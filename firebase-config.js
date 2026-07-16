// firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8LLpTH20AA-urTauEMHZg39aHs6huqVc",
  authDomain: "mon-journal-de-trading-8914c.firebaseapp.com",
  projectId: "mon-journal-de-trading-8914c",
  storageBucket: "mon-journal-de-trading-8914c.firebasestorage.app",
  messagingSenderId: "107546442927",
  appId: "1:107546442927:web:692d6d43c08eb7e916a85a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged };
export { collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, deleteDoc, doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";