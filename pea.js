import {
    auth,
    db,
    onAuthStateChanged,
    collection,
    addDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    Timestamp,
    deleteDoc,
    doc,
    updateDoc // Ajout
} from "./firebase-config.js";

// -- État Global --
let state = {
    user: null,
    operations: [],
    entryRules: [],
    portfolio: {
        cash: 0,
        invested: 0,
        dividendsYear: 0,
        holdings: {}
    }
};

let editingOperationId = null; // Variable pour le mode édition

let charts = {
    growth: null,
    allocation: null,
    gains: null,
    pnlEvolution: null
};

let pnlChartSettings = {
    period: 'all',
    view: 'cumulative'
};

const TWELVE_DATA_API_KEY = "ee6a290787f341849d49e5b7110b63c1";

let portfolioChartFilters = {
    period: 'all'
};

function getOperationDateValue(op) {
    if (!op) return 0;
    if (op.dateObj instanceof Date) return op.dateObj.getTime();
    if (op.date && typeof op.date.toDate === 'function') return op.date.toDate().getTime();
    if (op.date && typeof op.date.seconds === 'number') return op.date.seconds * 1000;
    const parsed = new Date(op.date);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortOperationsByDate(ops) {
    return [...ops]
        .map((op, index) => ({ ...op, __sourceIndex: op.__sourceIndex ?? index }))
        .sort((a, b) => {
            const dateA = getOperationDateValue(a);
            const dateB = getOperationDateValue(b);
            if (dateA !== dateB) return dateA - dateB;
            const createdA = Number(a.createdAt || 0);
            const createdB = Number(b.createdAt || 0);
            if (createdA !== createdB) return createdA - createdB;
            return (a.__sourceIndex || 0) - (b.__sourceIndex || 0);
        });
}

// -- Initialisation --
document.addEventListener('DOMContentLoaded', () => {
    // Auth Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("PEA (JS): Utilisateur connecté ->", user.email);
            state.user = user;
            initApp();
        } else {
            console.log("PEA (JS): Aucun utilisateur connecté.");
            // L'overlay est géré par pea.html
        }
    });

    // Form Listener
    // Note: Le listener submit principal est défini plus bas via getElementById directement

    const upBtn = document.getElementById('update-prices-btn');
    if (upBtn) upBtn.addEventListener('click', handleUpdatePricesMock);

    // Ajustement dynamique des champs du formulaire
    const opType = document.getElementById('op-type');
    if (opType) {
        opType.addEventListener('change', updateFormFields);
    }
    // Listener Recherche Ticker
    const btnSearchTicker = document.getElementById('btn-search-ticker');
    if (btnSearchTicker) {
        btnSearchTicker.addEventListener('click', searchTickerAuto);
    }

    // Listener gestion des règles d'entrée
    const entryRuleForm = document.getElementById('entry-rule-form');
    const cancelEntryRuleEditBtn = document.getElementById('cancel-entry-rule-edit-btn');
    if (entryRuleForm) {
        entryRuleForm.addEventListener('submit', handleEntryRuleFormSubmit);
    }
    if (cancelEntryRuleEditBtn) {
        cancelEntryRuleEditBtn.addEventListener('click', resetEntryRuleForm);
    }

    loadEntryRules();

    // Listener Annulation Edition Position
    const cancelPEAOpEditBtn = document.getElementById('cancel-pea-op-edit-btn');
    if (cancelPEAOpEditBtn) {
        cancelPEAOpEditBtn.addEventListener('click', () => {
            document.getElementById('edit-pea-op-form').style.display = 'none';
            document.getElementById('edit-pea-op-form-title').style.display = 'none';
            document.getElementById('edit-pea-op-form').reset();
        });
    }

    // Listener Soumission Edition Position
    const editPEAOpForm = document.getElementById('edit-pea-op-form');
    if (editPEAOpForm) {
        editPEAOpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!state.user) return;

            const opId = document.getElementById('editPEAOpId').value;
            const asset = document.getElementById('editPEAOpAsset').value;
            const ticker = document.getElementById('editPEAOpTicker').value;
            const date = document.getElementById('editPEAOpDate').value;
            const fees = parseFloat(document.getElementById('editPEAOpFees').value) || 0;
            const ttfPercent = parseFloat(document.getElementById('editPEAOpTTFPercent').value) || 0;
            const quantity = parseFloat(document.getElementById('editPEAOpQuantity').value);
            const price = parseFloat(document.getElementById('editPEAOpPrice').value);
            const opType = document.getElementById('editPEAOpType')?.value || '';
            const technicalData = document.getElementById('editPEAOpTechnicalData')?.value || '';
            const analystNote = document.getElementById('editPEAOpAnalystNote')?.value || '';
            const targetPrice1Y = opType === 'buy' ? parseFloat(document.getElementById('editPEAOpTargetPrice1Y')?.value) || null : null;
            const entryRules = getSelectedEntryRules('#edit-pea-op-form');

            if (!opId || !asset || !ticker || !date || isNaN(quantity) || isNaN(price)) {
                alert("Champs invalides.");
                return;
            }

            const transactionAmount = quantity * price;
            const ttfAmount = transactionAmount * (ttfPercent / 100);
            const opData = {
                asset,
                ticker: ticker.toUpperCase(),
                date,
                fees,
                ttf: ttfAmount,
                ttfPercent,
                quantity,
                price,
                amount: transactionAmount,
                dateObj: new Date(date),
                technicalData: opType === 'buy' ? technicalData : '',
                analystNote: opType === 'buy' ? analystNote : '',
                targetPrice1Y: opType === 'buy' ? targetPrice1Y : null,
                entryRules
            };

            try {
                await updateDoc(doc(db, "users", state.user.uid, "pea_operations", opId), opData);
                
                // Fermer la modale
                const modalEl = document.getElementById('editPEAPositionModal');
                const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.hide();

                document.getElementById('edit-pea-op-form').reset();
                document.getElementById('edit-pea-op-form').style.display = 'none';
                document.getElementById('edit-pea-op-form-title').style.display = 'none';

                // Forcer la mise à jour immédiate de l'UI
                updateUI();
            } catch (error) {
                console.error("Erreur lors de la modification de l'opération PEA :", error);
                alert("Erreur lors de la sauvegarde : " + error.message);
            }
        });
    }


    // Appel initial pour caler l'état
    setTimeout(updateFormFields, 500);

    // Gestion du thème clair/sombre
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;

    const applyTheme = (theme) => {
        const themeIcon = themeToggleBtn ? themeToggleBtn.querySelector('i') : null;
        if (theme === 'dark') {
            body.classList.remove('light-mode');
            if (themeIcon) {
                themeIcon.classList.replace('bi-sun-fill', 'bi-moon-fill');
            }
        } else {
            body.classList.add('light-mode');
            if (themeIcon) {
                themeIcon.classList.replace('bi-moon-fill', 'bi-sun-fill');
            }
        }
        // Si les graphiques sont déjà initialisés, les mettre à jour
        if (state.operations && state.operations.length > 0) {
            updateUI();
        }
    };

    // Appliquer le thème sauvegardé
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = body.classList.contains('light-mode') ? 'dark' : 'light';
            localStorage.setItem('theme', currentTheme);
            applyTheme(currentTheme);
        });
    }

    const pnlPeriodSelect = document.getElementById('pnl-period-select');
    if (pnlPeriodSelect) {
        pnlPeriodSelect.value = pnlChartSettings.period;
        pnlPeriodSelect.addEventListener('change', () => {
            pnlChartSettings.period = pnlPeriodSelect.value;
            renderPnlEvolutionChart();
        });
    }

    const updatePnlViewButtons = () => {
        document.querySelectorAll('.pnl-view-btn').forEach(btn => {
            const isActive = (btn.getAttribute('data-view') || 'cumulative') === pnlChartSettings.view;
            btn.classList.toggle('active', isActive);
            btn.classList.toggle('btn-light', isActive);
            btn.classList.toggle('btn-outline-light', !isActive);
        });
    };

    updatePnlViewButtons();

    document.querySelectorAll('.pnl-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pnlChartSettings.view = btn.getAttribute('data-view') || 'cumulative';
            updatePnlViewButtons();
            renderPnlEvolutionChart();
        });
    });

    const periodSelect = document.getElementById('portfolio-period-select');
    if (periodSelect) {
        periodSelect.value = portfolioChartFilters.period;
        periodSelect.addEventListener('change', () => {
            portfolioChartFilters.period = periodSelect.value;
            if (state.operations && state.operations.length > 0) {
                updateUI();
            }
        });
    }

});

// --- RECHERCHE AUTO TICKER ---
async function searchTickerAuto() {
    const assetName = document.getElementById('op-asset').value.trim();
    if (assetName.length < 2) {
        alert("Veuillez entrer au moins le début du nom de l'actif (ex: 'Total').");
        return;
    }

    const btn = document.getElementById('btn-search-ticker');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    btn.disabled = true;

    try {
        const API_KEY = "ee6a290787f341849d49e5b7110b63c1";
        // On cherche spécifiquement en France si possible, sinon global
        const response = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${assetName}&outputsize=5&apikey=${API_KEY}`);
        const data = await response.json();

        if (data.data && data.data.length > 0) {
            // Logique de tri pour trouver la meilleure correspondance (Euronext Paris)
            let bestMatch = data.data.find(item => item.exchange === "Euronext Paris" || item.country === "France");

            // Si pas trouvé en France, on prend le premier (souvent US)
            if (!bestMatch) bestMatch = data.data[0];

            if (bestMatch) {
                // On garde le symbole brut renvoyé par l'API Search (ex: CA)
                // Twelve Data gère souvent mieux le symbole exact trouvé par son endpoint search
                document.getElementById('op-ticker').value = bestMatch.symbol;

                // On met aussi à jour le nom si c'était incomplet
                // document.getElementById('op-asset').value = bestMatch.instrument_name; 
                alert(`Trouvé : ${bestMatch.instrument_name} (${bestMatch.symbol})\nMarché : ${bestMatch.exchange}`);
            } else {
                alert("Aucun résultat probant trouvé.");
            }
        } else {
            alert("Aucun symbole trouvé pour ce nom.");
        }
    } catch (error) {
        console.error("Erreur recherche :", error);
        alert("Erreur lors de la recherche du ticker.");
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

function getSelectedEntryRules(formSelector = '#pea-operation-form') {
    const selected = [];
    document.querySelectorAll(`${formSelector} .entry-rule-check:checked`).forEach(cb => {
        selected.push(cb.value);
    });
    return selected;
}

function setEntryRuleCheckboxes(rules = [], formSelector = '#pea-operation-form') {
    document.querySelectorAll(`${formSelector} .entry-rule-check`).forEach(cb => {
        cb.checked = Array.isArray(rules) && rules.includes(cb.value);
    });
}

const defaultEntryRules = [
    { name: 'EMA 30 Weekly', value: '' },
    { name: 'Retour sur Zone Fib', value: '' },
    { name: 'Fibonacci 0.5/0.618', value: '' },
    { name: 'Mean Reversion', value: '' },
    { name: 'Support/Résistance', value: '' }
];

function entryRuleCollection() {
    if (!state.user) return null;
    return collection(db, 'users', state.user.uid, 'pea_entry_rules');
}

function normalizedEntryRules(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item, index) => {
        if (typeof item === 'string') {
            return { id: `local-${index}`, name: item, value: '' };
        }
        return {
            id: item.id || `local-${index}`,
            name: item.name || String(item),
            value: item.value || ''
        };
    }).filter(rule => rule.name);
}

function loadEntryRules() {
    const saved = localStorage.getItem('peaEntryRules');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.entryRules = normalizedEntryRules(parsed);
        } catch (error) {
            console.warn('Impossible de lire les règles d’entrée sauvegardées :', error);
        }
    }

    if (!Array.isArray(state.entryRules) || state.entryRules.length === 0) {
        state.entryRules = normalizedEntryRules(defaultEntryRules);
        saveEntryRules();
    }

    renderEntryRuleManagerList();
    renderEntryRuleCheckboxes('#pea-operation-form');
    renderEntryRuleCheckboxes('#edit-pea-op-form');
}

function saveEntryRules() {
    localStorage.setItem('peaEntryRules', JSON.stringify((state.entryRules || []).map(rule => ({ name: rule.name, value: rule.value || '' }))));
}

function subscribeEntryRules() {
    const rulesCol = entryRuleCollection();
    if (!rulesCol) return;

    const rulesQuery = query(rulesCol, orderBy('name', 'asc'));
    onSnapshot(rulesQuery, (snapshot) => {
        state.entryRules = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name || '', value: doc.data().value || '' })).filter(rule => rule.name);
        saveEntryRules();
        renderEntryRuleManagerList();
        renderEntryRuleCheckboxes('#pea-operation-form');
        renderEntryRuleCheckboxes('#edit-pea-op-form');
    }, (error) => {
        console.error('Erreur écoute Firestore des règles d’entrée :', error);
    });
}

async function createEntryRule(name, value = '') {
    const ruleName = name.trim();
    const ruleValue = value.trim();
    if (!ruleName) return;

    if (state.user) {
        try {
            await addDoc(entryRuleCollection(), { name: ruleName, value: ruleValue });
            return;
        } catch (error) {
            console.warn('Erreur création règle sur Firestore, fallback local :', error);
        }
    }

    state.entryRules.push({ id: `local-${Date.now()}`, name: ruleName, value: ruleValue });
    saveEntryRules();
    renderEntryRuleManagerList();
    renderEntryRuleCheckboxes('#pea-operation-form');
    renderEntryRuleCheckboxes('#edit-pea-op-form');
}

async function updateEntryRule(id, name, value = '') {
    const ruleName = name.trim();
    const ruleValue = value.trim();
    if (!ruleName) return;

    const index = state.entryRules.findIndex(rule => rule.id === id);
    if (index === -1) return;

    const rule = state.entryRules[index];
    if (state.user && rule.id && !rule.id.startsWith('local-')) {
        try {
            await updateDoc(doc(db, 'users', state.user.uid, 'pea_entry_rules', rule.id), { name: ruleName, value: ruleValue });
            return;
        } catch (error) {
            console.warn('Erreur mise à jour règle sur Firestore, fallback local :', error);
        }
    }

    state.entryRules[index].name = ruleName;
    state.entryRules[index].value = ruleValue;
    saveEntryRules();
    renderEntryRuleManagerList();
    renderEntryRuleCheckboxes('#pea-operation-form');
    renderEntryRuleCheckboxes('#edit-pea-op-form');
}

async function deleteEntryRule(id) {
    const index = state.entryRules.findIndex(rule => rule.id === id);
    if (index === -1) return;

    const rule = state.entryRules[index];
    if (state.user && rule.id && !rule.id.startsWith('local-')) {
        try {
            await deleteDoc(doc(db, 'users', state.user.uid, 'pea_entry_rules', rule.id));
            return;
        } catch (error) {
            console.warn('Erreur suppression règle sur Firestore, fallback local :', error);
        }
    }

    state.entryRules.splice(index, 1);
    saveEntryRules();
    renderEntryRuleManagerList();
    renderEntryRuleCheckboxes('#pea-operation-form');
    renderEntryRuleCheckboxes('#edit-pea-op-form');
}

function sanitizeEntryRuleId(rule, prefix = 'entry') {
    return `${prefix}-${rule}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

function renderEntryRuleCheckboxes(formSelector = '#pea-operation-form') {
    const containerId = (formSelector === '#edit-pea-op-form') ? 'edit-entry-rules-checkboxes' : 'entry-rules-checkboxes';
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (!Array.isArray(state.entryRules) || state.entryRules.length === 0) {
        container.innerHTML = '<div class="text-white-50 small">Aucune règle disponible.</div>';
        return;
    }

    state.entryRules.forEach(rule => {
        const ruleName = rule.name;
        const ruleValue = rule.value || '';
        const ruleId = sanitizeEntryRuleId(`${ruleName}${ruleValue ? `:${ruleValue}` : ''}`, formSelector === '#edit-pea-op-form' ? 'edit' : 'new');
        const ruleLabel = ruleValue ? `${ruleName} : ${ruleValue}` : ruleName;
        const col = document.createElement('div');
        col.className = 'col-md-6';
        col.innerHTML = `
            <div class="form-check form-check-sm">
                <input class="form-check-input entry-rule-check" type="checkbox" value="${ruleLabel}" id="${ruleId}">
                <label class="form-check-label" for="${ruleId}">${ruleLabel}</label>
            </div>
        `;
        container.appendChild(col);
    });
}

function renderEntryRuleManagerList() {
    const list = document.getElementById('entry-rule-manager-list');
    if (!list) return;

    list.innerHTML = '';
    if (!Array.isArray(state.entryRules) || state.entryRules.length === 0) {
        list.innerHTML = '<div class="text-center text-muted py-3">Aucune règle définie. Ajoutez-en une ci-dessus.</div>';
        return;
    }

    state.entryRules.forEach((rule, index) => {
        const displayValue = rule.value ? `<div class="text-white-50 small">${rule.value}</div>` : '';
        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-dark d-flex justify-content-between align-items-start gap-3';
        item.innerHTML = `
            <div>
                <div class="text-white fw-semibold">${rule.name}</div>
                ${displayValue}
            </div>
            <div class="btn-group btn-group-sm" role="group">
                <button type="button" class="btn btn-outline-light edit-entry-rule-btn" data-index="${index}"><i class="bi bi-pencil"></i></button>
                <button type="button" class="btn btn-outline-danger delete-entry-rule-btn" data-index="${index}"><i class="bi bi-trash"></i></button>
            </div>
        `;
        list.appendChild(item);
    });

    list.querySelectorAll('.edit-entry-rule-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = Number(btn.dataset.index);
            const rule = state.entryRules[index];
            if (!rule) return;
            document.getElementById('new-entry-rule-name').value = rule.name;
            document.getElementById('new-entry-rule-value').value = rule.value || '';
            document.getElementById('entry-rule-edit-id').value = String(index);
            document.getElementById('save-entry-rule-btn').textContent = 'Modifier';
            document.getElementById('cancel-entry-rule-edit-btn').style.display = 'block';
        });
    });

    list.querySelectorAll('.delete-entry-rule-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = Number(btn.dataset.index);
            const rule = state.entryRules[index];
            if (rule) {
                deleteEntryRule(rule.id || `local-${index}`);
            }
        });
    });
}

