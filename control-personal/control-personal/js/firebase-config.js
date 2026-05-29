// ============================================================
//  FIREBASE CONFIG
//  Reemplaza estos valores con los de tu proyecto en Firebase
//  Firebase Console → Project Settings → Your apps → SDK setup
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAwPJkECwIKRhpVtOe5VVDCX32FcPgmq8A",
  authDomain: "costco-bf893.firebaseapp.com",
  projectId: "costco-bf893",
  storageBucket: "costco-bf893.firebasestorage.app",
  messagingSenderId: "923404336272",
  appId: "1:923404336272:web:41b8b9a951af167f34ec15"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
