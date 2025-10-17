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
let accountTransactions = []; // <-- LIGNE AJOUTÉE
let currentUser = null;
const POSITIONS_PER_PAGE = 20;
let currentPage = 1;
let totalPages = 1;
let lastVisibleDoc = null; // Pour savoir où commencer la page suivante
let firstVisibleDocs = [null]; // Pour savoir où commencer la page précédente

// --- Références aux éléments du DOM ---
const mainSidebar = document.getElementById('main-sidebar');
const mainContentArea = document.getElementById('main-content-area');
const sectionTitle = document.getElementById('section-title');
const navLinks = document.querySelectorAll('#main-sidebar .nav-link');
const contentSections = document.querySelectorAll('.content-section');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');

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

        // Lancer les deux chargements de données en parallèle pour plus de rapidité
        await Promise.all([
            fetchStaticData(), // Charge les positions ouvertes et les transactions de compte
            fetchData(),
            fetchAllClosedPositionsForStats()       // Charge la première page de l'historique des positions clôturées
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
});
// app.js

// NOUVELLE FONCTION
async function fetchStaticData() {
    if (!currentUser) return;
    try {
        const openPositionsQuery = query(collection(db, 'users', currentUser.uid, 'positions'), where('status', '==', 'open'), orderBy('createdAt', 'desc'));
        const transactionsQuery = query(collection(db, 'users', currentUser.uid, 'accountTransactions'));
        
        const [openSnapshot, transactionsSnapshot] = await Promise.all([getDocs(openPositionsQuery), getDocs(transactionsQuery)]);
        
        openPositions = openSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        accountTransactions = transactionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        openPositions.forEach(p => {
            if (p.entries) p.entries.forEach(e => e.date = e.date.toDate());
        });
        accountTransactions.forEach(t => t.date = t.date.toDate());

    } catch (error) {
        console.error("Erreur de chargement des données statiques:", error);
    }
}

