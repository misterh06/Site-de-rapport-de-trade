// charts.js

// --- Variables et Instances de Graphiques ---
let selectedYear = new Date().getFullYear();
let performanceChartInstance, monthlyPnLChartInstance, winRateByAssetChartInstance,
    monthlyActivityChartInstance, longShortPnlChartInstance, avgWinLossChartInstance,
    strategyPnlChartInstance, confluenceRulesChartInstance, pnlVsSizeChartInstance, pnlVsDurationChartInstance,
    exitReasonChartInstance, planAdherenceChartInstance, pnlByAdherenceChartInstance;

// --- Plugin personnalisé pour l'effet Glow sur les barres ---
const glowPlugin = {
    id: 'glowEffect',
    beforeDatasetsDraw: (chart, args, options) => {
        if (chart.config.type !== 'bar') return;

        const ctx = chart.ctx;
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        // Déterminer la couleur de glow principale (basée sur la première couleur du dataset)
        const firstDataset = chart.data.datasets[0];
        if (firstDataset && firstDataset.backgroundColor) {
            const color = Array.isArray(firstDataset.backgroundColor)
                ? firstDataset.backgroundColor[0]
                : firstDataset.backgroundColor;
            ctx.shadowColor = color;
        }
    },
    afterDatasetsDraw: (chart) => {
        if (chart.config.type !== 'bar') return;
        chart.ctx.restore();
    }
};

// Plugin pour le glow des scatter plots (points)
const scatterGlowPlugin = {
    id: 'scatterGlowEffect',
    beforeDatasetsDraw: (chart) => {
        if (chart.config.type !== 'scatter') return;

        const ctx = chart.ctx;
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'rgba(75, 192, 192, 0.6)';
    },
    afterDatasetsDraw: (chart) => {
        if (chart.config.type !== 'scatter') return;
        chart.ctx.restore();
    }
};

// Enregistrer les plugins globalement
Chart.register(glowPlugin);
Chart.register(scatterGlowPlugin);

// --- COULEURS FLASH POUR LES GRAPHIQUES ---
// Vert néon plus vif
const FLASH_GREEN = {
    dark: 'rgba(0, 210, 106, 0.7)',      // Base sombre
    main: 'rgba(0, 230, 118, 0.95)',     // Couleur principale
    light: 'rgba(74, 255, 165, 1)',      // Clair
    glow: 'rgba(134, 255, 196, 1)'       // Reflet très clair
};

// Rouge flash
const FLASH_RED = {
    dark: 'rgba(220, 38, 38, 0.7)',
    main: 'rgba(239, 68, 68, 0.95)',
    light: 'rgba(252, 129, 129, 1)',
    glow: 'rgba(254, 202, 202, 1)'
};

// Bleu flash
const FLASH_BLUE = {
    dark: 'rgba(37, 99, 235, 0.7)',
    main: 'rgba(59, 130, 246, 0.95)',
    light: 'rgba(147, 197, 253, 1)',
    glow: 'rgba(191, 219, 254, 1)'
};

// Orange flash
const FLASH_ORANGE = {
    dark: 'rgba(234, 88, 12, 0.7)',
    main: 'rgba(251, 146, 60, 0.95)',
    light: 'rgba(253, 186, 116, 1)',
    glow: 'rgba(254, 215, 170, 1)'
};

// Jaune flash
const FLASH_YELLOW = {
    dark: 'rgba(202, 138, 4, 0.7)',
    main: 'rgba(234, 179, 8, 0.95)',
    light: 'rgba(253, 224, 71, 1)',
    glow: 'rgba(254, 249, 195, 1)'
};

// --- FONCTION UNIQUE POUR CRÉER UN DÉGRADÉ AVEC REFLET ---
function getBarGradient(ctx, chartArea, isPositive = true, isHorizontal = false) {
    if (!chartArea) return isPositive ? FLASH_GREEN.main : FLASH_RED.main;

    const colors = isPositive ? FLASH_GREEN : FLASH_RED;
    let gradient;

    if (isHorizontal) {
        gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    } else {
        gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    }

    // Dégradé avec effet de profondeur et reflet
    gradient.addColorStop(0, colors.dark);      // Base sombre (profondeur)
    gradient.addColorStop(0.4, colors.main);    // Couleur principale
    gradient.addColorStop(0.7, colors.main);    // Corps
    gradient.addColorStop(0.9, colors.light);   // Transition vers le reflet
    gradient.addColorStop(1, colors.glow);      // Reflet brillant en haut

    return gradient;
}

