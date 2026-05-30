// ===== pdf.js =====
import { fmtMoney } from "./worker.js";

const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function fmtDateLocal(d) {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00");
  return `${dt.getDate()} de ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtMins(m) {
  if (!m || m <= 0) return "0h 0m";
  return `${Math.floor(m/60)}h ${m%60}m`;
}

window.generatePDF = function() {
  import("./admin.js").then(mod => {
    const d = mod.lastCalcData;
    if (!d) { alert("Primero realiza un cálculo."); return; }
    buildAndDownloadPDF(d);
  });
};

function buildAndDownloadPDF(d) {
  const u = d.userData || d.u || {};

  const totalMinsNetos      = Math.round((d.totalHorasTrabajadas || 0) * 60);
  const totalHorasStr       = fmtMins(totalMinsNetos);
  const totalPermStr        = d.totalPermisoMinsTotales > 0 ? fmtMins(d.totalPermisoMinsTotales) : "—";
  const totalConsumosGlobal = parseFloat(d.totalConsumosGlobal || 0);

  const rows = (d.records || []).map(r => {
    const permMins    = r.permMins || r.minutoPermiso || 0;
    const minsBrutos  = r.minsBrutos || 0;
    const minsNetos   = r.minsNetos !== undefined ? r.minsNetos : minsBrutos;
    const permStr     = permMins > 0 ? `-${fmtMins(permMins)}` : "—";
    const consumosDia = parseFloat(r.consumosDia || r.totalConsumos || 0);
    const consumosStr = consumosDia > 0 ? `-$${consumosDia.toFixed(2)}` : "—";
    const consumosTip = (r.consumos||[]).map(c=>`${c.motivo}: $${parseFloat(c.monto).toFixed(2)}`).join(" | ");
    const pagoStr     = r.pagoDia !== undefined ? `$${parseFloat(r.pagoDia).toFixed(2)}` : "—";
    return `<tr>
      <td>${fmtDateLocal(r.fecha)}</td>
      <td>${r.dia}</td>
      <td>${r.localName||"—"}</td>
      <td>${r.entrada||"—"}</td>
      <td>${r.salida||"—"}</td>
      <td>${fmtMins(minsBrutos)}</td>
      <td>${permStr}</td>
      <td>${fmtMins(minsNetos)}</td>
      <td title="${consumosTip}" style="${consumosDia>0?'color:#c0392b':''}">${consumosStr}</td>
      <td><strong>${pagoStr}</strong></td>
      <td class="notes">${r.comentarios||"—"}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte — ${d.empName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;padding:28px 32px;background:#fff}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #111;margin-bottom:20px}
  .brand-name{font-size:18px;font-weight:800;color:#111;letter-spacing:-0.02em}
  .brand-sub{font-size:11px;color:#555;margin-top:2px}
  .emp-name{font-size:15px;font-weight:700;color:#111;margin-top:8px}
  .generated{font-size:10px;color:#888;text-align:right;line-height:1.7}
  .info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px}
  .info-card{background:#f4f4f4;border-left:3px solid #111;padding:8px 12px}
  .info-card .lbl{font-size:9px;color:#777;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}
  .info-card .val{font-size:12px;font-weight:700;color:#111}
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
  .metric{border:1.5px solid #111;padding:10px;text-align:center}
  .metric .val{font-size:15px;font-weight:800;color:#111}
  .metric .val.red{color:#c0392b}
  .metric .lbl{font-size:9px;color:#666;margin-top:3px;text-transform:uppercase;letter-spacing:.06em}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  thead th{background:#111;color:#fff;padding:7px 9px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  tbody td{padding:7px 9px;border-bottom:1px solid #ddd;font-size:11px;vertical-align:top}
  .notes{max-width:130px;word-break:break-word;color:#555}
  tbody tr:nth-child(even) td{background:#f9f9f9}
  .totals-row td{background:#f0f0f0!important;font-weight:700;font-size:11px}
  .total-box{border:2px solid #111;padding:16px 20px;text-align:center;margin:16px 0}
  .total-box .big{font-size:28px;font-weight:800;color:#111}
  .total-box .sub{font-size:11px;color:#555;margin-bottom:4px}
  .consumos-detail{background:#fff5f5;border:1px solid #f5c6c6;border-radius:4px;padding:8px 12px;margin-bottom:12px;font-size:11px}
  .consumos-detail .ch{font-weight:700;color:#c0392b;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  .firma-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:32px}
  .firma{border-top:1px solid #111;padding-top:6px;font-size:10px;color:#555;text-align:center}
  .footer{margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#aaa;text-align:center}
  @media print{body{padding:12px 16px}}
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="brand-name">Hakuna Matata</div>
    <div class="brand-sub">Control de Personal — Reporte de periodo laboral</div>
    <div class="emp-name">${d.empName}</div>
  </div>
  <div class="generated">
    Generado: ${new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"})}<br>
    ${new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}<br>
    <strong>Folio: ${Date.now().toString(36).toUpperCase()}</strong>
  </div>
</div>

<div class="info-grid">
  <div class="info-card"><div class="lbl">Empleada</div><div class="val">${d.empName}</div></div>
  <div class="info-card"><div class="lbl">Correo</div><div class="val" style="font-size:10px">${u.email||"—"}</div></div>
  <div class="info-card"><div class="lbl">Teléfono</div><div class="val">${u.tel||"—"}</div></div>
  <div class="info-card"><div class="lbl">Periodo desde</div><div class="val">${fmtDateLocal(d.from)}</div></div>
  <div class="info-card"><div class="lbl">Periodo hasta</div><div class="val">${fmtDateLocal(d.to)}</div></div>
  <div class="info-card"><div class="lbl">Tarifa por hora</div><div class="val">$${parseFloat(d.tarifaHora||0).toFixed(2)}</div></div>
</div>

<div class="metrics">
  <div class="metric"><div class="val">${d.diasTrabajados}</div><div class="lbl">Días trabajados</div></div>
  <div class="metric"><div class="val">${totalHorasStr}</div><div class="lbl">Horas pagadas</div></div>
  <div class="metric"><div class="val red">${totalConsumosGlobal>0?"-$"+totalConsumosGlobal.toFixed(2):"—"}</div><div class="lbl">Total consumos</div></div>
  <div class="metric"><div class="val">$${parseFloat(d.totalPago||0).toFixed(2)}</div><div class="lbl">Total a pagar</div></div>
</div>

${totalConsumosGlobal > 0 ? `
<div class="consumos-detail">
  <div class="ch">🛍 Consumos descontados del periodo</div>
  ${(d.records||[]).filter(r=>(r.consumosDia||r.totalConsumos||0)>0).map(r=>{
    const items=(r.consumos||[]).map(c=>`${c.motivo} ($${parseFloat(c.monto).toFixed(2)})`).join(", ");
    return `<div style="margin-bottom:2px"><strong>${fmtDateLocal(r.fecha)}:</strong> ${items||"—"} = <strong style="color:#c0392b">-$${parseFloat(r.consumosDia||r.totalConsumos||0).toFixed(2)}</strong></div>`;
  }).join("")}
</div>` : ""}

<table>
  <thead>
    <tr>
      <th>Fecha</th><th>Día</th><th>Local</th><th>Entrada</th><th>Salida</th>
      <th>Hrs brutas</th><th>Permiso</th><th>Hrs pagadas</th><th>Consumos</th><th>Pago del día</th><th>Comentarios</th>
    </tr>
  </thead>
  <tbody>
    ${rows||'<tr><td colspan="11" style="text-align:center;color:#aaa;padding:16px">Sin registros</td></tr>'}
    <tr class="totals-row">
      <td colspan="5" style="text-align:right;font-size:10px;letter-spacing:.04em">TOTALES DEL PERIODO</td>
      <td>—</td>
      <td>${totalPermStr}</td>
      <td>${totalHorasStr}</td>
      <td style="color:#c0392b">${totalConsumosGlobal>0?"-$"+totalConsumosGlobal.toFixed(2):"—"}</td>
      <td>$${parseFloat(d.totalPago||0).toFixed(2)}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="total-box">
  <div class="sub">${totalHorasStr} pagadas${totalConsumosGlobal>0?" &nbsp;·&nbsp; -$"+totalConsumosGlobal.toFixed(2)+" consumos":""} &nbsp;·&nbsp; ${fmtDateLocal(d.from)} al ${fmtDateLocal(d.to)}</div>
  <div class="big">$${parseFloat(d.totalPago||0).toFixed(2)}</div>
</div>

<div class="firma-grid">
  <div class="firma">Firma del administrador</div>
  <div class="firma">Firma de la empleada &nbsp;(${d.empName})</div>
</div>

<div class="footer">
  Hakuna Matata &nbsp;|&nbsp; Control de Personal &nbsp;|&nbsp; Generado automáticamente &nbsp;|&nbsp; ${new Date().toLocaleString("es-MX")}
</div>

<script>window.onload=function(){window.print()}<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type:"text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `reporte_${(d.empName||"empleada").replace(/\s+/g,"_")}_${d.from}_al_${d.to}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
