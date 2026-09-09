// options.js - Logic & Firestore Persistence for Options Trading

import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { 
    collection, 
    addDoc, 
    getDocs, 
    query, 
    where, 
    orderBy, 
    doc, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// --- Constantes & Variables Globales ---
const DEFAULT_TITLE_ACCOUNT_ID = 'compte-actuel';
const TITLE_ACCOUNT_ACTIVE_KEY = 'titleActiveAccountId';
const TITLE_ACCOUNT_LIST_KEY = 'titleAccountList';
const TITLE_ACCOUNT_LEGACY_LABEL_KEY = 'titleLegacyAccountLabel';

// Taux de change EUR/USD (partagé avec app.js via localStorage)
let eurToUsdRate = parseFloat(localStorage.getItem('eurToUsdRate')) || 1.07;

// Google Sheet "Taux de conversion" (même document que les prix d'actions PEA, gid=940617889)
const GOOGLE_SHEET_CSV_BASE_OPT = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTia7alCKPRGtG-CLXkCffnTEytWlf12pML_6EtufxPmuSGDTDE4wlMlB_WSd8u2hRviDaCJ_bh06mv/pub?output=csv";
const GOOGLE_SHEET_TAUX_URL_OPT = `${GOOGLE_SHEET_CSV_BASE_OPT}&gid=940617889`;

let currentUser = null;
let allOptionsPositions = [];
let openStockPositionsByTicker = {}; // Ticker -> Nb d'actions détenues sur le compte sélectionné

// Graphiques Chart.js
let chartOptionTypesInstance = null;
let chartMonthlyPremiumsInstance = null;

// Modales Bootstrap
let newOptionModalInstance = null;
let closeOptionModalInstance = null;

// --- Initialisation DOM & Auth ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialiser les modales Bootstrap
    const newModalEl = document.getElementById('newOptionModal');
    if (newModalEl) newOptionModalInstance = new bootstrap.Modal(newModalEl);

    const closeModalEl = document.getElementById('closeOptionModal');
    if (closeModalEl) closeOptionModalInstance = new bootstrap.Modal(closeModalEl);

    // Écouteurs d'événements UI
    initEventListeners();

    // Récupérer le taux EUR/USD depuis Google Sheet au chargement
    fetchExchangeRateFromSheet();

    // Authentification Firebase
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            const userDisplay = document.getElementById('user-display');
            if (userDisplay) userDisplay.textContent = user.email;
            
            document.getElementById('auth-section').style.display = 'none';
            document.getElementById('options-app-content').style.display = 'block';

            // Charger les comptes & données
            await loadAccountSwitcher();
            await refreshData();
        } else {
            currentUser = null;
            document.getElementById('auth-section').style.display = 'block';
            document.getElementById('options-app-content').style.display = 'none';
        }
    });
});

// --- Récupération du taux EUR/USD depuis le Google Sheet ---
async function fetchExchangeRateFromSheet() {
    // Tentative 1 : Google Sheet "Taux de conversion"
    try {
        const response = await fetch(GOOGLE_SHEET_TAUX_URL_OPT, { cache: 'no-store' });
        if (response.ok) {
            const text = await response.text();
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            for (const line of lines) {
                // Format CSV: eurusd,"1,1614" -> virgule décimale française entre guillemets
                const quotedMatch = line.match(/"([^"]+)"/);
                let numericVal = NaN;
                if (quotedMatch) {
                    numericVal = parseFloat(quotedMatch[1].replace(',', '.'));
                } else {
                    const parts = line.split(',');
                    if (parts.length >= 2) numericVal = parseFloat(parts[1].trim());
                }
                if (!isNaN(numericVal) && numericVal > 0.5 && numericVal < 2.5) {
                    eurToUsdRate = numericVal;
                    localStorage.setItem('eurToUsdRate', eurToUsdRate.toString());
                    console.log(`[Options - Google Sheet] Taux EUR/USD : ${eurToUsdRate}`);
                    updateRateDisplay();
                    return;
                }
            }
        }
    } catch (e) {
        console.warn('[Options] Erreur lecture Google Sheet taux:', e);
    }

    // Tentative 2 (fallback) : API frankfurter.app
    try {
        const response = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD');
        const data = await response.json();
        if (data?.rates?.USD) {
            eurToUsdRate = data.rates.USD;
            localStorage.setItem('eurToUsdRate', eurToUsdRate.toString());
            console.log(`[Options - API Frankfurter] Taux EUR/USD : ${eurToUsdRate}`);
            updateRateDisplay();
        }
    } catch (e) {
        console.warn('[Options] API Frankfurter indisponible, utilisation du cache:', eurToUsdRate);
    }

    updateRateDisplay();
}

function updateRateDisplay() {
    const el = document.getElementById('eur-usd-rate-display');
    if (el) {
        el.textContent = `1 EUR = ${eurToUsdRate.toFixed(4)} USD`;
        el.title = `Taux mis à jour depuis votre Google Sheet "Taux de conversion"`;
    }
}

// --- Gestion des Comptes Titre ---
function normalizeStoredAccountId(value) {
    if (!value) return DEFAULT_TITLE_ACCOUNT_ID;
    const normalized = String(value).trim().toLowerCase();
    if (
        normalized === 'compte-actuel' ||
        normalized === 'compte actuel' ||
        normalized === 'compte actuel (données existantes)' ||
        normalized === 'compte titre ordinaire' ||
        normalized === 'compte-ordinaire' ||
        normalized === 'compte_ordinaire' ||
        normalized === 'trading (u21752904)'
    ) {
        return DEFAULT_TITLE_ACCOUNT_ID;
    }
    return String(value).trim().toUpperCase();
}

function getSelectedTitleAccountId() {
    return normalizeStoredAccountId(localStorage.getItem(TITLE_ACCOUNT_ACTIVE_KEY));
}

function getStoredTitleAccounts() {
    try {
        const raw = localStorage.getItem(TITLE_ACCOUNT_LIST_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(Boolean)
            .map(acc => {
                const item = typeof acc === 'string' ? JSON.parse(acc) : acc;
                const id = normalizeStoredAccountId(item?.id);
                if (!id || id === DEFAULT_TITLE_ACCOUNT_ID) return null;
                return { id, name: String(item?.name || '').trim() || id };
            })
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

async function fetchTitleAccountsFromFirestore() {
    if (!currentUser) return getStoredTitleAccounts();

    try {
        const titleAccountsQuery = query(collection(db, 'users', currentUser.uid, 'titleAccounts'), orderBy('updatedAt', 'asc'));
        const snapshot = await getDocs(titleAccountsQuery);

        const firestoreAccounts = snapshot.docs
            .map(docSnapshot => {
                const data = docSnapshot.data();
                const id = normalizeStoredAccountId(data.id || docSnapshot.id);
                const name = String(data.name || '').trim();
                if (!id || (id === DEFAULT_TITLE_ACCOUNT_ID && !name)) return null;
                return { id, name: name || id };
            })
            .filter(Boolean);

        const localAccounts = getStoredTitleAccounts();
        const merged = [...localAccounts];

        firestoreAccounts.forEach(fa => {
            if (fa.id !== DEFAULT_TITLE_ACCOUNT_ID && !merged.some(m => m.id === fa.id)) {
                merged.push(fa);
            }
        });

        localStorage.setItem(TITLE_ACCOUNT_LIST_KEY, JSON.stringify(merged.map(a => JSON.stringify(a))));
        return merged;
    } catch (error) {
        console.warn('Impossible de charger les comptes titre depuis Firestore:', error);
        return getStoredTitleAccounts();
    }
}

async function loadAccountSwitcher() {
    const activeId = getSelectedTitleAccountId();
    const storedAccounts = await fetchTitleAccountsFromFirestore();
    const labelEl = document.getElementById('account-switch-label');
    const menuEl = document.getElementById('account-switch-menu');
    const btnSwitch = document.getElementById('account-switch-button');

    if (!menuEl) return;

    // Libellé par défaut du compte principal
    const defaultLabel = localStorage.getItem(TITLE_ACCOUNT_LEGACY_LABEL_KEY) || 'Trading (U21752904)';
    
    let currentAccountName = defaultLabel;
    if (activeId !== DEFAULT_TITLE_ACCOUNT_ID) {
        const found = storedAccounts.find(a => normalizeStoredAccountId(a.id) === activeId);
        currentAccountName = found ? `${found.name} (${found.id})` : activeId;
    }

    if (labelEl) labelEl.textContent = currentAccountName;

    // Remplir le menu déroulant
    menuEl.innerHTML = '';

    // Option 1 : Compte Principal
    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = `dropdown-item text-white ${activeId === DEFAULT_TITLE_ACCOUNT_ID ? 'active' : ''}`;
    mainBtn.innerHTML = `<i class="bi bi-bank2 me-2 text-info"></i>${defaultLabel}`;
    mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuEl.classList.remove('open');
        switchAccount(DEFAULT_TITLE_ACCOUNT_ID);
    });
    menuEl.appendChild(mainBtn);

    // Option N : Autres comptes
    storedAccounts.forEach(acc => {
        const accIdNorm = normalizeStoredAccountId(acc.id);
        if (accIdNorm === DEFAULT_TITLE_ACCOUNT_ID) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `dropdown-item text-white ${activeId === accIdNorm ? 'active' : ''}`;
        btn.innerHTML = `<i class="bi bi-briefcase me-2 text-warning"></i>${acc.name} (${acc.id})`;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuEl.classList.remove('open');
            switchAccount(acc.id);
        });
        menuEl.appendChild(btn);
    });

    // Toggle d'ouverture/fermeture avec classe .open (style.css)
    if (btnSwitch) {
        btnSwitch.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            menuEl.classList.toggle('open');
        };

        // Clôture au clic à l'extérieur
        document.addEventListener('click', (e) => {
            if (!menuEl.contains(e.target) && !btnSwitch.contains(e.target)) {
                menuEl.classList.remove('open');
            }
        });
    }
}

async function switchAccount(accountId) {
    const normalized = normalizeStoredAccountId(accountId);
    localStorage.setItem(TITLE_ACCOUNT_ACTIVE_KEY, normalized);
    await loadAccountSwitcher();
    await refreshData();

    const label = getSelectedTitleAccountId() === DEFAULT_TITLE_ACCOUNT_ID ? 'Compte Principal' : normalized;
    showToast(`Compte actif : ${label}`, 'info');
}

