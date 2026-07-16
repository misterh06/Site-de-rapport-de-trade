// app.js - VERSION FINALE CORRIGÉE

// --- Importations Firebase ---
import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, where, orderBy, doc, updateDoc, deleteDoc, arrayUnion, limit, startAfter, startAt } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { renderCharts, updateChartColors, initChartEventListeners } from './charts.js';

// --- Variables Globales ---
let openPositions = [];
let closedPositions = [];
let allClosedPositionsForStats = [];
let accountTransactions = [];
let currentUser = null;
const POSITIONS_PER_PAGE = 20;
let currentPage = 1;
let totalPages = 1;
let lastVisibleDoc = null;
let firstVisibleDocs = [null];
let strategies = [];
let totalClosedPositionsCount = 0;
let eurToUsdRate = parseFloat(localStorage.getItem('eurToUsdRate')) || 1.07; // Taux de change EUR/USD par défaut
let editingAccountTransactionId = null; // Pour l'édition des transactions de compte
const DEFAULT_TITLE_ACCOUNT_ID = 'compte-actuel';
const TITLE_ACCOUNT_ACTIVE_KEY = 'titleActiveAccountId';
const TITLE_ACCOUNT_LIST_KEY = 'titleAccountList';
const TITLE_ACCOUNT_TYPE_KEY = 'titleAccountType';
const TITLE_ACCOUNT_NUMBER_KEY = 'titleAccountNumber';
const TITLE_ACCOUNT_LEGACY_LABEL_KEY = 'titleLegacyAccountLabel';
const accountSwitchSelect = document.getElementById('account-switch-select');
const accountSwitchButton = document.getElementById('account-switch-button');
const accountSwitchLabel = document.getElementById('account-switch-label');
const accountSwitchMenu = document.getElementById('account-switch-menu');
const titleAccountForm = document.getElementById('title-account-form');
const newAccountNumberInput = document.getElementById('newAccountNumber');
const newAccountNameInput = document.getElementById('newAccountName');
const renameAccountForm = document.getElementById('rename-account-form');
const renameAccountSelect = document.getElementById('renameAccountSelect');
const renameAccountNameInput = document.getElementById('renameAccountName');

function getStoredTitleAccounts() {
    try {
        const raw = localStorage.getItem(TITLE_ACCOUNT_LIST_KEY);
        const parsed = raw ? JSON.parse(raw) : [];

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter(Boolean)
            .map(account => {
                const item = typeof account === 'string' ? JSON.parse(account) : account;
                const id = normalizeStoredAccountId(item?.id);

                if (!id || id === DEFAULT_TITLE_ACCOUNT_ID) {
                    return null;
                }

                return {
                    id,
                    name: String(item?.name || '').trim() || id
                };
            })
            .filter(Boolean);
    } catch (error) {
        console.warn('Impossible de lire la liste des comptes titre:', error);
        return [];
    }
}

function saveStoredTitleAccounts(accounts) {
    const normalizedAccounts = accounts
        .filter(Boolean)
        .map(account => {
            const id = normalizeStoredAccountId(account.id);
            return {
                id,
                name: String(account.name || '').trim() || id
            };
        })
        .filter(account => account.id && account.id !== DEFAULT_TITLE_ACCOUNT_ID);

    const uniqueAccounts = [];
    normalizedAccounts.forEach(account => {
        if (!uniqueAccounts.some(item => item.id === account.id)) uniqueAccounts.push(account);
    });

    localStorage.setItem(TITLE_ACCOUNT_LIST_KEY, JSON.stringify(uniqueAccounts.map(account => JSON.stringify(account))));
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

                if (!id || id === DEFAULT_TITLE_ACCOUNT_ID && !name) {
                    return null;
                }

                return { id, name: name || id };
            })
            .filter(Boolean);

        const legacyAccount = firestoreAccounts.find(account => normalizeStoredAccountId(account.id) === DEFAULT_TITLE_ACCOUNT_ID);
        if (legacyAccount && legacyAccount.name) {
            const lowerName = legacyAccount.name.toLowerCase();
            const nameToStore = (lowerName.includes('compte actuel') || lowerName.includes('compte-actuel') || lowerName.includes('compte d’origine') || lowerName.includes('compte d\'origine'))
                ? 'Trading (U21752904)' 
                : legacyAccount.name;
            localStorage.setItem(TITLE_ACCOUNT_LEGACY_LABEL_KEY, nameToStore);
        }

        const localAccounts = getStoredTitleAccounts();
        const firestoreMap = new Map(firestoreAccounts
            .filter(account => normalizeStoredAccountId(account.id) !== DEFAULT_TITLE_ACCOUNT_ID)
            .map(account => [account.id, account]));

        const mergedAccounts = localAccounts.map(account => {
            const firestoreEntry = firestoreMap.get(account.id);
            return firestoreEntry ? { id: account.id, name: firestoreEntry.name || account.name } : account;
        });

        firestoreAccounts
            .filter(account => normalizeStoredAccountId(account.id) !== DEFAULT_TITLE_ACCOUNT_ID)
            .forEach(account => {
                if (!mergedAccounts.some(item => item.id === account.id)) {
                    mergedAccounts.push(account);
                }
            });

        saveStoredTitleAccounts(mergedAccounts);
        return mergedAccounts;
    } catch (error) {
        console.warn('Impossible de charger les comptes titre depuis Firestore:', error);
        return getStoredTitleAccounts();
    }
}

async function syncTitleAccountsToFirestore(accounts, legacyLabel = null) {
    if (!currentUser) return;

    try {
        const titleAccountsRef = collection(db, 'users', currentUser.uid, 'titleAccounts');
        const snapshot = await getDocs(query(titleAccountsRef, orderBy('updatedAt', 'asc')));
        const existingDocs = new Map();

        snapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();
            const id = normalizeStoredAccountId(data.id || docSnapshot.id);
            if (id) {
                existingDocs.set(id.toLowerCase(), docSnapshot.ref);
            }
        });

        const entries = [];
        if (legacyLabel !== null || getLegacyTitleAccountLabel()) {
            const legacyAccountName = (legacyLabel ?? getLegacyTitleAccountLabel());
            entries.push({
                id: DEFAULT_TITLE_ACCOUNT_ID,
                name: String(legacyAccountName).trim()
            });
        }

        (accounts || getStoredTitleAccounts()).forEach(account => {
            entries.push({
                id: normalizeStoredAccountId(account.id),
                name: String(account.name || '').trim() || String(account.id || '').trim()
            });
        });

        for (const entry of entries) {
            const normalizedId = normalizeStoredAccountId(entry.id); 
            const ref = existingDocs.get(normalizedId.toLowerCase());
            const payload = { id: normalizedId, name: entry.name, updatedAt: Date.now() };

            if (ref) {
                await updateDoc(ref, payload);
            } else {
                await addDoc(titleAccountsRef, { ...payload, createdAt: Date.now() });
            }
        }
    } catch (error) {
        console.warn('Impossible de synchroniser les comptes titre vers Firestore:', error);
    }
}

function normalizeStoredAccountId(value) {
    if (!value) {
        return DEFAULT_TITLE_ACCOUNT_ID;
    }

    const normalizedValue = String(value).trim().toLowerCase();

    if (
        normalizedValue === 'compte-actuel' ||
        normalizedValue === 'compte actuel' ||
        normalizedValue === 'compte actuel (données existantes)' ||
        normalizedValue === 'compte titre ordinaire' ||
        normalizedValue === 'compte-ordinaire' ||
        normalizedValue === 'compte_ordinaire' ||
        normalizedValue === 'trading (u21752904)'
    ) {
        return DEFAULT_TITLE_ACCOUNT_ID;
    }

    return String(value).trim().toUpperCase();
}

function getSelectedTitleAccountId() {
    return normalizeStoredAccountId(localStorage.getItem(TITLE_ACCOUNT_ACTIVE_KEY) || localStorage.getItem(TITLE_ACCOUNT_TYPE_KEY) || DEFAULT_TITLE_ACCOUNT_ID);
}

function getLegacyTitleAccountLabel() {
    const savedLabel = String(localStorage.getItem(TITLE_ACCOUNT_LEGACY_LABEL_KEY) || '').trim();
    const lowerLabel = savedLabel.toLowerCase();
    if (!savedLabel || 
        lowerLabel.includes('compte actuel') || 
        lowerLabel.includes('compte-actuel') || 
        lowerLabel.includes('compte d’origine') || 
        lowerLabel.includes('compte d\'origine')) {
        return 'Trading (U21752904)';
    }
    return savedLabel;
}

function getSelectedTitleAccountLabel() {
    const selectedAccountId = getSelectedTitleAccountId();

    if (selectedAccountId === DEFAULT_TITLE_ACCOUNT_ID) {
        return getLegacyTitleAccountLabel();
    }

    const accounts = getStoredTitleAccounts();
    const matchedAccount = accounts.find(account => account.id === selectedAccountId);
    return matchedAccount ? `${matchedAccount.name} (${matchedAccount.id})` : selectedAccountId;
}

function normalizeAccountId(value) {
    return String(value || '').trim().toUpperCase();
}

function isCurrentAccountAlias(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return [
        'compte-actuel',
        'compte actuel',
        'compte actuel (données existantes)',
        'compte titre ordinaire',
        'compte-ordinaire',
        'compte_ordinaire',
        'trading (u21752904)'
    ].includes(normalized);
}

function isDocumentForSelectedAccount(documentData, selectedAccountId) {
    if (!documentData) return false;

    const normalizedSelectedAccountId = normalizeAccountId(selectedAccountId);
    const documentAccountId = documentData.accountId ? normalizeAccountId(documentData.accountId) : null;

    if (documentAccountId) {
        if (normalizedSelectedAccountId === normalizeAccountId(DEFAULT_TITLE_ACCOUNT_ID)) {
            return documentAccountId === normalizeAccountId(DEFAULT_TITLE_ACCOUNT_ID) || isCurrentAccountAlias(documentData.accountId);
        }

        return documentAccountId === normalizedSelectedAccountId;
    }

    // Compatibilité avec les anciennes données déjà présentes : sans accountId, elles appartiennent au compte actuel.
    return normalizedSelectedAccountId === normalizeAccountId(DEFAULT_TITLE_ACCOUNT_ID);
}

