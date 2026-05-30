// ===== admin.js =====
import { db } from "./firebase-config.js";
import {
  collection, doc, updateDoc, getDocs, getDoc,
  query, where, orderBy, setDoc, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showLoading, hideLoading } from "./auth.js";
import { fmtDate, fmtMoney, fmtMinutos, totalPermisoMins } from "./worker.js";

export let lastCalcData = null;

// ── Load admin ──────────────────────────────────────────────
export async function loadAdmin() {
  adminNavActivate("aprobaciones");
  await Promise.all([updateNotifCount(), loadEmployeeSelects(), loadLocalSelects()]);
  await renderPending();
}

// ── Nav ─────────────────────────────────────────────────────
function adminNavActivate(view) {
  document.querySelectorAll("#screen-admin .nav-btn").forEach(b => b.classList.remove("active"));
  const btn = document.querySelector(`#screen-admin [data-view="${view}"]`);
  if (btn) btn.classList.add("active");
  ["aprobaciones","registros","sueldos","locales","empleadas"].forEach(v => {
    const el = document.getElementById("av-" + v);
    if (el) el.style.display = v === view ? "block" : "none";
  });
}

window.adminNav = async function(view) {
  adminNavActivate(view);
  if (view === "aprobaciones") await renderPending();
  if (view === "registros")    { await loadLocalSelects(); await loadAllRecords(); }
  if (view === "sueldos")      await loadSueldosView();
  if (view === "locales")      await loadLocalesView();
  if (view === "empleadas")    { await loadLocalFilterSelect(); await renderEmployees(); }
};

// ── Notif ────────────────────────────────────────────────────
async function updateNotifCount() {
  try {
    // Avoid composite index: filter cierreEnviado client-side
    const q = query(collection(db, "records"), where("status","==","pendiente"));
    const snap = await getDocs(q);
    const n = snap.docs.filter(d => d.data().cierreEnviado).length;
    document.getElementById("notif-count").textContent = n > 0 ? `${n} pendiente${n>1?"s":""}` : "";
    document.getElementById("notif-badge").innerHTML   = n > 0 ? '<span class="notif-dot"></span>' : "";
  } catch(e) { console.error(e); }
}

// ── Pending approvals ────────────────────────────────────────
async function renderPending() {
  const el = document.getElementById("pending-table");
  el.innerHTML = '<div class="empty">Cargando...</div>';
  try {
    const q = query(collection(db, "records"), where("status","==","pendiente"));
    const snap = await getDocs(q);
    // Filter client-side to avoid composite index requirement
    const docs = snap.docs.filter(d => d.data().cierreEnviado)
      .sort((a,b) => b.data().fecha.localeCompare(a.data().fecha));

    if (!docs.length) { el.innerHTML = '<div class="empty">No hay registros pendientes de aprobación.</div>'; return; }

    const rows = await Promise.all(docs.map(async d => {
      const r = d.data();
      const [name, localName] = await Promise.all([getUserName(r.userId), getLocalName(r.localId)]);
      const permMins = totalPermisoMins(r.permisos);
      const permCell = permMins > 0 ? `<span style="color:var(--warning-text)">${fmtMinutos(permMins)}</span>` : "—";
      const anticipadoTag = r.esAnticipado ? ' <span class="badge badge-anticipado" style="font-size:9px">anticipado</span>' : "";
      return `<tr>
        <td>${name}${anticipadoTag}</td>
        <td>${localName ? `<span class="local-tag"><i class="ti ti-building-store"></i>${localName}</span>` : "—"}</td>
        <td>${fmtDate(r.fecha)}</td><td>${r.dia}</td>
        <td>${r.entrada}</td><td>${r.salida||"—"}</td>
        <td>${fmtMoney(r.ventas)}</td><td>${fmtMoney(r.recargas)}</td>
        <td>${permCell}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.comentarios||""}">${r.comentarios||"—"}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" title="Ajustar horas" onclick="openEditModal('${d.id}','${r.fecha}','${r.entrada||""}','${r.salida||""}')" style="padding:5px 8px;border-color:var(--jungle-mid);color:var(--jungle-pale)"><i class="ti ti-pencil"></i></button>
          <button class="btn btn-success btn-sm" onclick="approveRecord('${d.id}',true)"><i class="ti ti-check"></i> Aprobar</button>
          <button class="btn btn-danger btn-sm" onclick="approveRecord('${d.id}',false)"><i class="ti ti-x"></i> Rechazar</button>
        </div></td>
      </tr>`;
    }));

    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Empleada</th><th>Local</th><th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th>
      <th>Ventas</th><th>Recargas</th><th>Permiso</th><th>Comentarios</th><th>Acciones</th>
    </tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  } catch(e) { el.innerHTML = '<div class="empty">Error al cargar.</div>'; console.error(e); }
}

window.approveRecord = async function(id, approve) {
  showLoading(approve ? "Aprobando..." : "Rechazando...");
  try {
    await updateDoc(doc(db, "records", id), { status: approve ? "aprobado" : "rechazado" });
    await renderPending();
    await updateNotifCount();
  } catch(e) { alert("Error: " + e.message); }
  hideLoading();
};