// --- Logique principale ---
async function fetchData(direction = null) {
    if (!currentUser) return;
    try {
        const closedPositionsCol = collection(db, 'users', currentUser.uid, 'positions');
        let qClosed;

        if (direction === 'next') {
            qClosed = query(closedPositionsCol, where('status', '==', 'closed'), orderBy('createdAt', 'desc'), startAfter(lastVisibleDoc), limit(POSITIONS_PER_PAGE));
        } else { 
            qClosed = query(closedPositionsCol, where('status', '==', 'closed'), orderBy('createdAt', 'desc'), limit(POSITIONS_PER_PAGE));
            if (direction === null) {
                const countQuery = query(closedPositionsCol, where('status', '==', 'closed'));
                const countSnapshot = await getDocs(countQuery);
                totalPages = Math.ceil(countSnapshot.size / POSITIONS_PER_PAGE) || 1;
            }
        }

        const closedSnapshot = await getDocs(qClosed);
        if (!closedSnapshot.empty) {
            lastVisibleDoc = closedSnapshot.docs[closedSnapshot.docs.length - 1];
        }

        closedPositions = closedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
        // CORRECTION : On vide la liste avant de la remplir. C'est la ligne la plus importante.
        allClosedPositionsForStats = []; 

        const q = query(collection(db, 'users', currentUser.uid, 'positions'), where('status', '==', 'closed'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        const positionsTemp = []; // On utilise une liste temporaire pour être propre
        querySnapshot.forEach(doc => {
            positionsTemp.push({ id: doc.id, ...doc.data() });
        });

        // Convertir les timestamps
        positionsTemp.forEach(p => {
            if (p.entries) p.entries.forEach(e => e.date = e.date.toDate());
            if (p.exits) p.exits.forEach(ex => ex.date = ex.date.toDate());
        });

        // On assigne la nouvelle liste fraîchement téléchargée
        allClosedPositionsForStats = positionsTemp;

    } catch (error) {
        console.error("Erreur lors du chargement de toutes les positions clôturées:", error);
    }
}

// NOUVELLE FONCTION pour gérer les boutons
function updatePaginationControls(currentSize) {
    paginationInfo.textContent = `Page ${currentPage} sur ${totalPages}`;
    
    prevPageBtn.disabled = currentPage === 1;
    // Le bouton "Suivant" est désactivé si on est sur la dernière page
    // OU si la page actuelle n'est pas pleine (on sait qu'il n'y en a pas d'autre)
    nextPageBtn.disabled = currentPage === totalPages || currentSize < POSITIONS_PER_PAGE;
}

async function updateAllViews() {
    // Logique pour les positions
    renderOpenPositions();
    renderClosedPositionsHistory();
    renderLastClosedPositions();
    updateDashboardStats();
    renderCharts(allClosedPositionsForStats, getClosingDate, calculatePositionPnL); 
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
        
        // DESSINER LES GRAPHIQUES UNIQUEMENT SI LA SECTION EST VISIBLE
        if (sectionId === 'dashboard' || sectionId === 'reports-analytics') {
            renderCharts(allClosedPositionsForStats, getClosingDate, calculatePositionPnL);
        }
    }

    const activeLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    sectionTitle.textContent = activeLink ? activeLink.textContent.trim() : 'Authentification';
}

function renderOpenPositions() {
    openPositionsBody.innerHTML = '';
    if (openPositions.length === 0) { openPositionsBody.innerHTML = '<tr><td colspan="6" class="text-center">Aucune position ouverte.</td></tr>'; return; }
    openPositions.forEach(pos => {
        const metrics = calculatePositionMetrics(pos);
        const row = openPositionsBody.insertRow();
        row.innerHTML = `
            <td>${pos.asset}</td>
            <td>${pos.type === 'long' ? 'Achat' : 'Vente'}</td>
            <td>${metrics.currentQuantity}</td>
            <td>${metrics.averageEntryPrice.toFixed(4)} ${pos.currency}</td>
    <td>${(metrics.currentQuantity * metrics.averageEntryPrice).toFixed(2)} ${pos.currency}</td>
            <td>
                <button class="btn btn-sm btn-success me-2" onclick="handleModifyPosition('${pos.id}', 'add')">Renforcer</button>
                <button class="btn btn-sm btn-warning" onclick="handleModifyPosition('${pos.id}', 'close')">Clôturer</button>
            </td>`;
    });
}

function renderClosedPositionsHistory() {
    allPositionsBody.innerHTML = '';
    if (closedPositions.length === 0) { allPositionsBody.innerHTML = '<tr><td colspan="8" class="text-center">Aucune position clôturée.</td></tr>'; return; }
    closedPositions.forEach(pos => {
        const metrics = calculatePositionMetrics(pos);
        const pnl = calculatePositionPnL(pos);
        const row = allPositionsBody.insertRow();
        row.innerHTML = `
    <td>${formatDate(pos.entries[0].date)}</td>
    <td>${formatDate(getClosingDate(pos))}</td>
    <td>${pos.asset}</td>
    <td>${pos.type === 'long' ? 'Achat' : 'Vente'}</td>
    <td>${metrics.averageEntryPrice.toFixed(4)}</td>
    <td>${(metrics.totalExitValue / metrics.totalExitQuantity || 0).toFixed(4)}</td>
    <td style="color: ${pnl >= 0 ? 'green' : 'red'};">${pnl.toFixed(2)} ${pos.currency}</td>
    <td>
        <button class="btn btn-sm btn-info me-2" onclick="viewPositionDetails('${pos.id}')">Détails</button>
        <button class="btn btn-sm btn-danger" onclick="deletePosition('${pos.id}')">Supprimer</button>
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
    
    // ---- LOGIQUE D'AFFICHAGE DU P&L PAR DEVISE (LA BONNE) ----
    if (totalProfitLossSpan) {
        totalProfitLossSpan.innerHTML = ''; // On vide l'ancien contenu
        const sortedCurrencies = Object.keys(totalPnLByCurrency).sort();
        
        if (sortedCurrencies.length === 0) {
            totalProfitLossSpan.innerHTML = '0.00';
        } else {
            sortedCurrencies.forEach(currency => {
                const pnl = totalPnLByCurrency[currency];
                const color = pnl >= 0 ? 'green' : 'red';
                totalProfitLossSpan.innerHTML += `<div style="color: ${color}; font-size: 0.8em;">${pnl.toFixed(2)} ${currency}</div>`;
            });
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
    [assetGroup, typeGroup, notesGroup].forEach(el => el.style.display = 'none');
    positionModalLabel.textContent = action === 'add' ? `Renforcer ${position.asset}` : `Clôturer ${position.asset}`;
    if (action === 'close') { transactionQuantityInput.value = calculatePositionMetrics(position).currentQuantity; }
    transactionDateInput.value = new Date().toISOString().slice(0, 16);
    positionModal.show();
};

window.viewPositionDetails = (positionId) => {
    const position = [...openPositions, ...closedPositions].find(p => p.id === positionId);
    if (!position) return;
    let details = `Détails pour ${position.asset}:\n\n--- ENTRÉES ---\n`;
position.entries.forEach(e => { details += `${formatDate(e.date)} - Qte: ${e.quantity}, Prix: ${e.price} ${position.currency}\n`; });
details += '\n--- SORTIES ---\n';
if (position.exits && position.exits.length > 0) { position.exits.forEach(ex => { details += `${formatDate(ex.date)} - Qte: ${ex.quantity}, Prix: ${ex.price} ${position.currency}\n`; }); }
    else { details += 'Aucune sortie pour le moment.\n'; }
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

    try {
        if (action === 'open') {
            const newPosition = {
                asset: document.getElementById('positionAsset').value.toUpperCase(),
                type: document.getElementById('positionType').value,
                currency: document.getElementById('positionCurrency').value.toUpperCase(),
                status: 'open',
                notes: document.getElementById('positionNotes').value,
                createdAt: transaction.date,
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

        if (t.type === 'deposit')   balances[toCurrency] += toAmount;
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
    
    balancesDisplay.appendChild(table);
}
// NOUVELLE FONCTION : Affiche l'historique (adaptée pour les conversions)
function renderAccountTransactions() {
    transactionsHistoryBody.innerHTML = '';
    const sorted = [...accountTransactions].sort((a, b) => b.date - a.date);
    if (sorted.length === 0) {
        transactionsHistoryBody.innerHTML = '<tr><td colspan="2" class="text-center">Aucun historique.</td></tr>';
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
        row.innerHTML = `<td>${formatDate(t.date)}</td><td>${operationHtml}</td>`;
    });
}

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
        transactionData = {
            type: type,
            date: new Date(document.getElementById('dw_date').value),
            amount: parseFloat(document.getElementById('dw_amount').value),
            currency: document.getElementById('dw_currency').value.toUpperCase()
        };
    } else { // conversion
        const fromAmount = parseFloat(document.getElementById('conv_from_amount').value);
        const rate = parseFloat(document.getElementById('conv_rate').value);
        transactionData = {
            type: 'conversion',
            date: new Date(document.getElementById('conv_date').value),
            fromAmount: fromAmount,
            fromCurrency: document.getElementById('conv_from_currency').value.toUpperCase(),
            toAmount: fromAmount * rate,
            toCurrency: document.getElementById('conv_to_currency').value.toUpperCase(),
            rate: rate
        };
    }
    
    try {
        await addDoc(collection(db, 'users', currentUser.uid, 'accountTransactions'), transactionData);
        accountForm.reset();
        transactionTypeSelect.dispatchEvent(new Event('change')); // Réinitialise l'affichage du formulaire
        await fetchData();
        updateAllViews();
    } catch (error) {
        console.error("Erreur enregistrement transaction:", error);
        alert("Erreur lors de l'enregistrement.");
    }
});







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
    
    // Gestion de la navigation principale entre les sections
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentUser) {
                showSection(e.currentTarget.dataset.section);
            }
        });
    });
    // Gestion des boutons de pagination pour l'historique
    nextPageBtn.addEventListener('click', async () => {
        if (!nextPageBtn.disabled) {
            currentPage++;
            await fetchData('next');
            renderClosedPositionsHistory();
        }
    });
    prevPageBtn.addEventListener('click', async () => {
        if (!prevPageBtn.disabled) {
            currentPage--;
            await fetchData(); 
            for (let i = 1; i < currentPage; i++) {
                await fetchData('next');
            }
            renderClosedPositionsHistory();
        }
    });       
     initChartEventListeners(() => {
        // Cette fonction sera appelée à chaque changement d'année
        renderCharts(allClosedPositionsForStats, getClosingDate, calculatePositionPnL);
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
        renderCharts(allClosedPositionsForStats, getClosingDate, calculatePositionPnL);
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