// --- Chargement des Données depuis Firestore ---
async function refreshData() {
    if (!currentUser) return;

    try {
        // 1. Charger les positions sur actions ouvertes pour vérifier les Covered Calls
        await fetchOpenStockPositions();

        // 2. Charger les positions sur options
        const optionsRef = collection(db, 'users', currentUser.uid, 'optionsPositions');
        const snapshot = await getDocs(optionsRef);

        const currentAccountId = getSelectedTitleAccountId();

        allOptionsPositions = snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        })).filter(opt => {
            const optAcc = String(opt.accountId || DEFAULT_TITLE_ACCOUNT_ID).toUpperCase();
            return optAcc === currentAccountId || (currentAccountId === DEFAULT_TITLE_ACCOUNT_ID.toUpperCase() && optAcc === 'COMPTE-ACTUEL');
        });

        // Trier par date d'entrée descendant
        allOptionsPositions.sort((a, b) => new Date(b.entryDate || b.createdAt) - new Date(a.entryDate || a.createdAt));

        // Mettre à jour l'interface utilisateur
        renderKPIs();
        renderOpenOptionsTable();
        renderClosedOptionsTable();
        renderCharts();

    } catch (error) {
        console.error('Erreur lors du chargement des options:', error);
        showToast('Erreur lors du chargement des options depuis Firestore', 'error');
    }
}

// Récupérer les actions détenues sur le compte pour les Covered Calls
async function fetchOpenStockPositions() {
    openStockPositionsByTicker = {};
    if (!currentUser) return;

    try {
        const positionsRef = collection(db, 'users', currentUser.uid, 'positions');
        const q = query(positionsRef, where('status', '==', 'open'));
        const snapshot = await getDocs(q);

        const currentAccountId = getSelectedTitleAccountId();

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const posAcc = String(data.accountId || DEFAULT_TITLE_ACCOUNT_ID).toUpperCase();
            if (posAcc === currentAccountId || (currentAccountId === DEFAULT_TITLE_ACCOUNT_ID.toUpperCase() && posAcc === 'COMPTE-ACTUEL')) {
                const ticker = String(data.asset || '').trim().toUpperCase();
                if (!ticker) return;

                // Calcul de la quantité nette détenue (entrées - sorties)
                let netQty = 0;
                if (Array.isArray(data.entries)) {
                    netQty += data.entries.reduce((sum, e) => sum + (parseFloat(e.quantity) || 0), 0);
                }
                if (Array.isArray(data.exits)) {
                    netQty -= data.exits.reduce((sum, e) => sum + (parseFloat(e.quantity) || 0), 0);
                }

                openStockPositionsByTicker[ticker] = (openStockPositionsByTicker[ticker] || 0) + netQty;
            }
        });
    } catch (err) {
        console.warn('Impossible de lire les positions d\'actions pour Covered Call:', err);
    }
}

// --- Calculs et Rendu UI ---

function calculateOptionPnL(option) {
    const contracts = parseFloat(option.contracts) || 1;
    const multiplier = parseFloat(option.multiplier) || 100;
    const entryPrem = parseFloat(option.premiumPrice) || 0;
    const closePrem = parseFloat(option.closePremiumPrice) || 0;
    const entryComm = parseFloat(option.entryCommission) || 0;
    const exitComm = parseFloat(option.exitCommission) || 0;

    const entryTotal = entryPrem * contracts * multiplier;
    const closeTotal = closePrem * contracts * multiplier;

    if (option.status === 'open') return 0;

    let grossPnL = 0;
    if (option.closeReason === 'expired_otm') {
        grossPnL = option.side === 'sell' ? entryTotal : -entryTotal;
    } else if (option.side === 'buy') {
        grossPnL = closeTotal - entryTotal;
    } else {
        grossPnL = entryTotal - closeTotal;
    }

    // PnL Net = PnL Brut - Commission Entrée - Commission Sortie
    return grossPnL - entryComm - exitComm;
}