// --- Références aux éléments du DOM ---
const mainSidebar = document.getElementById('main-sidebar');
const mainContentArea = document.getElementById('main-content-area');
const sectionTitle = document.getElementById('section-title');
const navLinks = document.querySelectorAll('#main-sidebar .nav-link');
const contentSections = document.querySelectorAll('.content-section');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');
const editPositionModal = new bootstrap.Modal(document.getElementById('editPositionModal'));
const editPositionModalTitle = document.getElementById('editPositionModalTitle');
const entriesList = document.getElementById('entries-list');
const editEntryForm = document.getElementById('edit-entry-form');
const editEntryFormTitle = document.getElementById('edit-entry-form-title');
const editPositionIdInput = document.getElementById('editPositionId');
const editEntryIndexInput = document.getElementById('editEntryIndex');
const editEntryDateInput = document.getElementById('editEntryDate');
const editEntryQuantityInput = document.getElementById('editEntryQuantity');
const editEntryPriceInput = document.getElementById('editEntryPrice');
const cancelEntryEditBtn = document.getElementById('cancel-entry-edit-btn');
// const editPositionStrategySelect = document.getElementById('editPositionStrategySelect'); // Supprimé
const paginationCountInfo = document.getElementById('pagination-count-info');
// Stratégies
const strategyModal = new bootstrap.Modal(document.getElementById('strategyModal'));
const manageStrategiesBtn = document.getElementById('manage-strategies-btn');
const strategyForm = document.getElementById('strategy-form');
const strategyFormTitle = document.getElementById('strategy-form-title');
const strategyIdInput = document.getElementById('strategyId');
const strategyTitleInput = document.getElementById('strategyTitle');
const strategyDetailsInput = document.getElementById('strategyDetails');
const strategyList = document.getElementById('strategy-list');
const cancelEditStrategyBtn = document.getElementById('cancel-edit-strategy-btn');
// const positionStrategySelect = document.getElementById('positionStrategy'); // Supprimé
// Auth
const authSection = document.getElementById('auth-section');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const authErrorMessage = document.getElementById('auth-error-message');
const loginEmailInput = document.getElementById('loginEmail');
const loginPasswordInput = document.getElementById('loginPassword');
const signupEmailInput = document.getElementById('signupEmail');
const signupPasswordInput = document.getElementById('signupPassword');
// Positions Ouvertes
const openPositionsBody = document.getElementById('open-positions-body');
const showNewPositionFormBtn = document.getElementById('show-new-position-form-btn');
const allPositionsBody = document.getElementById('all-trades-body');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const paginationInfo = document.getElementById('pagination-info');
// Tableau de Bord & Rapports
const totalProfitLossSpan = document.getElementById('total-profit-loss');
const winRateSpan = document.getElementById('win-rate');
const totalTradesSpan = document.getElementById('total-trades');
const lastTradesBody = document.getElementById('last-trades-body');
// Modale
const positionModal = new bootstrap.Modal(document.getElementById('positionModal'));
const positionModalLabel = document.getElementById('positionModalLabel');
const positionForm = document.getElementById('position-form');
const positionIdInput = document.getElementById('positionId');
const formActionInput = document.getElementById('formAction');
const positionAssetInput = document.getElementById('positionAsset');
const positionTypeInput = document.getElementById('positionType');
const transactionDateInput = document.getElementById('transactionDate');
const transactionQuantityInput = document.getElementById('transactionQuantity');
const transactionPriceInput = document.getElementById('transactionPrice');
const positionNotesInput = document.getElementById('positionNotes');
const savePositionBtn = document.getElementById('save-position-btn');
const assetGroup = document.getElementById('asset-group');
const typeGroup = document.getElementById('type-group');
const notesGroup = document.getElementById('notes-group');

// --- Fonctions d'Authentification ---
function showAuthError(message) { authErrorMessage.textContent = message; authErrorMessage.classList.remove('d-none'); }
function hideAuthError() { authErrorMessage.classList.add('d-none'); authErrorMessage.textContent = ''; }
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault(); hideAuthError();
    try { await createUserWithEmailAndPassword(auth, signupEmailInput.value, signupPasswordInput.value); signupForm.reset(); }
    catch (error) { showAuthError(error.message); }
});
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); hideAuthError();
    try { await signInWithEmailAndPassword(auth, loginEmailInput.value, loginPasswordInput.value); loginForm.reset(); }
    catch (error) { showAuthError(error.message); }
});
logoutBtn.addEventListener('click', () => { signOut(auth); });

// --- Gestion de l'état de l'utilisateur (onAuthStateChanged) ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // L'utilisateur est connecté
        currentUser = user;
        userDisplay.textContent = user.email;
        mainSidebar.classList.remove('d-none');

        // ---- DÉBUT DES MODIFICATIONS ----

        // Réinitialiser l'état de la pagination à chaque nouvelle connexion
        currentPage = 1;
        totalPages = 1;
        lastVisibleDoc = null;
        // firstVisibleDocs = [null]; // Cette ligne est devenue moins critique avec la nouvelle logique, mais on peut la laisser pour éviter des erreurs.

        await fetchTitleAccountsFromFirestore();
        refreshTitleAccountSelection();

        // Lancer les deux chargements de données en parallèle pour plus de rapidité
        await Promise.all([
            fetchStaticData(), // Charge les positions ouvertes et les transactions de compte
            fetchData(),
            fetchAllClosedPositionsForStats(),
            fetchStrategies(),      // Charge la première page de l'historique des positions clôturées
            fetchExchangeRate()      // Récupère le taux de change EUR/USD
        ]);

        // Une fois TOUTES les données chargées, on met à jour l'interface
        updateAllViews();
        updateChartColors(localStorage.getItem('theme') || 'light');
        showSection('dashboard');

        // ---- FIN DES MODIFICATIONS ----

    } else {
        // L'utilisateur est déconnecté
        currentUser = null;
        openPositions = [];
        closedPositions = [];
        accountTransactions = [];
        userDisplay.textContent = '';
        mainSidebar.classList.add('d-none');
        updateAllViews(); // Met à jour l'interface pour qu'elle soit vide
        showSection('auth-section');
    }
})

    ;

// --- Fonction pour récupérer le taux de change EUR/USD ---
async function fetchExchangeRate() {
    try {
        const response = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD');
        const data = await response.json();
        if (data && data.rates && data.rates.USD) {
            eurToUsdRate = data.rates.USD;
            localStorage.setItem('eurToUsdRate', eurToUsdRate.toString());
            console.log(`Taux EUR/USD mis à jour : ${eurToUsdRate}`);
        }
    } catch (error) {
        console.warn('Erreur lors de la récupération du taux de change, utilisation du taux par défaut', error);
        // On garde la valeur par défaut ou celle stockée en cache
    }
}

