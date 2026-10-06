import * as db from "../db.js";
import { esc, today, addDays, fmtDate, fmtDateTime, dueText, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, replaceHash } from "../router.js";
import { on, onChange, onInput, badge, userCell, empty, openDrawer, openForm, confirmDialog, toast } from "../ui.js";
import { SEVERITY, SEVERITY_SLA_DAYS, SOURCE, FINDING_STATUS, FINDING_FLOW, ACTION_TYPE, ACTION_STATUS, ACTION_FLOW } from "../constants.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { userOpts, catOpts, catNameOpts, clientOpts, mapOpts, catName, clientName } from "./shared.js";

const F = { q: "", status: "", severity: "", source: "" };
let drawer = null, drawerId = null;
const SEV_RANK = { critico: 0, mayor: 1, menor: 2, observacion: 3 };

/* ------------------------------ Formularios -------------------------- */
const findingFields = (editing) => [
  { name: "title", label: "Título del hallazgo", required: true, span2: true },
  { name: "description", label: "Descripción", type: "textarea", span2: true },
  { name: "source", label: "Origen", type: "select", required: true, options: mapOpts(SOURCE) },
  { name: "severity", label: "Severidad", type: "select", required: true, options: mapOpts(SEVERITY) },
  ...(editing ? [{ name: "status", label: "Estado", type: "select", required: true, options: mapOpts(FINDING_STATUS) }] : []),
  { name: "classification_id", label: "Categoría", type: "select", options: catOpts("categoria_hallazgo") },
  { name: "area", label: "Área", type: "select", options: catNameOpts("area") },
  { name: "owner_id", label: "Responsable", type: "select", options: userOpts() },
  { name: "due_date", label: "Fecha compromiso", type: "date" },
  { name: "client_id", label: "Cliente (si aplica)", type: "select", options: clientOpts() },
  { name: "audit_id", label: "Auditoría origen", type: "select", options: db.rows("audits").map((a) => [a.id, a.code]) },
  { name: "root_cause", label: "Causa raíz (6M)", type: "select", options: catNameOpts("causa_raiz") },
];

export function newFinding(defaults = {}, onDone) {
  openForm({
    eyebrow: "Nuevo hallazgo", title: "Registrar hallazgo", fields: findingFields(false), size: "wide",
    values: { source: "auditoria", severity: "menor", due_date: addDays(today(), SEVERITY_SLA_DAYS.menor), owner_id: db.state.profile.id, ...defaults },
    submitLabel: "Registrar hallazgo",
    onSubmit: async (v) => { const r = await db.insert("findings", v); toast(`Hallazgo ${r.code} registrado`, "ok"); await refresh(); onDone?.(r); },
  });
}
function editFinding(f) {
  openForm({
    eyebrow: f.code, title: "Editar hallazgo", fields: findingFields(true), values: f, size: "wide",
    onSubmit: async (v) => { await db.update("findings", f.id, v); toast("Hallazgo actualizado", "ok"); await refresh(); },
    onDelete: db.can.manage ? async () => { await db.remove("findings", f.id); drawer?.close(); toast("Hallazgo eliminado"); await refresh(); } : null,
  });
}

export function actionForm({ finding_id, action, onDone }) {
  const fields = [
    ...(finding_id ? [] : [{ name: "finding_id", label: "Hallazgo", type: "select", required: true, span2: true, options: db.rows("findings").filter((f) => f.status !== "cerrado").map((f) => [f.id, `${f.code} · ${f.title}`]) }]),
    { name: "description", label: "Descripción de la acción", type: "textarea", required: true, span2: true },
    { name: "action_type", label: "Tipo", type: "select", required: true, options: mapOpts(ACTION_TYPE) },
    { name: "status", label: "Estado", type: "select", required: true, options: mapOpts(ACTION_STATUS) },
    { name: "owner_id", label: "Responsable", type: "select", options: userOpts() },
    { name: "due_date", label: "Fecha compromiso", type: "date" },
    ...(action ? [{ name: "effectiveness", label: "Verificación de efectividad", type: "textarea", span2: true }] : []),
  ];
  openForm({
    eyebrow: action ? action.code : "Nueva acción", title: action ? "Editar acción" : "Agregar acción", fields,
    values: action || { finding_id, action_type: "correctiva", status: "pendiente", owner_id: db.state.profile.id, due_date: addDays(today(), 14) },
    onSubmit: async (v) => {
      if (action) await db.update("actions", action.id, v); else await db.insert("actions", { ...v, finding_id: finding_id || v.finding_id });
      toast(action ? "Acción actualizada" : "Acción registrada", "ok"); await refresh(); onDone?.();
    },
    onDelete: action && db.can.manage ? async () => { await db.remove("actions", action.id); toast("Acción eliminada"); await refresh(); onDone?.(); } : null,
  });
}

