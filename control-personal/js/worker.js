// ===== worker.js =====
import { db } from "./firebase-config.js";
import {
  collection, addDoc, doc, updateDoc, getDoc, query,
  where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showLoading, hideLoading } from "./auth.js";

const DAYS   = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00");
  return `${dt.getDate()} de ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
export function fmtMoney(n) { return "$" + parseFloat(n||0).toFixed(2); }
export function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}
export function nowTime() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
}
export function dayName(dateStr) { return DAYS[new Date(dateStr+"T12:00:00").getDay()]; }

// Convierte "HH:MM" a minutos totales
function timeToMins(t) {
  if (!t) return 0;
  const [h,m] = t.split(":").map(Number);
  return h * 60 + m;
}
// Minutos → "Xh Xm"
export function fmtMinutos(mins) {
  if (!mins || mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
// Suma total de minutos de permiso de un array de permisos
export function totalPermisoMins(permisos) {
  if (!permisos?.length) return 0;
  return permisos.reduce((sum, p) => {
    if (p.salida && p.regreso) {
      return sum + (timeToMins(p.regreso) - timeToMins(p.salida));
    }
    return sum;
  }, 0);
}

let currentUser   = null;
let todayRecordId = null;
let todayPermisos = []; // array de {salida, regreso, motivo}
let todayConsumos = []; // array de {monto, motivo}

export function setCurrentUser(u) { currentUser = u; }
export function getCurrentUser()  { return currentUser; }

// ── Load worker screen ──────────────────────────────────────
export async function loadWorker(user, userData) {
  currentUser = { ...userData, uid: user.uid };
  document.getElementById("worker-name-top").textContent = `${userData.nombre} ${userData.apellido||""}`;
  if (userData.localId) {
    try {
      const lSnap = await getDoc(doc(db,"locales",userData.localId));
      if (lSnap.exists()) {
        const lt = document.getElementById("worker-local-tag");
        lt.textContent = lSnap.data().nombre;
        lt.style.display = "inline-flex";
      }
    } catch(e) {}
  }
  workerNavActivate("registro");
  startClock();
  await loadTodayReg();
}

function startClock() {
  function tick() {
    const n = new Date();
    const el = document.getElementById("clock-display");
    if (el) el.textContent = `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}:${String(n.getSeconds()).padStart(2,"0")}`;
    const d = document.getElementById("today-date");
    if (d) d.textContent = fmtDate(todayStr());
    const l = document.getElementById("today-label");
    if (l) l.textContent = dayName(todayStr());
  }
  tick();
  setInterval(tick, 1000);
}

function workerNavActivate(view) {
  document.querySelectorAll("#screen-worker .nav-btn").forEach(b=>b.classList.remove("active"));
  const btn = document.querySelector(`#screen-worker [data-view="${view}"]`);
  if (btn) btn.classList.add("active");
  ["registro","historial","perfil"].forEach(v=>{
    const el = document.getElementById("wv-"+v);
    if (el) el.style.display = v===view ? "block" : "none";
  });
}

window.workerNav = async function(view) {
  workerNavActivate(view);
  if (view==="historial") await renderWorkerHistory();
  if (view==="perfil")    renderWorkerProfile();
};

// ── Today record ────────────────────────────────────────────
async function loadTodayReg() {
  todayRecordId = null;
  todayPermisos = [];
  todayConsumos = [];
  try {
    const q = query(
      collection(db,"records"),
      where("userId","==",currentUser.uid),
      where("fecha","==",todayStr())
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const rec = snap.docs[0];
      todayRecordId = rec.id;
      todayPermisos = rec.data().permisos  || [];
      todayConsumos = rec.data().consumos  || [];
      applyTodayUI(rec.data());
    }
  } catch(e) { console.error(e); }
}

function applyTodayUI(rec) {
  document.getElementById("entrada-val").textContent = rec.entrada || "—";
  document.getElementById("salida-val").textContent  = rec.salida  || "—";
  document.getElementById("btn-entrada").disabled = true;

  const ps = document.getElementById("permiso-section");
  if (ps) ps.style.display = "block";

  if (rec.salida) {
    document.getElementById("btn-salida").disabled = true;
    document.getElementById("btn-permiso-salida").disabled = true;
    document.getElementById("btn-permiso-regreso").disabled = true;

    if (rec.cierreEnviado) {
      document.getElementById("cierre-dia-card").style.display = "none";
      document.getElementById("registro-enviado-card").style.display = "block";
      renderResumenDia(rec);
    } else {
      // Salida anticipada puesta por admin: mostrar aviso y el formulario de cierre
      document.getElementById("cierre-dia-card").style.display = "block";
      if (rec.salidaAnticipada) {
        const msg = document.getElementById("reg-status-msg");
        if (msg) msg.innerHTML = `<div class="alert alert-info" style="margin-bottom:1rem"><i class="ti ti-clock-bolt"></i> Tu hora de salida fue adelantada por el administrador. Completa el formulario de cierre.</div>`;
      }
    }
  } else {
    document.getElementById("btn-salida").disabled = false;
    updatePermisoButtons();
  }

  renderPermisosLog(rec.permisos || []);
  renderConsumosList(rec.consumos || []);
}

