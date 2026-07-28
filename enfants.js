import {
    auth,
    db,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot
} from './firebase-config.js';

const kids = [
    { name: 'Céliane', birthDate: '2012-08-25', color: '#ff7a59' },
    { name: 'Alexandre', birthDate: '2014-11-10', color: '#4cc9f0' }
];

const state = {
    user: null,
    operations: [],
    livePrices: {},
    sort: { key: 'date', direction: 'desc' }
};

let chartInstance = null;

const ORDERS_COLLECTION = 'children_operations';

function formatCurrency(value) {
    return `${Number(value || 0).toFixed(0)} €`;
}

function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)} %`;
}

function formatDate(dateValue) {
    if (!dateValue) return '—';
    const date = new Date(dateValue);
    return number(date.getDate()) + '/' + number(date.getMonth() + 1) + '/' + date.getFullYear();
}

function number(value) {
    return String(value).padStart(2, '0');
}

function getAge(birthDate) {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age -= 1;
    }
    return age;
}

function showAuthMessage(message, isError = false) {
    const box = document.getElementById('auth-message');
    if (!box) return;
    box.textContent = message;
    box.className = `small mt-3 ${isError ? 'text-danger' : 'text-success'}`;
}

function setAuthVisible(visible) {
    const shell = document.getElementById('app-shell');
    const panel = document.getElementById('auth-panel');
    if (shell) shell.classList.toggle('d-none', !visible);
    if (panel) panel.classList.toggle('d-none', !visible);
}

function updateAuthUi() {
    const shell = document.getElementById('app-shell');
    const panel = document.getElementById('auth-panel');
    if (!shell || !panel) return;
    shell.classList.toggle('d-none', !state.user);
    panel.classList.toggle('d-none', !!state.user);
}

function setupAuthHandlers() {
    const form = document.getElementById('auth-form');
    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const mode = event.submitter?.dataset.mode || 'login';
            try {
                if (mode === 'signup') {
                    await createUserWithEmailAndPassword(auth, email, password);
                    showAuthMessage('Compte créé. Tu peux maintenant passer des ordres.');
                } else {
                    await signInWithEmailAndPassword(auth, email, password);
                    showAuthMessage('Connexion réussie.');
                }
            } catch (error) {
                showAuthMessage(error.message || 'Erreur d’authentification', true);
            }
        });
    }

    const logoutButton = document.getElementById('logout-btn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            await signOut(auth);
        });
    }
}

function setupOrderModal() {
    const openButton = document.getElementById('open-order-modal-btn');
    const modalElement = document.getElementById('orderModal');
    const form = document.getElementById('order-form');

    if (openButton) {
        openButton.addEventListener('click', () => {
            if (!state.user) {
                showAuthMessage('Connecte-toi d’abord pour enregistrer un ordre réel.', true);
                return;
            }
            document.getElementById('order-date').value = new Date().toISOString().slice(0, 10);
            const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
            modal.show();
        });
    }

    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!state.user) return;

            const investor = document.getElementById('order-investor').value;
            const type = document.getElementById('order-type').value;
            const asset = document.getElementById('order-asset').value.trim();
            const ticker = document.getElementById('order-ticker').value.trim().toUpperCase();
            const quantity = parseFloat(document.getElementById('order-quantity').value);
            const price = parseFloat(document.getElementById('order-price').value);
            const amount = parseFloat(document.getElementById('order-amount').value);
            const fees = parseFloat(document.getElementById('order-fees').value) || 0;
            const ttfPercent = parseFloat(document.getElementById('order-ttf-percent').value) || 0;
            const date = document.getElementById('order-date').value;
            const notes = document.getElementById('order-notes').value.trim();

            let operation = {
                investor,
                type,
                asset: asset || 'Espèces',
                ticker: ticker || null,
                quantity: quantity || 1,
                price: price || 0,
                amount: amount || 0,
                fees,
                ttf: 0,
                ttfPercent,
                date,
                notes,
                createdAt: Date.now()
            };

            if (type === 'buy' || type === 'sell') {
                if (!asset || !date || !quantity || !price) {
                    showAuthMessage('Remplis bien le nom, la quantité et le prix pour cet ordre.', true);
                    return;
                }
                operation.amount = quantity * price;
                operation.ttf = operation.amount * (ttfPercent / 100);
            } else {
                if (!amount || !date) {
                    showAuthMessage('Remplis le montant et la date pour l’apport ou le retrait.', true);
                    return;
                }
                operation.asset = type === 'deposit' ? 'Apport Espèces' : 'Retrait Espèces';
                operation.quantity = 1;
                operation.price = amount;
                operation.amount = amount;
            }

            try {
                await addDoc(collection(db, 'users', state.user.uid, ORDERS_COLLECTION), operation);
                form.reset();
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
                showAuthMessage('Ordre enregistré dans Firebase.');
            } catch (error) {
                showAuthMessage('Impossible d’enregistrer l’ordre : ' + error.message, true);
            }
        });
    }

    const typeSelect = document.getElementById('order-type');
    const assetField = document.getElementById('field-asset');
    const tickerField = document.getElementById('field-ticker');
    const quantityField = document.getElementById('field-quantity');
    const priceField = document.getElementById('field-price');
    const amountField = document.getElementById('field-amount');

    function updateOrderFields() {
        const isCash = typeSelect.value === 'deposit' || typeSelect.value === 'withdrawal';
        assetField.classList.toggle('d-none', isCash);
        tickerField.classList.toggle('d-none', isCash);
        quantityField.classList.toggle('d-none', isCash);
        priceField.classList.toggle('d-none', isCash);
        amountField.classList.toggle('d-none', !isCash);
    }

    if (typeSelect) {
        typeSelect.addEventListener('change', updateOrderFields);
        updateOrderFields();
    }
}

function subscribeToOperations() {
    if (!state.user) return;
    const q = query(collection(db, 'users', state.user.uid, ORDERS_COLLECTION), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snapshot) => {
        state.operations = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
        renderAll();
    }, (error) => {
        showAuthMessage('Impossible de charger les ordres : ' + error.message, true);
    });
}

function calculateSummary(investorName) {
    let cash = 0;
    let invested = 0;
    const holdings = {};

    const investorOps = state.operations.filter((op) => op.investor === investorName);

    investorOps.forEach((op) => {
        const quantity = Number(op.quantity || 0);
        const price = Number(op.price || 0);
        const amount = Number(op.amount || 0);

        if (op.type === 'deposit') {
            cash += amount;
            invested += amount;
        } else if (op.type === 'buy') {
            cash -= amount;
            if (!holdings[op.asset]) {
                holdings[op.asset] = { qty: 0, avgCost: 0 };
            }
            const line = holdings[op.asset];
            const newQty = line.qty + quantity;
            const oldValue = line.qty * line.avgCost;
            line.avgCost = newQty > 0 ? (oldValue + amount) / newQty : 0;
            line.qty = newQty;
        } else if (op.type === 'sell') {
            cash += amount;
            if (holdings[op.asset]) {
                holdings[op.asset].qty = Math.max(0, holdings[op.asset].qty - quantity);
            }
        } else if (op.type === 'withdrawal') {
            cash -= amount;
        }
    });

    let holdingsValue = 0;
    Object.entries(holdings).forEach(([asset, data]) => {
        const latestPrice = getLatestPriceForAsset(asset, investorName);
        holdingsValue += data.qty * latestPrice;
    });

    const totalValue = cash + holdingsValue;
    const performance = invested > 0 ? ((totalValue - invested) / invested) * 100 : 0;
    return { cash, invested, holdings, holdingsValue, totalValue, performance };
}

function getLatestPriceForAsset(assetName, investorName) {
    const matchingOps = state.operations.filter((op) => op.investor === investorName && op.asset === assetName);
    const lookupKeys = [assetName, assetName?.toUpperCase?.(), ...matchingOps.map((op) => op.ticker?.toUpperCase?.()).filter(Boolean)];

    for (const key of lookupKeys) {
        const priceFromLive = state.livePrices[key];
        if (priceFromLive) return Number(priceFromLive);
    }

    const lastOp = matchingOps[matchingOps.length - 1];
    return Number(lastOp?.price || 0);
}

async function refreshPrices() {
    if (!state.user) return;

    const operationsToRefresh = state.operations.filter((op) => (op.type === 'buy' || op.type === 'sell') && (op.ticker || op.asset));
    if (operationsToRefresh.length === 0) {
        showAuthMessage('Aucun actif à mettre à jour pour l’instant.', true);
        return;
    }

    const uniqueAssets = new Map();
    operationsToRefresh.forEach((op) => {
        const ticker = (op.ticker || op.asset || '').trim().toUpperCase();
        const assetKey = ticker || (op.asset || '').trim();
        if (!uniqueAssets.has(assetKey)) {
            uniqueAssets.set(assetKey, { asset: op.asset, ticker });
        }
    });

    for (const { asset, ticker } of uniqueAssets.values()) {
        try {
            const query = ticker || asset;
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(query)}?interval=1d&range=1d`;
            
            const proxies = [
                `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`
            ];

            let data = null;
            let success = false;
            for (const proxyUrl of proxies) {
                try {
                    const response = await fetch(proxyUrl);
                    if (response.ok) {
                        data = await response.json();
                        if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
                            success = true;
                            break;
                        }
                    }
                } catch (e) {
                    console.warn(`Proxy ${proxyUrl} failed:`, e);
                }
            }

            if (success && data) {
                const price = data.chart.result[0].meta.regularMarketPrice;
                if (price) {
                    state.livePrices[query] = price;
                    if (asset) state.livePrices[asset] = price;
                }
            } else {
                throw new Error('All proxies failed or returned invalid data');
            }
        } catch (error) {
            console.warn('Prix non récupéré pour', ticker || asset, error);
        }
    }

    renderAll();
}

function renderKids() {
    const grid = document.getElementById('kids-grid');
    if (!grid) return;

    grid.innerHTML = kids.map((kid) => {
        const summary = calculateSummary(kid.name);
        const progress = Math.min(100, Math.round((summary.totalValue / Math.max(1000, summary.invested || 1000)) * 100));
        return `
            <div class="col-md-6">
                <div class="kid-card">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <div class="kid-title">${kid.name}</div>
                            <div class="kid-age">${getAge(kid.birthDate)} ans • Mission d’investisseur junior</div>
                        </div>
                        <span class="pill" style="border-color:${kid.color}20; color:${kid.color};">${formatPercent(summary.performance)}</span>
                    </div>
                    <div class="mt-3">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="text-muted">Capital</span>
                            <span class="value-big">${formatCurrency(summary.totalValue)}</span>
                        </div>
                        <div class="progress-bar">
                            <div style="width:${progress}%; background:linear-gradient(90deg, ${kid.color} 0%, #7b61ff 100%);"></div>
                        </div>
                        <small class="text-muted d-block mt-2">Liquidités ${formatCurrency(summary.cash)} • Objectif de progression ${formatPercent(summary.performance)}</small>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderLeaderboard() {
    const leaderboard = document.getElementById('orders-list');
    if (!leaderboard) return;
    const sorted = [...kids].map((kid) => ({ ...kid, summary: calculateSummary(kid.name) })).sort((a, b) => b.summary.totalValue - a.summary.totalValue);
    leaderboard.innerHTML = sorted.map((kid, index) => `
        <div class="order-item">
            <div class="d-flex align-items-center gap-2">
                <span class="badge-rank">${index + 1}</span>
                <span><strong>${kid.name}</strong><br><small class="text-muted">${kid.summary.totalValue.toFixed(0)} €</small></span>
            </div>
            <strong>${formatPercent(kid.summary.performance)}</strong>
        </div>
    `).join('');
}

function getSortedOperations() {
    const items = [...state.operations];
    const { key, direction } = state.sort;

    return items.sort((a, b) => {
        let valueA = a[key];
        let valueB = b[key];

        if (key === 'date') {
            valueA = new Date(a.date || 0).getTime();
            valueB = new Date(b.date || 0).getTime();
        } else if (['quantity', 'price', 'amount'].includes(key)) {
            valueA = Number(a[key] || 0);
            valueB = Number(b[key] || 0);
        } else {
            valueA = String(valueA || '').toLowerCase();
            valueB = String(valueB || '').toLowerCase();
        }

        if (valueA < valueB) return direction === 'asc' ? -1 : 1;
        if (valueA > valueB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function renderOrdersTable() {
    const body = document.getElementById('orders-table-body');
    if (!body) return;
    if (!state.operations.length) {
        body.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-4">Aucun ordre enregistré pour le moment.</td></tr>';
        return;
    }

    const sortedOperations = getSortedOperations();

    body.innerHTML = sortedOperations.map((op) => {
        const actionLabel = op.type === 'buy' ? 'Achat' : op.type === 'sell' ? 'Vente' : op.type === 'deposit' ? 'Apport' : 'Retrait';
        const position = op.type === 'buy' ? 'Long' : op.type === 'sell' ? 'Court' : '—';
        const total = Number(op.amount || 0).toFixed(0) + ' €';
        const rendement = op.type === 'buy' || op.type === 'sell' ? '—' : '—';
        const pnlPercent = op.type === 'buy' || op.type === 'sell' ? '—' : '—';
        const feesValue = Number(op.fees || 0).toFixed(2) + ' €';
        const ttfValue = Number(op.ttf || 0).toFixed(2) + ' €';
        return `
            <tr>
                <td>${formatDate(op.date)}</td>
                <td>${actionLabel}</td>
                <td>${op.asset || '—'}</td>
                <td>${Number(op.quantity || 0).toFixed(2)}</td>
                <td>${Number(op.price || 0).toFixed(2)} €</td>
                <td>${Number(op.amount || 0).toFixed(0)} €</td>
                <td>${position}</td>
                <td>${total}</td>
                <td>${rendement}</td>
                <td>${pnlPercent}</td>
                <td>${feesValue}</td>
                <td>${ttfValue}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary me-1" type="button" title="Éditer">✏️</button>
                    <button class="btn btn-sm btn-outline-danger" type="button" title="Supprimer">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderChart() {
    const ctx = document.getElementById('capital-chart');
    if (!ctx) return;

    const sortedOps = [...state.operations].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const monthSet = new Set();
    const investorMaps = {};

    kids.forEach((kid) => {
        investorMaps[kid.name] = new Map();
    });

    sortedOps.forEach((op) => {
        const month = (op.date || '').slice(0, 7) || '2026-01';
        monthSet.add(month);

        const investorMap = investorMaps[op.investor];
        if (!investorMap) return;

        const value = investorMap.get(month) || 0;
        if (op.type === 'deposit') {
            investorMap.set(month, value + Number(op.amount || 0));
        } else if (op.type === 'buy') {
            investorMap.set(month, value - Number(op.amount || 0));
        } else if (op.type === 'sell') {
            investorMap.set(month, value + Number(op.amount || 0));
        } else if (op.type === 'withdrawal') {
            investorMap.set(month, value - Number(op.amount || 0));
        }
    });

    const labels = Array.from(monthSet).sort();
    const datasets = kids.map((kid) => {
        const values = [];
        let running = 0;
        labels.forEach((label) => {
            running += investorMaps[kid.name].get(label) || 0;
            values.push(running);
        });

        return {
            label: kid.name,
            data: values,
            borderColor: kid.color,
            backgroundColor: `${kid.color}22`,
            tension: 0.35,
            fill: false,
            pointRadius: 4
        };
    });

    const cumulative = [];
    let runningTotal = 0;
    labels.forEach((label) => {
        let monthDelta = 0;
        kids.forEach((kid) => {
            monthDelta += investorMaps[kid.name].get(label) || 0;
        });
        runningTotal += monthDelta;
        cumulative.push(runningTotal);
    });

    datasets.push({
        label: 'Cumulé',
        data: cumulative,
        borderColor: '#7b61ff',
        backgroundColor: 'rgba(123,97,255,0.18)',
        tension: 0.35,
        fill: false,
        pointRadius: 4
    });

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#4f3e82' } } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#4f3e82' } },
                x: { ticks: { color: '#4f3e82' } }
            }
        }
    });
}