function resetEntryRuleForm() {
    const input = document.getElementById('new-entry-rule-name');
    const valueInput = document.getElementById('new-entry-rule-value');
    const editId = document.getElementById('entry-rule-edit-id');
    const saveBtn = document.getElementById('save-entry-rule-btn');
    const cancelBtn = document.getElementById('cancel-entry-rule-edit-btn');

    if (input) input.value = '';
    if (valueInput) valueInput.value = '';
    if (editId) editId.value = '';
    if (saveBtn) saveBtn.textContent = 'Ajouter';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

async function handleEntryRuleFormSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('new-entry-rule-name');
    const valueInput = document.getElementById('new-entry-rule-value');
    const editId = document.getElementById('entry-rule-edit-id');
    const ruleName = input?.value.trim();
    const ruleValue = valueInput?.value.trim() || '';
    if (!ruleName) {
        alert('Le nom de la règle est requis.');
        return;
    }

    const isEditing = editId && editId.value !== '';
    if (isEditing) {
        const index = Number(editId.value);
        if (isNaN(index) || index < 0 || index >= state.entryRules.length) {
            alert('Impossible de modifier la règle.');
            return;
        }
        const currentRule = state.entryRules[index];
        if (!currentRule) {
            alert('Règle introuvable.');
            return;
        }
        await updateEntryRule(currentRule.id, ruleName, ruleValue);
    } else {
        const existsIndex = state.entryRules.findIndex(r => {
            const existingName = typeof r === 'string' ? r : r.name;
            const existingValue = typeof r === 'string' ? '' : r.value || '';
            return existingName.toLowerCase() === ruleName.toLowerCase() && existingValue.toLowerCase() === ruleValue.toLowerCase();
        });
        if (existsIndex !== -1) {
            alert('Cette règle existe déjà.');
            return;
        }
        await createEntryRule(ruleName, ruleValue);
    }

    resetEntryRuleForm();
}

// --- Fonctions de Gestion de Formulaire ---
function updateFormFields() {
    const type = document.getElementById('op-type').value;
    const assetFields = document.getElementById('asset-fields');
    let depositFields = document.getElementById('deposit-fields');

    // Création dynamique du champ Montant si absent
    if (!depositFields) {
        const div = document.createElement('div');
        div.id = 'deposit-fields';
        div.className = 'mb-3';
        div.innerHTML = `
            <label class="form-label">Montant (€)</label>
            <input type="number" step="any" class="form-control bg-dark text-white border-secondary" id="op-amount">
        `;
        // Insérer avant la date
        const dateDiv = document.getElementById('op-date').parentNode;
        dateDiv.parentNode.insertBefore(div, dateDiv);
        depositFields = div;
    }

    const depositAmountInput = document.getElementById('op-amount');
    const priceInput = document.getElementById('op-price');
    const qtyInput = document.getElementById('op-quantity');
    const assetInput = document.getElementById('op-asset');
    const buyRatingFields = document.getElementById('buy-rating-fields');
    const buyTargetPriceFields = document.getElementById('buy-target-price-fields');

    const entryRulesGroup = document.getElementById('entry-rules-group');
    if (type === 'deposit' || type === 'withdrawal') {
        // Mode ESPÈCES
        if (assetFields) assetFields.style.display = 'none';
        depositFields.style.display = 'block';
        if (buyRatingFields) buyRatingFields.style.display = 'none';
        if (buyTargetPriceFields) buyTargetPriceFields.style.display = 'none';
        if (entryRulesGroup) entryRulesGroup.style.display = 'none';

        depositAmountInput.required = true;
        assetInput.required = false;
        priceInput.required = false;
        qtyInput.required = false;

    } else {
        // Mode TITRES
        if (assetFields) assetFields.style.display = 'block';
        depositFields.style.display = 'none';
        if (buyRatingFields) buyRatingFields.style.display = type === 'buy' ? 'block' : 'none';
        if (buyTargetPriceFields) buyTargetPriceFields.style.display = type === 'buy' ? 'block' : 'none';
        if (entryRulesGroup) entryRulesGroup.style.display = type === 'buy' ? 'block' : 'none';
        if (type !== 'buy') {
            document.querySelectorAll('#entry-rules-group .entry-rule-check').forEach(cb => cb.checked = false);
        }

        depositAmountInput.required = false;
        assetInput.required = true;
        priceInput.required = true;
        qtyInput.required = true;
    }

    updateModalInfo();
}

function updateModalInfo() {
    const type = document.getElementById('op-type').value;
    let balanceInfoDiv = document.getElementById('main-account-balance-info');

    if (!balanceInfoDiv) {
        const div = document.createElement('div');
        div.id = 'main-account-balance-info';
        div.className = 'alert alert-info mt-2 py-1 small';
        div.style.display = 'none';

        // Insérer dans le formulaire (juste avant le bouton submit par exemple)
        const form = document.getElementById('pea-operation-form');
        // Insérer avant la div des frais (fees) pour que ce soit visible
        const feesDiv = document.getElementById('op-fees').parentNode;
        feesDiv.parentNode.insertBefore(div, feesDiv.nextSibling);

        balanceInfoDiv = div;
    }

    if (type === 'deposit') {
        balanceInfoDiv.innerHTML = `<i class="bi bi-bank me-1"></i>Dispo Compte Titre : <strong>${state.mainAccountBalanceEUR ? state.mainAccountBalanceEUR.toFixed(2) : '0.00'} €</strong>`;
        balanceInfoDiv.style.display = 'block';
        balanceInfoDiv.classList.remove('alert-danger');
        balanceInfoDiv.classList.add('alert-info');
    } else {
        balanceInfoDiv.style.display = 'none';
    }
}


function initApp() {
    console.log("Initialisation App PEA...");

    const q = query(
        collection(db, "users", state.user.uid, "pea_operations"),
        orderBy("date", "asc")
    );

    let initialPriceUpdateDone = false; // Flag pour éviter le spam API

    onSnapshot(q, (snapshot) => {
        console.log("Données PEA reçues :", snapshot.size, "opérations.");
        state.operations = sortOperationsByDate(snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })));

        recalculatePortfolio();
        updateUI();

        // Lancement auto de l'API au premier chargement (si des opérations existent)
        if (!initialPriceUpdateDone && state.operations.length > 0) {
            console.log("Premier chargement : Actualisation auto des prix...");
            updatePricesFromAPI(true); // Mode silencieux
            initialPriceUpdateDone = true;
        }

    }, (error) => {
        console.error("Erreur lecture Firestore (PEA):", error);
    });

    // 2. Ecouter le Compte Titre (Pour le solde dispo)
    console.log("Démarrage écoute Compte Titre...");
    const qAccount = query(collection(db, "users", state.user.uid, "accountTransactions"));

    onSnapshot(qAccount, (snapshot) => {
        let balanceEUR = 0;
        console.log(`Compte Titre : ${snapshot.size} transactions trouvées.`);

        snapshot.forEach((doc) => {
            const t = doc.data();

            // Normalisation
            const cur = (t.currency || '').toUpperCase();
            const fromCur = (t.fromCurrency || '').toUpperCase();
            const toCur = (t.toCurrency || '').toUpperCase();

            const amount = parseFloat(t.amount) || 0;
            const fromAmount = parseFloat(t.fromAmount) || 0;
            const toAmount = parseFloat(t.toAmount) || 0;

            // Debug silencieux par défaut, décommentez si besoin
            // console.log(`Tx: ${t.type} ${amount} ${cur}`);

            if (t.type === 'deposit') {
                if (cur === 'EUR') balanceEUR += amount;
            }
            else if (t.type === 'withdrawal') {
                if (cur === 'EUR') balanceEUR -= amount;
            }
            else if (t.type === 'conversion') {
                if (fromCur === 'EUR') balanceEUR -= fromAmount;
                if (toCur === 'EUR') balanceEUR += toAmount;
            }
        });

        console.log(">>> Solde Compte Titre (EUR) :", balanceEUR);
        state.mainAccountBalanceEUR = balanceEUR;

        // Mise à jour immédiate si le formulaire est ouvert
        const infoDiv = document.getElementById('main-account-balance-info');
        if (infoDiv && infoDiv.style.display !== 'none') {
            updateModalInfo();
        }
    }, (error) => {
        console.error("Erreur lecture Firestore (Compte Titre):", error);
    });

    // Abonnement aux règles d'entrée stockées dans Firestore
    subscribeEntryRules();
}

// Soumission du formulaire (MODIFIÉ)
document.getElementById('pea-operation-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) return;

    const type = document.getElementById('op-type').value;
    const date = document.getElementById('op-date').value;
    const fees = parseFloat(document.getElementById('op-fees').value) || 0;
    const ttfPercent = parseFloat(document.getElementById('op-ttf-percent').value) || 0;
    const technicalData = document.getElementById('op-technical-data')?.value || '';
    const analystNote = document.getElementById('op-analyst-note')?.value || '';
    const targetPrice1Y = type === 'buy' ? parseFloat(document.getElementById('op-target-price-1y')?.value) || null : null;

    // Validation Date
    if (!date) { alert("La date est requise."); return; }

    let amount = 0;
    let quantity = 0;
    let price = 0;
    let asset = "";
    let ticker = "";
    let isin = "";

    // Logique de récupération
    if (type === 'deposit' || type === 'withdrawal') {
        amount = parseFloat(document.getElementById('op-amount').value);
        if (!amount || amount <= 0) { alert("Montant invalide."); return; }
        quantity = 1;
        price = amount;
        asset = (type === 'deposit') ? 'Apport Espèces' : 'Retrait Espèces';
    } else {
        asset = document.getElementById('op-asset').value.trim();
        ticker = document.getElementById('op-ticker').value.trim().toUpperCase();
        isin = document.getElementById('op-isin').value.trim();
        quantity = parseFloat(document.getElementById('op-quantity').value);
        price = parseFloat(document.getElementById('op-price').value);

        if (!quantity || quantity <= 0) { alert("Quantité invalide."); return; }
        if (!asset) { alert("Nom de l'actif requis."); return; }

        amount = quantity * price;
    }

    const ttf = amount * (ttfPercent / 100);

    const opData = {
        type,
        asset,
        ticker: ticker || null,
        isin: isin || null,
        quantity,
        price,
        amount,
        date,
        dateObj: new Date(date),
        fees,
        ttf,
        ttfPercent,
        technicalData: type === 'buy' ? technicalData : '',
        analystNote: type === 'buy' ? analystNote : '',
        targetPrice1Y: type === 'buy' ? targetPrice1Y : null,
        entryRules: type === 'buy' ? getSelectedEntryRules('#pea-operation-form') : []
    };

    try {
        if (editingOperationId) {
            // MODE MODIFICATION
            await updateDoc(doc(db, "users", state.user.uid, "pea_operations", editingOperationId), opData);
            // Note: On ne modifie pas automatiquement la transaction miroir sur le compte titre car c'est complexe de la retrouver.
        } else {
            // MODE CRÉATION
            await addDoc(collection(db, "users", state.user.uid, "pea_operations"), opData);

            // Opération miroir seulement en création
            if (type === 'deposit' || type === 'withdrawal') {
                const mainAccountType = (type === 'deposit') ? 'withdrawal' : 'deposit';
                const notes = (type === 'deposit') ? 'Virement vers PEA' : 'Virement depuis PEA';

                // On vérifie le solde seulement en création
                if (type === 'deposit' && amount > state.mainAccountBalanceEUR) {
                    if (!confirm(`Solde Compte Titre insuffisant (${state.mainAccountBalanceEUR}€). Forcer ?`)) return;
                }

                await addDoc(collection(db, "users", state.user.uid, "accountTransactions"), {
                    type: mainAccountType,
                    amount: amount,
                    currency: 'EUR',
                    date: new Date(date),
                    notes: notes
                });
            }
        }

        // Reset
        document.getElementById('pea-operation-form').reset();
        const modal = bootstrap.Modal.getInstance(document.getElementById('operationModal'));
        modal.hide();
        editingOperationId = null;
        document.querySelector('#pea-operation-form button[type="submit"]').textContent = "Valider";

        setTimeout(updateFormFields, 100);

    } catch (error) {
        console.error("Erreur sauvegarde :", error);
        alert("Erreur : " + error.message);
    }
});

function handleUpdatePricesMock() {
    updatePricesFromAPI();
}

// --- API PRIX (YAHOO FINANCE via PROXY) ---
// Yahoo Finance bloque souvent l'accès direct depuis le navigateur. On tente l'accès direct,
// puis des proxies de secours si nécessaire.