function calculateDTE(expirationDateStr) {
    if (!expirationDateStr) return 0;
    const exp = new Date(expirationDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);

    const diffTime = exp - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function renderKPIs() {
    let totalPnL = 0;
    let netPremiums = 0;
    let collateral = 0;
    let expiringSoonCount = 0;

    const openOptions = allOptionsPositions.filter(o => o.status === 'open');
    const closedOptions = allOptionsPositions.filter(o => o.status === 'closed');

    // Total PnL sur options clôturées
    closedOptions.forEach(opt => {
        totalPnL += calculateOptionPnL(opt);
    });

    // Primes nettes et collateral sur options ouvertes & clôturées
    allOptionsPositions.forEach(opt => {
        const contracts = parseFloat(opt.contracts) || 1;
        const multiplier = parseFloat(opt.multiplier) || 100;
        const prem = parseFloat(opt.premiumPrice) || 0;
        const totPrem = contracts * multiplier * prem;

        if (opt.side === 'sell') {
            netPremiums += totPrem;
        } else {
            netPremiums -= totPrem;
        }
    });

    // Collateral des Ventes de Put ouvertes
    openOptions.forEach(opt => {
        const dte = calculateDTE(opt.expirationDate);
        if (dte >= 0 && dte <= 7) expiringSoonCount++;

        if (opt.side === 'sell' && opt.optionType === 'put') {
            const contracts = parseFloat(opt.contracts) || 1;
            const multiplier = parseFloat(opt.multiplier) || 100;
            const strike = parseFloat(opt.strike) || 0;
            collateral += strike * contracts * multiplier;
        }
    });

    const elTotalPnL = document.getElementById('stat-total-pnl');
    if (elTotalPnL) {
        elTotalPnL.textContent = `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`;
        elTotalPnL.className = `fw-bold mb-0 ${totalPnL >= 0 ? 'text-success' : 'text-danger'}`;
    }

    const elNetPrem = document.getElementById('stat-net-premiums');
    if (elNetPrem) {
        elNetPrem.textContent = `$${netPremiums.toFixed(2)}`;
    }

    const elCollateral = document.getElementById('stat-collateral');
    if (elCollateral) {
        elCollateral.textContent = `$${collateral.toFixed(2)}`;
    }

    const elExpSoon = document.getElementById('stat-expiring-soon');
    if (elExpSoon) {
        elExpSoon.textContent = expiringSoonCount;
    }
}

function renderOpenOptionsTable() {
    const tbody = document.getElementById('open-options-table-body');
    if (!tbody) return;

    const openOptions = allOptionsPositions.filter(o => o.status === 'open');

    if (openOptions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-4 text-muted">
                    <i class="bi bi-inbox fs-2 d-block mb-2"></i>
                    Aucune position sur option ouverte pour le compte sélectionné.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = openOptions.map(opt => {
        const dte = calculateDTE(opt.expirationDate);
        let dteBadge = '';
        if (dte < 0) {
            dteBadge = `<span class="badge badge-dte-expired">🔴 Expiré (${Math.abs(dte)}j)</span>`;
        } else if (dte <= 7) {
            dteBadge = `<span class="badge badge-dte-warning">⚠️ ${dte}j restants</span>`;
        } else {
            dteBadge = `<span class="badge badge-dte-safe">🟢 ${dte}j restants</span>`;
        }

        let typeBadge = '';
        if (opt.optionType === 'call') {
            typeBadge = opt.side === 'buy' ? '<span class="badge badge-call-buy">Achat CALL</span>' : '<span class="badge badge-call-sell">Vente CALL</span>';
        } else {
            typeBadge = opt.side === 'buy' ? '<span class="badge badge-put-buy">Achat PUT</span>' : '<span class="badge badge-put-sell">Vente PUT</span>';
        }

        // Verification du statut de couverture (Covered Call ou Cash-Secured Put)
        let coverBadge = '';
        const ticker = String(opt.ticker || '').toUpperCase();
        const ownedShares = openStockPositionsByTicker[ticker] || 0;
        const requiredShares = (parseFloat(opt.contracts) || 1) * 100;

        if (opt.side === 'sell' && opt.optionType === 'call') {
            if (ownedShares >= requiredShares) {
                coverBadge = `<span class="badge badge-covered" title="${ownedShares} actions détenues"><i class="bi bi-shield-check me-1"></i>Covered (${ownedShares}/${requiredShares})</span>`;
            } else {
                coverBadge = `<span class="badge badge-uncovered" title="Seulement ${ownedShares} actions détenues"><i class="bi bi-exclamation-triangle me-1"></i>Naked Call (${ownedShares}/${requiredShares})</span>`;
            }
        } else if (opt.side === 'sell' && opt.optionType === 'put') {
            const collateralVal = (parseFloat(opt.strike) || 0) * requiredShares;
            coverBadge = `<span class="badge badge-cash-secured" title="Collateral $${collateralVal.toFixed(0)}"><i class="bi bi-shield-lock me-1"></i>Cash Secured</span>`;
        } else {
            coverBadge = `<span class="badge bg-secondary bg-opacity-20 text-white-50">Débit</span>`;
        }

        const contracts = parseFloat(opt.contracts) || 1;
        const multiplier = parseFloat(opt.multiplier) || 100;
        const premium = parseFloat(opt.premiumPrice) || 0;
        const totalPrem = contracts * multiplier * premium;

        return `
            <tr>
                <td class="fw-bold text-white fs-5">${escapeHtml(opt.ticker)}</td>
                <td>${typeBadge}</td>
                <td class="fw-bold">$${parseFloat(opt.strike).toFixed(2)}</td>
                <td>
                    <div class="small">${opt.expirationDate}</div>
                    <div>${dteBadge}</div>
                </td>
                <td class="fw-bold">${opt.contracts}</td>
                <td>$${premium.toFixed(2)}</td>
                <td class="fw-bold text-warning">$${totalPrem.toFixed(2)}</td>
                <td>${coverBadge}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary me-1 btn-edit-option" data-id="${opt.id}" title="Modifier">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-action-otm me-1 btn-quick-otm" data-id="${opt.id}" title="Marquer Expiré OTM (100% gain/perte)">
                        <i class="bi bi-check2-circle me-1"></i>OTM
                    </button>
                    <button class="btn btn-sm btn-action-close me-1 btn-quick-close" data-id="${opt.id}" title="Clôturer l'option">
                        <i class="bi bi-flag me-1"></i>Sortie
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-delete-option" data-id="${opt.id}" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Attacher les écouteurs d'événements des boutons d'action
    tbody.querySelectorAll('.btn-edit-option').forEach(btn => {
        btn.onclick = () => openEditModal(btn.dataset.id);
    });
    tbody.querySelectorAll('.btn-quick-otm').forEach(btn => {
        btn.onclick = () => handleQuickOTM(btn.dataset.id);
    });
    tbody.querySelectorAll('.btn-quick-close').forEach(btn => {
        btn.onclick = () => openCloseModal(btn.dataset.id);
    });
    tbody.querySelectorAll('.btn-delete-option').forEach(btn => {
        btn.onclick = () => handleDeleteOption(btn.dataset.id);
    });
}

function renderClosedOptionsTable() {
    const tbody = document.getElementById('closed-options-table-body');
    if (!tbody) return;

    const closedOptions = allOptionsPositions.filter(o => o.status === 'closed');

    if (closedOptions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-4 text-muted">
                    <i class="bi bi-clock-history fs-2 d-block mb-2"></i>
                    Aucune option clôturée.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = closedOptions.map(opt => {
        const pnl = calculateOptionPnL(opt);
        const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';

        let typeBadge = '';
        if (opt.optionType === 'call') {
            typeBadge = opt.side === 'buy' ? '<span class="badge badge-call-buy">Achat CALL</span>' : '<span class="badge badge-call-sell">Vente CALL</span>';
        } else {
            typeBadge = opt.side === 'buy' ? '<span class="badge badge-put-buy">Achat PUT</span>' : '<span class="badge badge-put-sell">Vente PUT</span>';
        }

        let reasonLabel = '';
        switch (opt.closeReason) {
            case 'expired_otm': reasonLabel = '✅ Expirée OTM'; break;
            case 'buy_to_close': reasonLabel = '🔄 Rachat/Revente'; break;
            case 'exercised_itm': reasonLabel = '⚡ Exercée/Assignée'; break;
            default: reasonLabel = 'Clôturée'; break;
        }

        const entryComm = parseFloat(opt.entryCommission) || 0;
        const exitComm = parseFloat(opt.exitCommission) || 0;
        const totalComms = entryComm + exitComm;
        const commTitle = totalComms > 0 ? `P/L Net après $${totalComms.toFixed(2)} de frais` : 'P/L Net';

        return `
            <tr>
                <td class="small text-white-50">${opt.closeDate ? opt.closeDate.replace('T', ' ') : '-'}</td>
                <td class="fw-bold text-white">${escapeHtml(opt.ticker)}</td>
                <td>${typeBadge}</td>
                <td class="fw-bold">$${parseFloat(opt.strike).toFixed(2)}</td>
                <td>$${parseFloat(opt.premiumPrice).toFixed(2)}</td>
                <td>$${parseFloat(opt.closePremiumPrice || 0).toFixed(2)}</td>
                <td><span class="badge bg-secondary bg-opacity-20 text-white-50">${reasonLabel}</span></td>
                <td class="fw-bold ${pnlClass}" title="${commTitle}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary me-1 btn-edit-option" data-id="${opt.id}" title="Modifier">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-delete-option" data-id="${opt.id}" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.btn-edit-option').forEach(btn => {
        btn.onclick = () => openEditModal(btn.dataset.id);
    });
    tbody.querySelectorAll('.btn-delete-option').forEach(btn => {
        btn.onclick = () => handleDeleteOption(btn.dataset.id);
    });
}

// Ouvrir la modale en mode Édition
function openEditModal(id) {
    const option = allOptionsPositions.find(o => o.id === id);
    if (!option) return;

    document.getElementById('opt-editing-id').value = id;

    const titleEl = document.getElementById('opt-modal-title');
    if (titleEl) {
        titleEl.innerHTML = `<i class="bi bi-pencil me-2 text-warning"></i>Modifier la Position : ${option.ticker} ${option.strike}$ ${option.optionType.toUpperCase()}`;
    }

    const saveBtn = document.getElementById('btn-save-new-option');
    if (saveBtn) {
        saveBtn.textContent = "Mettre à jour l'Option";
    }

    document.getElementById('opt-ticker').value = option.ticker || '';
    document.getElementById('opt-type').value = option.optionType || 'call';
    document.getElementById('opt-side').value = option.side || 'sell';
    document.getElementById('opt-strike').value = option.strike || '';
    document.getElementById('opt-expiration').value = option.expirationDate || '';
    document.getElementById('opt-entry-date').value = option.entryDate || new Date().toISOString().slice(0, 16);
    document.getElementById('opt-contracts').value = option.contracts || 1;
    document.getElementById('opt-premium').value = option.premiumPrice || 0;
    document.getElementById('opt-commission').value = option.entryCommission !== undefined ? option.entryCommission : 1.00;
    document.getElementById('opt-multiplier').value = option.multiplier || 100;
    document.getElementById('opt-notes').value = option.notes || '';

    updateCalculationsNewOption();
    newOptionModalInstance.show();
}

// --- Dynamic Form Event Listeners ---
function initEventListeners() {
    // Bouton Déconnexion
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => signOut(auth));
    }

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-theme');
        });
    }

    // Ouvrir Modale Nouvelle Option
    const btnOpenNew = document.getElementById('btn-open-new-option');
    if (btnOpenNew) {
        btnOpenNew.onclick = () => {
            document.getElementById('form-new-option').reset();
            document.getElementById('opt-editing-id').value = '';

            const titleEl = document.getElementById('opt-modal-title');
            if (titleEl) {
                titleEl.innerHTML = `<i class="bi bi-plus-circle me-2 text-warning"></i>Ouvrir une Position sur Option`;
            }

            const saveBtn = document.getElementById('btn-save-new-option');
            if (saveBtn) {
                saveBtn.textContent = "Enregistrer l'Option";
            }

            const now = new Date();
            const nowIso = now.toISOString().slice(0, 16);
            document.getElementById('opt-entry-date').value = nowIso;
            document.getElementById('opt-commission').value = '1.00';

            updateCalculationsNewOption();
            newOptionModalInstance.show();
        };
    }

    // Écouteurs de modification dans le formulaire Nouvelle Option
    ['opt-ticker', 'opt-type', 'opt-side', 'opt-strike', 'opt-contracts', 'opt-premium', 'opt-commission', 'opt-multiplier'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', updateCalculationsNewOption);
            input.addEventListener('change', updateCalculationsNewOption);
        }
    });

    // Enregistrer Nouvelle Option
    const btnSaveNew = document.getElementById('btn-save-new-option');
    if (btnSaveNew) {
        btnSaveNew.onclick = saveNewOption;
    }

    // Clôture Option Confirm
    const btnConfirmClose = document.getElementById('btn-confirm-close-option');
    if (btnConfirmClose) {
        btnConfirmClose.onclick = confirmCloseOption;
    }

    // Écouteur mode de clôture dans modale
    const closeReasonSelect = document.getElementById('close-opt-reason');
    if (closeReasonSelect) {
        closeReasonSelect.addEventListener('change', (e) => {
            const premInput = document.getElementById('close-opt-premium');
            if (e.target.value === 'expired_otm') {
                premInput.value = '0.00';
            }
            updateClosePnLPreview();
        });
    }

    const closePremInput = document.getElementById('close-opt-premium');
    if (closePremInput) {
        closePremInput.addEventListener('input', updateClosePnLPreview);
    }
    const closeCommInput = document.getElementById('close-opt-commission');
    if (closeCommInput) {
        closeCommInput.addEventListener('input', updateClosePnLPreview);
    }
}