/* -------------------------------- Drawer ----------------------------- */
function drawerHTML(f) {
  const acts = db.rows("actions").filter((a) => a.finding_id === f.id).sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9"));
  const notif = db.rows("customer_notifications").find((n) => n.finding_id === f.id);
  const audit = db.get("audits", f.audit_id);
  const idx = FINDING_FLOW.indexOf(f.status);
  const due = dueText(f.due_date);
  const overdue = due.overdue && f.status !== "cerrado";
  return `
  <div class="dialog-head"><div><span class="eyebrow mono">${esc(f.code)}</span><h2>${esc(f.title)}</h2>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${badge(SEVERITY, f.severity)}${badge(SOURCE, f.source)}${badge(FINDING_STATUS, f.status)}</div></div>
    <button class="btn ghost icon" data-close aria-label="Cerrar">${icon("close")}</button></div>
  <div class="dialog-body">
    <div class="stepper" role="group" aria-label="Estado">${FINDING_FLOW.map((s, i) => `<button class="step ${i < idx ? "done" : ""} ${i === idx ? "current" : ""}" ${db.can.write ? "" : "disabled"} data-action="f-status" data-id="${f.id}" data-status="${s}">${FINDING_STATUS[s][0]}</button>`).join("")}</div>

    <dl class="detail-grid" style="margin-top:22px">
      <div class="span-2"><dt>Descripción</dt><dd>${f.description ? esc(f.description) : '<span class="muted">Sin descripción</span>'}</dd></div>
      <div><dt>Responsable</dt><dd>${userCell(db.get("profiles", f.owner_id))}</dd></div>
      <div><dt>Fecha compromiso</dt><dd class="${overdue ? "overdue" : ""}">${due.text}</dd></div>
      <div><dt>Categoría</dt><dd>${esc(catName(f.classification_id))}</dd></div>
      <div><dt>Área</dt><dd>${esc(f.area || "—")}</dd></div>
      <div><dt>Causa raíz</dt><dd>${esc(f.root_cause || "—")}</dd></div>
      <div><dt>Cliente</dt><dd>${esc(clientName(f.client_id))}</dd></div>
      <div><dt>Origen</dt><dd>${audit ? `<a href="#/audits/${audit.id}">${esc(audit.code)}</a>` : notif ? `<a href="#/notifications/${notif.id}">${esc(notif.code)}</a>` : "—"}</dd></div>
      <div><dt>Registrado</dt><dd>${fmtDateTime(f.created_at)}</dd></div>
      ${f.closed_at ? `<div><dt>Cerrado</dt><dd>${fmtDateTime(f.closed_at)}</dd></div>` : ""}
    </dl>

    <div class="section-title"><span>Acciones (${acts.filter((a) => ["completada", "verificada"].includes(a.status)).length}/${acts.length})</span>
      ${db.can.write ? `<button class="btn sm" data-action="a-new" data-finding="${f.id}">${icon("plus")} Agregar</button>` : ""}</div>
    ${acts.length ? acts.map((a) => { const d = dueText(a.due_date); const late = d.overdue && !["completada", "verificada"].includes(a.status);
      return `<div class="item-row"><div><div><span class="mono" style="color:var(--g-cyan)">${esc(a.code)}</span> ${badge(ACTION_TYPE, a.action_type)} ${badge(ACTION_STATUS, a.status)}</div>
        <div style="margin-top:6px">${esc(a.description)}</div>
        <div class="meta">${esc(db.profileName(a.owner_id))} · <span class="${late ? "overdue" : ""}">${d.text}</span></div></div>
        ${db.can.write ? `<div style="display:flex;gap:6px">${a.status !== "verificada" ? `<button class="btn sm" data-action="a-next" data-id="${a.id}" title="Avanzar estado">${icon("chevR")}</button>` : ""}<button class="btn sm icon" data-action="a-edit" data-id="${a.id}" aria-label="Editar">${icon("edit")}</button></div>` : ""}</div>`; }).join("")
      : `<div class="muted" style="padding:6px 0 0">Aún no hay acciones. Agrega una acción de contención, correctiva o preventiva.</div>`}
    ${attachmentsSection("finding", f.id)}
  </div>
  ${db.can.write ? `<div class="dialog-foot"><button class="btn" data-action="f-edit" data-id="${f.id}">${icon("edit")} Editar</button></div>` : ""}`;
}

export function openFinding(id) {
  const f = db.get("findings", id);
  if (!f) { toast("Hallazgo no encontrado", "danger"); return; }
  drawerId = id;
  if (drawer && document.body.contains(drawer.el)) drawer.set(drawerHTML(f));
  else { drawer = openDrawer(drawerHTML(f)); }
}
async function refresh() {
  await rerender();
  if (drawer && document.body.contains(drawer.el)) { const f = db.get("findings", drawerId); f ? drawer.set(drawerHTML(f)) : drawer.close(); }
}

hooks.finding = () => refresh();