async function parseJsonResponse(res, source) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (parseError) {
        throw new Error(`Invalid JSON from ${source} (${parseError.message})`);
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTwelveDataPrice(ticker) {
    if (!ticker) return null;
    const symbol = encodeURIComponent(ticker.trim().toUpperCase());
    const url = `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_API_KEY}`;
    try {
        const data = await tryFetchJson(url, 'TwelveData');
        const price = Number(data?.price);
        if (!Number.isNaN(price) && price !== 0) {
            return { symbol: data.symbol || ticker, price };
        }
        throw new Error('Aucun prix retourné par TwelveData');
    } catch (error) {
        console.warn(`TwelveData fetch failed for ${ticker}:`, error.message || error);
        return null;
    }
}

async function tryFetchJson(url, sourceLabel) {
    try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
            throw new Error(`${sourceLabel || url} HTTP ${res.status}`);
        }
        return await parseJsonResponse(res, sourceLabel || url);
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`${sourceLabel || url} timeout`);
        }
        throw error;
    }
}

async function fetchYahooJson(url) {
    const proxies = [
        { url: `https://corsproxy.io/?url=${encodeURIComponent(url)}`, label: 'corsproxy.io' },
        { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, label: 'allorigins.raw' },
        { url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, label: 'allorigins.get' },
        { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, label: 'api.codetabs.com' },
        { url: `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`, label: 'thingproxy.freeboard.io' },
        { url, label: 'direct' }
    ];

    let lastError = null;
    for (const candidate of proxies) {
        try {
            const data = await tryFetchJson(candidate.url, candidate.label);
            if (candidate.label === 'allorigins.get') {
                if (data?.contents) {
                    try {
                        return JSON.parse(data.contents);
                    } catch (error) {
                        throw new Error(`Invalid JSON wrapper from allorigins.get: ${error.message}`);
                    }
                }
                throw new Error('No contents field in allorigins.get response');
            }
            return data;
        } catch (error) {
            console.warn(`[YahooJson] ${candidate.label} failed for ${url}:`, error.message || error);
            lastError = error;
        }
    }

    throw new Error(`Unable to fetch Yahoo JSON for ${url}: ${lastError?.message || 'unknown error'}`);
}

async function resolveYahooTicker(rawTicker) {
    const query = rawTicker.trim();
    if (!query) return null;
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;
    const data = await fetchYahooJson(searchUrl);
    const symbol = data?.quotes?.[0]?.symbol || data?.news?.[0]?.symbol || data?.quotes?.[0]?.quoteType;
    return symbol || null;
}

async function fetchYahooPrice(ticker) {
    const tryTicker = async (symbol) => {
        symbol = String(symbol || '').trim();
        if (!symbol) return null;
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
            const data = await fetchYahooJson(url);
            const result = data?.chart?.result?.[0];
            const price = result?.meta?.regularMarketPrice || result?.meta?.chartPreviousClose;
            if (price != null && !Number.isNaN(price)) {
                return { symbol, price };
            }
            throw new Error('No price data in Yahoo response');
        } catch (error) {
            console.warn(`Yahoo fetch failed for ${symbol}:`, error.message || error);
            return null;
        }
    };

    let result = await tryTicker(ticker);
    if (result) return result;

    const resolved = await resolveYahooTicker(ticker);
    if (resolved && resolved.toUpperCase() !== ticker.trim().toUpperCase()) {
        result = await tryTicker(resolved);
    }
    return result;
}

async function fetchMarketPrice(ticker) {
    const providerOrder = [fetchTwelveDataPrice, fetchYahooPrice];
    for (const provider of providerOrder) {
        const result = await provider(ticker);
        if (result && result.price != null) {
            return result;
        }
    }
    return null;
}

async function updatePricesFromAPI(silent = false) {
    const btn = document.getElementById('update-prices-btn');
    if (btn) {
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        btn.disabled = true;
    }

    const resetButton = () => {
        if (btn) {
            btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Actualiser Prix';
            btn.disabled = false;
        }
    };

    const safetyTimer = setTimeout(() => {
        console.warn('updatePricesFromAPI: timeout reached, resetting button');
        resetButton();
    }, 25000);

    // 1. Récupérer les tickers UNIQUES du portefeuille
    const currentHoldings = state.portfolio.holdings || {};
    console.log('updatePricesFromAPI: currentHoldings=', currentHoldings);
    const tickersToUpdate = new Map(); // YahooTicker -> [assetName,...]

    for (const [assetName, holding] of Object.entries(currentHoldings)) {
        const ticker = (holding.ticker || '').trim().toUpperCase();
        if (ticker) {
            if (!tickersToUpdate.has(ticker)) {
                tickersToUpdate.set(ticker, []);
            }
            tickersToUpdate.get(ticker).push(assetName);
        }
    }

    let tickers = [...tickersToUpdate.keys()];
    if (tickers.length === 0 && state.operations && state.operations.length > 0) {
        console.warn('updatePricesFromAPI: Aucun ticker dans holdings, fallback sur state.operations');
        state.operations.forEach(op => {
            const ticker = (op.ticker || '').trim().toUpperCase();
            if (ticker) {
                if (!tickersToUpdate.has(ticker)) {
                    tickersToUpdate.set(ticker, []);
                }
                if (!tickersToUpdate.get(ticker).includes(op.asset)) {
                    tickersToUpdate.get(ticker).push(op.asset);
                }
            }
        });
        tickers = [...tickersToUpdate.keys()];
    }

    console.log('updatePricesFromAPI: tickersToUpdate=', Array.from(tickersToUpdate.entries()));
    if (tickers.length === 0) {
        if (!silent) alert("Aucun ticker trouvé.");
        if (btn) { btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Actualiser Prix'; btn.disabled = false; }
        return;
    }

    console.log(">>> [YAHOO] Récupération pour :", tickers);

    // Initialiser state.livePrices
    if (!state.livePrices) state.livePrices = {};

    let updatedCount = 0;

    try {
        for (const ticker of tickers) {
            console.log(`>>> Appel marché (${ticker})...`);
            const result = await fetchMarketPrice(ticker);

            if (result && result.price) {
                state.livePrices[ticker] = result.price;
                updatedCount++;
                console.log(`OK ${ticker} (${result.symbol}) : ${result.price} EUR`);
            } else {
                console.warn(`Pas de prix trouvé pour ${ticker}`);
            }
        }

        console.log(`>>> Mises à jour : ${updatedCount}/${tickers.length}`);

        // Rafraichir UI
        updateUI();

        if (!silent && updatedCount > 0) alert(`${updatedCount} prix mis à jour via Yahoo Finance !`);
        if (!silent && updatedCount === 0) alert("Impossible de récupérer les prix. Vérifiez les tickers (ex: CA.PA).");

    } catch (error) {
        console.error("Erreur Yahoo Globale :", error);
        if (!silent) alert("Erreur Yahoo : " + error.message);
    } finally {
        clearTimeout(safetyTimer);
        resetButton();
    }
}

// Fonction auxiliaire pour mettre à jour le prix dans l'objet state.portfolio
// NOTE: Cette fonction n'est plus utilisée directement par `updatePricesFromAPI` après la migration vers Finnhub.
// La logique de mise à jour des prix est maintenant gérée via `state.livePrices` et `updateUI()`.
function updateHoldingPrice(ticker, newPrice) {
    // On doit retrouver quel "Nom d'actif" correspond à ce Ticker
    // C'est un peu lourd car on a indexé par "Nom" et pas "Ticker" dans calculatePortfolio.
    // On parcourt les holdings
    for (const [name, holding] of Object.entries(state.portfolio.holdings)) {
        // On cherche une opération liée à ce nom qui a ce ticker
        const op = state.operations.find(o => o.asset === name && o.ticker === ticker);
        if (op) {
            state.portfolio.holdings[name].currentPrice = newPrice;
            console.log(`Prix mis à jour pour ${name} (${ticker}) : ${newPrice} €`);
        }
    }
}
// -- Cœur du Calcul (Engine) --
function recalculatePortfolio() {
    console.log("Recalcul Portfolio avec", state.operations.length, "opérations en mémoire."); // DEBUG

    // Reset
    let cash = 0;
    let invested = 0; // Argent frais apporté
    let dividendsYear = 0;
    let realizedPnL = 0; // Plus-values réalisées sur les trades clôturés
    let holdings = {};
    const currentYear = new Date().getFullYear();

    const sortedOps = sortOperationsByDate(state.operations);

    sortedOps.forEach(op => {
        const qty = parseFloat(op.quantity) || 0;
        const price = parseFloat(op.price) || 0;
        const fees = parseFloat(op.fees) || 0;
        const ttf = parseFloat(op.ttf) || 0;
        const totalFees = fees + ttf;
        const amountValue = parseFloat(op.amount) || (qty * price);
        const totalAmount = (qty * price) || amountValue;
        const netAmount = amountValue - totalFees;

        if (op.type === 'deposit') {
            invested += amountValue;
            cash += amountValue;
        }
        else if (op.type === 'buy') {
            cash -= (amountValue + totalFees);

            // Calcul PRU
            if (!holdings[op.asset]) {
                holdings[op.asset] = {
                    name: op.asset,
                    qty: 0,
                    pru: 0,
                    totalCost: 0,
                    sector: 'Divers',
                    currentPrice: price, // Init au prix d'achat
                    ticker: op.ticker || null, // Stocker le ticker ici
                    targetPrice1Y: null
                };
            }

            const line = holdings[op.asset];

            // Nouveau PRU sans frais
            const newTotalQty = line.qty + qty;
            const oldVal = line.qty * line.pru;
            const newVal = amountValue; // montant brut sans frais

            if (newTotalQty > 0) {
                line.pru = (oldVal + newVal) / newTotalQty;
            }
            line.qty = newTotalQty;
            line.totalCost += (totalAmount + totalFees); // Coût comptable réel, frais inclus
            line.currentPrice = price;
            if (op.targetPrice1Y !== null && op.targetPrice1Y !== undefined && op.targetPrice1Y !== '') {
                line.targetPrice1Y = parseFloat(op.targetPrice1Y);
            }
        }
        else if (op.type === 'sell') {
            if (holdings[op.asset]) {
                const line = holdings[op.asset];
                const avgCostPerShare = line.qty > 0 ? (line.totalCost / line.qty) : line.pru;
                const soldCostBasis = avgCostPerShare * qty;
                cash += netAmount;

                const pnl = netAmount - soldCostBasis;
                realizedPnL += pnl;

                line.qty -= qty;
                line.totalCost = Math.max(0, line.totalCost - soldCostBasis);
                if (line.qty <= 0.0001) {
                    delete holdings[op.asset]; // Ligne fermée
                }
            } else {
                cash += netAmount;
            }
        }
        else if (op.type === 'dividend') {
            cash += amountValue; // Montant net perçu
            // Vérifier l'année
            const opYear = new Date(op.date).getFullYear();
            if (opYear === currentYear) {
                dividendsYear += amountValue;
            }
        }
        else if (op.type === 'withdrawal') {
            invested -= amountValue;
            cash -= amountValue;
        }
    });

    // INJECTION DES PRIX LIVE (Si disponibles)
    if (state.livePrices) {
        Object.entries(holdings).forEach(([assetName, holding]) => {
            const ticker = (holding.ticker || '').trim().toUpperCase();
            const priceFromTicker = ticker ? state.livePrices[ticker] : undefined;
            const priceFromAsset = state.livePrices[assetName];
            const livePrice = priceFromTicker !== undefined ? priceFromTicker : priceFromAsset;

            if (livePrice !== undefined) {
                holdings[assetName].currentPrice = livePrice;
                console.log(`Prix mis à jour pour ${assetName} (${ticker || 'sans ticker'}) : ${livePrice}`);
            }
        });
    }

    const totalCostBasis = Object.values(holdings).reduce((sum, h) => sum + (h.totalCost || ((h.qty || 0) * (h.pru || 0))), 0);
    state.portfolio = { cash, invested, dividendsYear, realizedPnL, holdings, costBasis: totalCostBasis };
    console.debug('[PEA cash]', { cash, invested, realizedPnL, holdingsCount: Object.keys(holdings).length });
}


// -- Mise à jour UI --
function updateUI() {
    recalculatePortfolio(); // On s'assure d'avoir les données fraîches (dont prix live)
    const p = state.portfolio;

    // 1. Calcul de la valeur totale
    let holdingsValue = 0;
    let totalPnl = 0;

    // Préparer liste pour tableau
    const holdingsList = Object.entries(p.holdings).map(([name, data]) => {
        const val = data.qty * data.currentPrice;
        const costBasis = data.totalCost || (data.qty * data.pru);
        holdingsValue += val;

        const pnl = val - costBasis;
        totalPnl += pnl;

        return { ...data, value: val, pnl: pnl, costBasis };
    });

    console.log("Holdings à afficher :", holdingsList); // DEBUG


    const totalPortfolio = holdingsValue + p.cash;

    // Calcul Total des gains (Réalisés)
    let totalRealizedPnl = 0;
    const groupedItems = groupOperationsIntoPositions(state.operations);
    groupedItems.forEach(item => {
        if (item.type === 'position') {
            const metrics = calculatePEAPositionMetrics(item);
            if (item.status === 'closed') {
                totalRealizedPnl += metrics.pnl;
            } else if (item.status === 'open' && metrics.totalExitQty > 0) {
                const realized = metrics.totalExitVal - (metrics.totalExitQty * metrics.averageEntryPrice) - metrics.totalExitFees;
                totalRealizedPnl += realized;
            }
        }
    });

    // KPIs HTML
    document.getElementById('total-portfolio-value').textContent = formatCurrency(totalPortfolio);
    document.getElementById('total-cash').textContent = formatCurrency(p.cash);

    // Total des gains (Réalisés)
    const totalRealizedPnlEl = document.getElementById('total-realized-pnl');
    if (totalRealizedPnlEl) {
        totalRealizedPnlEl.textContent = (totalRealizedPnl >= 0 ? '+' : '') + formatCurrency(totalRealizedPnl);
        totalRealizedPnlEl.className = `kpi-value ${totalRealizedPnl >= 0 ? 'text-success' : 'text-danger'}`;
    }

    document.getElementById('total-invested').textContent = formatCurrency(p.invested);
    document.getElementById('total-dividends-year').textContent = formatCurrency(p.dividendsYear);

    // P/L Latent
    const pnlUnrealizedEl = document.getElementById('total-pnl');
    pnlUnrealizedEl.textContent = (totalPnl >= 0 ? '+' : '') + formatCurrency(totalPnl);
    pnlUnrealizedEl.className = `kpi-value ${totalPnl >= 0 ? 'text-success' : 'text-danger'}`;

    if (document.getElementById('total-pnl-percent')) {
        const pnlPercent = holdingsValue > 0 ? (totalPnl / (holdingsValue - totalPnl)) * 100 : 0;
        const pnlPercentEl = document.getElementById('total-pnl-percent');
        pnlPercentEl.textContent = pnlPercent.toFixed(2) + '%';
        pnlPercentEl.className = totalPnl >= 0 ? 'text-success' : 'text-danger';
    }

    // Résumé des performances
    const performanceYield = p.invested > 0 ? ((totalPortfolio - p.invested) / p.invested) * 100 : 0;
    const bestAsset = holdingsList.slice().sort((a, b) => b.value - a.value)[0];
    const bestAssetLabel = bestAsset
        ? `${bestAsset.ticker || bestAsset.asset || 'Actif'} (${((bestAsset.value / totalPortfolio) * 100).toFixed(1)}%)`
        : 'Aucun actif';

    const perfRealizedEl = document.getElementById('performance-summary-realized');
    if (perfRealizedEl) {
        perfRealizedEl.textContent = `${totalRealizedPnl >= 0 ? '+' : ''}${formatCurrency(totalRealizedPnl)}`;
        perfRealizedEl.className = `fs-5 fw-bold ${totalRealizedPnl >= 0 ? 'text-success' : 'text-danger'}`;
    }

    const perfLatentEl = document.getElementById('performance-summary-latent');
    if (perfLatentEl) {
        perfLatentEl.textContent = `${totalPnl >= 0 ? '+' : ''}${formatCurrency(totalPnl)}`;
        perfLatentEl.className = `fs-5 fw-bold ${totalPnl >= 0 ? 'text-success' : 'text-danger'}`;
    }

    const perfYieldEl = document.getElementById('performance-summary-yield');
    if (perfYieldEl) {
        perfYieldEl.textContent = `${performanceYield >= 0 ? '+' : ''}${performanceYield.toFixed(2)}%`;
        perfYieldEl.className = `fs-5 fw-bold ${performanceYield >= 0 ? 'text-success' : 'text-danger'}`;
    }

    const perfBestEl = document.getElementById('performance-summary-best');
    if (perfBestEl) {
        perfBestEl.textContent = bestAssetLabel;
        perfBestEl.className = 'fs-6 fw-bold text-info';
    }

    // Total des Gains (Uniquement les trades clôturés / plus-values réalisées)
    const totalGains = p.realizedPnL;
    const totalGainsPercent = p.invested > 0 ? (totalGains / p.invested) * 100 : 0;

    if (document.getElementById('total-gains')) {
        const totalGainsEl = document.getElementById('total-gains');
        totalGainsEl.textContent = (totalGains >= 0 ? '+' : '') + formatCurrency(totalGains);
        totalGainsEl.className = `kpi-value ${totalGains >= 0 ? 'text-success' : 'text-danger'}`;
    }

    if (document.getElementById('total-gains-percent')) {
        const totalGainsPercentEl = document.getElementById('total-gains-percent');
        totalGainsPercentEl.textContent = totalGainsPercent.toFixed(2) + '%';
        totalGainsPercentEl.className = totalGains >= 0 ? 'text-success' : 'text-danger';
    }

    if (document.getElementById('total-gains-latent')) {
        const totalGainsLatentEl = document.getElementById('total-gains-latent');
        const totalGainsIncludingLatent = totalGains + totalPnl;
        totalGainsLatentEl.textContent = `${totalGainsIncludingLatent >= 0 ? '+' : ''}${formatCurrency(totalGainsIncludingLatent)} (gains + latent)`;
        totalGainsLatentEl.className = `d-block mt-1 ${totalGainsIncludingLatent >= 0 ? 'text-success' : 'text-danger'}`;
    }

    if (document.getElementById('yield-on-cost')) {
        const yieldVal = p.invested > 0 ? (p.dividendsYear / p.invested) * 100 : 0;
        document.getElementById('yield-on-cost').textContent = yieldVal.toFixed(2) + '%';
    }

    // Remplir Tableau Holdings (Nouveau)
    renderHoldingsTable(holdingsList, totalPortfolio);
    renderAssetPerformanceTable(holdingsList, totalPortfolio);

    // Remplir Tableau Historique (Nouveau)
    renderHistoryTable();

    updateCharts(holdingsList, totalPortfolio);
}

function sortAssetPerformanceRows(rows) {
    const direction = assetPerformanceSortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        let valueA;
        let valueB;

        switch (assetPerformanceSortColumn) {
            case 'asset':
                valueA = (a.name || '').toLowerCase();
                valueB = (b.name || '').toLowerCase();
                return valueA.localeCompare(valueB) * direction;
            case 'status':
                valueA = (a.status || '').toLowerCase();
                valueB = (b.status || '').toLowerCase();
                return valueA.localeCompare(valueB) * direction;
            case 'weight':
                valueA = a.weight || 0;
                valueB = b.weight || 0;
                break;
            case 'targetPrice1Y':
                valueA = a.targetPrice1Y || 0;
                valueB = b.targetPrice1Y || 0;
                break;
            case 'pnl':
            default:
                valueA = a.pnlCapitalPercent || 0;
                valueB = b.pnlCapitalPercent || 0;
        }

        if (valueA < valueB) return -1 * direction;
        if (valueA > valueB) return 1 * direction;
        return 0;
    });
}