// ── Registrar entrada ────────────────────────────────────────
window.registrarEntrada = async function() {
  const time  = nowTime();
  const today = todayStr();
  showLoading("Registrando entrada...");
  try {
    const docRef = await addDoc(collection(db,"records"), {
      userId: currentUser.uid,
      localId: currentUser.localId || null,
      fecha: today,
      dia: dayName(today),
      entrada: time,
      salida: null,
      base: 0, ventas: 0, recargas: 0,
      comentarios: "",
      status: "pendiente",
      cierreEnviado: false,
      permisos: [],
      minutoPermiso: 0,
      consumos: [],
      totalConsumos: 0,
      createdAt: serverTimestamp()
    });
    todayRecordId = docRef.id;
    todayPermisos = [];
    todayConsumos = [];
    document.getElementById("entrada-val").textContent = time;
    document.getElementById("btn-entrada").disabled = true;
    document.getElementById("btn-salida").disabled  = false;
    const ps = document.getElementById("permiso-section");
    if (ps) ps.style.display = "block";
    updatePermisoButtons();
    renderPermisosLog([]);
    renderConsumosList([]);
  } catch(e) { alert("Error al registrar entrada: "+e.message); }
  hideLoading();
};

// ── Registrar salida ─────────────────────────────────────────
window.registrarSalida = async function() {
  if (!todayRecordId) { alert("Primero registra tu entrada."); return; }
  // Verificar que no hay permiso abierto sin regreso
  const permisoAbierto = todayPermisos.find(p => p.salida && !p.regreso);
  if (permisoAbierto) {
    alert("Tienes un permiso de salida activo. Registra tu regreso antes de finalizar el turno.");
    return;
  }
  const time = nowTime();
  showLoading("Registrando salida...");
  try {
    await updateDoc(doc(db,"records",todayRecordId), { salida: time });
    document.getElementById("salida-val").textContent = time;
    document.getElementById("btn-salida").disabled = true;
    document.getElementById("btn-permiso-salida").disabled = true;
    document.getElementById("btn-permiso-regreso").disabled = true;
    document.getElementById("cierre-dia-card").style.display = "block";
  } catch(e) { alert("Error al registrar salida: "+e.message); }
  hideLoading();
};

// ── Permiso: salir ───────────────────────────────────────────
window.registrarPermisoSalida = async function() {
  if (!todayRecordId) { alert("Primero registra tu entrada."); return; }
  const motivo = prompt("Motivo del permiso (opcional):", "") ?? "";
  const time = nowTime();
  todayPermisos.push({ salida: time, regreso: null, motivo });
  showLoading("Registrando permiso...");
  try {
    const totalMins = totalPermisoMins(todayPermisos);
    await updateDoc(doc(db,"records",todayRecordId), {
      permisos: todayPermisos,
      minutoPermiso: totalMins
    });
    updatePermisoButtons();
    renderPermisosLog(todayPermisos);
  } catch(e) {
    todayPermisos.pop(); // revert
    alert("Error: "+e.message);
  }
  hideLoading();
};

// ── Permiso: regresar ────────────────────────────────────────
window.registrarPermisoRegreso = async function() {
  if (!todayRecordId) return;
  const idx = todayPermisos.findIndex(p => p.salida && !p.regreso);
  if (idx < 0) { alert("No hay permiso de salida activo."); return; }
  const time = nowTime();
  todayPermisos[idx].regreso = time;
  showLoading("Registrando regreso...");
  try {
    const totalMins = totalPermisoMins(todayPermisos);
    await updateDoc(doc(db,"records",todayRecordId), {
      permisos: todayPermisos,
      minutoPermiso: totalMins
    });
    updatePermisoButtons();
    renderPermisosLog(todayPermisos);
  } catch(e) {
    todayPermisos[idx].regreso = null; // revert
    alert("Error: "+e.message);
  }
  hideLoading();
};

// ── UI helpers para permisos ─────────────────────────────────
function updatePermisoButtons() {
  const abierto = todayPermisos.find(p => p.salida && !p.regreso);
  const btnSalida  = document.getElementById("btn-permiso-salida");
  const btnRegreso = document.getElementById("btn-permiso-regreso");
  const estadoTxt  = document.getElementById("permiso-estado-txt");
  if (!btnSalida) return;

  if (abierto) {
    btnSalida.disabled  = true;
    btnRegreso.disabled = false;
    estadoTxt.textContent = `Fuera desde ${abierto.salida}${abierto.motivo ? " · "+abierto.motivo : ""}`;
    estadoTxt.style.color = "var(--warning-text)";
  } else {
    btnSalida.disabled  = false;
    btnRegreso.disabled = true;
    const total = totalPermisoMins(todayPermisos);
    estadoTxt.textContent = todayPermisos.length > 0
      ? `${todayPermisos.length} permiso(s) · ${fmtMinutos(total)} fuera en total`
      : "Sin permiso activo";
    estadoTxt.style.color = "";
  }
}

function renderPermisosLog(permisos) {
  const el = document.getElementById("permisos-log");
  if (!el) return;
  if (!permisos.length) { el.innerHTML = ""; return; }

  const rows = permisos.map((p, i) => {
    const mins = p.salida && p.regreso ? timeToMins(p.regreso) - timeToMins(p.salida) : null;
    const duracion = mins !== null ? `<span style="color:var(--warning-text);font-weight:600">${fmtMinutos(mins)}</span>` : `<span style="color:var(--warning-text);animation:pulse 1.5s infinite">Fuera…</span>`;
    return `<tr>
      <td style="color:var(--text-muted);font-size:11px">#${i+1}</td>
      <td>${p.salida}</td>
      <td>${p.regreso || "—"}</td>
      <td>${duracion}</td>
      <td class="text-muted small">${p.motivo || "—"}</td>
    </tr>`;
  }).join("");

  const totalMins = totalPermisoMins(permisos);
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">
      Registro de permisos
    </div>
    <div class="table-wrap">
      <table style="font-size:12px">
        <thead><tr>
          <th>#</th><th>Salida</th><th>Regreso</th><th>Tiempo fuera</th><th>Motivo</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${totalMins > 0 ? `<div style="margin-top:8px;font-size:12px;color:var(--warning-text)"><i class="ti ti-clock-pause"></i> Tiempo total fuera: <strong>${fmtMinutos(totalMins)}</strong></div>` : ""}`;
}

// ── Enviar cierre ────────────────────────────────────────────
window.enviarCierre = async function() {
  if (!todayRecordId) return;
  const base        = parseFloat(document.getElementById("f-base").value)||0;
  const ventas      = parseFloat(document.getElementById("f-ventas").value)||0;
  const recargas    = parseFloat(document.getElementById("f-recargas").value)||0;
  const comentarios = document.getElementById("f-comentarios").value;
  const totalConsumos = todayConsumos.reduce((s,c)=>s+parseFloat(c.monto||0),0);
  showLoading("Enviando registro...");
  try {
    await updateDoc(doc(db,"records",todayRecordId), {
      base, ventas, recargas, comentarios,
      consumos: todayConsumos,
      totalConsumos,
      cierreEnviado: true,
      cierreAt: serverTimestamp()
    });
    document.getElementById("cierre-dia-card").style.display = "none";
    document.getElementById("registro-enviado-card").style.display = "block";
    renderResumenDia({
      base, ventas, recargas, totalConsumos,
      entrada: document.getElementById("entrada-val").textContent,
      salida:  document.getElementById("salida-val").textContent,
      permisos: todayPermisos,
      consumos: todayConsumos
    });
  } catch(e) { alert("Error al enviar cierre: "+e.message); }
  hideLoading();
};

function renderResumenDia(rec) {
  const totalMins = totalPermisoMins(rec.permisos || []);
  const totalCons = parseFloat(rec.totalConsumos||0);
  document.getElementById("resumen-dia").innerHTML = `
    <div class="grid-4" style="margin-top:1rem">
      <div class="metric"><div class="metric-val blue">${rec.entrada}</div><div class="metric-lbl">Entrada</div></div>
      <div class="metric"><div class="metric-val blue">${rec.salida||"—"}</div><div class="metric-lbl">Salida</div></div>
      <div class="metric"><div class="metric-val green">${fmtMoney(rec.ventas)}</div><div class="metric-lbl">Ventas</div></div>
      <div class="metric"><div class="metric-val" style="color:var(--danger-text)">${totalCons > 0 ? fmtMoney(totalCons) : "—"}</div><div class="metric-lbl">Consumos</div></div>
    </div>`;
}

// ── Consumos del local ────────────────────────────────────────
window.agregarConsumo = function() {
  const motivo = prompt("¿Qué tomaste del local?");
  if (motivo === null) return; // cancelado
  const montoStr = prompt(`Monto de "${motivo}" ($):`);
  if (montoStr === null) return;
  const monto = parseFloat(montoStr);
  if (isNaN(monto) || monto <= 0) { alert("Ingresa un monto válido mayor a 0."); return; }
  todayConsumos.push({ motivo: motivo || "Sin descripción", monto });
  renderConsumosList(todayConsumos);
  // Guardar en Firestore en tiempo real
  if (todayRecordId) {
    const total = todayConsumos.reduce((s,c)=>s+parseFloat(c.monto||0),0);
    updateDoc(doc(db,"records",todayRecordId), {
      consumos: todayConsumos,
      totalConsumos: total
    }).catch(e => console.error("Error guardando consumo:", e));
  }
};

window.eliminarConsumo = function(idx) {
  todayConsumos.splice(idx, 1);
  renderConsumosList(todayConsumos);
  if (todayRecordId) {
    const total = todayConsumos.reduce((s,c)=>s+parseFloat(c.monto||0),0);
    updateDoc(doc(db,"records",todayRecordId), {
      consumos: todayConsumos,
      totalConsumos: total
    }).catch(e => console.error("Error eliminando consumo:", e));
  }
};

function renderConsumosList(consumos) {
  const el    = document.getElementById("consumos-list");
  const telEl = document.getElementById("consumos-total");
  if (!el) return;
  if (!consumos.length) {
    el.innerHTML = '<div class="small text-muted" style="margin-bottom:.5rem">Sin consumos registrados.</div>';
    if (telEl) telEl.style.display = "none";
    return;
  }
  const total = consumos.reduce((s,c)=>s+parseFloat(c.monto||0),0);
  el.innerHTML = consumos.map((c,i)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg-secondary);border-radius:var(--radius);margin-bottom:6px;border:1px solid var(--border)">
      <div>
        <span style="font-size:13px">${c.motivo}</span>
        <span style="font-size:12px;color:var(--danger-text);font-weight:600;margin-left:8px">${fmtMoney(c.monto)}</span>
      </div>
      <button onclick="eliminarConsumo(${i})" style="background:none;border:none;cursor:pointer;color:var(--danger-text);padding:2px 6px;font-size:16px;line-height:1" title="Eliminar">×</button>
    </div>`).join("");
  if (telEl) {
    telEl.textContent = `Total consumos: ${fmtMoney(total)} — se descontará de tu pago del día`;
    telEl.style.display = "block";
  }
}

// ── Historial ────────────────────────────────────────────────
async function renderWorkerHistory() {
  const el = document.getElementById("worker-history-table");
  el.innerHTML = '<div class="empty">Cargando...</div>';
  try {
    const q = query(collection(db,"records"), where("userId","==",currentUser.uid));
    const snap = await getDocs(q);
    if (snap.empty) { el.innerHTML='<div class="empty">No hay registros aún.</div>'; return; }
    const docs = snap.docs.map(d=>d.data()).sort((a,b)=>b.fecha.localeCompare(a.fecha));
    const rows = docs.map(r => {
      const permMins = totalPermisoMins(r.permisos);
      const permCell = permMins > 0
        ? `<span style="color:var(--warning-text)">${fmtMinutos(permMins)}</span>`
        : "—";
      return `<tr>
        <td>${fmtDate(r.fecha)}</td><td>${r.dia}</td>
        <td>${r.entrada}</td><td>${r.salida||"—"}</td>
        <td>${fmtMoney(r.ventas)}</td>
        <td>${permCell}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
      </tr>`;
    }).join("");
    el.innerHTML=`<div class="table-wrap"><table><thead><tr>
      <th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th><th>Ventas</th><th>Permiso</th><th>Estado</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch(e) { el.innerHTML=`<div class="empty">Error: ${e.message}</div>`; console.error(e); }
}

function renderWorkerProfile() {
  const u = currentUser;
  document.getElementById("worker-profile-view").innerHTML=`
    <div class="grid-2">
      <div class="form-group"><label>Nombre</label><input value="${u.nombre}" disabled></div>
      <div class="form-group"><label>Apellido</label><input value="${u.apellido||""}" disabled></div>
    </div>
    <div class="form-group"><label>Correo electrónico</label><input value="${u.email}" disabled></div>
    <div class="form-group"><label>Teléfono</label><input value="${u.tel||""}" disabled></div>`;
}