// ── All records ──────────────────────────────────────────────
window.loadAllRecords = async function() {
  const el = document.getElementById("all-records-table");
  el.innerHTML = '<div class="empty">Cargando...</div>';

  // Auto-limpiar registros >30 días cada vez que se abre esta vista
  await autoCleanOldRecords();

  const emp    = document.getElementById("filter-emp").value;
  const local  = document.getElementById("filter-local")?.value || "";
  const from   = document.getElementById("filter-from").value;
  const to     = document.getElementById("filter-to").value;
  const status = document.getElementById("filter-status").value;
  try {
    // Fetch all then filter client-side to avoid composite index issues
    let allDocs = (await getDocs(collection(db, "records"))).docs.map(d=>({id:d.id,...d.data()}));
    if (emp)    allDocs = allDocs.filter(r=>r.userId===emp);
    if (local)  allDocs = allDocs.filter(r=>r.localId===local);
    if (from)   allDocs = allDocs.filter(r=>r.fecha>=from);
    if (to)     allDocs = allDocs.filter(r=>r.fecha<=to);
    if (status) allDocs = allDocs.filter(r=>r.status===status);
    allDocs.sort((a,b)=>b.fecha.localeCompare(a.fecha));

    if (!allDocs.length) { el.innerHTML = '<div class="empty">No hay registros con esos filtros.</div>'; return; }

    const rows = await Promise.all(allDocs.map(async r => {
      const [name, localName] = await Promise.all([getUserName(r.userId), getLocalName(r.localId)]);
      const permMins = totalPermisoMins(r.permisos);
      const permCell = permMins > 0 ? `<span style="color:var(--warning-text)">${fmtMinutos(permMins)}</span>` : "—";
      const statusBadge = r.esAnticipado
        ? `<span class="badge badge-anticipado">anticipado</span>`
        : `<span class="badge badge-${r.status}">${r.status}</span>`;
      const ajustadoTag = r.ajustado && !r.esAnticipado
        ? ` <span title="Horas ajustadas por admin${r.ajusteMotivo?': '+r.ajusteMotivo:''}" style="font-size:10px;color:var(--jungle-light);cursor:help"><i class="ti ti-edit"></i></span>`
        : "";
      const adminTag = r.agregadoPorAdmin
        ? ` <span title="Día agregado por admin" style="font-size:10px;color:var(--jungle-pale);cursor:help"><i class="ti ti-shield"></i></span>`
        : "";
      const editBtn   = `<button class="btn btn-sm" title="Editar horas" onclick="openEditModal('${r.id}','${r.fecha}','${r.entrada||""}','${r.salida||""}')" style="padding:4px 8px;border-color:var(--jungle-mid);color:var(--jungle-pale)"><i class="ti ti-pencil"></i></button>`;
      const statusBtn = `<button class="btn btn-sm" title="Cambiar estado" onclick="changeRecordStatus('${r.id}','${r.status}')" style="padding:4px 8px;border-color:var(--border);color:var(--text-muted)"><i class="ti ti-refresh"></i></button>`;
      return `<tr>
        <td>${name}${ajustadoTag}${adminTag}</td>
        <td>${localName ? `<span class="local-tag">${localName}</span>` : "—"}</td>
        <td>${fmtDate(r.fecha)}</td><td>${r.dia}</td>
        <td>${r.entrada||"—"}</td><td>${r.salida||"—"}</td>
        <td>${fmtMoney(r.ventas)}</td><td>${fmtMoney(r.recargas)}</td>
        <td>${fmtMoney(r.base)}</td>
        <td>${permCell}</td>
        <td>${statusBadge}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.comentarios||""}">${r.comentarios||"—"}</td>
        <td><div class="row-actions">${editBtn}${statusBtn}</div></td>
      </tr>`;
    }));
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Empleada</th><th>Local</th><th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th>
      <th>Ventas</th><th>Recargas</th><th>Base</th><th>Permiso</th><th>Estado</th><th>Notas</th><th></th>
    </tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  } catch(e) { el.innerHTML='<div class="empty">Error al cargar.</div>'; console.error(e); }
};

// ── Employee selects ─────────────────────────────────────────
export async function loadEmployeeSelects() {
  try {
    const snap = await getDocs(query(collection(db,"users"), where("role","==","worker")));
    const html = snap.docs.map(d=>`<option value="${d.id}">${d.data().nombre} ${d.data().apellido||""}</option>`).join("");
    ["filter-emp","sal-emp","calc-emp","assign-emp"].forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = id==="filter-emp" ? `<option value="">Todas</option>${html}` : (html||`<option value="">Sin empleadas</option>`);
    });
  } catch(e) { console.error(e); }
}

// ── Local selects ─────────────────────────────────────────────
export async function loadLocalSelects() {
  try {
    const snap = await getDocs(collection(db,"locales"));
    const html = snap.docs.map(d=>`<option value="${d.id}">${d.data().nombre}</option>`).join("");
    ["filter-local","assign-local"].forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = id==="filter-local" ? `<option value="">Todos</option>${html}` : (html||`<option value="">Sin locales</option>`);
    });
  } catch(e) { console.error(e); }
}

async function loadLocalFilterSelect() {
  const el = document.getElementById("emp-filter-local");
  if (!el) return;
  try {
    const snap = await getDocs(collection(db,"locales"));
    el.innerHTML = `<option value="">Todos los locales</option>` +
      snap.docs.map(d=>`<option value="${d.id}">${d.data().nombre}</option>`).join("");
  } catch(e) {}
}

// ── Salaries ──────────────────────────────────────────────────
async function loadSueldosView() {
  await loadEmployeeSelects();
  await renderSalaryHistory();
  loadCurrentSalary();
}

window.loadCurrentSalary = async function() {
  const emp = document.getElementById("sal-emp")?.value;
  if (!emp) return;
  try {
    const snap = await getDoc(doc(db,"salaries",emp));
    document.getElementById("sal-amount").value = snap.exists() ? snap.data().amount : "";
  } catch(e) {}
};

window.saveSalary = async function() {
  const emp = document.getElementById("sal-emp").value;
  const amt = parseFloat(document.getElementById("sal-amount").value) || 0;
  if (!emp) { alert("Selecciona una empleada."); return; }
  showLoading("Guardando sueldo...");
  try {
    await setDoc(doc(db,"salaries",emp), { amount: amt, updatedAt: serverTimestamp() });
    alert("Sueldo guardado correctamente.");
  } catch(e) { alert("Error: " + e.message); }
  hideLoading();
};

window.calcWeekly = function() {
  const today = new Date();
  const day = today.getDay();
  const mon = new Date(today); mon.setDate(today.getDate() - (day===0?6:day-1));
  const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
  const fmt = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  document.getElementById("calc-from").value = fmt(mon);
  document.getElementById("calc-to").value   = fmt(sun);
  calcSalary();
};

window.calcSalary = async function() {
  const empId = document.getElementById("calc-emp").value;
  const from  = document.getElementById("calc-from").value;
  const to    = document.getElementById("calc-to").value;
  const descontarPermiso = document.getElementById("calc-descontar-permiso")?.checked || false;
  if (!empId||!from||!to) { alert("Selecciona empleada y rango de fechas."); return; }
  showLoading("Calculando...");
  try {
    const [salSnap, userSnap] = await Promise.all([
      getDoc(doc(db,"salaries",empId)),
      getDoc(doc(db,"users",empId))
    ]);
    const tarifaHora = salSnap.exists() ? parseFloat(salSnap.data().amount) : 0;
    const u = userSnap.exists() ? userSnap.data() : {};

    const allRecs = (await getDocs(query(collection(db,"records"), where("userId","==",empId)))).docs
      .map(d=>({id:d.id,...d.data()}))
      .filter(r=>r.status==="aprobado" && r.fecha>=from && r.fecha<=to)
      .sort((a,b)=>a.fecha.localeCompare(b.fecha));

    const diasTrabajados = allRecs.length;
    const totalVentas    = allRecs.reduce((s,r)=>s+parseFloat(r.ventas||0),0);
    const totalRecargas  = allRecs.reduce((s,r)=>s+parseFloat(r.recargas||0),0);
    const totalPermisoMinsTotales = allRecs.reduce((s,r)=>s+(r.minutoPermiso||0),0);
    const totalConsumosGlobal = allRecs.reduce((s,r)=>s+parseFloat(r.totalConsumos||0),0);

    let totalPago    = 0;
    let totalMinsTrabajados = 0;

    const recsConPago = allRecs.map(r => {
      const minsBrutos   = calcMinsBetween(r.entrada, r.salida);
      const permMins     = r.minutoPermiso || 0;
      const minsNetos    = descontarPermiso ? Math.max(0, minsBrutos - permMins) : minsBrutos;
      const horasNetas   = minsNetos / 60;
      const pagoHoras    = tarifaHora * horasNetas;
      const consumosDia  = parseFloat(r.totalConsumos || 0);
      const pagoDia      = Math.max(0, pagoHoras - consumosDia);
      const descuento    = descontarPermiso ? tarifaHora * (permMins/60) : 0;

      totalPago += pagoDia;
      totalMinsTrabajados += minsNetos;

      return { ...r, minsBrutos, minsNetos, horasNetas, pagoHoras, pagoDia, descuento, permMins, consumosDia };
    });

    const totalHorasTrabajadas = totalMinsTrabajados / 60;

    lastCalcData = {
      empId, empName:`${u.nombre||""} ${u.apellido||""}`.trim(),
      from, to, tarifaHora, diasTrabajados,
      totalHorasTrabajadas, totalPago,
      totalVentas, totalRecargas, totalPermisoMinsTotales, totalConsumosGlobal,
      descontarPermiso, records: recsConPago, userData: u
    };

    const tableRows = await Promise.all(recsConPago.map(async r => {
      const localName   = await getLocalName(r.localId);
      const brutoStr    = fmtHoras(r.minsBrutos);
      const netosStr    = r.minsNetos !== r.minsBrutos
        ? `<span style="color:var(--jungle-light)">${fmtHoras(r.minsNetos)}</span>`
        : fmtHoras(r.minsNetos);
      const permCell    = r.permMins > 0
        ? `<span style="color:var(--warning-text)">-${fmtMinutos(r.permMins)}</span>`
        : "—";
      const consumoCell = r.consumosDia > 0
        ? `<span style="color:var(--danger-text);font-weight:600">-${fmtMoney(r.consumosDia)}</span>`
        : "—";
      const consumosTip = (r.consumos||[]).map(c=>`${c.motivo}: ${fmtMoney(c.monto)}`).join(" | ");
      return `<tr>
        <td>${fmtDate(r.fecha)}</td>
        <td>${r.dia}</td>
        <td>${localName ? `<span class="local-tag">${localName}</span>` : "—"}</td>
        <td>${r.entrada||"—"}</td>
        <td>${r.salida||"—"}</td>
        <td>${brutoStr}</td>
        <td>${permCell}</td>
        <td>${netosStr}</td>
        <td title="${consumosTip}">${consumoCell}</td>
        <td><strong>${fmtMoney(r.pagoDia)}</strong></td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis">${r.comentarios||"—"}</td>
      </tr>`;
    }));

    document.getElementById("calc-result-content").innerHTML = `
      <div class="grid-4" style="margin-bottom:1rem">
        <div class="metric"><div class="metric-val blue">${diasTrabajados}</div><div class="metric-lbl">Días trabajados</div></div>
        <div class="metric"><div class="metric-val blue">${fmtHoras(totalMinsTrabajados)}</div><div class="metric-lbl">Horas pagadas</div></div>
        <div class="metric"><div class="metric-val" style="color:var(--danger-text)">${totalConsumosGlobal > 0 ? "-"+fmtMoney(totalConsumosGlobal) : "—"}</div><div class="metric-lbl">Total consumos</div></div>
        <div class="metric"><div class="metric-val green">${fmtMoney(totalPago)}</div><div class="metric-lbl">Total a pagar</div></div>
      </div>
      ${descontarPermiso && totalPermisoMinsTotales > 0 ? `<div class="alert alert-info" style="margin-bottom:1rem"><i class="ti ti-info-circle"></i> Permisos descontados: <strong>${fmtMinutos(totalPermisoMinsTotales)}</strong> del tiempo pagado.</div>` : ""}
      ${totalConsumosGlobal > 0 ? `<div class="alert alert-danger" style="margin-bottom:1rem"><i class="ti ti-shopping-bag"></i> Consumos del periodo: <strong>-${fmtMoney(totalConsumosGlobal)}</strong> descontados del pago.</div>` : ""}
      <div class="table-wrap"><table><thead><tr>
        <th>Fecha</th><th>Día</th><th>Local</th><th>Entrada</th><th>Salida</th>
        <th>Hrs brutas</th><th>Permiso</th><th>Hrs pagadas</th><th>Consumos</th><th>Pago día</th><th>Notas</th>
      </tr></thead><tbody>
        ${tableRows.join("")||'<tr><td colspan="11" class="empty">Sin registros aprobados en este periodo</td></tr>'}
      </tbody></table></div>`;
    document.getElementById("calc-result").style.display = "block";
  } catch(e) { alert("Error al calcular: " + e.message); console.error(e); }
  hideLoading();
};

window.saveCalcHistory = async function() {
  if (!lastCalcData) { alert("Primero realiza un cálculo."); return; }
  showLoading("Guardando...");
  try {
    await addDoc(collection(db,"salary_history"), { ...lastCalcData, savedAt: serverTimestamp() });
    await renderSalaryHistory();
    alert("Cálculo guardado en historial.");
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

async function renderSalaryHistory() {
  const el = document.getElementById("salary-history");
  if (!el) return;
  try {
    // Auto-clear records older than 1 month
    await autoCleanSalaryHistory();
    const snap = await getDocs(collection(db,"salary_history"));
    const docs = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.savedAt?.seconds||0)-(a.savedAt?.seconds||0));
    if (!docs.length) { el.innerHTML='<div class="empty">No hay cálculos guardados.</div>'; return; }
    const rows = docs.map(h=>`<tr>
      <td>${h.empName}</td>
      <td>${fmtDate(h.from)} – ${fmtDate(h.to)}</td>
      <td>${h.diasTrabajados}</td>
      <td>${h.totalHorasTrabajadas ? (h.totalHorasTrabajadas).toFixed(1)+"h" : "—"}</td>
      <td>${fmtMoney(h.totalPago)}</td>
      <td><div class="row-actions">
        <button class="btn btn-primary btn-sm" onclick="loadHistoryCalc('${h.id}')"><i class="ti ti-file-download"></i> PDF</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSalaryHistory('${h.id}')"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join("");
    el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Empleada</th><th>Periodo</th><th>Días</th><th>Hrs pagadas</th><th>Total</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch(e) { console.error(e); }
}

// Auto-delete salary_history older than 1 month
async function autoCleanSalaryHistory() {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const cutoff = oneMonthAgo.getTime() / 1000; // Firestore timestamp seconds
    const snap = await getDocs(collection(db,"salary_history"));
    const toDelete = snap.docs.filter(d => {
      const s = d.data().savedAt?.seconds;
      return s && s < cutoff;
    });
    await Promise.all(toDelete.map(d => deleteDoc(doc(db,"salary_history",d.id))));
    if (toDelete.length > 0) console.log(`Auto-eliminados ${toDelete.length} registros de historial antiguos.`);
  } catch(e) { console.warn("autoClean error:", e); }
}

window.deleteSalaryHistory = async function(id) {
  if (!confirm("¿Eliminar este registro del historial?")) return;
  showLoading("Eliminando...");
  try {
    await deleteDoc(doc(db,"salary_history",id));
    await renderSalaryHistory();
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

window.loadHistoryCalc = async function(docId) {
  showLoading("Cargando...");
  try {
    const snap = await getDoc(doc(db,"salary_history",docId));
    if (snap.exists()) { lastCalcData=snap.data(); window.generatePDF(); }
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

// ── Locales ───────────────────────────────────────────────────
async function loadLocalesView() {
  await loadEmployeeSelects();
  await loadLocalSelects();
  await renderLocalesList();
}

async function renderLocalesList() {
  const el = document.getElementById("locales-list");
  try {
    const snap = await getDocs(collection(db,"locales"));
    if (snap.empty) { el.innerHTML='<div class="empty">No hay locales. Agrega el primero.</div>'; return; }
    const rows = snap.docs.map(d=>{
      const l=d.data();
      return `<tr>
        <td><strong>${l.nombre}</strong></td>
        <td class="text-muted small">${l.direccion||"—"}</td>
        <td class="text-muted small">${l.descripcion||"—"}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteLocal('${d.id}')"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    }).join("");
    el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Dirección</th><th>Descripción</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch(e) { el.innerHTML='<div class="empty">Error al cargar.</div>'; }
}

window.saveLocal = async function() {
  const nombre = document.getElementById("local-nombre").value.trim();
  if (!nombre) { alert("El nombre del local es obligatorio."); return; }
  const dir  = document.getElementById("local-dir").value.trim();
  const desc = document.getElementById("local-desc").value.trim();
  showLoading("Guardando local...");
  try {
    await addDoc(collection(db,"locales"), { nombre, direccion:dir, descripcion:desc, createdAt:serverTimestamp() });
    document.getElementById("local-nombre").value="";
    document.getElementById("local-dir").value="";
    document.getElementById("local-desc").value="";
    await renderLocalesList();
    await loadLocalSelects();
    alert("Local agregado correctamente.");
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

window.deleteLocal = async function(id) {
  if (!confirm("¿Eliminar este local?")) return;
  showLoading("Eliminando...");
  try {
    await deleteDoc(doc(db,"locales",id));
    await renderLocalesList();
    await loadLocalSelects();
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

window.assignLocal = async function() {
  const empId   = document.getElementById("assign-emp").value;
  const localId = document.getElementById("assign-local").value;
  if (!empId||!localId) { alert("Selecciona empleada y local."); return; }
  showLoading("Asignando...");
  try {
    await updateDoc(doc(db,"users",empId), { localId });
    alert("Empleada asignada al local correctamente.");
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

// ── Employees list ────────────────────────────────────────────
window.renderEmployees = async function() {
  const el = document.getElementById("emp-list-table");
  el.innerHTML='<div class="empty">Cargando...</div>';
  const filterLocal = document.getElementById("emp-filter-local")?.value||"";
  try {
    const [workersSnap, salsSnap, recsSnap, localesSnap] = await Promise.all([
      getDocs(query(collection(db,"users"),where("role","==","worker"))),
      getDocs(collection(db,"salaries")),
      getDocs(collection(db,"records")),
      getDocs(collection(db,"locales"))
    ]);
    if (workersSnap.empty) { el.innerHTML='<div class="empty">No hay empleadas registradas.</div>'; return; }
    const sals={};salsSnap.docs.forEach(d=>sals[d.id]=d.data().amount);
    const localesMap={};localesSnap.docs.forEach(d=>localesMap[d.id]=d.data().nombre);
    const allRecs=recsSnap.docs.map(d=>d.data());
    let workers=workersSnap.docs;
    if (filterLocal) workers=workers.filter(d=>d.data().localId===filterLocal);
    if (!workers.length) { el.innerHTML='<div class="empty">No hay empleadas en este local.</div>'; return; }
    const rows=workers.map(d=>{
      const u=d.data();
      const total=allRecs.filter(r=>r.userId===d.id).length;
      const aprobados=allRecs.filter(r=>r.userId===d.id&&r.status==="aprobado").length;
      const localName=u.localId?localesMap[u.localId]||"—":"—";
      const uid = d.id;
      const passDisplay = u.pass
        ? `<span style="display:flex;align-items:center;gap:6px">
            <span id="pass-${uid}" style="font-family:monospace;letter-spacing:2px;font-size:13px">••••••••</span>
            <button onclick="togglePass('${uid}','${u.pass}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;line-height:1" title="Mostrar/ocultar contraseña">
              <i class="ti ti-eye" id="eye-${uid}"></i>
            </button>
            <button onclick="setStoredPass('${uid}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;line-height:1" title="Actualizar contraseña guardada">
              <i class="ti ti-pencil" style="font-size:13px"></i>
            </button>
          </span>`
        : `<span style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--text-muted);font-size:12px">No guardada</span>
            <button onclick="setStoredPass('${uid}')" style="background:none;border:none;cursor:pointer;color:var(--jungle-light);padding:2px;line-height:1" title="Guardar contraseña">
              <i class="ti ti-plus" style="font-size:13px"></i>
            </button>
          </span>`;
      return `<tr>
        <td>${u.nombre} ${u.apellido||""}</td>
        <td class="text-muted small">${u.email}</td>
        <td>${u.tel||"—"}</td>
        <td>${passDisplay}</td>
        <td><span class="local-tag">${localName}</span></td>
        <td>${fmtMoney(sals[d.id]||0)}</td>
        <td>${total}</td><td>${aprobados}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteEmployee('${uid}','${u.nombre} ${u.apellido||""}')"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    }).join("");
    el.innerHTML=`<div class="table-wrap"><table><thead><tr>
      <th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Contraseña</th>
      <th>Local</th><th>Tarifa/hr</th><th>Registros</th><th>Aprobados</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch(e) { el.innerHTML='<div class="empty">Error al cargar.</div>'; console.error(e); }
};

// ── Toggle password visibility ────────────────────────────────
window.togglePass = function(uid, pass) {
  const el  = document.getElementById("pass-"+uid);
  const eye = document.getElementById("eye-"+uid);
  if (!el) return;
  if (el.textContent === "••••••••") {
    el.textContent = pass;
    el.style.letterSpacing = "normal";
    eye.className = "ti ti-eye-off";
  } else {
    el.textContent = "••••••••";
    el.style.letterSpacing = "2px";
    eye.className = "ti ti-eye";
  }
};

// ── Set/update stored password for employee ───────────────────
window.setStoredPass = async function(uid) {
  const newPass = prompt("Ingresa la contraseña actual de la empleada para guardarla\n(mínimo 6 caracteres):");
  if (!newPass) return;
  if (newPass.length < 6) { alert("La contraseña debe tener al menos 6 caracteres."); return; }
  showLoading("Guardando...");
  try {
    await updateDoc(doc(db,"users",uid), { pass: newPass });
    await window.renderEmployees();
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

// ── Delete employee ───────────────────────────────────────────
window.deleteEmployee = async function(uid, nombre) {
  if (!confirm(`¿Eliminar a "${nombre}"?\n\nSe eliminarán también todos sus registros y sueldo asignado. Esta acción no se puede deshacer.`)) return;
  showLoading("Eliminando empleada...");
  try {
    // Delete user doc
    await deleteDoc(doc(db,"users",uid));
    // Delete salary
    try { await deleteDoc(doc(db,"salaries",uid)); } catch(e){}
    // Delete all records
    const recsSnap = await getDocs(query(collection(db,"records"), where("userId","==",uid)));
    await Promise.all(recsSnap.docs.map(d => deleteDoc(doc(db,"records",d.id))));
    delete nameCache[uid];
    await renderEmployees();
    await loadEmployeeSelects();
    alert(`Empleada "${nombre}" eliminada correctamente.`);
  } catch(e) { alert("Error: "+e.message); console.error(e); }
  hideLoading();
};

// ── Helpers cache ─────────────────────────────────────────────
const nameCache={}, localCache={};

async function getUserName(uid) {
  if (!uid) return "Desconocida";
  if (nameCache[uid]) return nameCache[uid];
  try {
    const snap=await getDoc(doc(db,"users",uid));
    const n=snap.exists()?`${snap.data().nombre} ${snap.data().apellido||""}`.trim():"Desconocida";
    nameCache[uid]=n; return n;
  } catch { return "Desconocida"; }
}

async function getLocalName(localId) {
  if (!localId) return null;
  if (localCache[localId]) return localCache[localId];
  try {
    const snap=await getDoc(doc(db,"locales",localId));
    const n=snap.exists()?snap.data().nombre:null;
    if(n) localCache[localId]=n; return n;
  } catch { return null; }
}

export { loadSueldosView, loadLocalesView };

// ── Time helpers ──────────────────────────────────────────────
function calcMinsBetween(entrada, salida) {
  if (!entrada || !salida) return 0;
  const [eh, em] = entrada.split(":").map(Number);
  const [sh, sm] = salida.split(":").map(Number);
  const mins = (sh * 60 + sm) - (eh * 60 + em);
  return Math.max(0, mins);
}

function fmtHoras(mins) {
  if (!mins || mins <= 0) return "0h 0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// ── Safe getElementById helper for modal ─────────────────────
function mEl(id) { return document.getElementById(id); }
function mSet(id, prop, val) { const e = mEl(id); if (e) e[prop] = val; }
function mStyle(id, prop, val) { const e = mEl(id); if (e) e.style[prop] = val; }

// ── Modal: Editar registro ────────────────────────────────────
window.openEditModal = function(recordId, fecha, entrada, salida) {
  mSet("modal-record-id", "value", recordId);
  mSet("modal-mode", "value", "edit");
  mSet("modal-title", "textContent", "Editar horas del registro");
  mStyle("modal-advance-banner", "display", "none");
  mStyle("modal-advance-extra", "display", "none");
  mStyle("modal-emp-group", "display", "none");
  mStyle("modal-newday-banner", "display", "none");
  mStyle("modal-newday-fields", "display", "none");
  mStyle("modal-motivo-group", "display", "block");
  mStyle("modal-entrada-group", "display", "block");
  mSet("modal-salida-label", "textContent", "Hora de salida");
  mSet("modal-fecha", "value", fecha);
  mEl("modal-fecha") && (mEl("modal-fecha").disabled = true);
  mSet("modal-entrada", "value", entrada || "");
  mSet("modal-salida", "value", salida || "");
  mSet("modal-motivo", "value", "");
  mSet("modal-save-btn", "innerHTML", '<i class="ti ti-device-floppy"></i> Guardar cambios');
  mEl("modal-edit")?.classList.add("visible");
};

// ── Modal: Agregar día completo ───────────────────────────────
window.openNewDayModal = async function() {
  const workers = (await getDocs(query(collection(db,"users"), where("role","==","worker")))).docs;
  const empSel = mEl("modal-emp-id");
  if (empSel) empSel.innerHTML = workers.map(d=>`<option value="${d.id}">${d.data().nombre} ${d.data().apellido||""}</option>`).join("") || '<option value="">Sin empleadas</option>';

  mSet("modal-record-id", "value", "");
  mSet("modal-mode", "value", "newday");
  mSet("modal-title", "textContent", "Agregar día trabajado");
  mStyle("modal-advance-banner", "display", "none");
  mStyle("modal-newday-banner", "display", "flex");
  mStyle("modal-advance-extra", "display", "none");
  mStyle("modal-newday-fields", "display", "block");
  mStyle("modal-emp-group", "display", "block");
  mStyle("modal-motivo-group", "display", "none");
  mStyle("modal-entrada-group", "display", "block");
  mSet("modal-salida-label", "textContent", "Hora de salida");

  const today = new Date();
  mSet("modal-fecha", "value", `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`);
  mEl("modal-fecha") && (mEl("modal-fecha").disabled = false);
  mSet("modal-entrada", "value", "");
  mSet("modal-salida", "value", "");
  mSet("modal-base", "value", "");
  mSet("modal-ventas", "value", "");
  mSet("modal-recargas", "value", "");
  mSet("modal-comentarios", "value", "");
  mSet("modal-save-btn", "innerHTML", '<i class="ti ti-calendar-plus"></i> Agregar día');
  mEl("modal-edit")?.classList.add("visible");
};

// ── Modal: Adelantar hora de salida ──────────────────────────
window.openAdvanceModal = async function() {
  const workers = (await getDocs(query(collection(db,"users"), where("role","==","worker")))).docs;
  const empSel = mEl("modal-emp-id");
  if (empSel) empSel.innerHTML = workers.map(d=>`<option value="${d.id}">${d.data().nombre} ${d.data().apellido||""}</option>`).join("") || '<option value="">Sin empleadas</option>';

  mSet("modal-record-id", "value", "");
  mSet("modal-mode", "value", "advance");
  mSet("modal-title", "textContent", "Adelantar hora de salida");
  mStyle("modal-advance-banner", "display", "flex");
  mStyle("modal-advance-extra", "display", "block");
  mStyle("modal-emp-group", "display", "block");
  mStyle("modal-motivo-group", "display", "none");
  mStyle("modal-newday-banner", "display", "none");
  mStyle("modal-newday-fields", "display", "none");
  mStyle("modal-entrada-group", "display", "none");
  mSet("modal-salida-label", "textContent", "Hora de salida estimada");

  const today = new Date();
  mSet("modal-fecha", "value", `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`);
  mEl("modal-fecha") && (mEl("modal-fecha").disabled = false);
  mSet("modal-entrada", "value", "");
  mSet("modal-salida", "value", "");
  mSet("modal-save-btn", "innerHTML", '<i class="ti ti-clock-bolt"></i> Adelantar salida');
  mEl("modal-edit")?.classList.add("visible");
};

window.closeEditModal = function() {
  document.getElementById("modal-edit").classList.remove("visible");
};

window.saveEditModal = async function() {
  const mode    = document.getElementById("modal-mode").value;
  const recId   = document.getElementById("modal-record-id").value;
  const entrada = document.getElementById("modal-entrada").value;
  const salida  = document.getElementById("modal-salida").value;
  const fecha   = document.getElementById("modal-fecha").value;

  if (mode === "edit" && !entrada) { alert("La hora de entrada es obligatoria."); return; }

  showLoading(mode === "edit" ? "Guardando ajuste..." : mode === "newday" ? "Guardando día..." : "Actualizando...");
  try {
    if (mode === "edit") {
      const motivo = document.getElementById("modal-motivo").value.trim();
      await updateDoc(doc(db,"records",recId), {
        entrada,
        salida: salida || null,
        ajustado: true,
        ajusteMotivo: motivo || "Ajuste manual por administrador",
        ajusteAt: serverTimestamp()
      });
      closeEditModal();
      const aprobView = document.getElementById("av-aprobaciones");
      if (aprobView && aprobView.style.display !== "none") await renderPending();
      else await loadAllRecords();

    } else if (mode === "newday") {
      // ── NUEVO DÍA: crear registro completo aprobado de inmediato
      const empId = document.getElementById("modal-emp-id").value;
      if (!empId)   { alert("Selecciona una empleada."); hideLoading(); return; }
      if (!entrada) { alert("La hora de entrada es obligatoria."); hideLoading(); return; }
      if (!fecha)   { alert("La fecha es obligatoria."); hideLoading(); return; }

      // Verificar que no exista ya un registro ese día
      const existing = (await getDocs(query(
        collection(db,"records"),
        where("userId","==",empId),
        where("fecha","==",fecha)
      ))).docs;
      if (existing.length) {
        alert("Ya existe un registro para esa empleada en esa fecha. Usa el botón ✏ para editarlo.");
        hideLoading(); return;
      }

      const userSnap = await getDoc(doc(db,"users",empId));
      const u = userSnap.exists() ? userSnap.data() : {};
      const DAYS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
      const dia  = DAYS[new Date(fecha+"T12:00:00").getDay()];

      await addDoc(collection(db,"records"), {
        userId:   empId,
        localId:  u.localId || null,
        fecha, dia,
        entrada,
        salida:   salida || null,
        base:     parseFloat(document.getElementById("modal-base").value)     || 0,
        ventas:   parseFloat(document.getElementById("modal-ventas").value)   || 0,
        recargas: parseFloat(document.getElementById("modal-recargas").value) || 0,
        comentarios: document.getElementById("modal-comentarios").value || "",
        status:       "aprobado",   // ← directo aprobado
        cierreEnviado: true,
        permisos:     [],
        minutoPermiso: 0,
        agregadoPorAdmin: true,
        ajustado: true,
        createdAt: serverTimestamp()
      });

      closeEditModal();
      await loadAllRecords();
      alert("Día trabajado agregado y aprobado correctamente.");

    } else {
      // ── ADVANCE: adelantar hora de salida
      const empId = document.getElementById("modal-emp-id").value;
      if (!empId)  { alert("Selecciona una empleada."); hideLoading(); return; }
      if (!salida) { alert("Ingresa la hora de salida estimada."); hideLoading(); return; }

      const existing = (await getDocs(query(
        collection(db,"records"),
        where("userId","==",empId),
        where("fecha","==",fecha)
      ))).docs;

      if (!existing.length) {
        alert("La empleada aún no ha registrado su entrada ese día. Espera a que lo haga y luego adelanta su salida.");
        hideLoading(); return;
      }

      await updateDoc(doc(db,"records", existing[0].id), {
        salida,
        salidaAnticipada: true,
        ajustado: true,
        ajusteMotivo: "Salida adelantada por administrador",
        ajusteAt: serverTimestamp()
      });

      closeEditModal();
      await loadAllRecords();
      alert("Hora de salida adelantada. El registro sigue pendiente hasta que el admin lo apruebe.");
    }
  } catch(e) { alert("Error: "+e.message); console.error(e); }
  hideLoading();
};

// ── Cambiar estado de un registro ────────────────────────────
window.changeRecordStatus = async function(id, currentStatus) {
  // Ciclo: pendiente → aprobado → rechazado → pendiente
  const next = { pendiente:"aprobado", aprobado:"rechazado", rechazado:"pendiente" };
  const labels = { pendiente:"Pendiente", aprobado:"Aprobado", rechazado:"Rechazado" };
  const newStatus = next[currentStatus] || "pendiente";
  if (!confirm(`Cambiar estado de "${labels[currentStatus]}" a "${labels[newStatus]}"?`)) return;
  showLoading("Cambiando estado...");
  try {
    await updateDoc(doc(db,"records",id), { status: newStatus });
    await updateNotifCount();
    await loadAllRecords();
  } catch(e) { alert("Error: "+e.message); }
  hideLoading();
};

// ── Auto-eliminar registros con más de 30 días ────────────────
// Se llama automáticamente al cargar los registros
async function autoCleanOldRecords() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,"0")}-${String(cutoff.getDate()).padStart(2,"0")}`;

    const snap = await getDocs(collection(db,"records"));
    const toDelete = snap.docs.filter(d => {
      const r = d.data();
      return r.fecha && r.fecha < cutoffStr;
    });

    if (toDelete.length > 0) {
      await Promise.all(toDelete.map(d => deleteDoc(doc(db,"records",d.id))));
      console.log(`Auto-eliminados ${toDelete.length} registros con más de 30 días.`);
    }
  } catch(e) { console.warn("autoCleanOldRecords:", e.message); }
}

// Close modal on backdrop click
document.addEventListener("click", e => {
  const modal = document.getElementById("modal-edit");
  if (e.target === modal) closeEditModal();
});