function renderOverall() {
    const overallCapital = document.getElementById('overall-capital');
    const overallGain = document.getElementById('overall-gain');
    if (!overallCapital || !overallGain) return;
    const summaries = kids.map((kid) => calculateSummary(kid.name));
    const totalValue = summaries.reduce((sum, item) => sum + item.totalValue, 0);
    const invested = summaries.reduce((sum, item) => sum + item.invested, 0);
    const performance = invested > 0 ? ((totalValue - invested) / invested) * 100 : 0;
    overallCapital.textContent = formatCurrency(totalValue);
    overallGain.textContent = `Progression globale : ${formatPercent(performance)}`;
}

function renderAll() {
    renderKids();
    renderLeaderboard();
    renderOrdersTable();
    renderChart();
    renderOverall();
}

function setupSorting() {
    document.querySelectorAll('.sortable').forEach((header) => {
        header.addEventListener('click', () => {
            const key = header.dataset.sort;
            if (!key) return;
            if (state.sort.key === key) {
                state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                state.sort.key = key;
                state.sort.direction = 'asc';
            }
            renderOrdersTable();
        });
    });
}

function init() {
    setupAuthHandlers();
    setupOrderModal();
    setupSorting();
    document.getElementById('refresh-prices-btn')?.addEventListener('click', refreshPrices);

    onAuthStateChanged(auth, (user) => {
        state.user = user;
        updateAuthUi();
        if (user) {
            showAuthMessage('Bonjour ! Les ordres seront enregistrés dans Firebase.');
            subscribeToOperations();
        } else {
            state.operations = [];
            renderAll();
        }
    });
}

init();