// Fonction pour créer un dégradé avec une couleur personnalisée
function getCustomGradient(ctx, chartArea, colorSet, isHorizontal = false) {
    if (!chartArea) return colorSet.main;

    let gradient;
    if (isHorizontal) {
        gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    } else {
        gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    }

    gradient.addColorStop(0, colorSet.dark);
    gradient.addColorStop(0.4, colorSet.main);
    gradient.addColorStop(0.7, colorSet.main);
    gradient.addColorStop(0.9, colorSet.light);
    gradient.addColorStop(1, colorSet.glow);

    return gradient;
}

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
    if (confluenceRulesChartInstance) confluenceRulesChartInstance.destroy();
    if (pnlVsSizeChartInstance) pnlVsSizeChartInstance.destroy();
    if (pnlVsDurationChartInstance) pnlVsDurationChartInstance.destroy();
    if (exitReasonChartInstance) exitReasonChartInstance.destroy();
    if (planAdherenceChartInstance) planAdherenceChartInstance.destroy();
    if (pnlByAdherenceChartInstance) pnlByAdherenceChartInstance.destroy();

    const monthLabels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"];
    const positionsForYear = allClosedPositionsForStats.filter(p => {
        const closingDate = getClosingDate(p);
        return closingDate instanceof Date && closingDate.getFullYear() === selectedYear;
    });
    updateYearNavigatorUI(allClosedPositionsForStats, getClosingDate);

    // --- 1. GRAPHIQUE DE PERFORMANCE CUMULATIVE (INTERACTIF) ---
    const performanceCtx = document.getElementById('performanceChart');
    if (performanceCtx) {

        // --- ÉTAPE 1 : Préparation des données ---

        // Trier tous les trades par date de clôture
        const sortedPositions = allClosedPositionsForStats
            .map(p => ({ ...p, closingDate: getClosingDate(p) }))
            .filter(p => p.closingDate instanceof Date)
            .sort((a, b) => a.closingDate - b.closingDate);

        // Calculer le P/L cumulé et journalier pour CHAQUE devise (USD et EUR)
        const dailyCumulativePnlUSD = {};
        const dailyCumulativePnlEUR = {};
        const dailyPnlUSD = {};
        const dailyPnlEUR = {};

        let cumulativePnlUSD = 0;
        let cumulativePnlEUR = 0;

        sortedPositions.forEach(pos => {
            let pnl = calculatePositionPnL(pos);
            const currency = (pos.currency || 'USD').toUpperCase();

            // Utiliser la date LOCALE
            const year = pos.closingDate.getFullYear();
            const month = String(pos.closingDate.getMonth() + 1).padStart(2, '0');
            const day = String(pos.closingDate.getDate()).padStart(2, '0');
            const dayKey = `${year}-${month}-${day}`;

            // Initialiser les valeurs du jour si elles n'existent pas
            if (dailyPnlUSD[dayKey] === undefined) dailyPnlUSD[dayKey] = 0;
            if (dailyPnlEUR[dayKey] === undefined) dailyPnlEUR[dayKey] = 0;

            // Ajouter au bon cumul et au bon journalier
            if (currency === 'EUR') {
                cumulativePnlEUR += pnl;
                dailyPnlEUR[dayKey] += pnl;
            } else {
                // On considère tout ce qui n'est pas EUR comme USD (ou on pourrait filtrer strict USD)
                cumulativePnlUSD += pnl;
                dailyPnlUSD[dayKey] += pnl;
            }

            // On enregistre l'état du cumul à la fin de chaque trade pour ce jour
            dailyCumulativePnlUSD[dayKey] = cumulativePnlUSD;
            dailyCumulativePnlEUR[dayKey] = cumulativePnlEUR;
        });

        // Préparer les données finales. On doit avoir une entrée pour chaque jour où il y a eu un trade, 
        // peu importe la devise.
        const allDayKeys = new Set([...Object.keys(dailyCumulativePnlUSD), ...Object.keys(dailyCumulativePnlEUR)]);
        const sortedDayKeys = Array.from(allDayKeys).sort();

        // On doit s'assurer que les courbes sont continues. Si un jour il n'y a pas de trade USD mais un trade EUR,
        // le cumul USD doit rester au niveau précédent.
        // Cependant, notre boucle ci-dessus ne remplit dailyCumulativePnlUSD[dayKey] QUE si un trade a eu lieu ce jour-là (ou un trade EUR a eu lieu et on a itéré).
        // Attendez, ma boucle itère sur les positions. Si je traite une position EUR, je ne mets pas à jour dailyCumulativePnlUSD[dayKey].
        // Donc il faut lisser les données après coup.

        const chartDataUSD = [];
        const chartDataEUR = [];
        const dailyGainDataUSD = [];
        const dailyGainDataEUR = [];

        let lastCumulUSD = 0;
        let lastCumulEUR = 0;

        sortedDayKeys.forEach(dayKey => {
            const timestamp = new Date(dayKey).getTime();

            // Si on a une valeur pour ce jour, on la prend, sinon on garde la dernière connue
            if (dailyCumulativePnlUSD[dayKey] !== undefined) lastCumulUSD = dailyCumulativePnlUSD[dayKey];
            if (dailyCumulativePnlEUR[dayKey] !== undefined) lastCumulEUR = dailyCumulativePnlEUR[dayKey];

            chartDataUSD.push({ x: timestamp, y: lastCumulUSD });
            chartDataEUR.push({ x: timestamp, y: lastCumulEUR });

            dailyGainDataUSD.push({ x: timestamp, y: dailyPnlUSD[dayKey] || 0 });
            dailyGainDataEUR.push({ x: timestamp, y: dailyPnlEUR[dayKey] || 0 });
        });

        // --- ÉTAPE 2 : Création du graphique ---

        performanceChartInstance = new Chart(performanceCtx, {
            type: 'line',
            data: {
                datasets: [
                    // Courbe USD (Vert Émeraude)
                    {
                        label: 'Cumul USD ($)',
                        data: chartDataUSD,
                        borderColor: '#10b981', // Emerald 500
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3, // Ligne plus épaisse
                        tension: 0.3, // Légèrement plus courbe pour l'esthétique
                        fill: false,
                        pointRadius: 0, // Points invisibles sauf au survol (plus propre)
                        pointHoverRadius: 6,
                        yAxisID: 'yCumulative',
                        order: 1
                    },
                    // Courbe EUR (Indigo)
                    {
                        label: 'Cumul EUR (€)',
                        data: chartDataEUR,
                        borderColor: '#6366f1', // Indigo 500
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        borderWidth: 3, // Ligne plus épaisse
                        tension: 0.3,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        yAxisID: 'yCumulative',
                        order: 2
                    },
                    // Barres USD (Vert Émeraude transparent)
                    {
                        type: 'bar',
                        label: 'Gain Jour USD ($)',
                        data: dailyGainDataUSD,
                        backgroundColor: 'rgba(16, 185, 129, 0.25)', // Plus subtil
                        borderColor: 'rgba(16, 185, 129, 0.0)', // Pas de bordure pour un look "flat"
                        borderWidth: 0,
                        yAxisID: 'yDaily',
                        order: 3,
                        barPercentage: 1.0,
                        categoryPercentage: 1.0
                    },
                    // Barres EUR (Indigo transparent)
                    {
                        type: 'bar',
                        label: 'Gain Jour EUR (€)',
                        data: dailyGainDataEUR,
                        backgroundColor: 'rgba(99, 102, 241, 0.25)', // Plus subtil
                        borderColor: 'rgba(99, 102, 241, 0.0)',
                        borderWidth: 0,
                        yAxisID: 'yDaily',
                        order: 4,
                        barPercentage: 1.0,
                        categoryPercentage: 1.0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index', // Affiche les infos des deux courbes au survol d'un point X
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day',
                            tooltipFormat: 'dd MMM yyyy',
                            displayFormats: { day: 'dd MMM', week: 'dd MMM yy', month: 'MMM yyyy' }
                        },
                        ticks: { autoSkip: true, maxTicksLimit: 15 }
                    },
                    yCumulative: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'P/L Cumulé' }
                    },
                    yDaily: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Gain Journalier' },
                        grid: { drawOnChartArea: false }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: { display: false },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    }
                }
            }
        });

        // --- ÉTAPE 3 : Connexion des boutons d'interactivité ---

        // ✅ CORRECTION : On crée les "labels" textuels ici et on les passe à la fonction
        const textLabelsForButtons = sortedDayKeys;
        setupPerformanceChartInteractivity(performanceChartInstance, textLabelsForButtons);
    }
    // --- 2. GRAPHIQUE P&L MENSUEL ---
    const monthlyPnLCtx = document.getElementById('monthlyPnLChart');
    if (monthlyPnLCtx) {
        const monthlyPnLData = Array(12).fill(0);
        positionsForYear.forEach(pos => { monthlyPnLData[getClosingDate(pos).getMonth()] += calculatePositionPnL(pos); });

        monthlyPnLChartInstance = new Chart(monthlyPnLCtx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: 'P/L Mensuel',
                    data: monthlyPnLData,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        return getBarGradient(ctx, chartArea, context.raw >= 0, false);
                    },
                    borderWidth: 0,
                    borderRadius: 8,
                    borderSkipped: false
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
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
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
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Taux de Réussite (%)',
                    data,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return FLASH_BLUE.main;

                        const value = context.raw;
                        let colorSet;
                        if (value >= 60) colorSet = FLASH_GREEN;
                        else if (value >= 50) colorSet = FLASH_YELLOW;
                        else colorSet = FLASH_RED;

                        return getCustomGradient(ctx, chartArea, colorSet, false);
                    },
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: { grid: { display: false } }
                }
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
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Nombre de Trades',
                        data: monthlyTotals,
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const { ctx, chartArea } = chart;
                            return getCustomGradient(ctx, chartArea, FLASH_BLUE, false);
                        },
                        borderRadius: 6,
                        yAxisID: 'yTrades'
                    },
                    {
                        type: 'line',
                        label: 'Taux de Gain (%)',
                        data: winRateData,
                        borderColor: FLASH_ORANGE.main,
                        backgroundColor: FLASH_ORANGE.light,
                        yAxisID: 'yWinRate',
                        tension: 0.3,
                        pointBackgroundColor: FLASH_ORANGE.glow,
                        pointBorderColor: FLASH_ORANGE.main,
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    yTrades: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'Nombre de Trades' }, grid: { color: 'rgba(0,0,0,0.05)' } },
                    yWinRate: { type: 'linear', position: 'right', min: 0, max: 100, title: { display: true, text: 'Taux de Gain (%)' }, grid: { drawOnChartArea: false } },
                    x: { grid: { display: false } }
                }
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
            data: {
                labels: ['Profits générés par "Long"', 'Profits générés par "Short"'],
                datasets: [{
                    data: [longGains, shortGains],
                    backgroundColor: [FLASH_GREEN.main, FLASH_RED.main],
                    hoverBackgroundColor: [FLASH_GREEN.light, FLASH_RED.light],
                    borderColor: [FLASH_GREEN.glow, FLASH_RED.glow],
                    borderWidth: 3,
                    hoverBorderWidth: 4,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        padding: 12,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 12 }
                    }
                }
            }
        });
        // ... (affichage des stats inchangé) ...
        const longShortStatsDisplay = document.getElementById('longShortStatsDisplay');
        const longWinRate = typeStats.long.count > 0 ? (typeStats.long.wins / typeStats.long.count * 100) : 0;
        const shortWinRate = typeStats.short.count > 0 ? (typeStats.short.wins / typeStats.short.count * 100) : 0;
        longShortStatsDisplay.innerHTML = `<table class="table table-sm table-borderless small"><thead><tr><th>Type</th><th class="text-end">P/L Total</th><th class="text-end">Taux Gain</th><th class="text-end">Trades</th></tr></thead><tbody><tr><td><span class="badge" style="background-color: ${FLASH_GREEN.main};">Long</span></td><td class="text-end" style="color:${typeStats.long.totalPnl >= 0 ? '#00D26A' : '#EF4444'}"><strong>${typeStats.long.totalPnl.toFixed(2)}</strong></td><td class="text-end">${longWinRate.toFixed(1)}%</td><td class="text-end">${typeStats.long.count}</td></tr><tr><td><span class="badge" style="background-color: ${FLASH_RED.main};">Short</span></td><td class="text-end" style="color:${typeStats.short.totalPnl >= 0 ? '#00D26A' : '#EF4444'}"><strong>${typeStats.short.totalPnl.toFixed(2)}</strong></td><td class="text-end">${shortWinRate.toFixed(1)}%</td><td class="text-end">${typeStats.short.count}</td></tr></tbody></table>`;

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
            data: {
                labels: ['Gain Moyen', 'Perte Moyenne'],
                datasets: [{
                    data: [averageGain, averageLoss],
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        return getBarGradient(ctx, chartArea, context.dataIndex === 0, false);
                    },
                    borderWidth: 0,
                    borderRadius: 10,
                    barPercentage: 0.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: { grid: { display: false } }
                }
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
    // --- 7. GRAPHIQUE : EFFICACITÉ TENDANCE VS CONTRE-TENDANCE ---
    const strategyPnlCtx = document.getElementById('strategyPnlChart');
    if (strategyPnlCtx) {
        // Initialiser les stats pour Tendance et Contre-tendance uniquement
        const modeStats = {
            'Tendance': { totalPnl: 0, totalHours: 0, count: 0 },
            'Contre-tendance': { totalPnl: 0, totalHours: 0, count: 0 }
        };

        // Calculer le P&L et la durée pour chaque trade selon son mode
        allClosedPositionsForStats.forEach(pos => {
            const pnl = calculatePositionPnL(pos);
            const closingDate = getClosingDate(pos);
            const openingDate = pos.entries[0].date;
            const durationHours = (closingDate - openingDate) / (1000 * 60 * 60);

            if (pos.confluences && pos.confluences.length > 0) {
                // Vérifier les confluences pour Tendance et Contre-tendance
                if (pos.confluences.includes('Tendance H4')) {
                    modeStats['Tendance'].totalPnl += pnl;
                    modeStats['Tendance'].totalHours += durationHours;
                    modeStats['Tendance'].count++;
                }
                if (pos.confluences.includes('Contre-tendance')) {
                    modeStats['Contre-tendance'].totalPnl += pnl;
                    modeStats['Contre-tendance'].totalHours += durationHours;
                    modeStats['Contre-tendance'].count++;
                }
            }
        });

        // Préparer les données : efficacité = P&L total / heures totales
        const labels = Object.keys(modeStats);
        const efficiencyData = labels.map(mode => {
            const stat = modeStats[mode];
            if (stat.count === 0 || stat.totalHours === 0) return 0;
            return stat.totalPnl / stat.totalHours;
        });
        const pnlData = labels.map(mode => modeStats[mode].totalPnl);
        const counts = labels.map(mode => modeStats[mode].count);
        const avgDuration = labels.map(mode => {
            const stat = modeStats[mode];
            return stat.count > 0 ? stat.totalHours / stat.count : 0;
        });

        // Couleurs distinctes pour chaque mode avec dégradés
        const colorSets = [FLASH_BLUE, FLASH_ORANGE];

        strategyPnlChartInstance = new Chart(strategyPnlCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Efficacité (P&L/heure)',
                    data: efficiencyData,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return colorSets[context.dataIndex].main;
                        return getCustomGradient(ctx, chartArea, colorSets[context.dataIndex], true); // horizontal
                    },
                    borderWidth: 0,
                    borderRadius: 8,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }]
            },
            options: {
                indexAxis: 'y', // Barres horizontales pour un meilleur rendu
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: 10,
                        right: 20,
                        top: 10,
                        bottom: 10
                    }
                },
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: '📊 Tendance vs Contre-tendance',
                        font: { size: 14, weight: 'bold' },
                        padding: { bottom: 15 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        padding: 12,
                        titleFont: { size: 13 },
                        bodyFont: { size: 12 },
                        callbacks: {
                            label: function (context) {
                                return `Efficacité: ${context.parsed.x.toFixed(2)} $/h`;
                            },
                            afterLabel: function (context) {
                                const index = context.dataIndex;
                                const pnl = pnlData[index].toFixed(2);
                                const count = counts[index];
                                const avgHours = avgDuration[index].toFixed(1);
                                return [
                                    `────────────`,
                                    `💰 P&L Total: ${pnl} $`,
                                    `📈 Trades: ${count}`,
                                    `⏱️ Durée moy: ${avgHours}h`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Efficacité (P&L par heure)',
                            font: { weight: 'bold' }
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.05)'
                        }
                    },
                    y: {
                        ticks: {
                            font: { size: 13, weight: 'bold' }
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    // --- 8. NOUVEAU GRAPHIQUE : TAUX DE RÉUSSITE PAR RÈGLE DE CONFLUENCE ---
    const confluenceRulesCtx = document.getElementById('confluenceRulesChart');
    if (confluenceRulesCtx) {
        // Mapping entre les valeurs sauvegardées et les labels d'affichage
        const ruleMap = {
            'Tendance H4': 'Tendance H4',
            'Contre-tendance': 'Contre-tendance',
            'Trading de Range': 'Trading de Range',
            'Support/Résistance': 'Vente Résist. / Achat Supp.',
            'Retour sur FVG': 'Retour sur FVG',
            'Fibonacci 0.5/0.618': 'Zone Fib 0.5 / 0.618',
            'Mean Reversion': 'Mean Reversion'
        };
        const rules = Object.keys(ruleMap);

        // Initialiser les stats pour chaque règle
        const ruleStats = {};
        rules.forEach(rule => {
            ruleStats[rule] = { wins: 0, total: 0 };
        });

        // Calculer le winrate pour chaque règle
        allClosedPositionsForStats.forEach(pos => {
            const pnl = calculatePositionPnL(pos);
            const isWin = pnl >= 0;

            if (pos.confluences && pos.confluences.length > 0) {
                pos.confluences.forEach(confluence => {
                    if (ruleStats[confluence]) {
                        ruleStats[confluence].total++;
                        if (isWin) ruleStats[confluence].wins++;
                    }
                });
            }
        });

        // Préparer les données pour le graphique
        const ruleLabels = rules.map(rule => ruleMap[rule]);
        const winRateData = rules.map(rule => {
            const stat = ruleStats[rule];
            return stat.total > 0 ? (stat.wins / stat.total * 100) : 0;
        });
        const tradeCounts = rules.map(rule => ruleStats[rule].total);

        confluenceRulesChartInstance = new Chart(confluenceRulesCtx, {
            type: 'bar',
            data: {
                labels: ruleLabels,
                datasets: [{
                    label: 'Taux de Réussite (%)',
                    data: winRateData,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return FLASH_BLUE.main;

                        const value = context.raw;
                        let colorSet;
                        if (value >= 60) colorSet = FLASH_GREEN;
                        else if (value >= 50) colorSet = FLASH_YELLOW;
                        else colorSet = FLASH_RED;

                        return getCustomGradient(ctx, chartArea, colorSet, true); // horizontal
                    },
                    borderWidth: 0,
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y', // Barres horizontales
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'Taux de Réussite par Règle de Confluence'
                    },
                    tooltip: {
                        callbacks: {
                            afterLabel: function (context) {
                                const index = context.dataIndex;
                                return `Trades avec cette règle: ${tradeCounts[index]}`;
                                const count = tradeCounts[index];
                                if (count === 0) {
                                    return `Aucun trade avec cette règle.`;
                                }
                                return `Trades avec cette règle: ${count}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Taux de Réussite (%)'
                        }
                    },
                    y: {
                        ticks: {
                            autoSkip: false // Forcer l'affichage de toutes les règles
                        }
                    }
                }
            }
        });
    }
    // --- 8. NOUVEAU GRAPHIQUE : P/L VS CAPITAL INVESTI (SCATTER PLOT) ---
    const pnlVsSizeCtx = document.getElementById('pnlVsSizeChart');
    if (pnlVsSizeCtx) {
        // 1. Préparer les données au format {x, y} pour un scatter plot
        const scatterData = allClosedPositionsForStats.map(pos => {
            // Calculer le coût total d'entrée (quantité × prix)
            const totalCost = pos.entries ? pos.entries.reduce((sum, entry) => sum + (entry.quantity * entry.price), 0) : 0;
            const pnl = calculatePositionPnL(pos);
            return {
                x: totalCost,  // Axe X : Capital investi
                y: pnl,        // Axe Y : Profit/Perte
                asset: pos.asset // Pour le tooltip
            };
        });

        // 2. Définir les couleurs flash pour chaque point
        const pointBgColors = scatterData.map(point => point.y >= 0 ? FLASH_GREEN.main : FLASH_RED.main);
        const pointBorderColors = scatterData.map(point => point.y >= 0 ? FLASH_GREEN.glow : FLASH_RED.glow);
        const pointHoverBgColors = scatterData.map(point => point.y >= 0 ? FLASH_GREEN.light : FLASH_RED.light);

        pnlVsSizeChartInstance = new Chart(pnlVsSizeCtx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Trade',
                    data: scatterData,
                    backgroundColor: pointBgColors,
                    borderColor: pointBorderColors,
                    hoverBackgroundColor: pointHoverBgColors,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointBorderWidth: 1,
                    pointHoverBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        padding: 14,
                        titleFont: { size: 14, weight: 'bold' },
                        bodyFont: { size: 12 },
                        displayColors: false,
                        callbacks: {
                            title: function (context) {
                                const asset = context[0].raw.asset || 'Trade';
                                const pnl = context[0].raw.y;
                                const emoji = pnl >= 0 ? '🟢' : '🔴';
                                return `${emoji} ${asset}`;
                            },
                            label: function (context) {
                                const capital = context.parsed.x.toFixed(2);
                                const pnl = context.parsed.y.toFixed(2);
                                const pnlSign = context.parsed.y >= 0 ? '+' : '';
                                const roi = context.parsed.x > 0 ? ((context.parsed.y / context.parsed.x) * 100).toFixed(1) : '0';
                                return [
                                    `💰 Capital: ${capital} $`,
                                    `📊 P/L: ${pnlSign}${pnl} $`,
                                    `📈 ROI: ${pnlSign}${roi}%`
                                ];
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
                            text: 'Capital Investi ($)',
                            font: { weight: 'bold', size: 12 }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Profit / Perte (P/L)',
                            font: { weight: 'bold', size: 12 }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    }
                }
            }
        });
    }
    // --- 9. NOUVEAU GRAPHIQUE : PERFORMANCE PAR DURÉE (BAR CHART) ---
    const pnlVsDurationCtx = document.getElementById('pnlVsDurationChart');
    if (pnlVsDurationCtx) {
        // 1. Définir les catégories (buckets) de durée
        const buckets = [
            { label: '< 15 min', maxMs: 15 * 60 * 1000, totalPnl: 0, count: 0 },
            { label: '15m - 1h', maxMs: 60 * 60 * 1000, totalPnl: 0, count: 0 },
            { label: '1h - 4h', maxMs: 4 * 60 * 60 * 1000, totalPnl: 0, count: 0 },
            { label: '4h - 24h', maxMs: 24 * 60 * 60 * 1000, totalPnl: 0, count: 0 },
            { label: '> 24h', maxMs: Infinity, totalPnl: 0, count: 0 }
        ];

        // 2. Répartir les trades dans les buckets
        allClosedPositionsForStats.forEach(pos => {
            const closingDate = getClosingDate(pos);
            const openingDate = pos.entries[0].date;
            const durationMs = closingDate - openingDate;
            const pnl = calculatePositionPnL(pos);

            // Trouver le bon bucket
            for (let bucket of buckets) {
                if (durationMs < bucket.maxMs) {
                    bucket.totalPnl += pnl;
                    bucket.count++;
                    break;
                }
            }
        });

        // 3. Préparer les données pour le graphique (Moyenne par trade)
        const labels = buckets.map(b => b.label);
        const data = buckets.map(b => b.count > 0 ? b.totalPnl / b.count : 0);

        pnlVsDurationChartInstance = new Chart(pnlVsDurationCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'P/L Moyen par Trade',
                    data: data,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        return getBarGradient(ctx, chartArea, context.raw >= 0, false);
                    },
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'P/L Moyen',
                            font: { weight: 'bold' }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        padding: 10,
                        callbacks: {
                            afterLabel: function (context) {
                                const bucketIndex = context.dataIndex;
                                const count = buckets[bucketIndex].count;
                                const total = buckets[bucketIndex].totalPnl.toFixed(2);
                                return [`📈 Trades: ${count}`, `💰 Total: ${total} $`];
                            }
                        }
                    }
                }
            }
        });
    }

    // --- 10. NOUVEAU GRAPHIQUE : RAISONS DE SORTIE (DOUGHNUT) ---
    const exitReasonCtx = document.getElementById('exitReasonChart');
    if (exitReasonCtx) {
        const reasonStats = {};
        const reasonLabelsMap = {
            'target': '✅ Target atteint',
            'stop_loss': '❌ Stop Loss touché',
            'manual_plan': '🤝 Sortie manuelle (plan)',
            'manual_emotional': '😨 Sortie émotionnelle',
            'time_based': '⏰ Sortie temporelle',
            'breakeven': '🔄 Breakeven',
            'other': '💡 Autre'
        };

        allClosedPositionsForStats.forEach(pos => {
            const reason = pos.exitReason;
            // Ignorer les trades sans raison de sortie définie
            if (!reason || reason === 'Inconnu') return;
            if (!reasonStats[reason]) reasonStats[reason] = 0;
            reasonStats[reason]++;
        });

        const labels = Object.keys(reasonStats).map(r => reasonLabelsMap[r] || r);
        const data = Object.values(reasonStats);

        // Couleurs flash pour les raisons de sortie
        const reasonColors = {
            'target': { bg: FLASH_GREEN.main, border: FLASH_GREEN.glow, hover: FLASH_GREEN.light },
            'stop_loss': { bg: FLASH_RED.main, border: FLASH_RED.glow, hover: FLASH_RED.light },
            'manual_plan': { bg: FLASH_BLUE.main, border: FLASH_BLUE.glow, hover: FLASH_BLUE.light },
            'manual_emotional': { bg: FLASH_YELLOW.main, border: FLASH_YELLOW.glow, hover: FLASH_YELLOW.light },
            'time_based': { bg: 'rgba(107, 114, 128, 0.9)', border: 'rgba(156, 163, 175, 1)', hover: 'rgba(156, 163, 175, 0.9)' },
            'breakeven': { bg: FLASH_BLUE.main, border: FLASH_BLUE.glow, hover: FLASH_BLUE.light },
            'other': { bg: 'rgba(75, 85, 99, 0.9)', border: 'rgba(107, 114, 128, 1)', hover: 'rgba(107, 114, 128, 0.9)' }
        };

        const bgColors = Object.keys(reasonStats).map(r => reasonColors[r]?.bg || 'rgba(107, 114, 128, 0.9)');
        const borderColors = Object.keys(reasonStats).map(r => reasonColors[r]?.border || 'rgba(156, 163, 175, 1)');
        const hoverColors = Object.keys(reasonStats).map(r => reasonColors[r]?.hover || 'rgba(156, 163, 175, 0.9)');

        exitReasonChartInstance = new Chart(exitReasonCtx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    hoverBackgroundColor: hoverColors,
                    borderColor: borderColors,
                    borderWidth: 3,
                    hoverBorderWidth: 4,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '55%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 15,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        padding: 12,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 12 },
                        callbacks: {
                            label: function (context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return ` ${context.parsed} trades (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // --- 11. NOUVEAU GRAPHIQUE : DISTRIBUTION DU RESPECT DU PLAN (BAR) ---
    const planAdherenceCtx = document.getElementById('planAdherenceChart');
    if (planAdherenceCtx) {
        const adherenceStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        allClosedPositionsForStats.forEach(pos => {
            if (pos.planAdherence) {
                adherenceStats[pos.planAdherence]++;
            }
        });

        const labels = ['1 ⭐', '2 ⭐', '3 ⭐', '4 ⭐', '5 ⭐'];
        const data = [adherenceStats[1], adherenceStats[2], adherenceStats[3], adherenceStats[4], adherenceStats[5]];

        // Dégradé du rouge au vert avec les couleurs flash
        const colorSets = [FLASH_RED, FLASH_ORANGE, FLASH_YELLOW, FLASH_YELLOW, FLASH_GREEN];

        planAdherenceChartInstance = new Chart(planAdherenceCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Nombre de Trades',
                    data: data,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return 'rgba(100,100,100,0.5)';
                        return getCustomGradient(ctx, chartArea, colorSets[context.dataIndex], false);
                    },
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Nombre de Trades', font: { weight: 'bold' } },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // --- 12. NOUVEAU GRAPHIQUE : IMPACT DISCIPLINE SUR P/L (BAR) ---
    const pnlByAdherenceCtx = document.getElementById('pnlByAdherenceChart');
    if (pnlByAdherenceCtx) {
        const adherencePnl = {
            1: { total: 0, count: 0 },
            2: { total: 0, count: 0 },
            3: { total: 0, count: 0 },
            4: { total: 0, count: 0 },
            5: { total: 0, count: 0 }
        };

        allClosedPositionsForStats.forEach(pos => {
            if (pos.planAdherence) {
                adherencePnl[pos.planAdherence].total += calculatePositionPnL(pos);
                adherencePnl[pos.planAdherence].count++;
            }
        });

        const labels = ['1 ⭐', '2 ⭐', '3 ⭐', '4 ⭐', '5 ⭐'];
        const data = [1, 2, 3, 4, 5].map(score => {
            const stat = adherencePnl[score];
            return stat.count > 0 ? stat.total / stat.count : 0;
        });

        pnlByAdherenceChartInstance = new Chart(pnlByAdherenceCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'P/L Moyen par Trade',
                    data: data,
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        return getBarGradient(ctx, chartArea, context.raw >= 0, false);
                    },
                    borderWidth: 0,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'P/L Moyen', font: { weight: 'bold' } },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

}

// Petite fonction utilitaire locale pour le formatage dans le graphique
function formatDurationForChart(ms) {
    if (!ms || ms < 0) return '-';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
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

    // Écouteur pour le sélecteur de devise
    const currencySelect = document.getElementById('chart-currency-select');
    if (currencySelect) {
        currencySelect.addEventListener('change', () => {
            onYearChange(); // On redessine tout
        });
    }
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
function setupPerformanceChartInteractivity(chart, allLabels) {
    const controls = document.getElementById('performance-chart-controls');
    if (!controls || allLabels.length === 0) return;

    const rangeButtons = controls.querySelectorAll('.btn-group button');
    const resetBtn = controls.querySelector('#reset-zoom-btn');

    const lastDate = new Date(allLabels[allLabels.length - 1]);

    rangeButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Gérer le style du bouton actif
            rangeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            const range = button.dataset.range;
            let startDate = new Date(allLabels[0]);

            if (range === 'week') {
                startDate = new Date(lastDate);
                startDate.setDate(lastDate.getDate() - 7);
            } else if (range === 'month') {
                startDate = new Date(lastDate);
                startDate.setMonth(lastDate.getMonth() - 1);
            } else if (range === '3month') {
                startDate = new Date(lastDate);
                startDate.setMonth(lastDate.getMonth() - 3);
            } else if (range === 'year') {
                startDate = new Date(lastDate);
                startDate.setFullYear(lastDate.getFullYear() - 1);
            }

            chart.zoomScale('x', { min: startDate.getTime(), max: lastDate.getTime() }, 'default');
        });
    });

    resetBtn.addEventListener('click', () => {
        chart.resetZoom('default');
        rangeButtons.forEach(btn => btn.classList.remove('active'));
        controls.querySelector('button[data-range="all"]').classList.add('active');
    });
}