// charts.js

// --- Variables et Instances de Graphiques ---
let selectedYear = new Date().getFullYear();
let performanceChartInstance, monthlyPnLChartInstance, winRateByAssetChartInstance,
    monthlyActivityChartInstance, longShortPnlChartInstance, avgWinLossChartInstance,
    strategyPnlChartInstance, pnlVsSizeChartInstance;

/**
 * Fonction principale pour dessiner ou redessiner tous les graphiques.
 * Elle prend en paramètre toutes les données dont elle a besoin pour être indépendante.
 * @param {Array} allClosedPositionsForStats - Le tableau complet des positions clôturées.
 * @param {Function} getClosingDate - La fonction utilitaire pour obtenir la date de clôture.
 * @param {Function} calculatePositionPnL - La fonction utilitaire pour calculer le P/L.
 */
export function renderCharts(allClosedPositionsForStats, strategies, getClosingDate, calculatePositionPnL) {
    // Destruction des anciennes instances...
    if (performanceChartInstance) performanceChartInstance.destroy();
    if (monthlyPnLChartInstance) monthlyPnLChartInstance.destroy();
    if (winRateByAssetChartInstance) winRateByAssetChartInstance.destroy();
    if (monthlyActivityChartInstance) monthlyActivityChartInstance.destroy();
    if (longShortPnlChartInstance) longShortPnlChartInstance.destroy();
    if (avgWinLossChartInstance) avgWinLossChartInstance.destroy();
    if (strategyPnlChartInstance) strategyPnlChartInstance.destroy();
    if (pnlVsSizeChartInstance) pnlVsSizeChartInstance.destroy();

    const monthLabels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"];
    const positionsForYear = allClosedPositionsForStats.filter(p => {
        const closingDate = getClosingDate(p);
        return closingDate instanceof Date && closingDate.getFullYear() === selectedYear;
    });
    updateYearNavigatorUI(allClosedPositionsForStats, getClosingDate);

    // --- 1. GRAPHIQUE DE PERFORMANCE CUMULATIVE ---
    const performanceCtx = document.getElementById('performanceChart');
    if (performanceCtx) {
        // ... (logique de données inchangée) ...
        const positionsWithClosingDate = allClosedPositionsForStats.map(p => ({ ...p, closingDate: getClosingDate(p) })).filter(p => p.closingDate instanceof Date).sort((a, b) => a.closingDate - b.closingDate);
        const labels = positionsWithClosingDate.map(p => p.closingDate.toLocaleDateString('fr-FR'));
        const allCurrencies = [...new Set(positionsWithClosingDate.map(p => p.currency))];
        const dataByCurrency = {};
        allCurrencies.forEach(c => dataByCurrency[c] = []);
        const cumulativePnLByCurrency = {};
        allCurrencies.forEach(c => cumulativePnLByCurrency[c] = 0);
        positionsWithClosingDate.forEach(pos => {
            cumulativePnLByCurrency[pos.currency] += calculatePositionPnL(pos);
            allCurrencies.forEach(currency => { dataByCurrency[currency].push(cumulativePnLByCurrency[currency]); });
        });
        const colors = ['rgb(75, 192, 192)', 'rgb(255, 99, 132)', 'rgb(255, 205, 86)'];
        const datasets = allCurrencies.map((currency, index) => ({ label: `Performance Cumulative (${currency})`, data: dataByCurrency[currency], borderColor: colors[index % colors.length], tension: 0.1, fill: false }));
        
        performanceChartInstance = new Chart(performanceCtx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false, // <-- CORRIGÉ
                plugins: { legend: { position: 'top' } }
            }
        });
    }

    // --- 2. GRAPHIQUE P&L MENSUEL ---
    const monthlyPnLCtx = document.getElementById('monthlyPnLChart');
    if (monthlyPnLCtx) {
        const monthlyPnLData = Array(12).fill(0);
        positionsForYear.forEach(pos => { monthlyPnLData[getClosingDate(pos).getMonth()] += calculatePositionPnL(pos); });
        
        monthlyPnLChartInstance = new Chart(monthlyPnLCtx, {
            type: 'bar',
            data: { labels: monthLabels, datasets: [{ label: 'Profit/Perte Net Mensuel', data: monthlyPnLData, backgroundColor: monthlyPnLData.map(pnl => pnl >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)') }] },
            options: {
                responsive: true,
                maintainAspectRatio: false // <-- AJOUTÉ
            }
        });
    }

    // --- 3. GRAPHIQUE TAUX DE RÉUSSITE PAR ACTIF ---
    const winRateByAssetCtx = document.getElementById('winRateByAssetChart');
    if (winRateByAssetCtx) {
        const assetStats = {};
        allClosedPositionsForStats.forEach(pos => {
            if (!assetStats[pos.asset]) assetStats[pos.asset] = { total: 0, wins: 0 };
            assetStats[pos.asset].total++;
            if (calculatePositionPnL(pos) >= 0) assetStats[pos.asset].wins++;
        });
        const labels = Object.keys(assetStats);
        const data = labels.map(asset => (assetStats[asset].wins / assetStats[asset].total) * 100);
        
        winRateByAssetChartInstance = new Chart(winRateByAssetCtx, {
            type: 'bar', data: { labels, datasets: [{ label: 'Taux de Réussite (%)', data, backgroundColor: 'rgba(54, 162, 235, 0.6)' }] },
            options: {
                responsive: true,
                maintainAspectRatio: false, // <-- AJOUTÉ
                scales: { y: { beginAtZero: true, max: 100 } }
            }
        });
    }

    // --- 4. GRAPHIQUE ACTIVITÉ MENSUELLE ---
    const monthlyActivityCtx = document.getElementById('monthlyActivityChart');
    if (monthlyActivityCtx) {
        const monthlyTotals = Array(12).fill(0);
        const monthlyWins = Array(12).fill(0);
        positionsForYear.forEach(pos => { const monthIndex = getClosingDate(pos).getMonth(); monthlyTotals[monthIndex]++; if (calculatePositionPnL(pos) >= 0) monthlyWins[monthIndex]++; });
        const winRateData = monthlyTotals.map((total, index) => total > 0 ? (monthlyWins[index] / total) * 100 : 0);
        
        monthlyActivityChartInstance = new Chart(monthlyActivityCtx, {
            type: 'bar',
            data: { labels: monthLabels, datasets: [{ type: 'bar', label: 'Nombre de Trades', data: monthlyTotals, backgroundColor: 'rgba(54, 162, 235, 0.6)', yAxisID: 'yTrades' }, { type: 'line', label: 'Taux de Gain (%)', data: winRateData, borderColor: 'rgba(255, 159, 64, 1)', backgroundColor: 'rgba(255, 159, 64, 0.6)', yAxisID: 'yWinRate', tension: 0.1 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false, // <-- AJOUTÉ
                scales: { yTrades: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'Nombre de Trades' } }, yWinRate: { type: 'linear', position: 'right', min: 0, max: 100, title: { display: true, text: 'Taux de Gain (%)' }, grid: { drawOnChartArea: false } } }
            }
        });
    }
    
    // --- 5. GRAPHIQUE LONG VS SHORT ---
    const longShortCtx = document.getElementById('longShortPnlChart');
    if (longShortCtx) {
        const typeStats = { long: { totalPnl: 0, wins: 0, count: 0 }, short: { totalPnl: 0, wins: 0, count: 0 } };
        allClosedPositionsForStats.forEach(pos => { const pnl = calculatePositionPnL(pos); if (pos.type === 'long' || pos.type === 'short') { typeStats[pos.type].count++; typeStats[pos.type].totalPnl += pnl; if (pnl >= 0) typeStats[pos.type].wins++; } });
        const longGains = Math.max(0, typeStats.long.totalPnl);
        const shortGains = Math.max(0, typeStats.short.totalPnl);
        
        longShortPnlChartInstance = new Chart(longShortCtx, {
            type: 'doughnut',
            data: { labels: ['Profits générés par "Long"', 'Profits générés par "Short"'], datasets: [{ data: [longGains, shortGains], backgroundColor: ['rgba(75, 192, 192, 0.7)', 'rgba(255, 99, 132, 0.7)'], borderColor: ['rgba(75, 192, 192, 1)', 'rgba(255, 99, 132, 1)'], borderWidth: 1 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false, // <-- AJOUTÉ
                plugins: { legend: { display: false } }
            }
        });
        // ... (affichage des stats inchangé) ...
        const longShortStatsDisplay = document.getElementById('longShortStatsDisplay');
        const longWinRate = typeStats.long.count > 0 ? (typeStats.long.wins / typeStats.long.count * 100) : 0;
        const shortWinRate = typeStats.short.count > 0 ? (typeStats.short.wins / typeStats.short.count * 100) : 0;
        longShortStatsDisplay.innerHTML = `<table class="table table-sm table-borderless small"><thead><tr><th>Type</th><th class="text-end">P/L Total</th><th class="text-end">Taux Gain</th><th class="text-end">Trades</th></tr></thead><tbody><tr><td><span class="badge" style="background-color: rgba(75, 192, 192, 0.7);">Long</span></td><td class="text-end" style="color:${typeStats.long.totalPnl >= 0 ? 'green' : 'red'}"><strong>${typeStats.long.totalPnl.toFixed(2)}</strong></td><td class="text-end">${longWinRate.toFixed(1)}%</td><td class="text-end">${typeStats.long.count}</td></tr><tr><td><span class="badge" style="background-color: rgba(255, 99, 132, 0.7);">Short</span></td><td class="text-end" style="color:${typeStats.short.totalPnl >= 0 ? 'green' : 'red'}"><strong>${typeStats.short.totalPnl.toFixed(2)}</strong></td><td class="text-end">${shortWinRate.toFixed(1)}%</td><td class="text-end">${typeStats.short.count}</td></tr></tbody></table>`;

    }

    // --- 6. GRAPHIQUE GAINS VS PERTES MOYENNES ---
    const avgWinLossCtx = document.getElementById('avgWinLossChart');
    if (avgWinLossCtx) {
        const gains = []; const losses = [];
        allClosedPositionsForStats.forEach(pos => { const pnl = calculatePositionPnL(pos); if (pnl > 0) gains.push(pnl); else if (pnl < 0) losses.push(Math.abs(pnl)); });
        const averageGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
        const averageLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
        
        avgWinLossChartInstance = new Chart(avgWinLossCtx, {
            type: 'bar',
            data: { labels: ['Gain Moyen', 'Perte Moyenne'], datasets: [{ data: [averageGain, averageLoss], backgroundColor: ['rgba(75, 192, 192, 0.7)', 'rgba(255, 99, 132, 0.7)'], borderColor: ['rgba(75, 192, 192, 1)', 'rgba(255, 99, 132, 1)'], borderWidth: 1 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false, // <-- AJOUTÉ
                scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } }
            }
        });
        // ... (affichage des stats inchangé) ...
        const avgWinLossStatsDisplay = document.getElementById('avgWinLossStatsDisplay');
        const totalGains = gains.reduce((a, b) => a + b, 0);
        const totalLosses = losses.reduce((a, b) => a + b, 0);
        const profitFactor = totalLosses > 0 ? (totalGains / totalLosses) : Infinity;
        const realizedRR = averageLoss > 0 ? (averageGain / averageLoss) : Infinity;
        avgWinLossStatsDisplay.innerHTML = `<p class="mb-1">Ratio Risque/Rendement Réalisé : <strong style="font-size: 1.2em; color: ${realizedRR >= 1 ? 'green' : 'red'};">${realizedRR.toFixed(2)} : 1</strong></p><small class="text-muted">(Pour chaque 1 unité de risque, vous avez gagné ${realizedRR.toFixed(2)} unités en moyenne)</small><hr class="my-2"><p class="mb-1">Profit Factor : <strong style="font-size: 1.2em; color: ${profitFactor >= 1 ? 'green' : 'red'};">${profitFactor.toFixed(2)}</strong></p><small class="text-muted">(Total des Gains / Total des Pertes)</small>`;

    }
    // --- 7. NOUVEAU GRAPHIQUE : PERFORMANCE PAR STRATÉGIE ---
    const strategyPnlCtx = document.getElementById('strategyPnlChart');
    if (strategyPnlCtx) {
        const pnlByStrategy = {}; // Ex: { strategyId1: 500, strategyId2: -150 }

        // 1. Calculer le P/L total pour chaque ID de stratégie
        allClosedPositionsForStats.forEach(pos => {
            if (pos.strategyId && pos.strategyId !== "") {
                if (!pnlByStrategy[pos.strategyId]) {
                    pnlByStrategy[pos.strategyId] = 0;
                }
                pnlByStrategy[pos.strategyId] += calculatePositionPnL(pos);
            }
        });

        // 2. Transformer les IDs en noms pour l'affichage
        const labels = Object.keys(pnlByStrategy).map(strategyId => {
            const strategy = strategies.find(s => s.id === strategyId);
            return strategy ? strategy.title : 'Inconnue';
        });
        const data = Object.values(pnlByStrategy);

        strategyPnlChartInstance = new Chart(strategyPnlCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'P/L Total par Stratégie',
                    data: data,
                    // Même logique de couleur que pour le P/L mensuel
                    backgroundColor: data.map(pnl => pnl >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)')
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
     // --- 8. NOUVEAU GRAPHIQUE : P/L VS TAILLE DE POSITION (SCATTER PLOT) ---
    const pnlVsSizeCtx = document.getElementById('pnlVsSizeChart');
    if (pnlVsSizeCtx) {
        // 1. Préparer les données au format {x, y} pour un scatter plot
        const scatterData = allClosedPositionsForStats.map(pos => {
            const totalQuantity = pos.entries ? pos.entries.reduce((sum, entry) => sum + entry.quantity, 0) : 0;
            const pnl = calculatePositionPnL(pos);
            return {
                x: totalQuantity, // Axe X : Quantité
                y: pnl,           // Axe Y : Profit/Perte
            };
        });

        // 2. Définir la couleur de chaque point (vert pour gain, rouge pour perte)
        const pointColors = scatterData.map(point => point.y >= 0 ? 'rgba(75, 192, 192, 0.7)' : 'rgba(255, 99, 132, 0.7)');

        pnlVsSizeChartInstance = new Chart(pnlVsSizeCtx, {
            type: 'scatter', // <-- Le type de graphique important !
            data: {
                datasets: [{
                    label: 'Trade',
                    data: scatterData,
                    backgroundColor: pointColors,
                    borderColor: pointColors,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }, // Pas besoin de légende ici
                    tooltip: {
                         callbacks: {
                            label: function(context) {
                                let label = ` Trade - P/L: ${context.parsed.y.toFixed(2)}`;
                                let size = `Taille: ${context.parsed.x}`;
                                return [size, label];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Taille de la Position (Quantité Totale)'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Profit / Perte (P/L)'
                        }
                    }
                }
            }
        });
    }

}


/**
 * Met à jour les couleurs des graphiques en fonction du thème.
 * @param {string} theme - 'light' ou 'dark'
 */
export function updateChartColors(theme) {
    const isDark = theme === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDark ? '#e0e0e0' : '#666';

    Chart.defaults.color = textColor;
    Chart.defaults.borderColor = gridColor;

    // La fonction renderCharts sera appelée depuis app.js pour redessiner avec les bonnes couleurs
}

/**
 * Initialise les écouteurs d'événements pour la navigation par année.
 * @param {Function} onYearChange - La fonction à appeler lorsque l'année change.
 */
export function initChartEventListeners(onYearChange) {
    const yearNavigators = [
        { prev: 'pnl-prev-year', next: 'pnl-next-year' },
        { prev: 'activity-prev-year', next: 'activity-next-year' }
    ];
    yearNavigators.forEach(nav => {
        document.getElementById(nav.prev).addEventListener('click', () => {
            selectedYear--;
            onYearChange(); // Appelle la fonction de redessin
        });
        document.getElementById(nav.next).addEventListener('click', () => {
            selectedYear++;
            onYearChange(); // Appelle la fonction de redessin
        });
    });
}

/**
 * Met à jour l'affichage de l'année et l'état des boutons de navigation.
 * (Anciennement dans app.js, maintenant locale à charts.js)
 */
function updateYearNavigatorUI(allClosedPositionsForStats, getClosingDate) {
    document.getElementById('pnl-current-year').textContent = selectedYear;
    document.getElementById('activity-current-year').textContent = selectedYear;

    const years = [...new Set(allClosedPositionsForStats.map(p => getClosingDate(p)?.getFullYear()).filter(Boolean))];
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    
    const isMin = selectedYear <= minYear;
    const isMax = selectedYear >= maxYear;

    document.getElementById('pnl-prev-year').disabled = isMin;
    document.getElementById('activity-prev-year').disabled = isMin;
    document.getElementById('pnl-next-year').disabled = isMax;
    document.getElementById('activity-next-year').disabled = isMax;
}