// Mise à jour en direct des calculs du formulaire Nouvelle Option
function updateCalculationsNewOption() {
    const ticker = (document.getElementById('opt-ticker').value || '').trim().toUpperCase();
    const optType = document.getElementById('opt-type').value;
    const optSide = document.getElementById('opt-side').value;
    const strike = parseFloat(document.getElementById('opt-strike').value) || 0;
    const contracts = parseFloat(document.getElementById('opt-contracts').value) || 1;
    const premium = parseFloat(document.getElementById('opt-premium').value) || 0;
    const commission = parseFloat(document.getElementById('opt-commission').value) || 0;
    const multiplier = parseFloat(document.getElementById('opt-multiplier').value) || 100;

    const totalPremium = contracts * multiplier * premium;
    const netPremium = optSide === 'sell' ? totalPremium - commission : totalPremium + commission;
    const collateral = strike * contracts * multiplier;

    document.getElementById('opt-calc-total-premium').textContent = `$${totalPremium.toFixed(2)}`;
    const netElem = document.getElementById('opt-calc-net-premium');
    if (netElem) netElem.textContent = `$${netPremium.toFixed(2)}`;
    document.getElementById('opt-calc-collateral').textContent = `$${collateral.toFixed(2)}`;

    // Mise à jour du texte d'explication pédagogique
    const explanationSpan = document.getElementById('opt-explanation-text');
    if (explanationSpan) {
        if (optType === 'call' && optSide === 'sell') {
            explanationSpan.innerHTML = `<strong>Vente de Call (Short Call / Covered Call) :</strong> Vous encaissez immédiatement la prime ($). 📉 <strong>On parie à la baisse (ou à la stabilité)</strong> sous le Strike. (Si le cours dépasse le Strike, vos 100 actions seront vendues au Strike).`;
        } else if (optType === 'put' && optSide === 'sell') {
            explanationSpan.innerHTML = `<strong>Vente de Put (Cash-Secured Put) :</strong> Vous encaissez immédiatement la prime ($). 📈 <strong>On parie à la hausse (ou à la stabilité)</strong> au-dessus du Strike. (Si le cours baisse sous le Strike, vous vous engagez à acheter 100 actions au Strike).`;
        } else if (optType === 'call' && optSide === 'buy') {
            explanationSpan.innerHTML = `<strong>Achat de Call (Long Call) :</strong> Vous payez la prime ($). 📈 <strong>On parie à la hausse</strong> du sous-jacent au-dessus du Strike.`;
        } else if (optType === 'put' && optSide === 'buy') {
            explanationSpan.innerHTML = `<strong>Achat de Put (Long Put / Couverture) :</strong> Vous payez la prime ($). 📉 <strong>On parie à la baisse</strong> du sous-jacent sous le Strike (spéculation baissière ou protection de portefeuille).`;
        }
    }

    // Condition d'affichage du collateral
    const collateralRow = document.getElementById('opt-calc-collateral-row');
    if (optSide === 'sell' && optType === 'put') {
        collateralRow.style.display = 'flex';
    } else {
        collateralRow.style.display = 'none';
    }

    // Détection Covered Call par rapport aux 100 actions détenues dans le compte
    const coveredStatusDiv = document.getElementById('opt-covered-call-status');
    const coveredMsgSpan = document.getElementById('opt-covered-call-msg');

    if (optSide === 'sell' && optType === 'call' && ticker) {
        const ownedShares = openStockPositionsByTicker[ticker] || 0;
        const requiredShares = contracts * 100;

        coveredStatusDiv.classList.remove('d-none');
        if (ownedShares >= requiredShares) {
            coveredStatusDiv.className = 'alert alert-success mb-3';
            coveredMsgSpan.innerHTML = `<i class="bi bi-shield-check me-2"></i><strong>Covered Call Sécurisé :</strong> Vous possédez <strong>${ownedShares}</strong> actions ${ticker} dans ce compte (besoin de ${requiredShares} actions).`;
        } else {
            coveredStatusDiv.className = 'alert alert-warning mb-3';
            coveredMsgSpan.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i><strong>Attention - Call Nu (Naked Call) :</strong> Vous possédez ${ownedShares} actions ${ticker} dans ce compte (${requiredShares} requises pour être couvert).`;
        }
    } else {
        coveredStatusDiv.classList.add('d-none');
    }
}

// Sauvegarder l'option dans Firestore (Création ou Édition)
async function saveNewOption() {
    if (!currentUser) return;

    const editingId = document.getElementById('opt-editing-id').value;
    const ticker = (document.getElementById('opt-ticker').value || '').trim().toUpperCase();
    const optionType = document.getElementById('opt-type').value;
    const side = document.getElementById('opt-side').value;
    const strike = parseFloat(document.getElementById('opt-strike').value);
    const expirationDate = document.getElementById('opt-expiration').value;
    const entryDate = document.getElementById('opt-entry-date').value;
    const contracts = parseInt(document.getElementById('opt-contracts').value) || 1;
    const premiumPrice = parseFloat(document.getElementById('opt-premium').value);
    const entryCommission = parseFloat(document.getElementById('opt-commission').value) || 0;
    const multiplier = parseInt(document.getElementById('opt-multiplier').value) || 100;
    const notes = (document.getElementById('opt-notes').value || '').trim();

    if (!ticker || isNaN(strike) || !expirationDate || !entryDate || isNaN(premiumPrice)) {
        showToast('Veuillez remplir tous les champs obligatoires correctement.', 'error');
        return;
    }

    const payload = {
        accountId: getSelectedTitleAccountId(),
        ticker,
        optionType,
        side,
        strike,
        expirationDate,
        entryDate,
        contracts,
        premiumPrice,
        entryCommission,
        multiplier,
        notes,
        updatedAt: Date.now()
    };

    try {
        if (editingId) {
            const docRef = doc(db, 'users', currentUser.uid, 'optionsPositions', editingId);
            await updateDoc(docRef, payload);
            showToast(`Option ${ticker} mise à jour avec succès !`, 'success');
        } else {
            payload.status = 'open';
            payload.createdAt = Date.now();
            const optionsRef = collection(db, 'users', currentUser.uid, 'optionsPositions');
            await addDoc(optionsRef, payload);
            showToast(`Option ${ticker} enregistrée avec succès !`, 'success');
        }

        newOptionModalInstance.hide();
        await refreshData();

    } catch (err) {
        console.error('Erreur sauvegarde option:', err);
        showToast('Impossible d\'enregistrer l\'option.', 'error');
    }
}

// Clôture rapide OTM (Expirée sans valeur)
async function handleQuickOTM(id) {
    if (!currentUser || !id) return;

    const result = await Swal.fire({
        title: 'Expirer Sans Valeur (OTM) ?',
        text: "Cette action va clôturer l'option avec un prix de sortie de $0.00 (100% de la prime conservée ou perdue).",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Oui, valider OTM',
        cancelButtonText: 'Annuler'
    });

    if (result.isConfirmed) {
        try {
            const docRef = doc(db, 'users', currentUser.uid, 'optionsPositions', id);
            await updateDoc(docRef, {
                status: 'closed',
                closeReason: 'expired_otm',
                closeDate: new Date().toISOString().slice(0, 16),
                closePremiumPrice: 0,
                exitCommission: 0,
                updatedAt: Date.now()
            });

            showToast('Option clôturée avec succès en Expiration OTM !', 'success');
            await refreshData();
        } catch (err) {
            console.error('Erreur clôture OTM:', err);
            showToast('Erreur lors de la clôture OTM', 'error');
        }
    }
}

// Ouvrir la modale de clôture sur mesure
function openCloseModal(id) {
    const option = allOptionsPositions.find(o => o.id === id);
    if (!option) return;

    document.getElementById('close-opt-id').value = id;
    document.getElementById('close-opt-ticker-title').textContent = `${option.ticker} ${option.strike}$ ${option.optionType.toUpperCase()}`;
    document.getElementById('close-opt-date').value = new Date().toISOString().slice(0, 16);
    document.getElementById('close-opt-premium').value = '0.00';
    document.getElementById('close-opt-commission').value = '1.00';
    document.getElementById('close-opt-reason').value = 'expired_otm';

    updateClosePnLPreview();
    closeOptionModalInstance.show();
}

function updateClosePnLPreview() {
    const id = document.getElementById('close-opt-id').value;
    const option = allOptionsPositions.find(o => o.id === id);
    if (!option) return;

    const closePrem = parseFloat(document.getElementById('close-opt-premium').value) || 0;
    const closeComm = parseFloat(document.getElementById('close-opt-commission').value) || 0;
    const reason = document.getElementById('close-opt-reason').value;

    const entryComm = parseFloat(option.entryCommission) || 0;
    const totalComms = entryComm + closeComm;

    const contracts = parseFloat(option.contracts) || 1;
    const multiplier = parseFloat(option.multiplier) || 100;
    const entryPrem = parseFloat(option.premiumPrice) || 0;

    const entryTotal = entryPrem * contracts * multiplier;
    const closeTotal = closePrem * contracts * multiplier;

    let grossPnL = 0;
    if (reason === 'expired_otm') {
        grossPnL = option.side === 'sell' ? entryTotal : -entryTotal;
    } else if (option.side === 'buy') {
        grossPnL = closeTotal - entryTotal;
    } else {
        grossPnL = entryTotal - closeTotal;
    }

    const netPnL = grossPnL - totalComms;

    const grossElem = document.getElementById('close-opt-pnl-gross');
    if (grossElem) grossElem.textContent = `${grossPnL >= 0 ? '+' : ''}$${grossPnL.toFixed(2)}`;

    const commsElem = document.getElementById('close-opt-commissions-total');
    if (commsElem) commsElem.textContent = `$${totalComms.toFixed(2)}`;

    const pnlSpan = document.getElementById('close-opt-pnl-preview');
    if (pnlSpan) {
        pnlSpan.textContent = `${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`;
        pnlSpan.className = `fw-bold fs-5 ${netPnL >= 0 ? 'text-success' : 'text-danger'}`;
    }
}

async function confirmCloseOption() {
    if (!currentUser) return;

    const id = document.getElementById('close-opt-id').value;
    const closeReason = document.getElementById('close-opt-reason').value;
    const closeDate = document.getElementById('close-opt-date').value;
    const closePremiumPrice = parseFloat(document.getElementById('close-opt-premium').value) || 0;
    const exitCommission = parseFloat(document.getElementById('close-opt-commission').value) || 0;

    if (!id || !closeDate) {
        showToast('Veuillez remplir la date de clôture.', 'error');
        return;
    }

    try {
        const docRef = doc(db, 'users', currentUser.uid, 'optionsPositions', id);
        await updateDoc(docRef, {
            status: 'closed',
            closeReason,
            closeDate,
            closePremiumPrice,
            exitCommission,
            updatedAt: Date.now()
        });

        closeOptionModalInstance.hide();
        showToast('Option clôturée avec succès !', 'success');
        await refreshData();
    } catch (err) {
        console.error('Erreur clôture option:', err);
        showToast('Erreur lors de la clôture.', 'error');
    }
}

// Supprimer une option
async function handleDeleteOption(id) {
    if (!currentUser || !id) return;

    const result = await Swal.fire({
        title: 'Supprimer cette option ?',
        text: "Cette suppression est définitive.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Oui, supprimer',
        cancelButtonText: 'Annuler'
    });

    if (result.isConfirmed) {
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'optionsPositions', id));
            showToast('Option supprimée.', 'info');
            await refreshData();
        } catch (err) {
            console.error('Erreur suppression:', err);
            showToast('Erreur de suppression.', 'error');
        }
    }
}

// --- Rendu des Graphiques (Chart.js) ---
function renderCharts() {
    renderChartOptionTypes();
    renderChartMonthlyPremiums();
}

function renderChartOptionTypes() {
    const ctx = document.getElementById('chart-option-types');
    if (!ctx) return;

    const closed = allOptionsPositions.filter(o => o.status === 'closed');
    const pnlByType = {
        'Achat CALL': 0,
        'Vente CALL': 0,
        'Achat PUT': 0,
        'Vente PUT': 0
    };

    closed.forEach(opt => {
        let key = '';
        if (opt.optionType === 'call') {
            key = opt.side === 'buy' ? 'Achat CALL' : 'Vente CALL';
        } else {
            key = opt.side === 'buy' ? 'Achat PUT' : 'Vente PUT';
        }
        pnlByType[key] += calculateOptionPnL(opt);
    });

    if (chartOptionTypesInstance) chartOptionTypesInstance.destroy();

    chartOptionTypesInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(pnlByType),
            datasets: [{
                label: 'P/L Réalisé ($)',
                data: Object.values(pnlByType),
                backgroundColor: ['#10b981', '#06b6d4', '#ef4444', '#8b5cf6'],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: 'rgba(255, 255, 255, 0.08)' }
                },
                x: {
                    ticks: { color: '#9ca3af' },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderChartMonthlyPremiums() {
    const ctx = document.getElementById('chart-monthly-premiums');
    if (!ctx) return;

    // Regrouper les primes par Mois (YYYY-MM)
    const monthlyData = {};

    allOptionsPositions.forEach(opt => {
        const dateStr = opt.entryDate || opt.createdAt;
        if (!dateStr) return;
        const monthKey = new Date(dateStr).toISOString().slice(0, 7);

        const contracts = parseFloat(opt.contracts) || 1;
        const multiplier = parseFloat(opt.multiplier) || 100;
        const prem = parseFloat(opt.premiumPrice) || 0;
        const totPrem = contracts * multiplier * prem;

        if (!monthlyData[monthKey]) monthlyData[monthKey] = 0;

        if (opt.side === 'sell') {
            monthlyData[monthKey] += totPrem;
        } else {
            monthlyData[monthKey] -= totPrem;
        }
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    const sortedValues = sortedMonths.map(m => monthlyData[m]);

    if (chartMonthlyPremiumsInstance) chartMonthlyPremiumsInstance.destroy();

    chartMonthlyPremiumsInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedMonths.length ? sortedMonths : ['Aucune donnée'],
            datasets: [{
                label: 'Primes Nettes ($)',
                data: sortedValues.length ? sortedValues : [0],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                fill: true,
                tension: 0.3,
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: 'rgba(255, 255, 255, 0.08)' }
                },
                x: {
                    ticks: { color: '#9ca3af' },
                    grid: { display: false }
                }
            }
        }
    });
}

// --- Utility Functions ---
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
    let background = '#3b82f6';
    if (type === 'success') background = '#10b981';
    if (type === 'error') background = '#ef4444';
    if (type === 'warning') background = '#f59e0b';

    Toastify({
        text: message,
        duration: 3500,
        close: true,
        gravity: "top",
        position: "right",
        style: { background }
    }).showToast();
}
