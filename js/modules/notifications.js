import * as db from "../db.js";
import { esc, today, addDays, fmtDate, fmtDateTime, dueText, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, replaceHash, navigate } from "../router.js";
import { on, onChange, onInput, badge, empty, openDrawer, openForm, toast } from "../ui.js";
import { SEVERITY, SEVERITY_SLA_DAYS, NOTIF_TYPE, NOTIF_FLOW, NOTIF_STATUS } from "../constants.js";
import { userOpts, clientOpts, mapOpts, clientName } from "./shared.js";

const F = { q: "", status: "", type: "", client: "" };
let drawer = null, drawerId = null;

const fields = (editing) => [
  { name: "client_id", label: "Cliente", type: "select", required: true, options: clientOpts() },
  { name: "notification_type", label: "Tipo de notificación", type: "select", required: true, options: Object.entries(NOTIF_TYPE) },
  { name: "subject", label: "Asunto", required: true, span2: true },
  { name: "description", label: "Descripción / detalle del cliente", type: "textarea", span2: true },
  { name: "part_number", label: "Número de parte" },
  { name: "quantity", label: "Cantidad afectada", type: "number", min: 0 },
  { name: "severity", label: "Severidad", type: "select", required: true, options: mapOpts(SEVERITY) },
  { name: "owner_id", label: "Responsable", type: "select", options: userOpts() },
  { name: "received_at", label: "Fecha de recepción", type: "date", required: true },
  { name: "response_due", label: "Fecha límite de respuesta", type: "date" },
  ...(editing ? [{ name: "status", label: "Estado", type: "select", required: true, options: mapOpts(NOTIF_STATUS) }] : []),
];

function openForm_(n) {
  openForm({
    eyebrow: n ? n.code : "Nueva notificación", title: n ? "Editar notificación" : "Registrar notificación de cliente", size: "wide", fields: fields(!!n),
    values: n || { notification_type: "queja", severity: "mayor", received_at: today(), response_due: addDays(today(), 5), owner_id: db.state.profile.id },
    submitLabel: n ? "Guardar" : "Registrar",
    onSubmit: async (v) => {
      if (n) await db.update("customer_notifications", n.id, v); else { const r = await db.insert("customer_notifications", v); toast(`Notificación ${r.code} registrada`, "ok"); }
      await refresh();
    },
    onDelete: n && db.can.manage ? async () => { await db.remove("customer_notifications", n.id); drawer?.close(); await refresh(); } : null,
  });
}

function sla(n) {
  if (n.status === "cerrada" || !n.response_due) return { text: n.response_due ? fmtDate(n.response_due) : "—", late: false };
  const d = dueText(n.response_due);
  return { text: d.text, late: d.overdue };
}

function drawerHTML(n) {
  const idx = NOTIF_FLOW.indexOf(n.status), finding = db.get("findings", n.finding_id), s = sla(n);
  return `
  <div class="dialog-head"><div><span class="eyebrow mono">${esc(n.code)}</span><h2>${esc(n.subject)}</h2>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${badge(SEVERITY, n.severity)}${badge(NOTIF_STATUS, n.status)}<span class="badge" data-tone="neutral">${esc(NOTIF_TYPE[n.notification_type])}</span></div></div>
    <button class="btn ghost icon" data-close aria-label="Cerrar">${icon("close")}</button></div>
  <div class="dialog-body">
    <div class="stepper">${NOTIF_FLOW.map((st, i) => `<button class="step ${i < idx ? "done" : ""} ${i === idx ? "current" : ""}" ${db.can.write ? "" : "disabled"} data-action="n-status" data-id="${n.id}" data-status="${st}">${NOTIF_STATUS[st][0]}</button>`).join("")}</div>
    <dl class="detail-grid" style="margin-top:22px">
      <div class="span-2"><dt>Detalle</dt><dd>${n.description ? esc(n.description) : '<span class="muted">Sin detalle</span>'}</dd></div>
      <div><dt>Cliente</dt><dd>${esc(clientName(n.client_id))}</dd></div>
      <div><dt>Responsable</dt><dd>${esc(db.profileName(n.owner_id))}</dd></div>
      <div><dt>Número de parte</dt><dd class="mono">${esc(n.part_number || "—")}</dd></div>
      <div><dt>Cantidad afectada</dt><dd>${n.quantity ?? "—"}</dd></div>
      <div><dt>Recibida</dt><dd>${fmtDate(n.received_at)}</dd></div>
      <div><dt>Límite de respuesta</dt><dd class="${s.late ? "overdue" : ""}">${s.text}</dd></div>
      ${n.closed_at ? `<div><dt>Cerrada</dt><dd>${fmtDateTime(n.closed_at)}</dd></div>` : ""}
    </dl>
    <div class="section-title"><span>Hallazgo vinculado</span></div>
    ${finding ? `<div class="item-row"><div><a class="mono" href="#/findings/${finding.id}">${esc(finding.code)}</a><div style="margin-top:4px">${esc(finding.title)}</div></div></div>`
      : `<div class="muted" style="margin-bottom:12px">Esta notificación aún no tiene un hallazgo asociado para dar seguimiento con acciones.</div>${db.can.write ? `<button class="btn" data-action="n-finding" data-id="${n.id}">${icon("finding")} Generar hallazgo</button>` : ""}`}
  </div>
  ${db.can.write ? `<div class="dialog-foot"><button class="btn" data-action="n-edit" data-id="${n.id}">${icon("edit")} Editar</button></div>` : ""}`;
}

function openNotif(id) {
  const n = db.get("customer_notifications", id);
  if (!n) return;
  drawerId = id;
  if (drawer && document.body.contains(drawer.el)) drawer.set(drawerHTML(n)); else drawer = openDrawer(drawerHTML(n));
}
async function refresh() {
  await rerender();
  if (drawer && document.body.contains(drawer.el)) { const n = db.get("customer_notifications", drawerId); n ? drawer.set(drawerHTML(n)) : drawer.close(); }
}

const filtered = () => {
  const q = F.q.toLowerCase();
  return db.rows("customer_notifications").filter((n) => (!F.status || n.status === F.status) && (!F.type || n.notification_type === F.type) && (!F.client || n.client_id === F.client) &&
    (!q || `${n.code} ${n.subject} ${n.part_number || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.status === "cerrada") - (b.status === "cerrada") || (a.response_due || "9").localeCompare(b.response_due || "9"));
};

export default {
  id: "notifications", label: "Notif. de cliente", icon: "bell",
  render(root, params) {
    setHead({
      eyebrow: "Gestión de calidad", title: "Notificaciones de cliente", subtitle: "Quejas, devoluciones, SCAR y alertas con control de tiempos de respuesta.",
      actions: `<button class="btn" data-action="n-export">${icon("download")} Exportar CSV</button>${db.can.write ? `<button class="btn primary" data-action="n-new">${icon("plus")} Nueva notificación</button>` : ""}`,
    });
    const all = db.rows("customer_notifications"), open = all.filter((n) => n.status !== "cerrada"), late = open.filter((n) => n.response_due && n.response_due < today());
    const list = filtered();
    root.innerHTML = `
    <div class="stack">
      <div class="grid cols-4">
        <div class="kpi"><label>Abiertas</label><strong>${open.length}</strong><small>En seguimiento</small></div>
        <div class="kpi" data-tone="${late.length ? "danger" : "ok"}"><label>Respuesta vencida</label><strong>${late.length}</strong><small>Fuera del tiempo comprometido</small></div>
        <div class="kpi" data-tone="warn"><label>Críticas abiertas</label><strong>${open.filter((n) => n.severity === "critico").length}</strong><small>Severidad crítica</small></div>
        <div class="kpi" data-tone="ok"><label>Cerradas</label><strong>${all.length - open.length}</strong><small>Total histórico</small></div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <input class="input grow" id="n-q" type="search" placeholder="Buscar folio, asunto o número de parte…" value="${esc(F.q)}" data-input="n-q">
          <select class="select" data-change="n-filter" data-key="status"><option value="">Todos los estados</option>${Object.entries(NOTIF_STATUS).map(([k, [l]]) => `<option value="${k}" ${F.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          <select class="select" data-change="n-filter" data-key="type"><option value="">Todo tipo</option>${Object.entries(NOTIF_TYPE).map(([k, l]) => `<option value="${k}" ${F.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          <select class="select" data-change="n-filter" data-key="client"><option value="">Todos los clientes</option>${clientOpts().map(([k, l]) => `<option value="${k}" ${F.client === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <span class="count">${list.length} registro(s)</span>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Cliente / Asunto</th><th>Tipo</th><th>Severidad</th><th>Estado</th><th>Responsable</th><th>Respuesta límite</th></tr></thead><tbody>
        ${list.map((n) => { const s = sla(n); return `<tr data-action="n-open" data-id="${n.id}"><td class="code">${esc(n.code)}</td><td><span class="title">${esc(n.subject)}</span><span class="sub">${esc(clientName(n.client_id))}${n.part_number ? " · " + esc(n.part_number) : ""}</span></td><td>${esc(NOTIF_TYPE[n.notification_type])}</td><td>${badge(SEVERITY, n.severity)}</td><td>${badge(NOTIF_STATUS, n.status)}</td><td>${esc(db.profileName(n.owner_id))}</td><td class="${s.late ? "overdue" : ""}">${s.text}</td></tr>`; }).join("")}
        </tbody></table></div>` : empty("Sin notificaciones", "No hay notificaciones con los filtros actuales.", "bell")}
      </div>
    </div>`;
    if (params?.[0]) { openNotif(params[0]); replaceHash("notifications"); }
  },
};

on("n-open", (el) => openNotif(el.dataset.id));
on("n-new", () => openForm_(null));
on("n-edit", (el) => openForm_(db.get("customer_notifications", el.dataset.id)));
on("n-status", async (el) => { try { await db.update("customer_notifications", el.dataset.id, { status: el.dataset.status }); await refresh(); } catch (e) { toast(e.message, "danger"); } });
on("n-finding", async (el) => {
  const n = db.get("customer_notifications", el.dataset.id);
  try {
    const f = await db.insert("findings", {
      title: `[${NOTIF_TYPE[n.notification_type]}] ${n.subject}`, description: n.description, source: "cliente", severity: n.severity,
      client_id: n.client_id, owner_id: n.owner_id, due_date: n.response_due || addDays(today(), SEVERITY_SLA_DAYS[n.severity]),
    });
    await db.update("customer_notifications", n.id, { finding_id: f.id });
    toast(`Hallazgo ${f.code} generado`, "ok");
    await refresh();
  } catch (e) { toast(e.message, "danger"); }
});
on("n-export", () => downloadCSV("notificaciones_cliente.csv", [
  { label: "Folio", value: (r) => r.code }, { label: "Cliente", value: (r) => clientName(r.client_id) }, { label: "Tipo", value: (r) => NOTIF_TYPE[r.notification_type] },
  { label: "Asunto", value: (r) => r.subject }, { label: "No. parte", value: (r) => r.part_number }, { label: "Cantidad", value: (r) => r.quantity },
  { label: "Severidad", value: (r) => SEVERITY[r.severity][0] }, { label: "Estado", value: (r) => NOTIF_STATUS[r.status][0] },
  { label: "Recibida", value: (r) => r.received_at }, { label: "Límite respuesta", value: (r) => r.response_due },
], filtered()));
onChange("n-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("n-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("n-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });
