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
      return `<tr>
        <td>${name}</td>
        <td>${localName ? `<span class="local-tag"><i class="ti ti-building-store"></i>${localName}</span>` : "—"}</td>
        <td>${fmtDate(r.fecha)}</td><td>${r.dia}</td>
        <td>${r.entrada}</td><td>${r.salida||"—"}</td>
        <td>${fmtMoney(r.ventas)}</td><td>${fmtMoney(r.recargas)}</td>
        <td>${permCell}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.comentarios||""}">${r.comentarios||"—"}</td>
        <td><div class="row-actions">
          <button class="btn btn-success btn-sm" onclick="approveRecord('${d.id}',true)"><i class="ti ti-check"></i> Aprobar</button>
          <button class="btn btn-danger btn-sm" onclick="approveRecord('${d.id}',false)"><i class="ti ti-x"></i> Rechazar</button>
        </div></td>
      </tr>`;
    }));

    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Empleada</th><th>Local</th><th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th>
      <th>Ventas</th><th>Recargas</th><th>Permiso</th><th>Comentarios</th><th>Acción</th>
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
      return `<tr>
        <td>${name}</td>
        <td>${localName ? `<span class="local-tag">${localName}</span>` : "—"}</td>
        <td>${fmtDate(r.fecha)}</td><td>${r.dia}</td>
        <td>${r.entrada}</td><td>${r.salida||"—"}</td>
        <td>${fmtMoney(r.ventas)}</td><td>${fmtMoney(r.recargas)}</td>
        <td>${fmtMoney(r.base)}</td>
        <td>${permCell}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.comentarios||""}">${r.comentarios||"—"}</td>
      </tr>`;
    }));
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Empleada</th><th>Local</th><th>Fecha</th><th>Día</th><th>Entrada</th><th>Salida</th>
      <th>Ventas</th><th>Recargas</th><th>Base</th><th>Permiso</th><th>Estado</th><th>Notas</th>
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

    let totalPago    = 0;
    let totalMinsTrabajados = 0;

    const recsConPago = allRecs.map(r => {
      // Calcular minutos brutos del turno (entrada → salida)
      const minsBrutos = calcMinsBetween(r.entrada, r.salida);
      const permMins   = r.minutoPermiso || 0;
      // Minutos realmente pagados
      const minsNetos  = descontarPermiso
        ? Math.max(0, minsBrutos - permMins)
        : minsBrutos;
      const horasNetas = minsNetos / 60;
      const pagoDia    = tarifaHora * horasNetas;
      const descuento  = descontarPermiso ? tarifaHora * (permMins/60) : 0;

      totalPago += pagoDia;
      totalMinsTrabajados += minsNetos;

      return { ...r, minsBrutos, minsNetos, horasNetas, pagoDia, descuento, permMins };
    });

    const totalHorasTrabajadas = totalMinsTrabajados / 60;

    lastCalcData = {
      empId, empName:`${u.nombre||""} ${u.apellido||""}`.trim(),
      from, to, tarifaHora, diasTrabajados,
      totalHorasTrabajadas, totalPago,
      totalVentas, totalRecargas, totalPermisoMinsTotales,
      descontarPermiso, records: recsConPago, userData: u
    };

    const tableRows = await Promise.all(recsConPago.map(async r => {
      const localName = await getLocalName(r.localId);
      const brutoStr  = fmtHoras(r.minsBrutos);
      const netosStr  = r.minsNetos !== r.minsBrutos
        ? `<span style="color:var(--jungle-light)">${fmtHoras(r.minsNetos)}</span>`
        : fmtHoras(r.minsNetos);
      const permCell  = r.permMins > 0
        ? `<span style="color:var(--warning-text)">-${fmtMinutos(r.permMins)}</span>`
        : "—";
      return `<tr>
        <td>${fmtDate(r.fecha)}</td>
        <td>${r.dia}</td>
        <td>${localName ? `<span class="local-tag">${localName}</span>` : "—"}</td>
        <td>${r.entrada}</td>
        <td>${r.salida||"—"}</td>
        <td>${brutoStr}</td>
        <td>${permCell}</td>
        <td>${netosStr}</td>
        <td>${fmtMoney(r.ventas)}</td>
        <td>${fmtMoney(r.recargas)}</td>
        <td><strong>${fmtMoney(r.pagoDia)}</strong></td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis">${r.comentarios||"—"}</td>
      </tr>`;
    }));

    document.getElementById("calc-result-content").innerHTML = `
      <div class="grid-4" style="margin-bottom:1rem">
        <div class="metric"><div class="metric-val blue">${diasTrabajados}</div><div class="metric-lbl">Días trabajados</div></div>
        <div class="metric"><div class="metric-val blue">${fmtHoras(totalMinsTrabajados)}</div><div class="metric-lbl">Horas pagadas</div></div>
        <div class="metric"><div class="metric-val">${fmtMoney(tarifaHora)}</div><div class="metric-lbl">Tarifa por hora</div></div>
        <div class="metric"><div class="metric-val green">${fmtMoney(totalPago)}</div><div class="metric-lbl">Total a pagar</div></div>
      </div>
      ${descontarPermiso && totalPermisoMinsTotales > 0 ? `<div class="alert alert-info" style="margin-bottom:1rem"><i class="ti ti-info-circle"></i> Permisos descontados: <strong>${fmtMinutos(totalPermisoMinsTotales)}</strong> del tiempo pagado.</div>` : ""}
      <div class="table-wrap"><table><thead><tr>
        <th>Fecha</th><th>Día</th><th>Local</th><th>Entrada</th><th>Salida</th>
        <th>Hrs brutas</th><th>Permiso</th><th>Hrs pagadas</th>
        <th>Ventas</th><th>Recargas</th><th>Pago día</th><th>Notas</th>
      </tr></thead><tbody>
        ${tableRows.join("")||'<tr><td colspan="12" class="empty">Sin registros aprobados en este periodo</td></tr>'}
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
      return `<tr>
        <td>${u.nombre} ${u.apellido||""}</td>
        <td class="text-muted small">${u.email}</td>
        <td>${u.tel||"—"}</td>
        <td><span class="local-tag">${localName}</span></td>
        <td>${fmtMoney(sals[d.id]||0)}</td>
        <td>${total}</td><td>${aprobados}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteEmployee('${d.id}','${u.nombre} ${u.apellido||""}')"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    }).join("");
    el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Local</th><th>Sueldo semanal</th><th>Registros</th><th>Aprobados</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch(e) { el.innerHTML='<div class="empty">Error al cargar.</div>'; console.error(e); }
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