/* -------------------------------- Lista ------------------------------ */
const filtered = () => {
  const q = F.q.toLowerCase();
  return db.rows("findings")
    .filter((f) => (!F.status || f.status === F.status) && (!F.severity || f.severity === F.severity) && (!F.source || f.source === F.source) &&
      (!q || `${f.code} ${f.title} ${f.area || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.status === "cerrado") - (b.status === "cerrado") || SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.due_date || "9").localeCompare(b.due_date || "9"));
};

export default {
  id: "findings", label: "Hallazgos", icon: "finding",
  render(root, params) {
    setHead({
      eyebrow: "Gestión de calidad", title: "Hallazgos", subtitle: "Registra, analiza y da seguimiento a cada hallazgo hasta su cierre verificado.",
      actions: `<button class="btn" data-action="f-export">${icon("download")} Exportar CSV</button>${db.can.write ? `<button class="btn primary" data-action="f-new">${icon("plus")} Nuevo hallazgo</button>` : ""}`,
    });
    const list = filtered();
    root.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input class="input grow" type="search" placeholder="Buscar por folio, título o área…" value="${esc(F.q)}" data-input="f-q" id="f-q">
        <select class="select" data-change="f-filter" data-key="status"><option value="">Todos los estados</option>${Object.entries(FINDING_STATUS).map(([k, [l]]) => `<option value="${k}" ${F.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="f-filter" data-key="severity"><option value="">Toda severidad</option>${Object.entries(SEVERITY).map(([k, [l]]) => `<option value="${k}" ${F.severity === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="f-filter" data-key="source"><option value="">Todo origen</option>${Object.entries(SOURCE).map(([k, [l]]) => `<option value="${k}" ${F.source === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="count">${list.length} registro(s)</span>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Hallazgo</th><th>Origen</th><th>Severidad</th><th>Estado</th><th>Responsable</th><th>Compromiso</th><th class="num">Acciones</th></tr></thead><tbody>
        ${list.map((f) => { const acts = db.rows("actions").filter((a) => a.finding_id === f.id); const done = acts.filter((a) => ["completada", "verificada"].includes(a.status)).length; const d = dueText(f.due_date);
          return `<tr data-action="f-open" data-id="${f.id}"><td class="code">${esc(f.code)}</td><td><span class="title">${esc(f.title)}</span><span class="sub">${esc(f.area || "Sin área")}</span></td><td>${badge(SOURCE, f.source)}</td><td>${badge(SEVERITY, f.severity)}</td><td>${badge(FINDING_STATUS, f.status)}</td><td>${esc(db.profileName(f.owner_id))}</td><td class="${d.overdue && f.status !== "cerrado" ? "overdue" : ""}">${f.status === "cerrado" ? fmtDate(f.due_date) : d.text}</td><td class="num mono">${done}/${acts.length}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin hallazgos", "No hay registros con los filtros actuales.", "finding")}
    </div>`;
    if (params?.[0]) { openFinding(params[0]); replaceHash("findings"); }
  },
};

/* ------------------------------ Eventos ------------------------------ */
on("f-open", (el) => openFinding(el.dataset.id));
on("f-new", () => newFinding());
on("f-edit", (el) => editFinding(db.get("findings", el.dataset.id)));
on("f-export", () => downloadCSV("hallazgos.csv", [
  { label: "Folio", value: (r) => r.code }, { label: "Título", value: (r) => r.title }, { label: "Origen", value: (r) => SOURCE[r.source][0] },
  { label: "Severidad", value: (r) => SEVERITY[r.severity][0] }, { label: "Estado", value: (r) => FINDING_STATUS[r.status][0] },
  { label: "Responsable", value: (r) => db.profileName(r.owner_id) }, { label: "Área", value: (r) => r.area }, { label: "Compromiso", value: (r) => r.due_date }, { label: "Cierre", value: (r) => r.closed_at?.slice(0, 10) },
], filtered()));
on("f-status", async (el) => {
  const f = db.get("findings", el.dataset.id), status = el.dataset.status;
  if (f.status === status) return;
  if (status === "cerrado") {
    const open = db.rows("actions").filter((a) => a.finding_id === f.id && !["completada", "verificada"].includes(a.status));
    if (open.length && !(await confirmDialog({ title: "Acciones pendientes", message: `Hay ${open.length} acción(es) sin completar. ¿Cerrar el hallazgo de todos modos?`, confirmLabel: "Cerrar hallazgo" }))) return;
  }
  try { await db.update("findings", f.id, { status }); await refresh(); } catch (e) { toast(e.message, "danger"); }
});
on("a-new", (el) => actionForm({ finding_id: el.dataset.finding }));
on("a-edit", (el) => actionForm({ finding_id: db.get("actions", el.dataset.id).finding_id, action: db.get("actions", el.dataset.id) }));
on("a-next", async (el) => {
  const a = db.get("actions", el.dataset.id);
  const next = ACTION_FLOW[Math.min(ACTION_FLOW.indexOf(a.status) + 1, ACTION_FLOW.length - 1)];
  try { await db.update("actions", a.id, { status: next }); await refresh(); } catch (e) { toast(e.message, "danger"); }
});
onChange("f-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("f-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("f-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });
