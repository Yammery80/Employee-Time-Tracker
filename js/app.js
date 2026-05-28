// ===== app.js  —  Entry point =====
import { auth, db }  from "./firebase-config.js";
import { onAuthStateChanged, showScreen, showLoading, hideLoading } from "./auth.js";
import { loadWorker } from "./worker.js";
import { loadAdmin, loadEmployeeSelects } from "./admin.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Create default admin on first load ──────────────────────
async function ensureAdminUser() {
  const { createUserWithEmailAndPassword } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const { setDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

  // Try to sign in admin silently; if it fails create it
  const ADMIN_EMAIL = "admin@sistema.com";
  const ADMIN_PASS  = "admin123";

  try {
    const adminDocRef = doc(db, "users", "admin-default");
    const snap = await getDoc(adminDocRef);
    if (!snap.exists()) {
      // First time: create admin auth account
      try {
        const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
        await setDoc(doc(db, "users", cred.user.uid), {
          nombre: "Administrador",
          apellido: "",
          email: ADMIN_EMAIL,
          role: "admin",
          createdAt: new Date().toISOString()
        });
        // Mark as initialized
        await setDoc(adminDocRef, { initialized: true });
      } catch (e) {
        // Admin already exists in Auth — just mark Firestore
        if (e.code === "auth/email-already-in-use") {
          await setDoc(adminDocRef, { initialized: true });
        }
      }
    }
  } catch (e) {
    // Firestore might not be ready yet or rules block anonymous read
    console.warn("ensureAdminUser:", e.message);
  }
}

// ── Auth state change ────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not logged in — show auth screen
    hideLoading();
    showScreen("auth");
    // Try to create default admin in background (first load only)
    ensureAdminUser().catch(() => {});
    return;
  }

  showLoading("Cargando tu perfil...");

  try {
    const userDocRef = doc(db, "users", user.uid);
    const snap       = await getDoc(userDocRef);

    if (!snap.exists()) {
      // Auth user with no Firestore record — sign out
      const { signOut } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      await signOut(auth);
      hideLoading();
      showScreen("auth");
      return;
    }

    const userData = snap.data();

    if (userData.role === "admin") {
      showScreen("admin");
      await loadAdmin();
    } else {
      showScreen("worker");
      await loadWorker(user, userData);
    }
  } catch (e) {
    console.error("Auth state error:", e);
    hideLoading();
    showScreen("auth");
  }

  hideLoading();
});
