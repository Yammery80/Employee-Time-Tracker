// ===== auth.js =====
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Helpers UI ──────────────────────────────────────────────
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + id).classList.add("active");
}

export function showLoading(msg = "Cargando...") {
  document.getElementById("loading-text").textContent = msg;
  document.getElementById("loading-overlay").classList.add("visible");
}

export function hideLoading() {
  document.getElementById("loading-overlay").classList.remove("visible");
}

export function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.style.display = "flex";
}

export function hideError(elId) {
  document.getElementById(elId).style.display = "none";
}

// ── Auth tab toggle ──────────────────────────────────────────
window.authTab = function(tab) {
  document.getElementById("auth-login").style.display    = tab === "login"    ? "block" : "none";
  document.getElementById("auth-register").style.display = tab === "register" ? "block" : "none";
  document.querySelectorAll(".tab").forEach((b, i) => {
    b.classList.toggle("active", (i === 0 && tab === "login") || (i === 1 && tab === "register"));
  });
};

// ── Login ────────────────────────────────────────────────────
window.doLogin = async function() {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-pass").value;
  hideError("login-error");

  if (!email || !pass) { showError("login-error", "Ingresa correo y contraseña."); return; }

  showLoading("Iniciando sesión...");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged se encarga de redirigir
  } catch (e) {
    hideLoading();
    const msg = e.code === "auth/invalid-credential" || e.code === "auth/wrong-password" || e.code === "auth/user-not-found"
      ? "Correo o contraseña incorrectos."
      : "Error al iniciar sesión: " + e.message;
    showError("login-error", msg);
  }
};

// ── Register ─────────────────────────────────────────────────
window.doRegister = async function() {
  const nombre   = document.getElementById("reg-nombre").value.trim();
  const apellido = document.getElementById("reg-apellido").value.trim();
  const tel      = document.getElementById("reg-tel").value.trim();
  const email    = document.getElementById("reg-email").value.trim();
  const pass     = document.getElementById("reg-pass").value;
  hideError("reg-error");

  if (!nombre || !email || !pass) { showError("reg-error", "Completa los campos obligatorios."); return; }
  if (pass.length < 6) { showError("reg-error", "La contraseña debe tener al menos 6 caracteres."); return; }

  showLoading("Creando cuenta...");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      nombre, apellido, tel, email,
      role: "worker",
      createdAt: new Date().toISOString()
    });
    // onAuthStateChanged redirigirá
  } catch (e) {
    hideLoading();
    const msg = e.code === "auth/email-already-in-use"
      ? "Este correo ya está registrado."
      : "Error al registrarse: " + e.message;
    showError("reg-error", msg);
  }
};

// ── Logout ────────────────────────────────────────────────────
window.logout = async function() {
  await signOut(auth);
  showScreen("auth");
  location.reload();
};

// ── Auth state listener (exported for app.js) ─────────────────
export { onAuthStateChanged, getDoc, doc };
