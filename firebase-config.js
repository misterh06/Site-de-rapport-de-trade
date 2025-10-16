// firebase-config.js

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB8LLpTH20AA-urTauEMHZg39aHs6huqVc",
  authDomain: "mon-journal-de-trading-8914c.firebaseapp.com",
  projectId: "mon-journal-de-trading-8914c",
  storageBucket: "mon-journal-de-trading-8914c.firebasestorage.app",
  messagingSenderId: "107546442927",
  appId: "1:107546442927:web:692d6d43c08eb7e916a85a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Exporter les services Auth et Firestore pour les utiliser dans d'autres fichiers
export const auth = getAuth(app);
export const db = getFirestore(app);