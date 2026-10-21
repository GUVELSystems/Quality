/* =====================================================================
   Notificaciones de cliente · Issues
   Es solo el detalle de lo que el cliente reportó (queja, devolución…).
   No tiene su propio flujo: al crearla, se genera de una vez su Hallazgo
   —ahí es donde pasa todo (elegir 8D/4D, aceptar, causa raíz, acciones,
   verificación, cierre)—. Abrir una notificación muestra su información
   y un botón para ir directo al Hallazgo.
   ===================================================================== */
import * as db from "../db.js";
import { esc, today, addDays, fmtDate, fmtDateTime, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, replaceHash, navigate } from "../router.js";
import { on, onChange, onInput, badge, empty, openDrawer, openForm, toast } from "../ui.js";
import { SEVERITY, FINDING_STATUS } from "../constants.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { userOpts, clientOpts, mapOpts, clientName, catNameOpts } from "./shared.js";

const F = { q: "", client: "", type: "" };
let drawer = null, drawerId = null;
/** El tipo (Queja, Devolución…) vive en el catálogo "Origen de Issues" (Config → Catálogos) */
const typesOf = () => catNameOpts("origen_issues");
const statusTone = (f) => (!f ? "neutral" : f.status === "cerrado" ? "ok" : "info");
const statusLabel = (f) => (!f ? "—" : f.status === "cerrado" ? "Cerrado" : "En proceso");

const fields = () => [
  { name: "client_id", label: "Cliente", type: "select", required: true, options: clientOpts() },
  { name: "notification_type", label: "Tipo de notificación", type: "select", required: true, options: typesOf() },
  { name: "subject", label: "Asunto", required: true, span2: true },
  { name: "description", label: "Descripción / detalle del cliente", type: "textarea", span2: true },
  { name: "part_number", label: "Número de parte" },
  { name: "quantity", label: "Cantidad afectada", type: "number", min: 0 },
  { name: "severity", label: "Severidad", type: "select", required: true, options: mapOpts(SEVERITY) },
  { name: "owner_id", label: "Responsable", type: "select", options: userOpts() },
  { name: "received_at", label: "Fecha de recepción", type: "date", required: true },
  { name: "response_due", label: "Fecha límite de respuesta", type: "date" },
];

function newNotifForm(defaultType) {
  openForm({
    eyebrow: "Issues", title: "Nueva notificación", size: "wide", fields: fields(),
    values: { notification_type: defaultType || typesOf()[0]?.[0], severity: "mayor", received_at: today(), response_due: addDays(today(), 5), owner_id: db.state.profile.id },
    submitLabel: "Registrar",
    intro: `<div class="note" style="margin-bottom:14px">Al registrarla se genera de una vez su Hallazgo; ahí se elige la estrategia (8D o 4D) y se da seguimiento.</div>`,
    onSubmit: async (v) => {
      const typeLabel = typesOf().find(([k]) => k === v.notification_type)?.[1] || v.notification_type;
      const f = await db.insert("findings", { module: "issues", title: `[${typeLabel}] ${v.subject}`, description: v.description || null, client_id: v.client_id, source: v.notification_type, owner_id: v.owner_id || null, status: "registro" });
      const r = await db.insert("customer_notifications", { ...v, finding_id: f.id });
      toast(`Notificación ${r.code} registrada · Hallazgo ${f.code} creado`, "ok");
      await refresh();
    },
  });
}
function editNotifForm(n) {
  openForm({
    eyebrow: n.code, title: "Editar notificación", size: "wide", fields: fields(), values: n, submitLabel: "Guardar",
    onSubmit: async (v) => { await db.update("customer_notifications", n.id, v); toast("Notificación actualizada", "ok"); await refresh(); },
    onDelete: db.can.manage ? async () => { await db.remove("customer_notifications", n.id); drawer?.close(); await refresh(); } : null,
  });
}

function drawerHTML(n) {
  const finding = db.get("findings", n.finding_id);
  return `
  <div class="dialog-head"><div><span class="eyebrow mono">${esc(n.code)}</span><h2>${esc(n.subject)}</h2>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${badge(SEVERITY, n.severity)}<span class="badge" data-tone="${statusTone(finding)}">${statusLabel(finding)}</span><span class="badge" data-tone="neutral">${esc(typesOf().find(([k]) => k === n.notification_type)?.[1] || n.notification_type || "—")}</span></div></div>
    <button class="btn ghost icon" data-close aria-label="Cerrar">${icon("close")}</button></div>
  <div class="dialog-body">
    <dl class="detail-grid">
      <div class="span-2"><dt>Detalle</dt><dd>${n.description ? esc(n.description) : '<span class="muted">Sin detalle</span>'}</dd></div>
      <div><dt>Cliente</dt><dd>${esc(clientName(n.client_id))}</dd></div>
      <div><dt>Responsable</dt><dd>${esc(db.profileName(n.owner_id))}</dd></div>
      <div><dt>Número de parte</dt><dd class="mono">${esc(n.part_number || "—")}</dd></div>
      <div><dt>Cantidad afectada</dt><dd>${n.quantity ?? "—"}</dd></div>
      <div><dt>Recibida</dt><dd>${fmtDate(n.received_at)}</dd></div>
      <div><dt>Límite de respuesta</dt><dd>${n.response_due ? fmtDate(n.response_due) : "—"}</dd></div>
    </dl>
    ${finding ? `<a class="btn primary" style="margin-top:18px" href="#/issues/hallazgos/${finding.id}">${icon("finding")} Ir al Hallazgo (${esc(finding.code)})</a>`
      : `<div class="note" style="margin-top:18px">Esta notificación no tiene un Hallazgo vinculado.</div>`}
    ${attachmentsSection("notification", n.id, { title: "Evidencias y documentos del cliente" })}
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
hooks.notification = () => refresh();
hooks.finding = () => refresh();   // si el hallazgo vinculado cambia de estado, el detalle se actualiza

/** Tipo activo (sección): si el catálogo cambió, cae al primero disponible */
function currentType() {
  const types = typesOf().map(([v]) => v);
  if (!types.length) return "";
  if (!types.includes(F.type)) F.type = types[0];
  return F.type;
}
const filtered = () => {
  const q = F.q.toLowerCase(), type = currentType();
  return db.rows("customer_notifications").filter((n) => (!type || n.notification_type === type) && (!F.client || n.client_id === F.client) &&
    (!q || `${n.code} ${n.subject} ${n.part_number || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => { const fa = db.get("findings", a.finding_id), fb = db.get("findings", b.finding_id); return (fa?.status === "cerrado") - (fb?.status === "cerrado") || b.created_at.localeCompare(a.created_at); });
};
/** Una sección (ventana) por cada tipo del catálogo: Queja separada de Devolución, igual que
 *  LPA está separado de Producto en Auditorías */
function typeTabs() {
  const types = typesOf().map(([v]) => v);
  if (types.length < 2) return "";
  const active = currentType(), all = db.rows("customer_notifications");
  return `<div class="type-tabs" role="tablist" aria-label="Tipo de notificación">${types.map((t) => {
    const mine = all.filter((n) => n.notification_type === t), open = mine.filter((n) => db.get("findings", n.finding_id)?.status !== "cerrado").length;
    return `<button type="button" class="type-tab ${t === active ? "active" : ""}" role="tab" aria-selected="${t === active}" data-action="n-type" data-type="${esc(t)}"><span class="tt-txt"><b>${esc(typesOf().find(([k]) => k === t)?.[1] || t)}</b><small>${mine.length} registro(s) · ${open} abierta(s)</small></span></button>`;
  }).join("")}</div>`;
}

export default {
  id: "notifications", label: "Notif. de cliente", icon: "bell",
  render(root, params) {
    setHead({
      title: "Notificaciones de calidad", subtitle: "Quejas, devoluciones, SCAR y alertas de clientes. Cada una tiene su Hallazgo, donde se da el seguimiento completo.",
      actions: `<button class="btn" data-action="n-export">${icon("download")} Exportar CSV</button>${db.can.write ? `<button class="btn primary" data-action="n-new">${icon("plus")} Nueva notificación</button>` : ""}`,
    });
    const all = db.rows("customer_notifications"), open = all.filter((n) => db.get("findings", n.finding_id)?.status !== "cerrado");
    const list = filtered();
    root.innerHTML = `
    <div class="stack">
      <div class="kpi-strip">
        <div class="kpi" data-tone="info"><label>Abiertas</label><strong>${open.length}</strong><small>En seguimiento</small></div>
        <div class="kpi" data-tone="warn"><label>Críticas abiertas</label><strong>${open.filter((n) => n.severity === "critico").length}</strong><small>Severidad crítica</small></div>
        <div class="kpi" data-tone="ok"><label>Cerradas</label><strong>${all.length - open.length}</strong><small>Total histórico</small></div>
      </div>
      ${typeTabs()}
      <div class="panel">
        <div class="toolbar">
          <input class="input grow" id="n-q" type="search" placeholder="Buscar folio, asunto o número de parte…" value="${esc(F.q)}" data-input="n-q">
          <select class="select" data-change="n-filter" data-key="client"><option value="">Todos los clientes</option>${clientOpts().map(([k, l]) => `<option value="${k}" ${F.client === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <span class="count">${list.length} registro(s)</span>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Cliente / Asunto</th><th>Tipo</th><th>Severidad</th><th>Estado</th><th>Hallazgo</th></tr></thead><tbody>
        ${list.map((n) => { const f = db.get("findings", n.finding_id); return `<tr data-action="n-open" data-id="${n.id}"><td class="code">${esc(n.code)}</td><td><span class="title">${esc(n.subject)}</span><span class="sub">${esc(clientName(n.client_id))}${n.part_number ? " · " + esc(n.part_number) : ""}</span></td><td>${esc(typesOf().find(([k]) => k === n.notification_type)?.[1] || n.notification_type || "—")}</td><td>${badge(SEVERITY, n.severity)}</td><td><span class="badge" data-tone="${statusTone(f)}">${statusLabel(f)}</span></td><td class="mono">${f ? esc(f.code) : "—"}</td></tr>`; }).join("")}
        </tbody></table></div>` : empty("Sin notificaciones", "No hay notificaciones con los filtros actuales.", "bell")}
      </div>
    </div>`;
    if (params?.[0]) { openNotif(params[0]); replaceHash("issues/notificaciones"); }
  },
};

on("n-open", (el) => openNotif(el.dataset.id));
on("n-new", () => newNotifForm(currentType()));
on("n-type", (el) => { F.type = el.dataset.type; rerender(); });
on("n-edit", (el) => editNotifForm(db.get("customer_notifications", el.dataset.id)));
on("n-export", () => downloadCSV("notificaciones_cliente.csv", [
  { label: "Folio", value: (r) => r.code }, { label: "Cliente", value: (r) => clientName(r.client_id) }, { label: "Tipo", value: (r) => typesOf().find(([k]) => k === r.notification_type)?.[1] || r.notification_type },
  { label: "Asunto", value: (r) => r.subject }, { label: "No. parte", value: (r) => r.part_number }, { label: "Cantidad", value: (r) => r.quantity },
  { label: "Severidad", value: (r) => SEVERITY[r.severity][0] }, { label: "Hallazgo", value: (r) => db.get("findings", r.finding_id)?.code || "" },
  { label: "Recibida", value: (r) => r.received_at }, { label: "Límite respuesta", value: (r) => r.response_due },
], filtered()));
onChange("n-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("n-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("n-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });
