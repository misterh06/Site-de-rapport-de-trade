// charts.js

// --- Variables et Instances de Graphiques ---
let selectedYear = new Date().getFullYear();
let performanceChartInstance, monthlyPnLChartInstance, winRateByAssetChartInstance,
    monthlyActivityChartInstance, longShortPnlChartInstance, avgWinLossChartInstance;

/**
 * Fonction principale pour dessiner ou redessiner tous les graphiques.
 * Elle prend en paramètre toutes les données dont elle a besoin pour être indépendante.
 * @param {Array} allClosedPositionsForStats - Le tableau complet des positions clôturées.
 * @param {Function} getClosingDate - La fonction utilitaire pour obtenir la date de clôture.
 * @param {Function} calculatePositionPnL - La fonction utilitaire pour calculer le P/L.
 */
export function renderCharts(allClosedPositionsForStats, getClosingDate, calculatePositionPnL) {
    // Destruction des anciennes instances pour éviter les fuites de mémoire
    if (performanceChartInstance) performanceChartInstance.destroy();
    if (monthlyPnLChartInstance) monthlyPnLChartInstance.destroy();
    if (winRateByAssetChartInstance) winRateByAssetChartInstance.destroy();
    if (monthlyActivityChartInstance) monthlyActivityChartInstance.destroy();
    if (longShortPnlChartInstance) longShortPnlChartInstance.destroy();
    if (avgWinLossChartInstance) avgWinLossChartInstance.destroy();

    const monthLabels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"];
    const positionsForYear = allClosedPositionsForStats.filter(p => {
        const closingDate = getClosingDate(p);
        return closingDate instanceof Date && closingDate.getFullYear() === selectedYear;
    });

    updateYearNavigatorUI(allClosedPositionsForStats, getClosingDate);

    // --- 1. GRAPHIQUE DE PERFORMANCE CUMULATIVE ---
    const performanceCtx = document.getElementById('performanceChart');
    if (performanceCtx) {
        // ... (Le code de ce graphique reste exactement le même)
        const positionsWithClosingDate = allClosedPositionsForStats
            .map(p => ({ ...p, closingDate: getClosingDate(p) }))
            .filter(p => p.closingDate instanceof Date)
            .sort((a, b) => a.closingDate - b.closingDate);
        const labels = positionsWithClosingDate.map(p => p.closingDate.toLocaleDateString('fr-FR')); // Simplifié
        const cumulativePnLByCurrency = {};
        const dataByCurrency = {};
        const allCurrencies = [...new Set(positionsWithClosingDate.map(p => p.currency))];
        allCurrencies.forEach(currency => {
            cumulativePnLByCurrency[currency] = 0;
            dataByCurrency[currency] = [];
        });
        positionsWithClosingDate.forEach(pos => {
            cumulativePnLByCurrency[pos.currency] += calculatePositionPnL(pos);
            allCurrencies.forEach(currency => {
                dataByCurrency[currency].push(cumulativePnLByCurrency[currency]);
            });
        });
        const colors = ['rgb(75, 192, 192)', 'rgb(255, 99, 132)', 'rgb(255, 205, 86)'];
        const datasets = allCurrencies.map((currency, index) => ({
            label: `Performance Cumulative (${currency})`,
            data: dataByCurrency[currency],
            borderColor: colors[index % colors.length],
            tension: 0.1,
            fill: false
        }));
        performanceChartInstance = new Chart(performanceCtx, { /* ... options ... */
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: { responsive: true, plugins: { legend: { position: 'top' }, title: { display: true, text: 'Courbe de Performance Cumulative par Devise' } } }
        });
    }

    // --- 2. GRAPHIQUE P&L MENSUEL ---
    const monthlyPnLCtx = document.getElementById('monthlyPnLChart');
    if (monthlyPnLCtx) {
        const monthlyPnLData = Array(12).fill(0);
        positionsForYear.forEach(pos => {
            const closingDate = getClosingDate(pos);
            monthlyPnLData[closingDate.getMonth()] += calculatePositionPnL(pos);
        });
        monthlyPnLChartInstance = new Chart(monthlyPnLCtx, { /* ... options ... */
            type: 'bar',
            data: { labels: monthLabels, datasets: [{ label: 'Profit/Perte Net Mensuel', data: monthlyPnLData, backgroundColor: monthlyPnLData.map(pnl => pnl >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)') }] }
        });
    }
    
    // ... Collez ici le reste du code des graphiques 3, 4, 5, et 6 ...
    // ... Le code est identique, pas besoin de le changer ...
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