function updateAssetPerformanceSortIcons() {
    document.querySelectorAll('#asset-performance-table th.sortable i').forEach(icon => {
        icon.className = 'bi bi-arrow-down-up text-muted ms-1';
    });

    const active = document.querySelector(`#asset-performance-table th.sortable[data-sort="${assetPerformanceSortColumn}"] i`);
    if (active) {
        active.className = assetPerformanceSortDirection === 'asc'
            ? 'bi bi-arrow-up text-primary ms-1'
            : 'bi bi-arrow-down text-primary ms-1';
    }
}

function formatRatingLabel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const labels = {
        strong_sell: 'Strong Sell',
        sell: 'Sell',
        neutre: 'Neutre',
        buy: 'Buy',
        strong_buy: 'Strong Buy'
    };
    return labels[normalized] || value || '—';
}

function getRatingBadgeClass(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['buy', 'strong_buy'].includes(normalized)) return 'bg-success';
    if (['sell', 'strong_sell'].includes(normalized)) return 'bg-danger';
    if (normalized === 'neutre') return 'bg-warning text-dark';
    return 'bg-secondary';
}

function renderAssetPerformanceTable(holdingsList, totalPortfolio) {
    const tbody = document.getElementById('asset-performance-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    const investedBase = state.portfolio?.invested || 0;
    const statusFilter = (document.getElementById('asset-performance-status-filter')?.value || 'all').toLowerCase();
    assetPerformanceStatusFilter = statusFilter;

    const positions = groupOperationsIntoPositions(state.operations)
        .filter(item => item.type === 'position')
        .filter(item => {
            if (statusFilter === 'open') return (item.status || 'open') === 'open';
            if (statusFilter === 'closed') return (item.status || 'open') === 'closed';
            return true;
        })
        .map(item => {
            const metrics = calculatePEAPositionMetrics(item);
            const remainingQty = Math.max(0, metrics.totalEntryQty - metrics.totalExitQty);
            const ticker = (item.ticker || '').trim().toUpperCase();
            const currentPrice = (state.livePrices && ((ticker && state.livePrices[ticker]) || state.livePrices[item.asset])) || (item.entries?.length ? item.entries[item.entries.length - 1].price : 0);
            const currentValue = item.status === 'open' ? remainingQty * currentPrice : 0;
            const pnlCapitalPercent = investedBase > 0 ? (metrics.pnl / investedBase) * 100 : 0;
            const latestBuy = [...(item.entries || [])].reverse().find(entry => entry.type === 'buy') || null;
            const analystNote = latestBuy?.analystNote || '';
            const technicalData = latestBuy?.technicalData || '';

            return {
                name: item.asset,
                ticker: item.ticker || '',
                status: item.status || 'open',
                value: currentValue,
                pnl: metrics.pnl,
                pnlCapitalPercent,
                pnlPercent: metrics.totalEntryVal > 0 ? (metrics.pnl / metrics.totalEntryVal) * 100 : 0,
                analystNote,
                technicalData,
                targetPrice1Y: latestBuy?.targetPrice1Y || null,
            };
        });

    if (positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Aucune action dans l’historique.</td></tr>';
        return;
    }

    const maxAbsPnl = positions.reduce((max, item) => Math.max(max, Math.abs(item.pnlCapitalPercent)), 0);

    const rows = sortAssetPerformanceRows(
        positions.map(item => ({
            ...item,
            weight: totalPortfolio > 0 ? (item.value / totalPortfolio) * 100 : 0,
            status: item.status || 'open'
        }))
    );

    rows.forEach(item => {
            const weight = item.weight || 0;
            const barWidth = maxAbsPnl > 0 ? Math.min(100, Math.abs(item.pnlCapitalPercent) * 100 / maxAbsPnl) : 0;
            const colorClass = item.pnlCapitalPercent >= 0 ? 'bg-success' : 'bg-danger';
            const badge = item.status === 'closed' ? '<span class="badge bg-secondary">Clôturée</span>' : '<span class="badge bg-info text-dark">Ouverte</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="ps-4">
                    <div class="d-flex align-items-center gap-2">
                        <span class="symbol-badge bg-secondary">${(item.name || 'AC').substring(0, 2).toUpperCase()}</span>
                        <div class="fw-semibold">${item.name}</div>
                    </div>
                </td>
                <td class="text-center">
                    ${badge}
                </td>
                <td class="text-center">
                    <span class="badge ${item.analystNote ? getRatingBadgeClass(item.analystNote) : 'bg-secondary'}">${item.analystNote ? formatRatingLabel(item.analystNote) : '—'}</span>
                </td>
                <td class="text-center">
                    <span class="badge ${item.technicalData ? getRatingBadgeClass(item.technicalData) : 'bg-secondary'}">${item.technicalData ? formatRatingLabel(item.technicalData) : '—'}</span>
                </td>
                <td class="text-end">${item.targetPrice1Y != null ? `${item.targetPrice1Y.toFixed(2)} €` : '—'}</td>
                <td class="text-end text-white-50">${item.status === 'closed' ? '0.0%' : weight.toFixed(1) + '%'}</td>
                <td class="text-end fw-semibold ${item.pnlCapitalPercent >= 0 ? 'text-success' : 'text-danger'}">${item.pnlCapitalPercent >= 0 ? '+' : ''}${item.pnlCapitalPercent.toFixed(2)}%</td>
                <td class="text-end pe-4">
                    <div class="d-flex align-items-center gap-2 justify-content-end">
                        <span class="small ${item.pnlCapitalPercent >= 0 ? 'text-success' : 'text-danger'}">${item.pnlCapitalPercent >= 0 ? '+' : ''}${item.pnlCapitalPercent.toFixed(1)}%</span>
                        <div class="progress" style="width: 110px; height: 8px; background-color: rgba(148,163,184,0.15);">
                            <div class="progress-bar ${colorClass}" role="progressbar" style="width: ${barWidth}%"></div>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
}

function sortHoldingsRows(rows) {
    const direction = holdingsSortDirection === 'asc' ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
        let valueA;
        let valueB;

        switch (holdingsSortColumn) {
            case 'asset':
                valueA = (a.name || '').toLowerCase();
                valueB = (b.name || '').toLowerCase();
                return valueA.localeCompare(valueB) * direction;
            case 'type':
                valueA = (a.type || 'Action').toLowerCase();
                valueB = (b.type || 'Action').toLowerCase();
                return valueA.localeCompare(valueB) * direction;
            case 'quantity':
                valueA = a.qty || 0;
                valueB = b.qty || 0;
                break;
            case 'pru':
                valueA = a.pru || 0;
                valueB = b.pru || 0;
                break;
            case 'price':
                valueA = a.currentPrice || 0;
                valueB = b.currentPrice || 0;
                break;
            case 'targetPrice1Y':
                valueA = a.targetPrice1Y || 0;
                valueB = b.targetPrice1Y || 0;
                break;
            case 'value':
                valueA = a.value || 0;
                valueB = b.value || 0;
                break;
            case 'pnl':
                valueA = a.pnl || 0;
                valueB = b.pnl || 0;
                break;
            case 'pnlPercent':
                valueA = ((a.qty * a.pru) > 0 ? (a.pnl / (a.qty * a.pru)) * 100 : 0) || 0;
                valueB = ((b.qty * b.pru) > 0 ? (b.pnl / (b.qty * b.pru)) * 100 : 0) || 0;
                break;
            case 'pnlCapitalPercent':
                valueA = (state.portfolio?.invested > 0 ? (a.pnl / state.portfolio.invested) * 100 : 0) || 0;
                valueB = (state.portfolio?.invested > 0 ? (b.pnl / state.portfolio.invested) * 100 : 0) || 0;
                break;
            default:
                valueA = a.value || 0;
                valueB = b.value || 0;
        }

        if (valueA < valueB) return -1 * direction;
        if (valueA > valueB) return 1 * direction;
        return 0;
    });

    return sorted;
}

function updateHoldingsSortIcons() {
    document.querySelectorAll('#holdings-table th.sortable i').forEach(icon => {
        icon.className = 'bi bi-arrow-down-up text-muted ms-1';
    });

    const active = document.querySelector(`#holdings-table th.sortable[data-sort="${holdingsSortColumn}"] i`);
    if (active) {
        active.className = holdingsSortDirection === 'asc'
            ? 'bi bi-arrow-up text-primary ms-1'
            : 'bi bi-arrow-down text-primary ms-1';
    }
}

function renderHoldingsTable(holdingsList, totalPortfolio) {
    const tbody = document.getElementById('holdings-body');
    const tfoot = document.getElementById('holdings-foot');
    tbody.innerHTML = '';
    if (tfoot) {
        tfoot.innerHTML = '';
    }

    if (holdingsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-4">Aucune ligne en portefeuille. Ajoutez une opération !</td></tr>';
    } else {
        const sortedHoldings = sortHoldingsRows(holdingsList);
        const positions = groupOperationsIntoPositions(state.operations);
        
        sortedHoldings.forEach(item => {
            const percent = totalPortfolio > 0 ? (item.value / totalPortfolio) * 100 : 0;
            const investBase = state.portfolio?.invested || 0;
            const tr = document.createElement('tr');
            tr.className = 'holdings-main-row';
            tr.dataset.asset = item.name;

            // Trouver la position associée pour les transactions
            const position = positions.find(p => p.type === 'position' && p.asset === item.name);

            // Sécurisation
            const tickerSafe = item.ticker || '';

            // Calcul du P/L en pourcentage
            const costBasis = item.qty * item.pru;
            const pnlPercent = costBasis > 0 ? (item.pnl / costBasis) * 100 : 0;
            const pnlPercentInvested = investBase > 0 ? (item.pnl / investBase) * 100 : 0;
            const targetGainPercent = item.targetPrice1Y != null && item.pru > 0
                ? ((item.targetPrice1Y - item.pru) / item.pru) * 100
                : null;

            let holdingFees = 0;
            let holdingTtf = 0;
            if (position) {
                const totalEntryQty = position.entries.reduce((sum, e) => sum + (parseFloat(e.quantity) || 0), 0);
                const totalEntryFees = position.entries.reduce((sum, e) => sum + (parseFloat(e.fees) || 0), 0);
                const totalEntryTtf = position.entries.reduce((sum, e) => sum + getOperationTtf(e), 0);
                const remainingQty = item.qty;
                const feesPerShare = totalEntryQty > 0 ? totalEntryFees / totalEntryQty : 0;
                const ttfPerShare = totalEntryQty > 0 ? totalEntryTtf / totalEntryQty : 0;
                holdingFees = feesPerShare * remainingQty;
                holdingTtf = ttfPerShare * remainingQty;
            }
            item.holdingFees = holdingFees;
            item.holdingTtf = holdingTtf;

            tr.innerHTML = `
                <td class="ps-4">
                    <div class="d-flex flex-column">
                        <div class="d-flex align-items-center">
                            <div class="symbol-badge bg-secondary me-2">${item.name.substring(0, 2).toUpperCase()}</div>
                            <div>
                                <div class="fw-bold">${item.name}</div>
                                ${tickerSafe ? `<small class="text-muted">${tickerSafe}</small>` : ''}
                            </div>
                        </div>
                    </div>
                </td>
                <td><span class="badge bg-secondary opacity-50">Action</span></td>
                <td class="text-end font-monospace">${item.qty.toFixed(2)}</td>
                <td class="text-end font-monospace">${item.pru.toFixed(2)} €</td>
                <td class="text-end font-monospace text-info">${item.currentPrice.toFixed(2)} €</td>
                <td class="text-end font-monospace">${formatCurrency(item.costBasis)}</td>
                <td class="text-end fw-bold">${formatCurrency(item.value)}</td>
                <td class="text-end font-monospace text-white-50">${formatCurrency(holdingFees)}</td>
                <td class="text-end font-monospace text-white-50">${formatCurrency(holdingTtf)}</td>
                <td class="text-end ${item.pnl >= 0 ? 'text-success' : 'text-danger'}">
                    ${item.pnl >= 0 ? '+' : ''}${formatCurrency(item.pnl)}
                </td>
                <td class="text-end fw-bold ${item.pnl >= 0 ? 'text-success' : 'text-danger'}">
                    ${item.pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%
                </td>
                <td class="text-end fw-bold ${item.pnl >= 0 ? 'text-success' : 'text-danger'}">
                    ${pnlPercentInvested >= 0 ? '+' : ''}${pnlPercentInvested.toFixed(2)}%
                </td>
                <td class="text-end pe-4">
                     <button class="btn btn-sm btn-outline-danger py-0 px-2 sell-btn" 
                        data-name="${item.name}" 
                        data-ticker="${tickerSafe}" 
                        data-qty="${item.qty}">
                        <i class="bi bi-currency-dollar"></i> Vendre
                     </button>
                </td>
            `;
            tbody.appendChild(tr);

            if (position) {
                const saleDetails = getPositionRealizedSales(position);
                if (saleDetails.length > 0) {
                    const lastSale = saleDetails[saleDetails.length - 1];
                    const summaryRow = document.createElement('tr');
                    summaryRow.className = 'holdings-summary-row';
                    summaryRow.innerHTML = `
                        <td colspan="11" class="py-2 bg-dark bg-opacity-10 small text-white">
                            <div class="d-flex flex-wrap gap-3 align-items-center">
                                <span class="badge bg-danger">Vente partielle</span>
                                <span>${new Date(lastSale.date).toLocaleDateString('fr-FR')}</span>
                                <span><strong>Qté :</strong> ${lastSale.quantity.toFixed(2)}</span>
                                <span><strong>PV :</strong> <span class="${lastSale.realizedPnl >= 0 ? 'text-success' : 'text-danger'}">${lastSale.realizedPnl >= 0 ? '+' : ''}${formatCurrency(lastSale.realizedPnl)}</span></span>
                                <span><strong>${lastSale.realizedPercent >= 0 ? '+' : ''}${lastSale.realizedPercent.toFixed(2)}%</strong></span>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(summaryRow);
                }
            }
        });

        // Calcul des totaux pour le footer
        let totalQty = 0;
        let totalValue = 0;
        let totalPnl = 0;
        let totalCostBasis = 0;
        let totalFees = 0;
        let totalTtf = 0;

        holdingsList.forEach(item => {
            totalQty += item.qty;
            totalValue += item.value;
            totalPnl += item.pnl;
            totalCostBasis += item.costBasis || (item.qty * item.pru);
            if (item.holdingFees) totalFees += item.holdingFees;
            if (item.holdingTtf) totalTtf += item.holdingTtf;
        });

        const totalPnlPercent = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;
        const investBase = state.portfolio?.invested || 0;
        const totalPnlCapitalPercent = investBase > 0 ? (totalPnl / investBase) * 100 : 0;

        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td class="ps-4 fw-bold text-white">TOTAL</td>
                    <td></td>
                    <td class="text-end font-monospace fw-bold text-white">${totalQty.toFixed(2)}</td>
                    <td class="text-end font-monospace text-muted">—</td>
                    <td class="text-end font-monospace text-muted">—</td>
                    <td class="text-end font-monospace fw-bold text-white">${formatCurrency(totalCostBasis)}</td>
                    <td class="text-end fw-bold text-white">${formatCurrency(totalValue)}</td>
                    <td class="text-end font-monospace fw-bold text-white">${formatCurrency(totalFees)}</td>
                    <td class="text-end font-monospace fw-bold text-white">${formatCurrency(totalTtf)}</td>
                    <td class="text-end fw-bold ${totalPnl >= 0 ? 'text-success' : 'text-danger'}">
                        ${totalPnl >= 0 ? '+' : ''}${formatCurrency(totalPnl)}
                    </td>
                    <td class="text-end fw-bold ${totalPnl >= 0 ? 'text-success' : 'text-danger'}">
                        ${totalPnl >= 0 ? '+' : ''}${totalPnlPercent.toFixed(2)}%
                    </td>
                    <td class="text-end fw-bold ${totalPnlCapitalPercent >= 0 ? 'text-success' : 'text-danger'}">
                        ${totalPnlCapitalPercent >= 0 ? '+' : ''}${totalPnlCapitalPercent.toFixed(2)}%
                    </td>
                    <td class="text-end pe-4"></td>
                </tr>
            `;
        }

        // Attacher les listeners après création du DOM
        document.querySelectorAll('.sell-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                openSellModal(btn.dataset.name, btn.dataset.ticker, btn.dataset.qty);
            });
        });

    }
}


function groupOperationsIntoPositions(ops) {
    const sortedOps = sortOperationsByDate(ops);
    const result = [];
    const activePositions = {};

    sortedOps.forEach(op => {
        if (op.type === 'buy') {
            if (!activePositions[op.asset]) {
                activePositions[op.asset] = {
                    id: 'pos_' + op.id,
                    type: 'position',
                    asset: op.asset,
                    ticker: op.ticker,
                    isin: op.isin,
                    status: 'open',
                    entries: [],
                    exits: [],
                    date: op.date
                };
            }
            activePositions[op.asset].entries.push(op);
        } 
        else if (op.type === 'sell') {
            let pos = activePositions[op.asset];
            if (!pos) {
                pos = {
                    id: 'pos_' + op.id,
                    type: 'position',
                    asset: op.asset,
                    ticker: op.ticker,
                    isin: op.isin,
                    status: 'closed',
                    entries: [],
                    exits: [op],
                    date: op.date,
                    closeDate: op.date
                };
                result.push(pos);
            } else {
                pos.exits.push(op);

                const totalBought = pos.entries.reduce((sum, e) => sum + e.quantity, 0);
                const totalSold = pos.exits.reduce((sum, e) => sum + e.quantity, 0);
                if (totalSold >= totalBought - 0.0001) {
                    pos.status = 'closed';
                    pos.closeDate = op.date;
                    result.push(pos);
                    delete activePositions[op.asset];
                }
            }
        }
        else {
            result.push({
                ...op,
                date: op.date
            });
        }
    });

    for (const assetName in activePositions) {
        result.push(activePositions[assetName]);
    }

    result.sort((a, b) => {
        const dateA = a.type === 'position' ? (a.closeDate || a.date) : a.date;
        const dateB = b.type === 'position' ? (b.closeDate || b.date) : b.date;
        return new Date(dateB) - new Date(dateA);
    });

    return result;
}

function calculatePEAPositionMetrics(pos) {
    const totalEntryQty = pos.entries.reduce((sum, e) => sum + e.quantity, 0);
    const totalEntryVal = pos.entries.reduce((sum, e) => sum + (e.quantity * e.price), 0);
    const totalEntryFees = pos.entries.reduce((sum, e) => sum + (e.fees || 0), 0);
    const totalEntryTTF = pos.entries.reduce((sum, e) => {
        const amount = e.amount || (e.quantity * e.price) || 0;
        const ttfStored = Number(e.ttf) || 0;
        const ttfFromPercent = amount * ((e.ttfPercent || 0) / 100);
        const ttfValue = ttfStored > 0 ? ttfStored : ttfFromPercent;
        return sum + ttfValue;
    }, 0);

    const totalExitQty = pos.exits.reduce((sum, e) => sum + e.quantity, 0);
    const totalExitVal = pos.exits.reduce((sum, e) => sum + (e.quantity * e.price), 0);
    const totalExitFees = pos.exits.reduce((sum, e) => sum + (e.fees || 0), 0);
    const totalExitTTF = pos.exits.reduce((sum, e) => {
        const amount = e.amount || (e.quantity * e.price) || 0;
        const ttfStored = Number(e.ttf) || 0;
        const ttfFromPercent = amount * ((e.ttfPercent || 0) / 100);
        const ttfValue = ttfStored > 0 ? ttfStored : ttfFromPercent;
        return sum + ttfValue;
    }, 0);

    const totalFeesOnly = totalEntryFees + totalExitFees;
    const totalTTFOnly = totalEntryTTF + totalExitTTF;
    const totalFees = totalFeesOnly + totalTTFOnly;

    let pnl = 0;
    let averageEntryPrice = totalEntryQty > 0 ? (totalEntryVal / totalEntryQty) : 0;
    let averageExitPrice = totalExitQty > 0 ? (totalExitVal / totalExitQty) : 0;

    if (pos.status === 'closed') {
        pnl = totalExitVal - totalEntryVal - totalFees;
    } else {
        const ticker = (pos.ticker || '').trim().toUpperCase();
        const currentPrice = (state.livePrices && ((ticker && state.livePrices[ticker]) || state.livePrices[pos.asset])) || (pos.entries.length > 0 ? pos.entries[pos.entries.length - 1].price : 0);
        const remainingQty = totalEntryQty - totalExitQty;
        const currentVal = remainingQty * currentPrice;
        pnl = (totalExitVal + currentVal) - totalEntryVal - totalFees;
    }

    return {
        totalEntryQty,
        totalEntryVal,
        totalExitQty,
        totalExitVal,
        totalFees,
        feesOnly: totalFeesOnly,
        ttfOnly: totalTTFOnly,
        averageEntryPrice,
        averageExitPrice,
        pnl
    };
}

function getOperationTtf(op) {
    const amount = op.amount || ((op.quantity || 0) * (op.price || 0));
    const ttfStored = Number(op.ttf) || 0;
    const ttfFromPercent = amount * ((op.ttfPercent || 0) / 100);
    return ttfStored > 0 ? ttfStored : ttfFromPercent;
}

function getPositionRealizedSales(position) {
    const entries = position.entries.map(e => ({
        remainingQty: e.quantity,
        totalQty: e.quantity,
        unitPrice: e.price,
        fees: e.fees || 0,
        ttf: getOperationTtf(e)
    }));

    const sales = [];
    position.exits.forEach(exit => {
        let remainingToAllocate = exit.quantity;
        let costBasis = 0;

        while (remainingToAllocate > 0 && entries.length > 0) {
            const entry = entries[0];
            const qtyTaken = Math.min(entry.remainingQty, remainingToAllocate);
            const feesPerShare = entry.totalQty > 0 ? entry.fees / entry.totalQty : 0;
            const ttfPerShare = entry.totalQty > 0 ? entry.ttf / entry.totalQty : 0;

            costBasis += qtyTaken * entry.unitPrice;
            costBasis += qtyTaken * feesPerShare;
            costBasis += qtyTaken * ttfPerShare;

            entry.remainingQty -= qtyTaken;
            remainingToAllocate -= qtyTaken;

            if (entry.remainingQty <= 0) {
                entries.shift();
            }
        }

        const saleAmount = exit.quantity * exit.price;
        const exitFees = exit.fees || 0;
        const exitTtf = getOperationTtf(exit);
        const netProceeds = saleAmount - exitFees - exitTtf;
        const pnl = netProceeds - costBasis;
        const percent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

        sales.push({
            ...exit,
            costBasis,
            netProceeds,
            realizedPnl: pnl,
            realizedPercent: percent
        });
    });

    return sales;
}

let peaHistorySortColumn = 'date';
let peaHistorySortDirection = 'desc';
let holdingsSortColumn = 'value';
let holdingsSortDirection = 'desc';
let assetPerformanceSortColumn = 'pnl';
let assetPerformanceSortDirection = 'desc';
let assetPerformanceStatusFilter = 'all';

function updatePEAHistorySortIcons() {
    document.querySelectorAll('#history-table th.sortable i').forEach(icon => {
        icon.className = 'bi bi-arrow-down-up text-muted ms-1';
    });

    const activeHeader = document.querySelector(`#history-table th.sortable[data-sort="${peaHistorySortColumn}"] i`);
    if (activeHeader) {
        activeHeader.className = peaHistorySortDirection === 'asc'
            ? 'bi bi-arrow-up text-primary ms-1'
            : 'bi bi-arrow-down text-primary ms-1';
    }
}

function getPEAHistoryRows() {
    const filter = (document.getElementById('pea-history-filter')?.value || '').toLowerCase().trim();
    const typeFilter = (document.getElementById('pea-history-type-filter')?.value || 'all').toLowerCase();
    const statusFilter = (document.getElementById('pea-history-status-filter')?.value || 'all').toLowerCase();
    const periodFilter = (document.getElementById('pea-history-period-filter')?.value || 'all').toLowerCase();
    const now = new Date();

    return groupOperationsIntoPositions(state.operations)
        .filter(item => {
            const positionLabel = item.type === 'position'
                ? `${item.asset || ''} ${item.ticker || ''} ${item.status || ''} ${item.type || ''}`
                : `${item.asset || ''} ${item.type || ''} ${item.status || ''}`;

            if (filter && !positionLabel.toLowerCase().includes(filter)) {
                return false;
            }

            const itemType = item.type === 'position' ? 'position' : (item.type || '').toLowerCase();
            const normalizedTypeFilter = typeFilter === 'trade' ? 'position' : typeFilter;

            if (typeFilter !== 'all' && itemType !== normalizedTypeFilter) {
                return false;
            }

            const itemStatus = item.type === 'position' ? (item.status || 'open').toLowerCase() : 'none';
            if (statusFilter !== 'all' && itemStatus !== statusFilter) {
                return false;
            }

            if (periodFilter !== 'all') {
                const itemDate = item.type === 'position'
                    ? new Date(item.closeDate || item.date)
                    : new Date(item.date);

                if (Number.isNaN(itemDate.getTime())) {
                    return false;
                }

                const cutoff = new Date(now);
                if (periodFilter === '1m') cutoff.setMonth(cutoff.getMonth() - 1);
                else if (periodFilter === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
                else if (periodFilter === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
                else if (periodFilter === '1y') cutoff.setFullYear(cutoff.getFullYear() - 1);

                if (itemDate < cutoff) {
                    return false;
                }
            }

            return true;
        })
        .map(item => {
            if (item.type === 'position') {
                const metrics = calculatePEAPositionMetrics(item);
                const positionValue = metrics.totalEntryQty * metrics.averageEntryPrice;
                const pnlPercent = metrics.totalEntryVal > 0 ? (metrics.pnl / metrics.totalEntryVal) * 100 : 0;

                return {
                    ...item,
                    metrics,
                    positionValue,
                    pnlPercent,
                    sortDate: item.status === 'closed' ? new Date(item.closeDate || item.date) : new Date(item.date),
                    totalPnl: metrics.pnl,
                    typeLabel: item.status === 'closed' ? 'Trade fermé' : 'Trade ouvert',
                    qtyValue: item.status === 'closed' ? metrics.totalEntryQty : (metrics.totalEntryQty - metrics.totalExitQty),
                    priceValue: metrics.averageEntryPrice,
                    amountValue: positionValue,
                    feesValue: metrics.totalFees,
                    entryQty: metrics.totalEntryQty,
                    exitQty: metrics.totalExitQty,
                    totalText: metrics.pnl,
                };
            }

            const amountValue = (item.quantity || 0) * (item.price || 0);
            return {
                ...item,
                metrics: null,
                positionValue: amountValue,
                pnlPercent: 0,
                sortDate: new Date(item.date),
                totalPnl: item.amount || 0,
                typeLabel: item.type || 'Opération',
                qtyValue: item.quantity || 0,
                priceValue: item.price || 0,
                amountValue,
                feesValue: item.fees || 0,
                totalText: item.amount || 0,
            };
        });
}

function sortPEAHistoryRows(rows) {
    const direction = peaHistorySortDirection === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
        let valueA;
        let valueB;

        switch (peaHistorySortColumn) {
            case 'date':
                valueA = a.sortDate.getTime();
                valueB = b.sortDate.getTime();
                break;
            case 'type':
                valueA = (a.type === 'position' ? a.typeLabel : a.type || '').toLowerCase();
                valueB = (b.type === 'position' ? b.typeLabel : b.type || '').toLowerCase();
                return valueA.localeCompare(valueB) * direction;
            case 'asset':
                valueA = (a.asset || '').toLowerCase();
                valueB = (b.asset || '').toLowerCase();
                return valueA.localeCompare(valueB) * direction;
            case 'quantity':
                valueA = a.qtyValue || 0;
                valueB = b.qtyValue || 0;
                break;
            case 'price':
                valueA = a.priceValue || 0;
                valueB = b.priceValue || 0;
                break;
            case 'amount':
                valueA = a.amountValue || 0;
                valueB = b.amountValue || 0;
                break;
            case 'pnl':
                valueA = a.totalPnl || 0;
                valueB = b.totalPnl || 0;
                break;
            case 'yield':
                valueA = a.pnlPercent || 0;
                valueB = b.pnlPercent || 0;
                break;
            default:
                valueA = a.sortDate.getTime();
                valueB = b.sortDate.getTime();
        }

        if (valueA < valueB) return -1 * direction;
        if (valueA > valueB) return 1 * direction;
        return 0;
    });
}

function renderHistoryTable() {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = sortPEAHistoryRows(getPEAHistoryRows());

    rows.forEach(item => {
        const tr = document.createElement('tr');

        if (item.type === 'position') {
            const metrics = calculatePEAPositionMetrics(item);
            
            let statusBadge = '';
            let dateText = '';
            let qtyText = '';
            let priceText = '';
            let totalText = '';

            if (item.status === 'closed') {
                statusBadge = '<span class="badge bg-success">Trade Fermé</span>';
                dateText = `${item.date} <i class="bi bi-arrow-right mx-1 text-muted"></i> ${item.closeDate}`;
                qtyText = `${metrics.totalEntryQty.toFixed(2)}`;
                priceText = `${metrics.averageEntryPrice.toFixed(3)} € <i class="bi bi-arrow-right mx-1 text-muted"></i> ${metrics.averageExitPrice.toFixed(3)} €`;
            } else {
                statusBadge = '<span class="badge bg-warning text-dark">Trade Ouvert</span>';
                dateText = `${item.date} <i class="bi bi-arrow-right mx-1 text-muted"></i> En cours`;
                qtyText = `${(metrics.totalEntryQty - metrics.totalExitQty).toFixed(2)} / ${metrics.totalEntryQty.toFixed(2)}`;
                priceText = `${metrics.averageEntryPrice.toFixed(3)} €`;
            }

            const pnlColor = metrics.pnl >= 0 ? 'text-success' : 'text-danger';
            totalText = `<span class="${pnlColor} fw-bold">${metrics.pnl >= 0 ? '+' : ''}${formatCurrency(metrics.pnl)}</span>`;
            const pnlPercent = metrics.totalEntryVal > 0 ? (metrics.pnl / metrics.totalEntryVal) * 100 : 0;
            const pnlPercentText = `<span class="${pnlColor} fw-bold">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%</span>`;
            const investedBase = state.portfolio?.invested || 0;
            const pnlCapitalPercent = investedBase > 0 ? (metrics.pnl / investedBase) * 100 : 0;
            const positionValue = metrics.totalEntryVal; // Entrée brute sans frais
            const feesOnly = metrics.feesOnly || 0;
            const ttfOnly = metrics.ttfOnly || 0;

            tr.innerHTML = `
                <td class="ps-4 text-white-50 small">${dateText}</td>
                <td>${statusBadge}</td>
                <td class="fw-bold text-white">${item.asset}</td>
                <td class="text-end font-monospace">${qtyText}</td>
                <td class="text-end font-monospace text-white-50">${priceText}</td>
                <td class="text-end font-monospace text-info">${formatCurrency(positionValue)}</td>
                <td class="text-end font-monospace">${totalText}</td>
                <td class="text-end font-monospace">${pnlPercentText}</td>
                <td class="text-end font-monospace ${pnlCapitalPercent >= 0 ? 'text-success' : 'text-danger'}">${pnlCapitalPercent >= 0 ? '+' : ''}${pnlCapitalPercent.toFixed(2)}%</td>
                <td class="text-end font-monospace text-white-50">${formatCurrency(feesOnly)}</td>
                <td class="text-end font-monospace text-white-50">${formatCurrency(ttfOnly)}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-link text-success p-0 me-2 open-sell-modal" data-asset="${item.asset}" data-ticker="${item.ticker}" data-qty="${metrics.totalEntryQty - metrics.totalExitQty}" title="Vendre">
                        <i class="bi bi-cash-coin"></i>
                    </button>
                    <button class="btn btn-sm btn-link text-warning p-0 me-2" onclick="handleEditPEAPosition('${item.id}')" title="Modifier">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-link text-danger p-0" onclick="deletePEAPosition('${item.id}')" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
        } else {
            let typeBadge = '';
            if (item.type === 'deposit') typeBadge = '<span class="badge bg-secondary">Dépôt</span>';
            else if (item.type === 'withdrawal') typeBadge = '<span class="badge bg-danger">Retrait</span>';
            else if (item.type === 'dividend') typeBadge = '<span class="badge bg-primary">Dividende</span>';

            const opData = JSON.stringify(item).replace(/"/g, '&quot;');

            const amountValue = (item.quantity || 0) * (item.price || 0);
            const feesValue = item.fees || 0;
            const investedBase = state.portfolio?.invested || 0;
            const pnlCapitalPercent = investedBase > 0 ? ((item.amount || amountValue) / investedBase) * 100 : 0;
            const ttfStored = Number(item.ttf) || 0;
            const ttfFallback = (item.amount || amountValue) * ((item.ttfPercent || 0) / 100);
            const ttfValue = ttfStored > 0 ? ttfStored : ttfFallback;

            tr.innerHTML = `
                <td class="ps-4 text-white-50 small">${item.date}</td>
                <td>${typeBadge}</td>
                <td>${item.asset}</td>
                <td class="text-end font-monospace">${item.quantity}</td>
                <td class="text-end font-monospace">${(item.price || 0).toFixed(3)} €</td>
                <td class="text-end font-monospace text-info">${formatCurrency(amountValue)}</td>
                <td class="text-end font-monospace fw-bold">${formatCurrency(item.amount || amountValue)}</td>
                <td class="text-end font-monospace">—</td>
                <td class="text-end font-monospace ${pnlCapitalPercent >= 0 ? 'text-success' : 'text-danger'}">${pnlCapitalPercent >= 0 ? '+' : ''}${pnlCapitalPercent.toFixed(2)}%</td>
                <td class="text-end font-monospace text-white-50">${feesValue ? formatCurrency(feesValue) : '-'}</td>
                <td class="text-end font-monospace text-white-50">${formatCurrency(ttfValue)}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-link text-warning p-0 me-2 edit-op-btn" data-op="${opData}" title="Modifier">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-link text-danger p-0" onclick="deletePEAOperation('${item.id}')" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
        }
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.edit-op-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const op = JSON.parse(btn.dataset.op.replace(/&quot;/g, '"'));
            startEditOperation(op);
        });
    });

    document.querySelectorAll('.open-sell-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            openPartialSellModal(
                btn.dataset.asset,
                btn.dataset.ticker,
                parseFloat(btn.dataset.qty)
            );
        });
    });

    updatePEAHistorySortIcons();

    document.querySelectorAll('.delete-op-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const ids = JSON.parse(btn.dataset.ids);
            deleteOperation(ids);
        });
    });
}

let currentPEAPosition = null;

document.querySelectorAll('#holdings-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const sortKey = th.dataset.sort;
        if (!sortKey) return;

        if (holdingsSortColumn === sortKey) {
            holdingsSortDirection = holdingsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            holdingsSortColumn = sortKey;
            holdingsSortDirection = 'desc';
        }

        updateHoldingsSortIcons();
        recalculatePortfolio();
        updateUI();
    });
});

document.querySelectorAll('#asset-performance-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const sortKey = th.dataset.sort;
        if (!sortKey) return;

        if (assetPerformanceSortColumn === sortKey) {
            assetPerformanceSortDirection = assetPerformanceSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            assetPerformanceSortColumn = sortKey;
            assetPerformanceSortDirection = 'desc';
        }

        updateAssetPerformanceSortIcons();
        recalculatePortfolio();
        updateUI();
    });
});

document.querySelectorAll('#history-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const sortKey = th.dataset.sort;
        if (!sortKey) return;

        if (peaHistorySortColumn === sortKey) {
            peaHistorySortDirection = peaHistorySortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            peaHistorySortColumn = sortKey;
            peaHistorySortDirection = 'desc';
        }

        updatePEAHistorySortIcons();
        renderHistoryTable();
    });
});

const peaHistoryFilterInput = document.getElementById('pea-history-filter');
const assetPerformanceStatusFilterSelect = document.getElementById('asset-performance-status-filter');
const allocationViewSelect = document.getElementById('allocation-view-select');
if (allocationViewSelect) {
    allocationViewSelect.addEventListener('change', () => {
        recalculatePortfolio();
        updateUI();
    });
}

if (peaHistoryFilterInput) {
    peaHistoryFilterInput.addEventListener('input', () => {
        renderHistoryTable();
    });
}

if (assetPerformanceStatusFilterSelect) {
    assetPerformanceStatusFilterSelect.addEventListener('change', () => {
        recalculatePortfolio();
        updateUI();
    });
}

// Accordéon pour le tableau Performance par action
const assetPerformanceToggle = document.getElementById('asset-performance-toggle');
const assetPerformanceContent = document.getElementById('asset-performance-content');
const assetPerformanceChevron = document.getElementById('asset-performance-chevron');

if (assetPerformanceToggle && assetPerformanceContent) {
    assetPerformanceToggle.addEventListener('click', () => {
        const isVisible = assetPerformanceContent.style.display !== 'none';
        assetPerformanceContent.style.display = isVisible ? 'none' : '';
        assetPerformanceChevron.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
    });
}

function jumpToAssetPerformance() {
    const section = document.getElementById('asset-performance-table');
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const filter = document.getElementById('asset-performance-status-filter');
        if (filter) filter.focus();
    }
}

function jumpToHistory() {
    const section = document.getElementById('pea-history-filter');
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section.focus();
    }
}

const jumpPerformanceBtn = document.getElementById('jump-performance-btn');
const jumpHistoryBtn = document.getElementById('jump-history-btn');

if (jumpPerformanceBtn) {
    jumpPerformanceBtn.addEventListener('click', jumpToAssetPerformance);
}
if (jumpHistoryBtn) {
    jumpHistoryBtn.addEventListener('click', jumpToHistory);
}

window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || !event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'p') {
        event.preventDefault();
        jumpToAssetPerformance();
    }
    if (key === 'h') {
        event.preventDefault();
        jumpToHistory();
    }
});

['pea-history-type-filter', 'pea-history-status-filter', 'pea-history-period-filter', 'pea-history-sort-select']
    .forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                if (id === 'pea-history-sort-select') {
                    peaHistorySortColumn = el.value || 'date';
                    peaHistorySortDirection = 'desc';
                    updatePEAHistorySortIcons();
                }
                renderHistoryTable();
            });
        }
    });

function handleEditPEAPosition(positionId) {
    const positions = groupOperationsIntoPositions(state.operations);
    const pos = positions.find(p => p.id === positionId);
    if (!pos) return;

    currentPEAPosition = pos;
    document.getElementById('editPEAPositionModalTitle').textContent = `Modifier le Trade : ${pos.asset}`;
    document.getElementById('editPEAPositionId').value = positionId;

    const entriesList = document.getElementById('pea-entries-list');
    entriesList.innerHTML = '';
    pos.entries.forEach((entry, idx) => {
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'list-group-item list-group-item-action bg-dark text-white border-secondary mb-1';
        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <span class="badge bg-success me-2">Achat #${idx + 1}</span>
                    <strong>${entry.date}</strong>
                </div>
                <div class="text-end font-monospace">
                    <div>Qté: <strong>${entry.quantity}</strong></div>
                    <div>Prix: <strong>${entry.price.toFixed(2)} €</strong></div>
                    <div>Frais: <strong>${entry.fees ? entry.fees.toFixed(2) : '0'} €</strong></div>
                </div>
            </div>
        `;
        item.addEventListener('click', (e) => {
            e.preventDefault();
            populatePEAEntryForm(entry);
        });
        entriesList.appendChild(item);
    });

    const exitsList = document.getElementById('pea-exits-list');
    exitsList.innerHTML = '';
    if (pos.exits.length === 0) {
        exitsList.innerHTML = '<div class="text-muted small p-2">Aucune vente enregistrée pour ce trade.</div>';
    } else {
        pos.exits.forEach((exit, idx) => {
            const item = document.createElement('a');
            item.href = '#';
            item.className = 'list-group-item list-group-item-action bg-dark text-white border-secondary mb-1';
            item.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <span class="badge bg-warning text-dark me-2">Vente #${idx + 1}</span>
                        <strong>${exit.date}</strong>
                    </div>
                    <div class="text-end font-monospace">
                        <div>Qté: <strong>${exit.quantity}</strong></div>
                        <div>Prix: <strong>${exit.price.toFixed(2)} €</strong></div>
                        <div>Frais: <strong>${exit.fees ? exit.fees.toFixed(2) : '0'} €</strong></div>
                    </div>
                </div>
            `;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                populatePEAEntryForm(exit);
            });
            exitsList.appendChild(item);
        });
    }

    document.getElementById('edit-pea-op-form').style.display = 'none';
    document.getElementById('edit-pea-op-form-title').style.display = 'none';

    const modal = new bootstrap.Modal(document.getElementById('editPEAPositionModal'));
    modal.show();
}
window.handleEditPEAPosition = handleEditPEAPosition;

function populatePEAEntryForm(op) {
    document.getElementById('editPEAOpId').value = op.id;
    document.getElementById('editPEAOpType').value = op.type || '';
    document.getElementById('editPEAOpAsset').value = op.asset || '';
    document.getElementById('editPEAOpTicker').value = op.ticker || '';
    document.getElementById('editPEAOpDate').value = op.date;
    document.getElementById('editPEAOpFees').value = op.fees || 0;
    document.getElementById('editPEAOpTTFPercent').value = op.ttfPercent ?? (op.ttf && (op.amount || (op.quantity * op.price)) ? (op.ttf / ((op.amount || (op.quantity * op.price)) || 1)) * 100 : 0);
    document.getElementById('editPEAOpQuantity').value = op.quantity;
    document.getElementById('editPEAOpPrice').value = op.price;
    document.getElementById('editPEAOpTargetPrice1Y').value = op.targetPrice1Y ?? '';
    document.getElementById('editPEAOpTechnicalData').value = op.technicalData || '';
    document.getElementById('editPEAOpAnalystNote').value = op.analystNote || '';

    setEntryRuleCheckboxes(op.entryRules || [], '#edit-pea-op-form');
    const editEntryRulesGroup = document.getElementById('edit-entry-rules-group');
    const editBuyRatingFields = document.getElementById('edit-buy-rating-fields');
    const editBuyTargetPriceFields = document.getElementById('edit-buy-target-price-fields');
    if (editEntryRulesGroup) {
        editEntryRulesGroup.style.display = op.type === 'buy' ? 'block' : 'none';
    }
    if (editBuyRatingFields) {
        editBuyRatingFields.style.display = op.type === 'buy' ? 'block' : 'none';
    }
    if (editBuyTargetPriceFields) {
        editBuyTargetPriceFields.style.display = op.type === 'buy' ? 'block' : 'none';
    }

    document.getElementById('edit-pea-op-form-title').textContent = op.type === 'buy' ? 'Modifier l\'achat' : 'Modifier la vente';
    document.getElementById('edit-pea-op-form-title').style.display = 'block';
    document.getElementById('edit-pea-op-form').style.display = 'block';
}

async function deletePEAPosition(positionId) {
    const positions = groupOperationsIntoPositions(state.operations);
    const pos = positions.find(p => p.id === positionId);
    if (!pos) return;

    const totalOps = pos.entries.length + pos.exits.length;
    if (!confirm(`Êtes-vous sûr de vouloir supprimer ce trade (${pos.asset}) ?\nCela supprimera définitivement les ${totalOps} opérations associées (achats et ventes) et recalculera votre portefeuille.`)) {
        return;
    }

    try {
        const promises = [];
        pos.entries.forEach(entry => {
            promises.push(deleteDoc(doc(db, "users", state.user.uid, "pea_operations", entry.id)));
        });
        pos.exits.forEach(exit => {
            promises.push(deleteDoc(doc(db, "users", state.user.uid, "pea_operations", exit.id)));
        });

        await Promise.all(promises);
    } catch (error) {
        console.error("Erreur lors de la suppression de la position PEA :", error);
        alert("Erreur lors de la suppression: " + error.message);
    }
}
window.deletePEAPosition = deletePEAPosition;


function startEditOperation(op) {
    editingOperationId = op.id; // On passe en mode édition

    const modalEl = document.getElementById('operationModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    const submitBtn = document.querySelector('#pea-operation-form button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Modifier l'opération";

    setTimeout(() => {
        document.getElementById('op-type').value = op.type;
        updateFormFields();

        document.getElementById('op-date').value = op.date;
        document.getElementById('op-fees').value = op.fees || 0;
        document.getElementById('op-ttf-percent').value = op.ttfPercent || 0;

        if (op.type === 'deposit' || op.type === 'withdrawal') {
            document.getElementById('op-amount').value = op.amount;
        } else {
            document.getElementById('op-asset').value = op.asset;
            document.getElementById('op-ticker').value = op.ticker || '';
            document.getElementById('op-quantity').value = op.quantity;
            document.getElementById('op-price').value = op.price;
            document.getElementById('op-isin').value = op.isin || '';
            setEntryRuleCheckboxes(op.entryRules || [], '#pea-operation-form');
            const entryRulesGroup = document.getElementById('entry-rules-group');
            if (entryRulesGroup) entryRulesGroup.style.display = op.type === 'buy' ? 'block' : 'none';
        }
    }, 200);

    modalEl.addEventListener('hidden.bs.modal', () => {
        editingOperationId = null;
        if (submitBtn) submitBtn.textContent = "Valider";
        document.querySelectorAll('#pea-operation-form .entry-rule-check').forEach(cb => cb.checked = false);
    }, { once: true });
}

async function deleteOperation(idOrIds) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const isMultiple = ids.length > 1;

    if (!confirm(isMultiple 
        ? "Êtes-vous sûr de vouloir supprimer ce trade (incluant toutes ses opérations d'achat/vente) ?\nCela recalculera tout votre portefeuille."
        : "Êtes-vous sûr de vouloir supprimer cette opération ?\nCela recalculera tout votre portefeuille."
    )) return;

    // Avertissement espèces
    if (!isMultiple) {
        const op = state.operations.find(o => o.id === ids[0]);
        if (op && (op.type === 'deposit' || op.type === 'withdrawal')) {
            alert("Attention : Vous supprimez un mouvement d'espèces.\nPensez à supprimer manuellement la transaction miroir dans 'Gestion du Compte' si nécessaire.");
        }
    }

    try {
        for (const id of ids) {
            await deleteDoc(doc(db, "users", state.user.uid, "pea_operations", id));
        }
        // Le snapshot listener de Firestore rechargera les données automatiquement
    } catch (e) {
        console.error("Erreur suppression:", e);
        alert("Erreur: " + e.message);
    }
}

// -- Vente Partielle --
async function openPartialSellModal(asset, ticker, maxQty) {
    document.getElementById('sellPositionAsset').value = asset;
    document.getElementById('sellPositionTicker').value = ticker;
    document.getElementById('sellMaxQty').textContent = `Max: ${maxQty.toFixed(2)}`;
    document.getElementById('sellQuantity').max = maxQty;
    document.getElementById('sellQuantity').value = '';
    document.getElementById('sellPrice').value = '';
    document.getElementById('sellDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sellFees').value = '0';
    document.getElementById('sellTTFPercent').value = '0';

    const modal = new bootstrap.Modal(document.getElementById('partialSellModal'));
    modal.show();
}

document.getElementById('partial-sell-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) {
        alert('Veuillez vous connecter.');
        return;
    }

    const asset = document.getElementById('sellPositionAsset').value;
    const ticker = document.getElementById('sellPositionTicker').value;
    const quantity = parseFloat(document.getElementById('sellQuantity').value);
    const price = parseFloat(document.getElementById('sellPrice').value);
    const date = document.getElementById('sellDate').value;
    const fees = parseFloat(document.getElementById('sellFees').value) || 0;
    const ttfPercent = parseFloat(document.getElementById('sellTTFPercent').value) || 0;

    if (!asset || !ticker || isNaN(quantity) || isNaN(price) || quantity <= 0) {
        alert('Tous les champs requis doivent être valides.');
        return;
    }

    const amount = quantity * price;
    const ttf = amount * (ttfPercent / 100);

    try {
        await addDoc(collection(db, 'users', state.user.uid, 'pea_operations'), {
            asset,
            ticker: ticker.toUpperCase(),
            type: 'sell',
            quantity,
            price,
            amount,
            fees,
            ttf,
            ttfPercent,
            date,
            dateObj: new Date(date),
            createdAt: Date.now()
        });

        const modal = bootstrap.Modal.getInstance(document.getElementById('partialSellModal'));
        modal.hide();
        document.getElementById('partial-sell-form').reset();
    } catch (error) {
        console.error('Erreur création vente:', error);
        alert('Erreur: ' + error.message);
    }
});

// -- Graphique Évolution des Gains / Pertes --
function renderPnlEvolutionChart() {
    const ctx = document.getElementById('pnlEvolutionChart');
    if (!ctx) return;

    const isLight = document.body.classList.contains('light-mode');
    const labelColor = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.04)';

    // Helper : convertit n'importe quel format de date en objet Date
    function parseOpDate(op) {
        const d = op.date;
        if (!d) return null;
        // Firestore Timestamp (objet avec .toDate)
        if (d && typeof d.toDate === 'function') return d.toDate();
        // Firestore Timestamp (objet avec seconds)
        if (d && typeof d.seconds === 'number') return new Date(d.seconds * 1000);
        // Chaîne ISO ou dateObj stocké
        const parsed = new Date(d);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    try {
        const viewMode = pnlChartSettings.view || 'cumulative';
        const periodMode = pnlChartSettings.period || 'all';

        // Construire la série temporelle du P&L cumulé à partir des opérations
        let ops = [...state.operations]
            .map(op => ({ ...op, _date: parseOpDate(op) }))
            .filter(op => op._date !== null)
            .sort((a, b) => a._date - b._date);

        if (periodMode !== 'all') {
            const now = new Date();
            const cutoff = new Date(now);
            if (periodMode === '1m') cutoff.setMonth(now.getMonth() - 1);
            else if (periodMode === '3m') cutoff.setMonth(now.getMonth() - 3);
            else if (periodMode === '6m') cutoff.setMonth(now.getMonth() - 6);
            else if (periodMode === '1y') cutoff.setFullYear(now.getFullYear() - 1);
            else if (periodMode === '2y') cutoff.setFullYear(now.getFullYear() - 2);

            ops = ops.filter(op => op._date >= cutoff);
        }

        if (ops.length === 0) {
            if (charts.pnlEvolution) { charts.pnlEvolution.destroy(); charts.pnlEvolution = null; }
            return;
        }

        if (charts.pnlEvolution) charts.pnlEvolution.destroy();

        if (['daily', 'weekly', 'monthly', 'yearly'].includes(viewMode)) {
            const grossMap = {};
            const feesMap = {};
            const transactionFeesMap = {};
            const ttfMap = {};
            const groupOrder = [];
            const closedPositions = groupOperationsIntoPositions(state.operations).filter(pos => pos.status === 'closed');

            function getGroupKey(date) {
                if (!date) return null;
                if (viewMode === 'daily') {
                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                }
                if (viewMode === 'weekly') {
                    const target = new Date(date.valueOf());
                    const dayNr = (date.getDay() + 6) % 7;
                    target.setDate(target.getDate() - dayNr + 3);
                    const firstThursday = target.valueOf();
                    target.setMonth(0, 1);
                    if (target.getDay() !== 4) {
                        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
                    }
                    const weekNum = 1 + Math.ceil((firstThursday - target) / 604800000);
                    return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
                }
                if (viewMode === 'monthly') {
                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                }
                return `${date.getFullYear()}`;
            }

            function addToGroup(map, key, value) {
                if (!Object.prototype.hasOwnProperty.call(map, key)) {
                    map[key] = 0;
                    if (!groupOrder.includes(key)) groupOrder.push(key);
                }
                map[key] += value;
            }

            closedPositions.forEach(position => {
                const closeDate = parseOpDate({ date: position.closeDate || position.date });
                if (!closeDate) return;
                if (periodMode !== 'all') {
                    const now = new Date();
                    const cutoff = new Date(now);
                    if (periodMode === '1m') cutoff.setMonth(now.getMonth() - 1);
                    else if (periodMode === '3m') cutoff.setMonth(now.getMonth() - 3);
                    else if (periodMode === '6m') cutoff.setMonth(now.getMonth() - 6);
                    else if (periodMode === '1y') cutoff.setFullYear(now.getFullYear() - 1);
                    else if (periodMode === '2y') cutoff.setFullYear(now.getFullYear() - 2);
                    if (closeDate < cutoff) return;
                }

                const metrics = calculatePEAPositionMetrics(position);
                const key = getGroupKey(closeDate);
                if (!key) return;
                addToGroup(grossMap, key, metrics.totalExitVal - metrics.totalEntryVal);
                addToGroup(feesMap, key, metrics.totalFees);
                addToGroup(transactionFeesMap, key, metrics.feesOnly);
                addToGroup(ttfMap, key, metrics.ttfOnly);
            });

            ops.filter(op => op.type === 'dividend').forEach(op => {
                const key = getGroupKey(op._date);
                if (!key) return;
                addToGroup(grossMap, key, parseFloat(op.price) || 0);
            });

            const orderedGroups = [...groupOrder].sort((a, b) => a.localeCompare(b));
            const labels = orderedGroups.map(key => {
                if (viewMode === 'daily') {
                    const [year, month, day] = key.split('-').map(Number);
                    return new Date(year, month - 1, day).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
                }
                if (viewMode === 'weekly') {
                    return `Sem. ${key.split('-W')[1]} ${key.split('-W')[0]}`;
                }
                if (viewMode === 'monthly') {
                    const [year, month] = key.split('-').map(Number);
                    return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
                }
                return key;
            });

            const values = orderedGroups.map(key => grossMap[key] || 0);
            const feesValues = orderedGroups.map(key => feesMap[key] || 0);
            const transactionFeesValues = orderedGroups.map(key => transactionFeesMap[key] || 0);
            const ttfValues = orderedGroups.map(key => ttfMap[key] || 0);

            const labelLabel = {
                daily: 'P&L journalier (€)',
                weekly: 'P&L hebdomadaire (€)',
                monthly: 'P&L mensuel (€)',
                yearly: 'P&L annuel (€)'
            }[viewMode];

            charts.pnlEvolution = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Frais (€)',
                            data: feesValues,
                            backgroundColor: 'rgba(239, 68, 68, 0.4)',
                            borderColor: '#ef4444',
                            borderWidth: 1,
                            borderRadius: 4,
                            stack: 'pnlStack'
                        },
                        {
                            label: labelLabel,
                            data: values,
                            backgroundColor: values.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'),
                            borderColor: values.map(v => v >= 0 ? '#10b981' : '#ef4444'),
                            borderWidth: 1.5,
                            borderRadius: 4,
                            stack: 'pnlStack'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { display: false }, ticks: { color: labelColor, font: { size: 11 } }, stacked: true },
                        y: { grid: { color: gridColor }, ticks: { color: labelColor, callback: (v) => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) }, stacked: true }
                    },
                    plugins: {
                        legend: { display: true },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label || 'P&L'} : ${Number(ctx.parsed.y).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`,
                                footer: (tooltipItems) => {
                                    const index = tooltipItems[0].dataIndex;
                                    const chartData = tooltipItems[0].chart.data;
                                    const grossDataset = chartData.datasets.find(ds => ds.label === labelLabel);
                                    const feesDataset = chartData.datasets.find(ds => ds.label === 'Frais (€)');
                                    const grossValue = grossDataset?.data[index] || 0;
                                    const feeValue = feesDataset?.data[index] || 0;
                                    const netPnlValue = grossValue - feeValue;
                                    const formattedNetPnl = `${netPnlValue >= 0 ? '+' : ''}${netPnlValue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`;
                                    const formattedFeeAmount = Math.abs(feeValue).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
                                    if (!grossValue || grossValue === 0) {
                                        return [
                                            `P&L net = ${formattedNetPnl}`,
                                            `Montant frais = ${formattedFeeAmount}`
                                        ];
                                    }
                                    const totalFeePercent = Math.abs(feeValue) / Math.abs(grossValue) * 100;
                                    const transactionFeeValue = transactionFeesValues[index] || 0;
                                    const ttfValue = ttfValues[index] || 0;
                                    const transactionFeePercent = Math.abs(transactionFeeValue) / Math.abs(grossValue) * 100;
                                    const ttfPercent = Math.abs(ttfValue) / Math.abs(grossValue) * 100;
                                    return [
                                        `P&L net = ${formattedNetPnl}`,
                                        `Montant frais = ${formattedFeeAmount}`,
                                        `Frais totaux = ${totalFeePercent.toFixed(2)}% des gains`,
                                        `Frais transaction = ${transactionFeePercent.toFixed(2)}%`,
                                        `TTF = ${ttfPercent.toFixed(2)}%`
                                    ];
                                }
                            }
                        },
                        zoom: {
                            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
                            pan: { enabled: true, mode: 'x' }
                        }
                    }
                },
                plugins: [
                    {
                        id: 'monthlyChartNoFill',
                        beforeDraw() {}
                    }
                ]
            });
            return;
        }

        // Reconstruction PRU par actif + cumul P&L chronologique
        const pruMap = {};
        const dataPoints = [];
        let cumulPnL = 0;

        // Point de départ 1 jour avant la première opération
        const firstTs = ops[0]._date.getTime();
        dataPoints.push({ x: firstTs - 86400000, y: 0 });

        ops.forEach(op => {
            const qty   = parseFloat(op.quantity) || 0;
            const price = parseFloat(op.price)    || 0;
            const fees  = parseFloat(op.fees)     || 0;
            const ts    = op._date.getTime();

            if (op.type === 'buy') {
                if (!pruMap[op.asset]) pruMap[op.asset] = { qty: 0, pru: 0 };
                const m = pruMap[op.asset];
                const fees = parseFloat(op.fees) || 0;
                const ttf = parseFloat(op.ttf) || 0;
                const totalFees = fees + ttf;
                const newQty = m.qty + qty;
                const oldVal = m.qty * m.pru;
                const newVal = qty * price + totalFees; // frais d'achat inclus
                m.pru = newQty > 0 ? (oldVal + newVal) / newQty : price;
                m.qty = newQty;
            } else if (op.type === 'sell') {
                if (pruMap[op.asset] && pruMap[op.asset].qty > 0) {
                    const ttf = parseFloat(op.ttf) || 0;
                    const pnl = (price - pruMap[op.asset].pru) * qty - fees - ttf;
                    cumulPnL += pnl;
                    pruMap[op.asset].qty = Math.max(0, pruMap[op.asset].qty - qty);
                }
            } else if (op.type === 'dividend') {
                cumulPnL += price;
            }

            dataPoints.push({ x: ts, y: parseFloat(cumulPnL.toFixed(2)) });
        });

        dataPoints.push({ x: Date.now(), y: parseFloat(cumulPnL.toFixed(2)) });

        // Plugin inline : remplissage vert/rouge selon le signe du P&L
        const pnlFillPlugin = {
            id: 'pnlFillBg',
            beforeDatasetsDraw(chart) {
                const { ctx: c, chartArea, scales } = chart;
                if (!chartArea || !scales.y) return;

                const yZero  = Math.min(chartArea.bottom, Math.max(chartArea.top, scales.y.getPixelForValue(0)));
                const { top, bottom, left, right } = chartArea;
                const width  = right - left;

                // Zone verte (positif)
                if (yZero > top) {
                    const gradG = c.createLinearGradient(0, top, 0, yZero);
                    gradG.addColorStop(0, 'rgba(16, 185, 129, 0.30)');
                    gradG.addColorStop(1, 'rgba(16, 185, 129, 0.04)');
                    c.save();
                    c.fillStyle = gradG;
                    c.fillRect(left, top, width, yZero - top);
                    c.restore();
                }

                // Zone rouge (négatif)
                if (yZero < bottom) {
                    const gradR = c.createLinearGradient(0, yZero, 0, bottom);
                    gradR.addColorStop(0, 'rgba(239, 68, 68, 0.04)');
                    gradR.addColorStop(1, 'rgba(239, 68, 68, 0.28)');
                    c.save();
                    c.fillStyle = gradR;
                    c.fillRect(left, yZero, width, bottom - yZero);
                    c.restore();
                }
            }
        };

        charts.pnlEvolution = new Chart(ctx, {
            type: 'line',
            plugins: [pnlFillPlugin],
            data: {
                datasets: [{
                    label: 'Gains / Pertes Cumulés (€)',
                    data: dataPoints,
                    borderColor: '#10b981',
                    borderWidth: 2.5,
                    tension: 0.3,
                    fill: false,
                    pointRadius: (context) => {
                        const i = context.dataIndex;
                        // Premier point fictif et dernier "Actuel" → petit rond
                        if (i === 0 || i === dataPoints.length - 1) return 4;
                        return 5;
                    },
                    pointBackgroundColor: (context) => {
                        const v = context.parsed?.y ?? 0;
                        return v >= 0 ? '#10b981' : '#ef4444';
                    },
                    pointBorderColor: isLight ? '#ffffff' : '#0f172a',
                    pointBorderWidth: 2,
                    pointHoverRadius: 7,
                    segment: {
                        // Ligne verte si on monte, rouge si on descend sous 0
                        borderColor: (ctx) => {
                            const y1 = ctx.p0.parsed.y;
                            const y2 = ctx.p1.parsed.y;
                            if (y1 < 0 || y2 < 0) return '#ef4444';
                            return '#10b981';
                        }
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            tooltipFormat: 'dd/MM/yyyy',
                            displayFormats: {
                                day:   'dd/MM/yy',
                                week:  'dd/MM/yy',
                                month: 'MMM yy',
                                year:  'yyyy'
                            }
                        },
                        grid: { display: false },
                        ticks: {
                            color: labelColor,
                            maxTicksLimit: 10,
                            font: { size: 11 }
                        }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: {
                            color: labelColor,
                            font: { size: 11 },
                            callback: (v) => v.toLocaleString('fr-FR', {
                                style: 'currency',
                                currency: 'EUR',
                                maximumFractionDigits: 0
                            })
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    zoom: {
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            mode: 'x'
                        },
                        pan: {
                            enabled: true,
                            mode: 'x'
                        }
                    },
                    tooltip: {
                        backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(15,23,42,0.97)',
                        borderColor:     isLight ? 'rgba(15,23,42,0.10)'   : 'rgba(255,255,255,0.10)',
                        borderWidth: 1,
                        titleColor: isLight ? '#0f172a' : '#f8fafc',
                        bodyColor:  isLight ? '#475569' : '#94a3b8',
                        padding: 12,
                        callbacks: {
                            label: (ctx) => {
                                const v = ctx.parsed.y;
                                const sign = v >= 0 ? '+' : '';
                                return `  ${sign}${v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`;
                            }
                        }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[PnL Chart] Erreur :', err);
    }
}

// -- Graphiques --
function updateCharts(holdingsList, totalPortfolio) {
    const isLight = document.body.classList.contains('light-mode');
    const labelColor = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.05)';

    // Camembert Allocation
    const ctxAlloc = document.getElementById('allocationChart').getContext('2d');

    if (charts.allocation) charts.allocation.destroy();

    const allocationLimit = document.getElementById('allocation-view-select')?.value || 'all';
    const sortedHoldings = [...holdingsList].sort((a, b) => b.value - a.value);
    const limit = allocationLimit === 'all' ? sortedHoldings.length : parseInt(allocationLimit, 10);

    let chartHoldings = sortedHoldings;
    let otherValue = 0;

    if (allocationLimit !== 'all' && sortedHoldings.length > limit) {
        chartHoldings = sortedHoldings.slice(0, limit);
        otherValue = sortedHoldings.slice(limit).reduce((sum, item) => sum + item.value, 0);
    }

    const labels = [
        ...chartHoldings.map(h => h.name),
        ...(otherValue > 0 ? ['Autres'] : []),
        'Espèces'
    ];
    const data = [
        ...chartHoldings.map(h => h.value),
        ...(otherValue > 0 ? [otherValue] : []),
        state.portfolio.cash
    ];
    const colors = [
        '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1',
        '#94a3b8', '#f472b6', '#22d3ee', '#fb7185', '#a78bfa', '#fbbf24',
        '#9ca3af' // Gris pour le cash
    ].slice(0, Math.max(labels.length, 1));

    charts.allocation = new Chart(ctxAlloc, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 1,
                borderColor: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.85)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            rotation: -90,
            plugins: {
                legend: {
                    position: labels.length > 12 ? 'bottom' : 'right',
                    align: 'center',
                    maxWidth: 420,
                    align: 'center',
                    maxWidth: 420,
                    labels: {
                        color: labelColor,
                        font: { size: 14, weight: '700' },
                        boxWidth: 18,
                        boxHeight: 18,
                        padding: 14,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${context.parsed.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`
                    }
                }
            },
            layout: {
                padding: { top: 4, right: 8, bottom: 4, left: 4 }
            }
        }
    });

    // Graphique Évolution des Gains / Pertes
    renderPnlEvolutionChart();

    // Courbe Croissance Réaliste
    const ctxGrowth = document.getElementById('portfolioGrowthChart').getContext('2d');
    if (charts.growth) charts.growth.destroy();

    // 1. Reconstruction Historique Temporelle Séquentielle
    const sortedOps = sortOperationsByDate(state.operations);
    
    let currentCash = 0;
    let currentInvested = 0;
    let currentHoldings = {};
    const points = [];

    // Ajouter un point d'origine la veille de la première opération
    if (sortedOps.length > 0) {
        const firstOpDate = new Date(sortedOps[0].date);
        firstOpDate.setDate(firstOpDate.getDate() - 1);
        const originDateStr = firstOpDate.toISOString().split('T')[0];
        points.push({
            date: originDateStr,
            invested: 0,
            value: 0
        });
    }

    sortedOps.forEach(op => {
        const qty = parseFloat(op.quantity) || 0;
        const price = parseFloat(op.price) || 0;
        const fees = parseFloat(op.fees) || 0;
        const ttf = parseFloat(op.ttf) || 0;
        const totalFees = fees + ttf;
        const amountValue = parseFloat(op.amount) || (qty * price);
        const totalAmount = (qty * price) || amountValue;

        if (op.type === 'deposit') {
            currentInvested += amountValue;
            currentCash += amountValue;
        }
        else if (op.type === 'withdrawal') {
            currentInvested -= amountValue;
            currentCash -= amountValue;
        }
        else if (op.type === 'buy') {
            currentCash -= (amountValue + totalFees);
            if (!currentHoldings[op.asset]) {
                currentHoldings[op.asset] = { qty: 0, lastPrice: price };
            }
            currentHoldings[op.asset].qty += qty;
            currentHoldings[op.asset].lastPrice = price;
        }
        else if (op.type === 'sell') {
            currentCash += (amountValue - totalFees);
            if (currentHoldings[op.asset]) {
                currentHoldings[op.asset].qty -= qty;
                currentHoldings[op.asset].lastPrice = price;
                if (currentHoldings[op.asset].qty <= 0.0001) {
                    delete currentHoldings[op.asset];
                }
            }
        }
        else if (op.type === 'dividend') {
            currentCash += amountValue;
        }

        // Calculer la valeur à cette étape
        let holdingsValue = 0;
        for (const [name, h] of Object.entries(currentHoldings)) {
            holdingsValue += h.qty * h.lastPrice;
        }
        const totalVal = currentCash + holdingsValue;

        points.push({
            date: op.date,
            invested: currentInvested,
            value: totalVal,
            cashValue: currentCash,
            holdingsValue
        });
    });

    // Regrouper par date (conserver le dernier état de la journée)
    const uniqueDatesPoints = [];
    points.forEach(p => {
        const existing = uniqueDatesPoints.find(x => x.date === p.date);
        if (existing) {
            existing.invested = p.invested;
            existing.value = p.value;
        } else {
            uniqueDatesPoints.push({ ...p });
        }
    });

    // Injecter le point en temps réel actuel à la fin
    if (uniqueDatesPoints.length > 0) {
        const lastPoint = uniqueDatesPoints[uniqueDatesPoints.length - 1];
        const todayStr = new Date().toISOString().split('T')[0];
        const currentPortfolioValue = totalPortfolio;
        const currentCashValue = state.portfolio.cash;
        const currentHoldingsValue = Object.values(state.portfolio.holdings).reduce((sum, h) => sum + (h.qty || 0) * (h.currentPrice || 0), 0);
        if (lastPoint.date !== todayStr) {
            uniqueDatesPoints.push({
                date: 'Aujourd\'hui',
                invested: state.portfolio.invested,
                value: currentPortfolioValue,
                cashValue: currentCashValue,
                holdingsValue: currentHoldingsValue
            });
        } else {
            lastPoint.value = currentPortfolioValue;
            lastPoint.invested = state.portfolio.invested;
            lastPoint.cashValue = currentCashValue;
            lastPoint.holdingsValue = currentHoldingsValue;
            lastPoint.date = 'Aujourd\'hui';
        }
    }

    function filterPointsByPeriod(points) {
        if (portfolioChartFilters.period === 'all') return points;

        const now = new Date();
        const cutoff = new Date(now);

        if (portfolioChartFilters.period === '1m') cutoff.setMonth(now.getMonth() - 1);
        else if (portfolioChartFilters.period === '3m') cutoff.setMonth(now.getMonth() - 3);
        else if (portfolioChartFilters.period === '6m') cutoff.setMonth(now.getMonth() - 6);
        else if (portfolioChartFilters.period === '1y') cutoff.setFullYear(now.getFullYear() - 1);
        else if (portfolioChartFilters.period === '2y') cutoff.setFullYear(now.getFullYear() - 2);

        return points.filter(point => {
            if (point.date === 'Aujourd\'hui') return true;
            const date = new Date(point.date);
            return !isNaN(date.getTime()) && date >= cutoff;
        });
    }

    const filteredPoints = filterPointsByPeriod(uniqueDatesPoints);

    // Mettre à jour l'encart de synthèse capital / capital investi
    const latestPoint = filteredPoints[filteredPoints.length - 1] || { invested: 0, cashValue: 0, value: 0 };
    const grossEl = document.getElementById('portfolio-gross-value');
    const capitalEl = document.getElementById('portfolio-capital-value');
    const investedEl = document.getElementById('portfolio-invested-value');
    const remainingEl = document.getElementById('portfolio-remaining-value');
    const cashValue = (state.portfolio?.cash ?? latestPoint.cashValue) || 0;
    const capitalValue = typeof totalPortfolio !== 'undefined' ? totalPortfolio : (latestPoint.value || 0);
    const investedValue = (state.portfolio?.costBasis ?? 0);
    const grossValue = cashValue + investedValue;
    if (grossEl) grossEl.textContent = formatCurrency(grossValue);
    if (capitalEl) capitalEl.textContent = formatCurrency(capitalValue);
    if (investedEl) investedEl.textContent = formatCurrency(investedValue);
    if (remainingEl) remainingEl.textContent = formatCurrency(cashValue);

    // Extraire les séries pour Chart.js
    const growthLabels = filteredPoints.map(p => {
        if (p.date === 'Aujourd\'hui') return 'Actuel';
        try {
            const d = new Date(p.date);
            return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
        } catch(e) {
            return p.date;
        }
    });
    const investedData = filteredPoints.map(p => p.invested);
    const valueData = filteredPoints.map(p => p.value);
    const cashData = filteredPoints.map(p => p.cashValue ?? (p.value - (p.holdingsValue || 0)));

    const datasets = [
        {
            label: 'Valeur du portefeuille',
            data: valueData,
            borderColor: '#d4af37',
            backgroundColor: isLight ? 'rgba(212, 175, 55, 0.05)' : 'rgba(212, 175, 55, 0.1)',
            fill: true,
            tension: 0.3
        },
        {
            label: 'Cash restant',
            data: cashData,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            fill: false,
            tension: 0.25
        }
    ];

    charts.growth = new Chart(ctxGrowth, {
        type: 'line',
        data: {
            labels: growthLabels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    grid: { color: gridColor }, 
                    ticks: { 
                        color: labelColor,
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }, 
                    beginAtZero: true 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { color: labelColor } 
                }
            },
            plugins: { 
                legend: { labels: { color: labelColor } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += formatCurrency(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

}

function formatCurrency(num) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(num);
}