async function fetchStrategies() {
    if (!currentUser) return;
    try {
        const q = query(collection(db, 'users', currentUser.uid, 'strategies'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        strategies = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Erreur de chargement des stratégies:", error);
    }
}

async function fetchStaticData() {
    if (!currentUser) return;
    try {
        const selectedAccountId = getSelectedTitleAccountId();
        const openPositionsQuery = query(collection(db, 'users', currentUser.uid, 'positions'), where('status', '==', 'open'), orderBy('createdAt', 'desc'));
        const transactionsQuery = query(collection(db, 'users', currentUser.uid, 'accountTransactions'));

        const [openSnapshot, transactionsSnapshot] = await Promise.all([getDocs(openPositionsQuery), getDocs(transactionsQuery)]);

        openPositions = openSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(pos => isDocumentForSelectedAccount(pos, selectedAccountId));

        accountTransactions = transactionsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(tx => isDocumentForSelectedAccount(tx, selectedAccountId));

        openPositions.forEach(p => {
            if (p.entries) p.entries.forEach(e => e.date = e.date.toDate());
        });
        accountTransactions.forEach(t => {
            if (t.date && typeof t.date.toDate === 'function') {
                t.date = t.date.toDate();
            }
        });

    } catch (error) {
        console.error("Erreur de chargement des données statiques:", error);
    }
}

// --- Logique principale ---
async function fetchData(direction = null) {
    if (!currentUser) return;
    try {
        const closedPositionsCol = collection(db, 'users', currentUser.uid, 'positions');
        const selectedAccountId = getSelectedTitleAccountId();
        let qClosed;

        if (direction === 'next') {
            qClosed = query(closedPositionsCol, where('status', '==', 'closed'), orderBy('createdAt', 'desc'), startAfter(lastVisibleDoc), limit(POSITIONS_PER_PAGE));
        } else {
            qClosed = query(closedPositionsCol, where('status', '==', 'closed'), orderBy('createdAt', 'desc'), limit(POSITIONS_PER_PAGE));
            if (direction === null) {
                const countQuery = query(closedPositionsCol, where('status', '==', 'closed'));
                const countSnapshot = await getDocs(countQuery);
                const allClosedForCount = countSnapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(pos => isDocumentForSelectedAccount(pos, selectedAccountId));
                totalClosedPositionsCount = allClosedForCount.length;
                totalPages = Math.ceil(allClosedForCount.length / POSITIONS_PER_PAGE) || 1;
            }
        }

        const closedSnapshot = await getDocs(qClosed);
        if (!closedSnapshot.empty) {
            lastVisibleDoc = closedSnapshot.docs[closedSnapshot.docs.length - 1];
        }

        closedPositions = closedSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(pos => isDocumentForSelectedAccount(pos, selectedAccountId));
        closedPositions.forEach(p => {
            if (p.entries) p.entries.forEach(e => e.date = e.date.toDate());
            if (p.exits) p.exits.forEach(ex => ex.date = ex.date.toDate());
        });

        updatePaginationControls(closedSnapshot.size);

    } catch (error) {
        console.error("Erreur de chargement des données paginées:", error);
    }
}
async function fetchAllClosedPositionsForStats() {
    if (!currentUser) return;
    try {
        allClosedPositionsForStats = [];

        const selectedAccountId = getSelectedTitleAccountId();
        const q = query(collection(db, 'users', currentUser.uid, 'positions'), where('status', '==', 'closed'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        const positionsTemp = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(pos => isDocumentForSelectedAccount(pos, selectedAccountId));

        positionsTemp.forEach(p => {
            if (p.entries) p.entries.forEach(e => e.date = e.date.toDate());
            if (p.exits) p.exits.forEach(ex => ex.date = ex.date.toDate());
        });

        allClosedPositionsForStats = positionsTemp;

    } catch (error) {
        console.error("Erreur lors du chargement de toutes les positions clôturées:", error);
    }
}

// --- GESTION DES STRATÉGIES ---

function renderStrategies() {
    strategyList.innerHTML = ''; // Vider la liste
    if (strategies.length === 0) {
        strategyList.innerHTML = '<p class="text-muted">Aucune stratégie enregistrée.</p>';
        return;
    }

    strategies.forEach(strat => {
        const stratItem = document.createElement('div');
        // On utilise la classe 'list-group-item' qui est plus simple
        stratItem.className = 'list-group-item d-flex justify-content-between align-items-center';

        // --- ✨ HTML CORRIGÉ AVEC LES BOUTONS ---
        stratItem.innerHTML = `
            <div>
                <h6 class="mb-0">${strat.title}</h6>
                <small class="text-muted">${strat.details || 'Aucun détail'}</small>
            </div>
            <div>
                <button class="btn btn-sm btn-outline-primary me-2" onclick="editStrategy('${strat.id}')" title="Modifier">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteStrategy('${strat.id}')" title="Supprimer">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        strategyList.appendChild(stratItem);
    });
}


manageStrategiesBtn.addEventListener('click', () => {
    renderStrategies();
    strategyModal.show();
});

strategyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = strategyIdInput.value;
    const data = {
        title: strategyTitleInput.value,
        details: strategyDetailsInput.value,
        createdAt: new Date()
    };

    try {
        if (id) { // Mise à jour
            const stratRef = doc(db, 'users', currentUser.uid, 'strategies', id);
            await updateDoc(stratRef, data);
        } else { // Création
            await addDoc(collection(db, 'users', currentUser.uid, 'strategies'), data);
        }

        strategyForm.reset();
        strategyIdInput.value = '';
        strategyFormTitle.textContent = 'Ajouter une nouvelle stratégie';
        cancelEditStrategyBtn.style.display = 'none';

        await fetchStrategies(); // Recharger les stratégies
        renderStrategies(); // Mettre à jour la liste dans la modale
    } catch (error) {
        console.error("Erreur sauvegarde stratégie:", error);
    }
});

window.editStrategy = (id) => {
    const strat = strategies.find(s => s.id === id);
    if (!strat) return;

    strategyIdInput.value = strat.id;
    strategyTitleInput.value = strat.title;
    strategyDetailsInput.value = strat.details;
    strategyFormTitle.textContent = 'Modifier la stratégie';
    cancelEditStrategyBtn.style.display = 'inline-block';
};


cancelEditStrategyBtn.addEventListener('click', () => {
    strategyForm.reset();
    strategyIdInput.value = '';
    strategyFormTitle.textContent = 'Ajouter une nouvelle stratégie';
    cancelEditStrategyBtn.style.display = 'none';
});

window.deleteStrategy = async (id) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette stratégie ?')) {
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'strategies', id));
            await fetchStrategies();
            renderStrategies();
        } catch (error) {
            console.error("Erreur suppression stratégie:", error);
        }
    }
};

function updatePaginationControls(currentSize) {
    // Affichage du nombre de positions
    if (totalClosedPositionsCount > 0) {
        const startItem = (currentPage - 1) * POSITIONS_PER_PAGE + 1;
        const endItem = Math.min(currentPage * POSITIONS_PER_PAGE, totalClosedPositionsCount);
        paginationCountInfo.textContent = `Affichage de ${startItem} à ${endItem} sur ${totalClosedPositionsCount} positions.`;
    } else {
        paginationCountInfo.textContent = 'Aucune position.';
    }

    // Affichage du numéro de page
    paginationInfo.textContent = `Page ${currentPage} sur ${totalPages}`;

    // Gestion de l'état des boutons
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages || currentSize < POSITIONS_PER_PAGE;
}
async function updateAllViews() {
    // Logique pour les positions
    renderOpenPositions();
    renderClosedPositionsHistory();
    renderLastClosedPositions();
    updateDashboardStats();
    renderCharts(allClosedPositionsForStats, strategies, getClosingDate, calculatePositionPnL);
    updateAccountBalances();
    renderAccountTransactions();
    updateDatalists();
}

function showSection(sectionId) {
    navLinks.forEach(link => link.classList.remove('active'));
    contentSections.forEach(section => section.classList.remove('active'));

    const activeSection = document.getElementById(sectionId);
    if (activeSection) {
        activeSection.classList.add('active');

        // --- MODIFICATION ICI ---
        // On redessine les graphiques APRES que la section soit devenue visible
        if (sectionId === 'dashboard' || sectionId === 'reports-analytics') {
            // On ajoute un délai de 50ms pour laisser le temps au navigateur de rendre la section
            setTimeout(() => {
                renderCharts(allClosedPositionsForStats, strategies, getClosingDate, calculatePositionPnL);
            }, 50); // Un petit délai suffit
        }
    }

    const activeLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (activeLink) activeLink.classList.add('active');

    sectionTitle.textContent = activeLink ? activeLink.textContent.trim() : 'Authentification';
}

function renderOpenPositions() {
    openPositionsBody.innerHTML = '';
    if (openPositions.length === 0) {
        openPositionsBody.innerHTML = '<tr><td colspan="7" class="text-center">Aucune position ouverte.</td></tr>';
        return;
    }
    openPositions.forEach(pos => {
        const metrics = calculatePositionMetrics(pos);

        // --- Calcul du P&L réalisé sur les sorties partielles ---
        let realizedPnLHtml = '<span class="text-muted">—</span>';
        if (metrics.totalExitQuantity > 0) {
            // Coût moyen des actions déjà vendues (basé sur le PRU d'entrée)
            const costOfExitedShares = metrics.totalExitQuantity * metrics.averageEntryPrice;
            let realizedPnL = 0;
            if (pos.type === 'long') {
                realizedPnL = metrics.totalExitValue - costOfExitedShares;
            } else {
                realizedPnL = costOfExitedShares - metrics.totalExitValue;
            }
            // Soustraire les frais déjà réglés
            realizedPnL -= metrics.totalFees;

            const color = realizedPnL >= 0 ? '#198754' : '#dc3545';
            const sign = realizedPnL >= 0 ? '+' : '';
            const exitInfo = `${metrics.totalExitQuantity} action(s) déjà clôturée(s)`;
            realizedPnLHtml = `
                <span class="fw-bold font-monospace" style="color: ${color};" title="${exitInfo}">
                    ${sign}${realizedPnL.toFixed(2)} ${pos.currency}
                </span>
                <br><small class="text-muted" style="font-size:0.7em;">${metrics.totalExitQuantity} clôturée(s)</small>`;
        }

        const row = openPositionsBody.insertRow();
        row.innerHTML = `
            <td class="fw-bold">${pos.asset}</td>
            <td>${pos.type === 'long' ? 'Achat' : 'Vente'}</td>
            <td>${metrics.currentQuantity}</td>
            <td class="font-monospace">${metrics.averageEntryPrice.toFixed(4)} ${pos.currency}</td>
            <td class="font-monospace">${(metrics.currentQuantity * metrics.averageEntryPrice).toFixed(2)} ${pos.currency}</td>
            <td>${realizedPnLHtml}</td>
            <td>
                <button class="btn btn-sm btn-success me-1" onclick="handleModifyPosition('${pos.id}', 'add')">Renforcer</button>
                <button class="btn btn-sm btn-warning me-1" onclick="handleModifyPosition('${pos.id}', 'close')">Clôturer</button>
                <button class="btn btn-sm btn-primary" onclick="handleEditPosition('${pos.id}')">Modifier</button>
            </td>`;
    });
}
// --- LOGIQUE D'ÉDITION DE POSITION ---

function showEditForm(show = true) {
    editEntryForm.style.display = show ? 'block' : 'none';
    editEntryFormTitle.style.display = show ? 'block' : 'none';
}

// Ouvre la modale et liste les entrées de la position
// Ouvre la modale et liste les entrées/sorties de la position
window.handleEditPosition = (positionId) => {
    // Chercher dans openPositions OU allClosedPositionsForStats
    let position = openPositions.find(p => p.id === positionId);
    if (!position && typeof allClosedPositionsForStats !== 'undefined') {
        position = allClosedPositionsForStats.find(p => p.id === positionId);
    }
    if (!position) return;

    editPositionModalTitle.textContent = `Modifier la position : ${position.asset}`;
    editPositionIdInput.value = positionId;

    // --- Remplir les paramètres globaux ---
    document.getElementById('editGlobalAsset').value = position.asset;
    document.getElementById('editGlobalType').value = position.type;
    document.getElementById('editGlobalCurrency').value = position.currency || 'USD';

    // --- Remplir les confluences ---
    document.querySelectorAll('.edit-confluence-check').forEach(cb => {
        cb.checked = position.confluences && position.confluences.includes(cb.value);
    });

    // --- Remplir la liste des entrées ---
    entriesList.innerHTML = '';
    if (position.entries) {
        position.entries.forEach((entry, index) => {
            const entryItem = document.createElement('a');
            entryItem.href = '#';
            entryItem.className = 'list-group-item list-group-item-action';
            entryItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <span class="badge bg-success me-2">Entrée #${index + 1}</span>
                        <strong>${formatDate(entry.date)}</strong>
                    </div>
                    <div class="text-end">
                        <div>Qté: <strong>${entry.quantity}</strong></div>
                        <div>Prix: <strong>${entry.price.toFixed(4)}</strong></div>
                    </div>
                </div>
            `;
            entryItem.onclick = (e) => {
                e.preventDefault();
                populateEntryForm(positionId, index, 'entry');
            };
            entriesList.appendChild(entryItem);
        });
    }

    // --- Remplir la liste des sorties ---
    const exitsList = document.getElementById('exits-list');
    exitsList.innerHTML = '';
    if (position.exits && position.exits.length > 0) {
        position.exits.forEach((exit, index) => {
            const exitItem = document.createElement('a');
            exitItem.href = '#';
            exitItem.className = 'list-group-item list-group-item-action';
            exitItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <span class="badge bg-danger me-2">Sortie #${index + 1}</span>
                        <strong>${formatDate(exit.date)}</strong>
                    </div>
                    <div class="text-end">
                        <div>Qté: <strong>${exit.quantity}</strong></div>
                        <div>Prix: <strong>${exit.price.toFixed(4)}</strong></div>
                    </div>
                </div>
            `;
            exitItem.onclick = (e) => {
                e.preventDefault();
                populateEntryForm(positionId, index, 'exit');
            };
            exitsList.appendChild(exitItem);
        });
    } else {
        exitsList.innerHTML = '<div class="text-muted small p-2">Aucune sortie enregistrée.</div>';
    }

    showEditForm(false);
    editPositionModal.show();
};

// Remplit le formulaire avec les données de la transaction sélectionnée
function populateEntryForm(positionId, index, type = 'entry') {
    let position = openPositions.find(p => p.id === positionId);
    if (!position && typeof allClosedPositionsForStats !== 'undefined') {
        position = allClosedPositionsForStats.find(p => p.id === positionId);
    }

    const transaction = type === 'entry' ? position.entries[index] : position.exits[index];

    document.getElementById('editTransactionType').value = type;
    editEntryIndexInput.value = index;

    // Gestion de la date locale pour l'input datetime-local
    const date = transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

    editEntryDateInput.value = localDate;
    editEntryQuantityInput.value = transaction.quantity;
    editEntryPriceInput.value = transaction.price;

    document.getElementById('edit-entry-form-title').textContent = type === 'entry' ? 'Modifier l\'entrée' : 'Modifier la sortie';
    document.getElementById('edit-entry-form-title').style.display = 'block';

    showEditForm(true);
}

// Gère la soumission du formulaire de modification des paramètres GLOBAUX
document.getElementById('edit-position-global-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const positionId = editPositionIdInput.value;
    const asset = document.getElementById('editGlobalAsset').value.toUpperCase();
    const type = document.getElementById('editGlobalType').value;
    const currency = document.getElementById('editGlobalCurrency').value.toUpperCase();

    // Récupérer les confluences
    const confluences = [];
    document.querySelectorAll('.edit-confluence-check:checked').forEach(cb => confluences.push(cb.value));

    try {
        const posRef = doc(db, 'users', currentUser.uid, 'positions', positionId);
        await updateDoc(posRef, {
            asset: asset,
            type: type,
            currency: currency,
            confluences: confluences
        });

        // Recharger les données
        await Promise.all([fetchStaticData(), fetchData(), fetchAllClosedPositionsForStats()]);
        updateAllViews();

        Toastify({ text: "Paramètres mis à jour.", className: "info", style: { background: "green" } }).showToast();
        editPositionModal.hide();

    } catch (error) {
        console.error("Erreur maj globale :", error);
        Toastify({ text: "Erreur lors de la mise à jour.", className: "info", style: { background: "red" } }).showToast();
    }
});

// Gère la soumission du formulaire d'édition de TRANSACTION
editEntryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const positionId = editPositionIdInput.value;
    const index = parseInt(editEntryIndexInput.value, 10);
    const type = document.getElementById('editTransactionType').value; // 'entry' ou 'exit'

    let position = openPositions.find(p => p.id === positionId);
    if (!position && typeof allClosedPositionsForStats !== 'undefined') {
        position = allClosedPositionsForStats.find(p => p.id === positionId);
    }

    if (!position || isNaN(index)) return;

    // On récupère une copie du tableau concerné
    const updatedTransactions = type === 'entry' ? [...position.entries] : [...position.exits];

    // On met à jour la transaction spécifique
    updatedTransactions[index] = {
        ...updatedTransactions[index], // conserve les anciennes propriétés
        date: new Date(editEntryDateInput.value),
        quantity: parseFloat(editEntryQuantityInput.value),
        price: parseFloat(editEntryPriceInput.value)
    };

    try {
        const posRef = doc(db, 'users', currentUser.uid, 'positions', positionId);

        // On met à jour le bon champ dans Firestore
        const updateData = {};
        if (type === 'entry') {
            updateData.entries = updatedTransactions;
        } else {
            updateData.exits = updatedTransactions;
        }

        await updateDoc(posRef, updateData);

        editPositionModal.hide();

        // Recharger les données pour que tout soit à jour
        await Promise.all([fetchStaticData(), fetchData(), fetchAllClosedPositionsForStats()]);
        updateAllViews();

        Toastify({ text: "Transaction modifiée avec succès.", className: "info", style: { background: "green" } }).showToast();

    } catch (error) {
        console.error("Erreur lors de la mise à jour de la transaction :", error);
        Toastify({ text: "Erreur lors de la modification.", className: "info", style: { background: "red" } }).showToast();
    }
});

// Bouton pour annuler l'édition d'une entrée
cancelEntryEditBtn.addEventListener('click', () => {
    showEditForm(false);
    editEntryForm.reset();
});

function renderClosedPositionsHistory() {
    allPositionsBody.innerHTML = '';
    if (closedPositions.length === 0) {
        // Le colspan passe de 10 à 11
        allPositionsBody.innerHTML = '<tr><td colspan="11" class="text-center">Aucune position clôturée.</td></tr>';
        return;
    }

    closedPositions.forEach(pos => {
        const metrics = calculatePositionMetrics(pos);
        const pnl = calculatePositionPnL(pos);

        // Logique pour la stratégie (inchangée)
        // let strategyTitle = '-';
        // if (pos.strategyId) {
        //     const foundStrategy = strategies.find(s => s.id === pos.strategyId);
        //     strategyTitle = foundStrategy ? `<span class="badge bg-secondary">${foundStrategy.title}</span>` : `<span class="badge bg-light text-dark">Inconnue</span>`;
        // }

        // --- ✨ NOUVELLE LOGIQUE EFFICACITÉ (P&L / heure) ---
        const closingDate = getClosingDate(pos);
        const openingDate = pos.entries[0].date;
        const durationMs = closingDate - openingDate;
        const durationHours = durationMs / (1000 * 60 * 60); // Durée en heures

        // Calculer l'efficacité : P&L par heure, normalisé par le coût d'entrée
        const totalCost = metrics.totalCost || 1; // Éviter division par zéro
        const efficiencyPerHour = durationHours > 0 ? (pnl / durationHours) : 0;
        const efficiencyPercent = (efficiencyPerHour / totalCost) * 100; // % par heure

        // Générer l'affichage selon le résultat
        let efficiencyBadge;

        if (pnl < 0) {
            // Trade perdant : pas d'étoiles, juste un indicateur de perte
            efficiencyBadge = `<span style="color: #dc3545; font-size: 1em;" title="Trade perdant: ${pnl.toFixed(2)}">❌</span>`;
        } else {
            // Trade gagnant : attribuer les étoiles (1 à 4)
            let efficiencyStars = 1;
            let starColor = '#fd7e14'; // Orange par défaut (1 étoile)

            if (efficiencyPercent < 0.5) {
                efficiencyStars = 1;
                starColor = '#fd7e14'; // Orange
            } else if (efficiencyPercent < 1) {
                efficiencyStars = 2;
                starColor = '#ffc107'; // Jaune
            } else if (efficiencyPercent < 2) {
                efficiencyStars = 3;
                starColor = '#9acd32'; // Vert-jaune
            } else {
                efficiencyStars = 4;
                starColor = '#198754'; // Vert
            }

            const fullStars = '⭐'.repeat(efficiencyStars);
            const emptyStars = '☆'.repeat(4 - efficiencyStars);
            efficiencyBadge = `<span style="color: ${starColor}; font-size: 0.9em;" title="Efficacité: ${efficiencyPercent.toFixed(2)}%/h">${fullStars}${emptyStars}</span>`;
        }

        // Badge pour le Type (Long/Short)
        const typeBadge = pos.type === 'long'
            ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Long</span>`
            : `<span class="badge bg-danger-subtle text-danger border border-danger-subtle">Short</span>`;

        // Nombre de transactions d'entrée (inchangé)
        const numberOfEntries = pos.entries ? pos.entries.length : 0;

        // --- ✨ LOGIQUE AJOUTÉE POUR LA QUANTITÉ TOTALE ---
        // On additionne la quantité de chaque entrée
        const totalQuantity = pos.entries ? pos.entries.reduce((sum, entry) => sum + entry.quantity, 0) : 0;
        // --- FIN DE LA LOGIQUE AJOUTÉE ---

        const row = allPositionsBody.insertRow();
        row.innerHTML = `
            <td class="text-muted small">${formatDate(pos.entries[0].date)}</td>
            <td class="text-muted small">${formatDate(getClosingDate(pos))}</td>
            <td class="small">${formatDuration(getClosingDate(pos) - pos.entries[0].date)}</td>
            <td class="fw-bold">${pos.asset}</td>
            <td>${typeBadge}</td>
            <td class="text-center">${efficiencyBadge}</td>
            <td class="text-center text-secondary small">${numberOfEntries}</td>
            <td class="text-center">${totalQuantity.toLocaleString()}</td>
            <td class="font-monospace">${metrics.averageEntryPrice.toFixed(4)}</td>
            <td class="font-monospace">${(metrics.totalExitValue / metrics.totalExitQuantity || 0).toFixed(4)}</td>
            <td class="fw-bold" style="color: ${pnl >= 0 ? '#198754' : '#dc3545'};">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ${pos.currency}</td>
            <td class="text-center">
                <div class="d-flex justify-content-center gap-1">
                    <button class="btn btn-sm btn-outline-info" onclick="viewPositionDetails('${pos.id}')" title="Détails"><i class="bi bi-eye"></i></button>
                    <button class="btn btn-sm btn-outline-primary" onclick="handleEditPosition('${pos.id}')" title="Modifier"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deletePosition('${pos.id}')" title="Supprimer"><i class="bi bi-trash"></i></button>
                </div>
            </td>`;
    });
}
function updateDashboardStats() {
    // On peut garder les logs pour le moment, c'est utile
    console.log("--- DIAGNOSTIC TABLEAU DE BORD ---");
    console.log("Nombre total de positions pour les stats :", allClosedPositionsForStats.length);

    const totalPnLByCurrency = {}; // Un objet pour stocker: { "USD": 596.10, "EUR": -25.50 }
    let winningPositions = 0;

    allClosedPositionsForStats.forEach(pos => {
        const pnl = calculatePositionPnL(pos);
        const currency = (pos.currency || 'INCONNU').toUpperCase();

        if (!totalPnLByCurrency[currency]) {
            totalPnLByCurrency[currency] = 0;
        }
        totalPnLByCurrency[currency] += pnl;

        if (pnl >= 0) winningPositions++;
    });

    const winRate = allClosedPositionsForStats.length > 0 ? (winningPositions / allClosedPositionsForStats.length * 100) : 0;

    console.log(`Calcul du Win Rate: ${winningPositions} (gains) / ${allClosedPositionsForStats.length} (total) = ${winRate.toFixed(2)}%`);

    // ---- LOGIQUE D'AFFICHAGE DU P&L PAR DEVISE + CONVERSION ----
    if (totalProfitLossSpan) {
        totalProfitLossSpan.innerHTML = ''; // On vide l'ancien contenu
        const sortedCurrencies = Object.keys(totalPnLByCurrency).sort();

        if (sortedCurrencies.length === 0) {
            totalProfitLossSpan.innerHTML = '0.00';
        } else {
            // Calcul du total en EUR et USD
            let totalInEUR = 0;
            let totalInUSD = 0;

            // Conversion vers EUR et USD pour chaque devise
            sortedCurrencies.forEach(currency => {
                const pnl = totalPnLByCurrency[currency];

                // Conversion vers EUR et USD
                if (currency === 'EUR') {
                    totalInEUR += pnl;
                    totalInUSD += pnl * eurToUsdRate;
                } else if (currency === 'USD') {
                    totalInEUR += pnl / eurToUsdRate;
                    totalInUSD += pnl;
                } else {
                    // Pour les autres devises, on les ignore dans la conversion pour le moment
                }
            });

            // Afficher le total converti sur une seule ligne
            if (sortedCurrencies.includes('EUR') || sortedCurrencies.includes('USD')) {
                const color = totalInUSD >= 0 ? 'green' : 'red';
                const sign = totalInUSD >= 0 ? '+' : '';

                totalProfitLossSpan.innerHTML = `
                    <div style="color: ${color}; font-weight: bold; font-size: 1.2em; margin-bottom: 8px;">
                        ${sign}${totalInUSD.toFixed(2)} $ / ${sign}${totalInEUR.toFixed(2)} €
                    </div>
                    <small style="color: gray; font-size: 0.65em; display: block;">
                        Taux: 1 EUR = ${eurToUsdRate.toFixed(4)} USD
                    </small>
                `;
            } else {
                // Si pas de EUR ou USD, afficher les devises originales
                sortedCurrencies.forEach(currency => {
                    const pnl = totalPnLByCurrency[currency];
                    const color = pnl >= 0 ? 'green' : 'red';
                    totalProfitLossSpan.innerHTML += `<div style="color: ${color}; font-size: 0.8em;">${pnl.toFixed(2)} ${currency}</div>`;
                });
            }
        }
    }

    if (winRateSpan) winRateSpan.textContent = `${winRate.toFixed(2)}%`;
    if (totalTradesSpan) totalTradesSpan.textContent = allClosedPositionsForStats.length;
}

function renderLastClosedPositions() {
    if (!lastTradesBody) return;
    lastTradesBody.innerHTML = '';
    const lastFive = closedPositions.slice(0, 5);
    if (lastFive.length === 0) {
        lastTradesBody.innerHTML = '<tr><td colspan="4" class="text-center">Aucune position clôturée récente.</td></tr>';
        return;
    }
    lastFive.forEach(pos => {
        const pnl = calculatePositionPnL(pos);
        const row = lastTradesBody.insertRow();
        row.innerHTML = `
            <td>${formatDate(getClosingDate(pos))}</td>
            <td>${pos.asset}</td>
            <td>${pos.type === 'long' ? 'Achat' : 'Vente'}</td>
            <td style="color: ${pnl >= 0 ? 'green' : 'red'};">${pnl.toFixed(2)} ${pos.currency}</td>
        `;
    });
}

// DANS app.js - REMPLACEZ L'ANCIENNE FONCTION PAR CELLE-CI



// --- Logique de la Modale ---
showNewPositionFormBtn.addEventListener('click', () => {
    positionForm.reset();
    positionIdInput.value = '';
    formActionInput.value = 'open';
    positionModalLabel.textContent = 'Ouvrir une Nouvelle Position';
    [assetGroup, typeGroup, notesGroup].forEach(el => el.style.display = 'block');
    document.getElementById('confluences-group').style.display = 'block'; // ✨ AFFICHER

    // ✨ NOUVEAU : Masquer les champs de clôture
    document.getElementById('close-only-fields').style.display = 'none';

    // Réinitialiser les checkboxes
    document.querySelectorAll('.confluence-check').forEach(cb => cb.checked = false);

    transactionDateInput.value = new Date().toISOString().slice(0, 16);
    positionModal.show();
});

window.handleModifyPosition = (positionId, action) => {
    const position = openPositions.find(p => p.id === positionId);
    if (!position) return;
    positionForm.reset();
    positionIdInput.value = positionId;
    formActionInput.value = action;
    positionAssetInput.value = position.asset;
    positionTypeInput.value = position.type;
    // Pré-remplir la devise (important pour ne pas la perdre ou devoir la ressaisir)
    document.getElementById('positionCurrency').value = position.currency || '';

    // Masquer les groupes inutiles pour l'ajout/clôture
    [assetGroup, typeGroup, notesGroup].forEach(el => el.style.display = 'none');
    document.getElementById('confluences-group').style.display = 'none'; // ✨ MASQUER

    // ✨ NOUVEAU : Afficher les champs de clôture si c'est une clôture
    const closeOnlyFields = document.getElementById('close-only-fields');
    if (action === 'close') {
        closeOnlyFields.style.display = 'block';
    } else {
        closeOnlyFields.style.display = 'none';
    }

    positionModalLabel.textContent = action === 'add' ? `Renforcer ${position.asset}` : `Clôturer ${position.asset}`;
    if (action === 'close') { transactionQuantityInput.value = calculatePositionMetrics(position).currentQuantity; }
    transactionDateInput.value = new Date().toISOString().slice(0, 16);
    positionModal.show();
};

window.viewPositionDetails = (positionId) => {
    const position = [...openPositions, ...closedPositions].find(p => p.id === positionId);
    if (!position) return;

    let details = `Détails pour ${position.asset}:\n`;

    // Afficher les confluences
    if (position.confluences && position.confluences.length > 0) {
        details += `\n--- QUALITÉ (${position.confluences.length}/7) ---\n`;
        details += position.confluences.join(', ') + '\n';
    } else {
        details += `\n--- QUALITÉ ---\nAucune règle cochée.\n`;
    }

    // ✨ NOUVEAU : Afficher les notes avant trade
    if (position.notes) {
        details += `\n--- 📝 NOTES AVANT TRADE ---\n${position.notes}\n`;
    }

    details += `\n--- ENTRÉES ---\n`;
    position.entries.forEach(e => { details += `${formatDate(e.date)} - Qte: ${e.quantity}, Prix: ${e.price} ${position.currency}\n`; });
    details += '\n--- SORTIES ---\n';
    if (position.exits && position.exits.length > 0) { position.exits.forEach(ex => { details += `${formatDate(ex.date)} - Qte: ${ex.quantity}, Prix: ${ex.price} ${position.currency}\n`; }); }
    else { details += 'Aucune sortie pour le moment.\n'; }

    // ✨ NOUVEAU : Afficher les informations de clôture si la position est fermée
    if (position.status === 'closed') {
        details += '\n--- 🔄 INFORMATIONS DE CLÔTURE ---\n';

        if (position.postTradeNotes) {
            details += `📝 Notes après trade :\n${position.postTradeNotes}\n\n`;
        }

        if (position.planAdherence) {
            const stars = '⭐'.repeat(position.planAdherence);
            details += `${stars} Score de respect du plan : ${position.planAdherence}/5\n`;
        }

        if (position.exitReason) {
            const reasonLabels = {
                'target': '✅ Target atteint',
                'stop_loss': '❌ Stop Loss touché',
                'manual_plan': '🤝 Sortie manuelle (selon plan)',
                'manual_emotional': '😨 Sortie émotionnelle (hors plan)',
                'time_based': '⏰ Sortie temporelle',
                'breakeven': '🔄 Breakeven / Sécurisation',
                'other': '💡 Autre raison'
            };
            details += `🎯 Raison de sortie : ${reasonLabels[position.exitReason] || position.exitReason}\n`;
        }
    }

    alert(details);
};
window.deletePosition = async (positionId) => {
    Swal.fire({
        title: 'Êtes-vous sûr ?',
        text: "Cette action est irréversible et supprimera définitivement la position.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Oui, supprimer !',
        cancelButtonText: 'Annuler'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // Créer une référence au document Firestore à supprimer
                const posRef = doc(db, 'users', currentUser.uid, 'positions', positionId);

                // Envoyer la commande de suppression à Firestore
                await deleteDoc(posRef);

                // --- DÉBUT DE LA MODIFICATION ---

                // On réinitialise la pagination à la page 1
                currentPage = 1;

                // On recharge TOUTES les données en parallèle pour une mise à jour complète
                await Promise.all([
                    fetchStaticData(),                 // Recharge les positions ouvertes et les transactions
                    fetchData(),                       // Recharge la première page de l'historique
                    fetchAllClosedPositionsForStats()  // Recharge TOUTES les positions pour les statistiques
                ]);

                // Une fois toutes les données rechargées, on met à jour l'interface
                updateAllViews();

                // --- FIN DE LA MODIFICATION ---

                // Afficher une confirmation de succès
                Swal.fire(
                    'Supprimée !',
                    'La position a été supprimée avec succès.',
                    'success'
                );

            } catch (error) {
                console.error("Erreur lors de la suppression de la position :", error);
                // Afficher une alerte d'erreur plus propre
                Swal.fire(
                    'Erreur',
                    "Une erreur est survenue lors de la suppression.",
                    'error'
                );
            }
        }
    });
};

savePositionBtn.addEventListener('click', async () => {
    if (!positionForm.checkValidity()) {
        positionForm.reportValidity();
        return;
    }
    const action = formActionInput.value;
    const positionId = positionIdInput.value;
    const transaction = {
        date: new Date(transactionDateInput.value),
        quantity: parseFloat(transactionQuantityInput.value),
        price: parseFloat(transactionPriceInput.value),
        fees: 0.36
    };

    // Récupérer les confluences cochées
    const selectedConfluences = [];
    document.querySelectorAll('.confluence-check:checked').forEach(cb => {
        selectedConfluences.push(cb.value);
    });

    try {
        if (action === 'open') {
            // Récupérer la valeur du RSI (null si vide)
            const rsiValue = document.getElementById('positionRsi').value;
            const rsi = rsiValue !== '' ? parseFloat(rsiValue) : null;

            const newPosition = {
                asset: document.getElementById('positionAsset').value.toUpperCase(),
                type: document.getElementById('positionType').value,
                currency: (document.getElementById('positionCurrency').value || 'USD').trim().toUpperCase(),
                rsi: rsi,
                confluences: selectedConfluences,
                status: 'open',
                notes: document.getElementById('positionNotes').value,
                createdAt: transaction.date,
                accountId: getSelectedTitleAccountId(),
                entries: [transaction],
                exits: []
            };
            await addDoc(collection(db, 'users', currentUser.uid, 'positions'), newPosition);
        } else {
            const posRef = doc(db, 'users', currentUser.uid, 'positions', positionId);
            const updateData = {};
            if (action === 'add') {
                updateData.entries = arrayUnion(transaction);
            } else if (action === 'close') {
                const position = openPositions.find(p => p.id === positionId);
                const metrics = calculatePositionMetrics(position);
                if (transaction.quantity > metrics.currentQuantity + 1e-9) {
                    alert("Erreur : Quantité de sortie supérieure à la quantité détenue.");
                    return;
                }
                updateData.exits = arrayUnion(transaction);
                if (Math.abs(transaction.quantity - metrics.currentQuantity) < 1e-9) {
                    updateData.status = 'closed';

                    // ✨ NOUVEAU : Sauvegarder les données de clôture
                    const postTradeNotes = document.getElementById('postTradeNotes');
                    const exitReasonSelect = document.getElementById('exitReason');
                    const selectedPlanAdherence = document.querySelector('input[name="planAdherence"]:checked');

                    if (postTradeNotes && postTradeNotes.value) {
                        updateData.postTradeNotes = postTradeNotes.value;
                    }
                    if (exitReasonSelect && exitReasonSelect.value) {
                        updateData.exitReason = exitReasonSelect.value;
                    }
                    if (selectedPlanAdherence) {
                        updateData.planAdherence = parseInt(selectedPlanAdherence.value, 10);
                    }
                }
            }
            await updateDoc(posRef, updateData);
        }

        positionModal.hide();

        // ---- DÉBUT DE LA CORRECTION ----

        // On réinitialise la pagination à la page 1 de l'historique
        currentPage = 1;

        // On recharge TOUTES les données pour s'assurer que tout est à jour
        await Promise.all([
            fetchStaticData(), // Recharge les positions ouvertes
            fetchData(),
            fetchAllClosedPositionsForStats()       // Recharge la première page de l'historique
        ]);

        // Et on met à jour l'intégralité de l'affichage
        updateAllViews();

        // ---- FIN DE LA CORRECTION ----

    } catch (error) {
        console.error("Erreur sauvegarde position :", error);
        alert("Erreur lors de la sauvegarde.");
    }
});
// --- Gestion du Compte ---

// Références DOM pour la nouvelle section
const accountForm = document.getElementById('account-form');
const transactionTypeSelect = document.getElementById('transactionType');
const balancesDisplay = document.getElementById('balances-display');
const transactionsHistoryBody = document.getElementById('transactions-history-body');
const depositWithdrawalGroup = document.getElementById('deposit-withdrawal-group');
const conversionGroup = document.getElementById('conversion-group');
const editingTransactionIdInput = document.getElementById('editingTransactionId');
const submitTransactionBtn = document.getElementById('submit-transaction-btn');
const cancelTransactionEditBtn = document.getElementById('cancel-transaction-edit-btn');
const titleAccountSummary = document.getElementById('title-account-summary');

function renderTitleAccountOptions() {
    if (!titleAccountSelect) return;

    const accounts = getStoredTitleAccounts();
    const selectedAccountId = getSelectedTitleAccountId();

    titleAccountSelect.innerHTML = '';

    const currentOption = document.createElement('option');
    currentOption.value = DEFAULT_TITLE_ACCOUNT_ID;
    currentOption.textContent = 'Trading (U21752904)';
    titleAccountSelect.appendChild(currentOption);

    accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = `${account.name} (${account.id})`;
        titleAccountSelect.appendChild(option);
    });

    titleAccountSelect.value = selectedAccountId === DEFAULT_TITLE_ACCOUNT_ID ? DEFAULT_TITLE_ACCOUNT_ID : selectedAccountId;
}

function renderAccountSwitchSelect() {
    if (!accountSwitchMenu || !accountSwitchButton || !accountSwitchLabel) return;

    const accounts = getStoredTitleAccounts();
    const selectedAccountId = getSelectedTitleAccountId();

    accountSwitchLabel.textContent = getSelectedTitleAccountLabel();
    accountSwitchMenu.innerHTML = '';

    const createItem = (accountId, label, isSelected) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'account-switch-menu-item' + (isSelected ? ' active' : '');
        btn.textContent = label;
        btn.setAttribute('role', 'menuitem');
        btn.onclick = () => {
            switchTitleAccount(accountId);
            accountSwitchMenu.classList.remove('open');
            accountSwitchButton.setAttribute('aria-expanded', 'false');
        };
        return btn;
    };

    accountSwitchMenu.appendChild(createItem(DEFAULT_TITLE_ACCOUNT_ID, getLegacyTitleAccountLabel(), selectedAccountId === DEFAULT_TITLE_ACCOUNT_ID));

    accounts.forEach(account => {
        accountSwitchMenu.appendChild(createItem(account.id, `${account.name} (${account.id})`, selectedAccountId === account.id));
    });
}

async function switchTitleAccount(accountId) {
    const normalizedAccountId = normalizeStoredAccountId(accountId);

    if (normalizedAccountId === DEFAULT_TITLE_ACCOUNT_ID) {
        localStorage.setItem(TITLE_ACCOUNT_ACTIVE_KEY, DEFAULT_TITLE_ACCOUNT_ID);
        localStorage.setItem(TITLE_ACCOUNT_TYPE_KEY, DEFAULT_TITLE_ACCOUNT_ID);
        localStorage.removeItem(TITLE_ACCOUNT_NUMBER_KEY);
    } else {
        localStorage.setItem(TITLE_ACCOUNT_ACTIVE_KEY, normalizedAccountId);
        localStorage.setItem(TITLE_ACCOUNT_TYPE_KEY, normalizedAccountId);
        localStorage.setItem(TITLE_ACCOUNT_NUMBER_KEY, normalizedAccountId);
    }

    refreshTitleAccountSelection();

    if (!currentUser) return;

    try {
        currentPage = 1;
        lastVisibleDoc = null;
        await Promise.all([
            fetchStaticData(),
            fetchData(),
            fetchAllClosedPositionsForStats()
        ]);
        updateAllViews();
    } catch (error) {
        console.error('Erreur lors du basculement vers le compte titre :', error);
    }
}

function updateTitleAccountSummary() {
    if (!titleAccountSummary) return;
    titleAccountSummary.textContent = `Compte suivi : ${getSelectedTitleAccountLabel()}`;
}

function renderRenameAccountOptions() {
    if (!renameAccountSelect) return;

    const accounts = getStoredTitleAccounts();
    renameAccountSelect.innerHTML = '';

    const legacyOption = document.createElement('option');
    legacyOption.value = DEFAULT_TITLE_ACCOUNT_ID;
    legacyOption.textContent = `${getLegacyTitleAccountLabel()} (compte d’origine)`;
    renameAccountSelect.appendChild(legacyOption);

    accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = `${account.name} (${account.id})`;
        renameAccountSelect.appendChild(option);
    });

    const selectedAccountId = getSelectedTitleAccountId();
    if (selectedAccountId === DEFAULT_TITLE_ACCOUNT_ID || !accounts.some(account => account.id === selectedAccountId)) {
        renameAccountSelect.value = DEFAULT_TITLE_ACCOUNT_ID;
    } else {
        renameAccountSelect.value = selectedAccountId;
    }
}

function refreshTitleAccountSelection() {
    renderAccountSwitchSelect();
    renderRenameAccountOptions();
    updateTitleAccountSummary();
}

if (accountSwitchButton) {
    accountSwitchButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !accountSwitchMenu.classList.contains('open');
        accountSwitchMenu.classList.toggle('open', willOpen);
        accountSwitchButton.setAttribute('aria-expanded', String(willOpen));
    });
}

window.addEventListener('click', (event) => {
    if (!accountSwitchMenu || !accountSwitchButton) return;
    if (!accountSwitchMenu.contains(event.target) && !accountSwitchButton.contains(event.target)) {
        accountSwitchMenu.classList.remove('open');
        accountSwitchButton.setAttribute('aria-expanded', 'false');
    }
});

if (renameAccountSelect) {
    renameAccountSelect.addEventListener('change', () => {
        if (renameAccountSelect.value === DEFAULT_TITLE_ACCOUNT_ID) {
            renameAccountNameInput.value = getLegacyTitleAccountLabel();
            renameAccountNameInput.placeholder = 'Ex. Intraday';
            return;
        }

        const selectedAccount = getStoredTitleAccounts().find(account => account.id === renameAccountSelect.value);
        if (selectedAccount) {
            renameAccountNameInput.value = selectedAccount.name === selectedAccount.id ? '' : selectedAccount.name;
            renameAccountNameInput.placeholder = selectedAccount.name || 'Ex. Intraday';
        }
    });
}

if (renameAccountForm) {
    renameAccountForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const accountId = renameAccountSelect?.value;
        const newName = (renameAccountNameInput?.value || '').trim();

        if (!accountId || !newName) {
            alert('Veuillez sélectionner un compte et saisir un nom valide.');
            return;
        }

        if (accountId === DEFAULT_TITLE_ACCOUNT_ID) {
            localStorage.setItem(TITLE_ACCOUNT_LEGACY_LABEL_KEY, newName);
            await syncTitleAccountsToFirestore(getStoredTitleAccounts(), newName);
            renameAccountNameInput.value = '';
            refreshTitleAccountSelection();
            alert('Le nom du compte d’origine a été mis à jour pour l’affichage.');
            return;
        }

        const accounts = getStoredTitleAccounts();
        const target = accounts.find(account => account.id === accountId);

        if (!target) {
            alert('Ce compte n’est pas encore enregistré localement.');
            return;
        }

        target.name = newName;
        saveStoredTitleAccounts(accounts);
        await syncTitleAccountsToFirestore(accounts);
        renameAccountNameInput.value = '';
        refreshTitleAccountSelection();
        alert(`Le nom du compte ${accountId} a été mis à jour.`);
    });
}

if (titleAccountForm) {
    titleAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const number = (newAccountNumberInput?.value || '').trim().toUpperCase();
        const name = (newAccountNameInput?.value || '').trim();

        if (!number || !name) {
            alert('Veuillez renseigner le numéro et le nom du compte.');
            return;
        }

        const existingAccounts = getStoredTitleAccounts();
        const newAccount = { id: number, name };
        const hasExisting = existingAccounts.some(account => account.id === number);

        if (!hasExisting) {
            existingAccounts.push(newAccount);
            saveStoredTitleAccounts(existingAccounts);
        }

        localStorage.setItem(TITLE_ACCOUNT_ACTIVE_KEY, number);
        localStorage.setItem(TITLE_ACCOUNT_TYPE_KEY, number);
        localStorage.setItem(TITLE_ACCOUNT_NUMBER_KEY, number);
        titleAccountForm.reset();

        await syncTitleAccountsToFirestore(existingAccounts, localStorage.getItem(TITLE_ACCOUNT_LEGACY_LABEL_KEY));
        refreshTitleAccountSelection();

        if (!currentUser) return;

        try {
            currentPage = 1;
            lastVisibleDoc = null;
            await Promise.all([
                fetchStaticData(),
                fetchData(),
                fetchAllClosedPositionsForStats()
            ]);
            updateAllViews();
        } catch (error) {
            console.error('Erreur lors de l’ajout du compte titre :', error);
        }
    });
}

refreshTitleAccountSelection();

// NOUVELLE FONCTION : Met à jour les balances par devise
function updateAccountBalances() {
    if (!balancesDisplay) return;

    const balances = {};

    // 1. Appliquer les transactions de compte
    accountTransactions.forEach(t => {
        // ... (cette partie reste inchangée)
        const fromCurrency = (t.fromCurrency || t.currency || '').toUpperCase();
        const toCurrency = (t.toCurrency || t.currency || '').toUpperCase();
        const fromAmount = t.fromAmount || t.amount || 0;
        const toAmount = t.toAmount || t.amount || 0;

        if (!fromCurrency && !toCurrency) {
            console.warn("Transaction ignorée car aucune devise n'est spécifiée :", t);
            return;
        }

        if (fromCurrency && !balances[fromCurrency]) balances[fromCurrency] = 0;
        if (toCurrency && !balances[toCurrency]) balances[toCurrency] = 0;

        if (t.type === 'deposit') balances[toCurrency] += toAmount;
        if (t.type === 'withdrawal') balances[fromCurrency] -= fromAmount;
        if (t.type === 'conversion') {
            if (fromCurrency) balances[fromCurrency] -= fromAmount;
            if (toCurrency) balances[toCurrency] += toAmount;
        }
    });

    // 2. Appliquer le P&L de TOUTES les positions clôturées
    // ---- CORRECTION IMPORTANTE CI-DESSOUS ----
    allClosedPositionsForStats.forEach(pos => { // On utilise allClosedPositionsForStats
        if (pos.currency) {
            const pnl = calculatePositionPnL(pos);
            const currency = pos.currency.toUpperCase();
            if (!balances[currency]) balances[currency] = 0;
            balances[currency] += pnl;
        }
    });

    // 3. Afficher les balances
    balancesDisplay.innerHTML = ''; // On vide l'ancien contenu

    const sortedCurrencies = Object.keys(balances).sort();

    if (sortedCurrencies.length === 0) {
        balancesDisplay.innerHTML = '<p class="text-muted">Aucune transaction pour le moment.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'table table-sm mb-0';
    table.innerHTML = '<tbody></tbody>';
    const tbody = table.querySelector('tbody');

    sortedCurrencies.forEach(currency => {
        // N'afficher que les balances avec un montant significatif
        if (Math.abs(balances[currency]) > 0.001) {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${currency}</strong></td>
                    <td class="text-end">${balances[currency].toFixed(2)}</td>
                </tr>`;
        }
    });

    // Calculer le total en EUR et USD pour afficher une ligne de synthèse
    let totalInEUR = 0;
    let totalInUSD = 0;
    let hasEurOrUsd = false;

    sortedCurrencies.forEach(currency => {
        if (Math.abs(balances[currency]) > 0.001) {
            const balance = balances[currency];

            if (currency === 'EUR') {
                totalInEUR += balance;
                totalInUSD += balance * eurToUsdRate;
                hasEurOrUsd = true;
            } else if (currency === 'USD') {
                totalInEUR += balance / eurToUsdRate;
                totalInUSD += balance;
                hasEurOrUsd = true;
            }
        }
    });

    // Ajouter la ligne de total si on a des EUR ou USD
    if (hasEurOrUsd) {
        const color = totalInEUR >= 0 ? '#28a745' : '#dc3545';
        const sign = totalInEUR >= 0 ? '+' : '';

        tbody.innerHTML += `
            <tr style="border-top: 2px solid #dee2e6;">
                <td><strong>Total</strong></td>
                <td class="text-end" style="color: ${color}; font-weight: bold;">
                    ${sign}${totalInEUR.toFixed(2)} €
                </td>
            </tr>
            <tr>
                <td colspan="2" class="text-end" style="font-size: 0.7em; color: gray;">
                    Taux: 1 EUR = ${eurToUsdRate.toFixed(4)} USD
                </td>
            </tr>`;
    }

    balancesDisplay.appendChild(table);
}
// NOUVELLE FONCTION : Affiche l'historique (adaptée pour les conversions)
function renderAccountTransactions() {
    transactionsHistoryBody.innerHTML = '';
    const sorted = [...accountTransactions].sort((a, b) => b.date - a.date);
    if (sorted.length === 0) {
        transactionsHistoryBody.innerHTML = '<tr><td colspan="3" class="text-center">Aucun historique.</td></tr>';
        return;
    }
    sorted.forEach(t => {
        const row = transactionsHistoryBody.insertRow();
        let operationHtml = '';
        if (t.type === 'deposit') {
            operationHtml = `<span class="text-success">Dépôt de ${t.amount.toFixed(2)} ${t.currency}</span>`;
        } else if (t.type === 'withdrawal') {
            operationHtml = `<span class="text-danger">Retrait de ${t.amount.toFixed(2)} ${t.currency}</span>`;
        } else if (t.type === 'conversion') {
            operationHtml = `Conversion de ${t.fromAmount.toFixed(2)} ${t.fromCurrency} <br> <small class="text-muted">→ ${t.toAmount.toFixed(2)} ${t.toCurrency} (Taux: ${t.rate})</small>`;
        }

        // Ajout : Afficher le motif (ex: Virement PEA)
        if (t.notes) {
            operationHtml += `<br><small class="text-white-50 fst-italic"><i class="bi bi-info-circle me-1"></i>${t.notes}</small>`;
        }

        row.innerHTML = `
            <td>${formatDate(t.date)}</td>
            <td>${operationHtml}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-link text-primary p-0 me-2" onclick="editAccountTransaction('${t.id}')" title="Modifier">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-link text-danger p-0" onclick="deleteAccountTransaction('${t.id}')" title="Supprimer">
                    <i class="bi bi-trash"></i>
                </button>
            </td>`;
    });
}

// NOUVEAU : Fonctions d'édition et suppression
window.editAccountTransaction = (id) => {
    const transaction = accountTransactions.find(t => t.id === id);
    if (!transaction) return;

    editingAccountTransactionId = id;
    editingTransactionIdInput.value = id;
    transactionTypeSelect.value = transaction.type;
    transactionTypeSelect.dispatchEvent(new Event('change'));

    // Date format for input[type="date"] (YYYY-MM-DD)
    const dateStr = transaction.date.toISOString().split('T')[0];

    if (transaction.type === 'deposit' || transaction.type === 'withdrawal') {
        document.getElementById('dw_date').value = dateStr;
        document.getElementById('dw_amount').value = transaction.amount;
        document.getElementById('dw_currency').value = transaction.currency;
    } else {
        document.getElementById('conv_date').value = dateStr;
        document.getElementById('conv_from_amount').value = transaction.fromAmount;
        document.getElementById('conv_from_currency').value = transaction.fromCurrency;
        document.getElementById('conv_to_currency').value = transaction.toCurrency;
        document.getElementById('conv_rate').value = transaction.rate;
        // Déclencher le calcul de l'affichage
        conversionGroup.dispatchEvent(new Event('input'));
    }

    submitTransactionBtn.innerHTML = '<i class="bi bi-save me-2"></i>Mettre à jour';
    cancelTransactionEditBtn.classList.remove('d-none');
    
    // Scroller vers le formulaire
    accountForm.scrollIntoView({ behavior: 'smooth' });
};

window.deleteAccountTransaction = async (id) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette transaction ?')) return;

    try {
        await deleteDoc(doc(db, 'users', currentUser.uid, 'accountTransactions', id));
        if (editingAccountTransactionId === id) resetAccountForm();
        await fetchStaticData();
        updateAllViews();
        Toastify({ text: "Transaction supprimée.", className: "info", style: { background: "orange" } }).showToast();
    } catch (error) {
        console.error("Erreur suppression transaction:", error);
        Toastify({ text: "Erreur lors de la suppression.", className: "info", style: { background: "red" } }).showToast();
    }
};

function resetAccountForm() {
    editingAccountTransactionId = null;
    editingTransactionIdInput.value = '';
    accountForm.reset();
    transactionTypeSelect.dispatchEvent(new Event('change'));
    submitTransactionBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Enregistrer';
    cancelTransactionEditBtn.classList.add('d-none');
}

cancelTransactionEditBtn.addEventListener('click', resetAccountForm);

// NOUVEAU : Gère l'affichage dynamique du formulaire
transactionTypeSelect.addEventListener('change', () => {
    if (transactionTypeSelect.value === 'conversion') {
        depositWithdrawalGroup.classList.add('d-none');
        conversionGroup.classList.remove('d-none');
    } else {
        depositWithdrawalGroup.classList.remove('d-none');
        conversionGroup.classList.add('d-none');
    }
});

// NOUVEAU : Calcule le montant de la conversion en temps réel
conversionGroup.addEventListener('input', () => {
    const fromAmount = parseFloat(document.getElementById('conv_from_amount').value) || 0;
    const rate = parseFloat(document.getElementById('conv_rate').value) || 0;
    document.getElementById('conv_to_amount_display').textContent = (fromAmount * rate).toFixed(2);
});

// NOUVEAU : Gère la soumission du formulaire (adapté pour les 3 types)
accountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    let transactionData;
    const type = transactionTypeSelect.value;

    if (type === 'deposit' || type === 'withdrawal') {
        const dateVal = document.getElementById('dw_date').value;
        const amountVal = parseFloat(document.getElementById('dw_amount').value);
        const currencyVal = document.getElementById('dw_currency').value.toUpperCase();

        if (!dateVal || isNaN(amountVal) || !currencyVal) {
            alert("Veuillez remplir tous les champs obligatoires.");
            return;
        }

        transactionData = {
            type: type,
            date: new Date(dateVal),
            amount: amountVal,
            currency: currencyVal,
            accountId: getSelectedTitleAccountId()
        };
    } else { // conversion
        const dateVal = document.getElementById('conv_date').value;
        const fromAmount = parseFloat(document.getElementById('conv_from_amount').value);
        const rate = parseFloat(document.getElementById('conv_rate').value);
        const fromCurrency = document.getElementById('conv_from_currency').value.toUpperCase();
        const toCurrency = document.getElementById('conv_to_currency').value.toUpperCase();

        if (!dateVal || isNaN(fromAmount) || isNaN(rate) || !fromCurrency || !toCurrency) {
            alert("Veuillez remplir tous les champs obligatoires.");
            return;
        }

        transactionData = {
            type: 'conversion',
            date: new Date(dateVal),
            fromAmount: fromAmount,
            fromCurrency: fromCurrency,
            toAmount: fromAmount * rate,
            toCurrency: toCurrency,
            rate: rate,
            accountId: getSelectedTitleAccountId()
        };
    }

    try {
        if (editingAccountTransactionId) {
            await updateDoc(doc(db, 'users', currentUser.uid, 'accountTransactions', editingAccountTransactionId), transactionData);
            Toastify({ text: "Transaction mise à jour !", className: "info", style: { background: "green" } }).showToast();
        } else {
            await addDoc(collection(db, 'users', currentUser.uid, 'accountTransactions'), transactionData);
            Toastify({ text: "Transaction enregistrée !", className: "info", style: { background: "green" } }).showToast();
        }
        
        resetAccountForm();
        await fetchStaticData();
        updateAllViews();
    } catch (error) {
        console.error("Erreur enregistrement transaction:", error);
        alert("Erreur lors de l'enregistrement : " + error.message);
    }
});







// --- Logique de Tri de l'Historique ---
window.isCustomSortActive = false;
let currentSortColumn = 'entry-date';
let currentSortDirection = 'desc';

function applySortingAndRender() {
    if (!allClosedPositionsForStats || allClosedPositionsForStats.length === 0) return;

    allClosedPositionsForStats.sort((a, b) => {
        let valA, valB;
        if (currentSortColumn === 'entry-date') {
            valA = a.entries && a.entries.length > 0 ? a.entries[0].date.getTime() : 0;
            valB = b.entries && b.entries.length > 0 ? b.entries[0].date.getTime() : 0;
        } else if (currentSortColumn === 'exit-date') {
            const dateA = getClosingDate(a);
            const dateB = getClosingDate(b);
            valA = dateA ? dateA.getTime() : 0;
            valB = dateB ? dateB.getTime() : 0;
        } else if (currentSortColumn === 'asset') {
            valA = (a.asset || '').toLowerCase();
            valB = (b.asset || '').toLowerCase();
        } else if (currentSortColumn === 'pnl') {
            valA = calculatePositionPnL(a);
            valB = calculatePositionPnL(b);
        }

        if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    totalClosedPositionsCount = allClosedPositionsForStats.length;
    totalPages = Math.ceil(totalClosedPositionsCount / POSITIONS_PER_PAGE) || 1;
    
    const startIndex = (currentPage - 1) * POSITIONS_PER_PAGE;
    const endIndex = startIndex + POSITIONS_PER_PAGE;
    
    closedPositions = allClosedPositionsForStats.slice(startIndex, endIndex);
    
    updatePaginationControls(closedPositions.length);
    renderClosedPositionsHistory();
}

window.sortHistory = function(column) {
    window.isCustomSortActive = true;
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'desc';
    }
    
    document.querySelectorAll('th.sortable i').forEach(icon => {
        icon.className = 'bi bi-arrow-down-up text-muted ms-1';
    });
    const th = document.querySelector(`th.sortable[data-sort="${column}"]`);
    if (th) {
        const activeIcon = th.querySelector('i');
        if (activeIcon) {
            activeIcon.className = currentSortDirection === 'asc' ? 'bi bi-arrow-up text-primary ms-1' : 'bi bi-arrow-down text-primary ms-1';
        }
    }
    
    currentPage = 1;
    applySortingAndRender();
};

// --- Fonctions Utilitaires ---
function formatDate(date) {
    // Si la date n'est pas valide, retourner une chaîne vide pour éviter les erreurs
    if (!date || typeof date.toDate !== 'function') {
        // Firebase Timestamps have a .toDate() method
        // Check for valid Date objects as well
        if (!(date instanceof Date) || isNaN(date)) {
            return 'Date invalide';
        }
    }

    // Convertir le Timestamp Firebase en objet Date JavaScript
    const d = date.toDate ? date.toDate() : date;

    const options = {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return d.toLocaleDateString('fr-FR', options);
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '-';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}mn`;
}
function updateDatalists() {
    // 1. Récupérer toutes les positions (ouvertes et fermées)
    const allPositions = [...openPositions, ...closedPositions];

    // 2. Créer des listes uniques d'actifs et de devises
    // Le `Set` permet de supprimer automatiquement les doublons
    const uniqueAssets = [...new Set(allPositions.map(p => p.asset).filter(Boolean))]; // .filter(Boolean) ignore les valeurs null/undefined
    const uniqueCurrencies = [...new Set(allPositions.map(p => p.currency).filter(Boolean))];

    // 3. Cibler les éléments <datalist> dans le DOM
    const assetList = document.getElementById('asset-list');
    const currencyList = document.getElementById('currency-list');

    // 4. Remplir les listes avec les options
    if (assetList) {
        assetList.innerHTML = uniqueAssets.map(asset => `<option value="${asset}"></option>`).join('');
    }
    if (currencyList) {
        currencyList.innerHTML = uniqueCurrencies.map(curr => `<option value="${curr}"></option>`).join('');
    }
}
function calculatePositionMetrics(position) {
    let totalQuantity = 0, totalCost = 0, totalEntryFees = 0;
    position.entries.forEach(e => {
        totalQuantity += e.quantity;
        totalCost += e.quantity * e.price;
        totalEntryFees += e.fees || 0; // Ajoute les frais, ou 0 si le champ n'existe pas
    });
    let totalExitQuantity = 0, totalExitValue = 0, totalExitFees = 0;
    if (position.exits) {
        position.exits.forEach(ex => {
            totalExitQuantity += ex.quantity;
            totalExitValue += ex.quantity * ex.price;
            totalExitFees += ex.fees || 0; // Ajoute les frais, ou 0 si le champ n'existe pas
        });
    }
    const totalFees = totalEntryFees + totalExitFees;
    return {
        currentQuantity: totalQuantity - totalExitQuantity,
        averageEntryPrice: totalCost / totalQuantity || 0,
        totalExitValue,
        totalExitQuantity,
        totalCost,
        totalQuantity,
        totalFees // On retourne le total des frais
    };
}
function calculatePositionPnL(position) {
    const metrics = calculatePositionMetrics(position);
    let pnlBrut = 0;

    if (position.type === 'long') {
        pnlBrut = metrics.totalExitValue - metrics.totalCost;
    } else { // short
        pnlBrut = metrics.totalCost - metrics.totalExitValue;
    }

    // Soustraire le total des frais pour obtenir le P&L Net
    return pnlBrut - metrics.totalFees;
}
function getClosingDate(position) {
    if (!position.exits || position.exits.length === 0) return null;
    // Trouve la date la plus récente dans le tableau des sorties
    return position.exits.reduce((latest, exit) => exit.date > latest ? exit.date : latest, position.exits[0].date);
}
// --- Initialisation ---
// DANS app.js - REMPLACEZ L'ANCIEN LISTENER PAR CELUI-CI
document.addEventListener('DOMContentLoaded', () => {

    // Gestion du tri des colonnes de l'historique
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const sortParam = th.dataset.sort;
            if (sortParam) {
                window.sortHistory(sortParam);
            }
        });
    });

    // Gestion de la navigation principale entre les sections
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const section = e.currentTarget.dataset.section;
            if (section) {
                e.preventDefault();
                if (currentUser) {
                    showSection(section);
                }
            }
            // Si pas de data-section, on laisse le comportement par défaut (lien vers une autre page)
        });
    });
    // Gestion des boutons de pagination pour l'historique
    nextPageBtn.addEventListener('click', async () => {
        if (!nextPageBtn.disabled) {
            currentPage++;
            if (window.isCustomSortActive) {
                applySortingAndRender();
            } else {
                await fetchData('next');
                renderClosedPositionsHistory();
            }
        }
    });
    prevPageBtn.addEventListener('click', async () => {
        if (!prevPageBtn.disabled) {
            currentPage--;
            if (window.isCustomSortActive) {
                applySortingAndRender();
            } else {
                await fetchData();
                for (let i = 1; i < currentPage; i++) {
                    await fetchData('next');
                }
                renderClosedPositionsHistory();
            }
        }
    });
    initChartEventListeners(() => {
        // Cette fonction sera appelée à chaque changement d'année
        renderCharts(allClosedPositionsForStats, strategies, getClosingDate, calculatePositionPnL);
    });
    // --- LOGIQUE DU MODE SOMBRE ---
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;
    const themeIcon = themeToggleBtn.querySelector('i');

    const applyTheme = (theme) => {
        if (theme === 'dark') {
            body.classList.add('dark-mode');
            if (themeIcon) themeIcon.classList.replace('bi-sun-fill', 'bi-moon-fill');
        } else {
            body.classList.remove('dark-mode');
            if (themeIcon) themeIcon.classList.replace('bi-moon-fill', 'bi-sun-fill');
        }
        updateChartColors(theme);
        if (document.getElementById('dashboard').classList.contains('active') || document.getElementById('reports-analytics').classList.contains('active')) {
            renderCharts(allClosedPositionsForStats, strategies, getClosingDate, calculatePositionPnL);
        }
    };
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

    themeToggleBtn.addEventListener('click', () => {
        const newTheme = body.classList.contains('dark-mode') ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    });
});


