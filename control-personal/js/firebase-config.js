// ============================================================
//  FIREBASE CONFIG
//  Reemplaza estos valores con los de tu proyecto en Firebase
//  Firebase Console → Project Settings → Your apps → SDK setup
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBmXw_aroyS28xDHOUkeWF7ebudLrkyR5E",
  authDomain: "control-personal-98120.firebaseapp.com",
  projectId: "control-personal-98120",
  storageBucket: "control-personal-98120.firebasestorage.app",
  messagingSenderId: "181622039342",
  appId: "1:181622039342:web:f1a0a064c2aa8ec754d0bf"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
