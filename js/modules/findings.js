import * as db from "../db.js";
import { esc, today, fmtDate, fmtDateTime, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, replaceHash, wsId } from "../router.js";
import { findingsOf, auditsOf, auditWs, WS_LABEL } from "../scope.js";
import { on, onChange, onInput, badge, userCell, empty, openDrawer, openForm, confirmDialog, toast } from "../ui.js";
import { SOURCE, FINDING_STATUS } from "../constants.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { notifyFindings } from "../notify.js";
import { catOpts, clientOpts, mapOpts, catName, clientName } from "./shared.js";
import {
  classes, classBadge, classOptions, classTag, scopesForWs, classOf, deadlineFields, areaOptions, resolveOwner, milestones, overdueKind, canAct, canTransfer, canVerify, verifyDays,
  STAGES, STAGE_LABEL, stageOf, eventsOf, acceptFinding, transferFinding, savePlan, closeActions, acceptVerification, rejectVerification,
} from "../workflow.js";

// Filtros independientes por módulo (Auditorías, Internas, Issues)
const FS = {};
const blankF = () => ({ q: "", status: "", cls: "", source: "", mine: "" });
const F = new Proxy({}, {
  get: (_, k) => (FS[wsId()] ||= blankF())[k],
  set: (_, k, v) => { (FS[wsId()] ||= blankF())[k] = v; return true; },
});
const isIssues = () => wsId() === "issues";
const staff = () => db.activeProfiles().filter((p) => ["admin", "quality_manager", "auditor"].includes(p.role));

let drawer = null, drawerId = null, viewStage = null, tickTimer = null;
const drafts = {}; // texto escrito y aún no guardado, por hallazgo y etapa

/* ------------------------------- Formularios ------------------------------- */
const classChoices = (current) => { const o = classOptions(scopesForWs(wsId())); const c = db.get("finding_classes", current); if (c && !o.some(([v]) => v === c.id)) o.push([c.id, `${c.code} · ${c.days} días hábiles (fuera de este módulo)`]); return o; };
const findingFields = (editing, current) => ([
  { name: "title", label: "Título del hallazgo", required: true, span2: true },
  { name: "description", label: "Descripción", type: "textarea", span2: true },
  { name: "source", label: "Origen", type: "select", required: true, options: mapOpts(SOURCE) },
  { name: "class_id", label: "Clasificación", type: "select", required: true, options: classChoices(current), hint: classOptions(scopesForWs(wsId())).length ? "Define el plazo en días hábiles para cerrar las acciones." : "No hay clasificaciones para este módulo: créalas en Configuración → Clasificaciones y niveles." },
  { name: "area_id", label: "Área", type: "select", options: areaOptions() },
  ...(!editing || db.can.admin ? [{ name: "owner_id", label: "Responsable", type: "select", options: staff().map((p) => [p.id, p.full_name]), hint: editing ? "" : "Si lo dejas vacío se asigna el dueño del área." }] : []),
  { name: "classification_id", label: "Categoría", type: "select", options: catOpts("categoria_hallazgo") },
  ...(isIssues() ? [{ name: "client_id", label: "Cliente", type: "select", options: clientOpts() }] : [{ name: "audit_id", label: "Auditoría origen", type: "select", options: auditsOf(wsId()).map((a) => [a.id, a.code]) }]),
]);

export function newFinding(defaults = {}) {
  openForm({
    eyebrow: WS_LABEL[wsId()], title: "Registrar hallazgo", fields: findingFields(false), size: "wide",
    values: { source: isIssues() ? "cliente" : "auditoria", ...defaults }, submitLabel: "Registrar hallazgo",
    onSubmit: async (v) => {
      const owner = v.owner_id || resolveOwner(v.area_id, null) || null;
      const r = await db.insert("findings", { ...v, owner_id: owner, area: db.get("areas", v.area_id)?.name || null, module: wsId(), status: "abierto", ...deadlineFields(v.class_id) });
      toast(`Hallazgo ${r.code} registrado${owner ? ` · se avisó a ${db.profileName(owner)}` : " · sin responsable (asígnalo desde Editar)"}`, "ok");
      if (owner) notifyFindings([r], "assigned");
      await refresh();
    },
  });
}
function editFinding(f) {
  openForm({
    eyebrow: f.code, title: "Editar hallazgo", fields: findingFields(true, f.class_id), values: f, size: "wide",
    onSubmit: async (v) => {
      const patch = { ...v, area: db.get("areas", v.area_id)?.name || null };
      if (v.class_id !== f.class_id && !f.actions_closed_at && f.status !== "cerrado") Object.assign(patch, { due_at: deadlineFields(v.class_id, new Date(f.start_date ? f.start_date + "T00:00:00" : Date.now())).due_at, due_date: deadlineFields(v.class_id, new Date(f.start_date ? f.start_date + "T00:00:00" : Date.now())).due_date });
      await db.update("findings", f.id, patch); toast("Hallazgo actualizado", "ok"); await refresh();
    },
    onDelete: db.can.manage ? async () => { await db.remove("findings", f.id); drawer?.close(); toast("Hallazgo eliminado"); await refresh(); } : null,
  });
}
function transferForm(f) {
  openForm({
    eyebrow: f.code, title: "Trasladar hallazgo", submitLabel: "Trasladar",
    intro: `<div class="note warn" style="margin-bottom:14px"><b>Solo se puede trasladar una vez.</b> La persona que lo reciba deberá aceptarlo y ya no podrá trasladarlo.</div>`,
    fields: [
      { name: "to", label: "Nuevo responsable", type: "select", required: true, span2: true, options: staff().filter((p) => p.id !== f.owner_id).map((p) => [p.id, `${p.full_name}${p.area ? " · " + p.area : ""}`]) },
      { name: "reason", label: "Motivo del traslado", type: "textarea", required: true, span2: true, placeholder: "Ej. El proceso lo gestiona otra área…" },
    ],
    onSubmit: async (v) => {
      await transferFinding(f, v.to, v.reason.trim()); viewStage = "abierto";
      toast(`Hallazgo trasladado a ${db.profileName(v.to)}`, "ok"); notifyFindings([db.get("findings", f.id)], "transferred"); await refresh();
    },
  });
}
function rejectForm(f) {
  openForm({
    eyebrow: f.code, title: "Rechazar verificación", submitLabel: "Rechazar y reabrir",
    intro: `<div class="note warn" style="margin-bottom:14px">El hallazgo se <b>reabre</b> y el responsable deberá corregir y cerrar las acciones de nuevo. El milestone de cierre <b>continúa con el tiempo que le quedaba</b>.</div>`,
    fields: [{ name: "reason", label: "Motivo del rechazo", type: "textarea", required: true, span2: true, placeholder: "¿Qué falta o por qué las acciones no fueron efectivas?" }],
    onSubmit: async (v) => {
      await rejectVerification(f, v.reason.trim()); viewStage = "abierto";
      toast("Verificación rechazada · hallazgo reabierto", "ok"); notifyFindings([db.get("findings", f.id)], "rejected"); await refresh();
    },
  });
}

/* ------------------------- Milestones: nubes flotantes ---------------------- */
const pad = (n) => String(n).padStart(2, "0");
const STATE_TAG = { ontime: "✔ A tiempo", late: "✖ Tarde", overdue: "● Vencido", running: "● En curso", pending: "" };

function cloudHTML(m, title, soon) {
  const dig = (n, l, off) => `<div><b>${off ? "—" : n}</b><span>${l}</span></div>`;
  if (!m) return `<div class="cloud-wrap"><div class="cloud off"><div class="cloud-k"><span>${title}</span></div><div class="cloud-clock off">${dig(0, "días", 1)}${dig(0, "horas", 1)}${dig(0, "min", 1)}</div><div class="cloud-cap">${soon}</div></div></div>`;
  return `<div class="cloud-wrap"><div class="cloud" data-tone="${m.tone}"><div class="cloud-k"><span>${title}</span><i>${STATE_TAG[m.state]}</i></div>
    <div class="cloud-clock">${dig(m.dur.d, "días")}${dig(pad(m.dur.h), "horas")}${dig(pad(m.dur.m), "min")}</div>
    <div class="cloud-cap"><b>${esc(m.caption)}</b> · límite ${fmtDateTime(m.due)}</div><div class="progress"><i style="width:${m.pct}%"></i></div></div></div>`;
}
const cloudsInner = (f) => { const { m1, m2 } = milestones(f); return `${cloudHTML(m1, "Milestone · Cierre de acciones")}${cloudHTML(m2, "Verificación", `Empieza al cerrar las acciones · ${verifyDays()} días hábiles`)}`; };

function removeClouds() { clearInterval(tickTimer); tickTimer = null; document.getElementById("msClouds")?.remove(); }
function paintClouds(f) {
  let box = document.getElementById("msClouds");
  if (!box) { box = document.createElement("div"); box.id = "msClouds"; box.className = "ms-clouds"; document.body.append(box); }
  box.innerHTML = cloudsInner(f);
  const inline = document.getElementById("msInline"); if (inline) inline.innerHTML = cloudsInner(f);
}
function startTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!drawer || !document.body.contains(drawer.el)) return removeClouds();
    const f = db.get("findings", drawerId); if (f) paintClouds(f);
  }, 15000);
}

/* ---------------------------------- Drawer --------------------------------- */
const evidenceOfOrigin = (f) => {
  const ans = db.rows("audit_answers").find((a) => a.finding_id === f.id);
  return ans ? attachmentsSection("audit", f.audit_id, { ref: ans.item_id, title: "Evidencia de la auditoría", canEdit: false }) : "";
};

const EV_TEXT = {
  accepted: (e) => `Aceptado por <b>${esc(db.profileName(e.actor))}</b>`,
  transferred: (e) => `Trasladado · ${esc(e.detail || "")}`,
  actions_closed: (e) => `Acciones cerradas · ${esc(e.detail || "")}`,
  rejected: (e) => `Verificación <b>rechazada</b> por ${esc(db.profileName(e.actor))} · «${esc(e.detail || "")}»`,
  verified: (e) => `Verificado y cerrado por <b>${esc(db.profileName(e.actor))}</b> · ${esc(e.detail || "")}`,
};
function timelineHTML(f) {
  const who = (id) => esc(db.profileName(id)), ev = [], saved = eventsOf(f);
  ev.push({ at: f.created_at, text: `Hallazgo registrado${f.audit_id ? " desde una auditoría" : ""}` });
  if (saved.length) saved.forEach((e) => ev.push({ at: e.created_at, text: (EV_TEXT[e.kind] || (() => esc(e.kind)))(e) }));
  else {                       // hallazgos anteriores al historial: se reconstruye con sus campos
    if (f.transferred_at) ev.push({ at: f.transferred_at, text: `Trasladado de <b>${who(f.transferred_from)}</b> a <b>${who(f.owner_id)}</b>${f.transfer_reason ? ` · «${esc(f.transfer_reason)}»` : ""}` });
    if (f.accepted_at) ev.push({ at: f.accepted_at, text: `Aceptado por <b>${who(f.accepted_by)}</b>` });
    if (f.actions_closed_at || f.actions_closed_on) ev.push({ at: f.actions_closed_at || f.actions_closed_on + "T12:00:00", text: "Acciones cerradas" });
    if (f.verified_at) ev.push({ at: f.verified_at, text: `Verificado y cerrado por <b>${who(f.verified_by)}</b>` });
  }
  ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return `<ul class="timeline">${ev.map((e) => `<li>${e.text}<time>${fmtDateTime(e.at)}</time></li>`).join("")}</ul>`;
}

const lock = (t) => `<div class="lock-note">${t}</div>`;
const draftOf = (f, key, saved) => drafts[`${f.id}:${key}`] ?? saved ?? "";
const textArea = (f, key, saved, ph) => `<textarea class="textarea" id="f-${key}" data-input="f-draft" data-key="${f.id}:${key}" rows="5" placeholder="${esc(ph)}">${esc(draftOf(f, key, saved))}</textarea>`;
const originLink = (f) => {
  const audit = db.get("audits", f.audit_id), notif = db.rows("customer_notifications").find((n) => n.finding_id === f.id);
  return audit ? `<a href="#/${auditWs(audit)}/audit/${audit.id}">${esc(audit.code)}</a>` : notif ? `<a href="#/issues/notificaciones/${notif.id}">${esc(notif.code)}</a>` : "—";
};

function stageHTML(f, st) {
  const cur = STAGES.indexOf(stageOf(f)), idx = STAGES.indexOf(st), act = canAct(f);
  const ownerName = esc(db.profileName(f.owner_id));
  const evid = (editable) => attachmentsSection("finding", f.id, { ref: "accion", title: "Evidencia de la acción", canEdit: editable });
  if (st === "abierto") {
    const area = db.get("areas", f.area_id);
    let controls = "";
    if (f.status === "abierto") {
      if (!f.owner_id) controls = lock("Este hallazgo no tiene responsable. Un administrador debe asignarlo desde <b>Editar</b>.");
      else if (act) controls = `<div class="stage-actions"><button class="btn primary" data-action="f-accept" data-id="${f.id}">${icon("check2")} Aceptar hallazgo</button>${canTransfer(f) ? `<button class="btn" data-action="f-transfer" data-id="${f.id}">${icon("swap")} Trasladar</button>` : ""}</div>${f.transfer_count > 0 ? lock("Este hallazgo ya fue trasladado una vez; no puede trasladarse de nuevo.") : ""}`;
      else controls = lock(`Solo <b>${ownerName}</b> (o un administrador) puede aceptar o trasladar este hallazgo.`);
    } else if (f.accepted_at) controls = `<div class="done-text">Aceptado por <b>${esc(db.profileName(f.accepted_by))}</b> · ${fmtDateTime(f.accepted_at)}</div>`;
    const rejected = f.reject_count > 0 && f.status === "abierto" ? `<div class="reject-note"><b>Verificación rechazada${f.rejected_at ? " el " + fmtDateTime(f.rejected_at) : ""}</b><br>${esc(f.rejection_reason || "")}<br><span class="muted">El hallazgo se reabrió y el milestone de cierre continúa con el tiempo que le quedaba.</span></div>` : "";
    return `${rejected}<dl class="detail-grid">
      <div class="span-2"><dt>Descripción</dt><dd>${f.description ? esc(f.description) : '<span class="muted">Sin descripción</span>'}</dd></div>
      <div><dt>Responsable</dt><dd>${userCell(db.get("profiles", f.owner_id))}${f.status === "abierto" && f.owner_id ? ' <span class="badge" data-tone="warn">Por aceptar</span>' : ""}</dd></div>
      <div><dt>Clasificación</dt><dd>${classBadge(f)} <span class="muted">${esc(classOf(f)?.name || "")}</span></dd></div>
      <div><dt>Área</dt><dd>${esc(area?.name || f.area || "—")}</dd></div><div><dt>Categoría</dt><dd>${esc(catName(f.classification_id))}</dd></div>
      <div><dt>Origen</dt><dd>${originLink(f)}</dd></div><div><dt>Cliente</dt><dd>${esc(clientName(f.client_id))}</dd></div>
      <div><dt>Registrado</dt><dd>${fmtDateTime(f.created_at)}</dd></div><div><dt>Límite de acciones</dt><dd>${fmtDateTime(f.due_at || f.due_date)}</dd></div>
      ${f.transfer_count > 0 ? `<div class="span-2"><dt>Traslado</dt><dd>De <b>${esc(db.profileName(f.transferred_from))}</b> a <b>${ownerName}</b> · ${fmtDate((f.transferred_at || "").slice(0, 10))} · «${esc(f.transfer_reason || "")}»</dd></div>` : ""}
    </dl>${controls}${evidenceOfOrigin(f)}${attachmentsSection("finding", f.id, { ref: null, title: "Evidencias del hallazgo", canEdit: act && cur === 0 })}`;
  }
  if (st === "en_accion") {
    if (idx > cur) return `<h3>Acción</h3>${lock("Disponible cuando el responsable acepte el hallazgo.")}`;
    if (idx < cur) return `<h3>¿Qué se hizo para corregir el hallazgo?</h3><div class="done-text">${esc(f.action_plan || "—")}</div>${evid(false)}<div class="muted" style="margin-top:6px;font-size:13px">Acciones cerradas el ${fmtDateTime(f.actions_closed_at || f.actions_closed_on)}</div>`;
    return `<h3>Acción</h3><span class="q-label">¿Qué se hará para corregir el hallazgo?</span>${act ? `${textArea(f, "plan", f.action_plan, "Describe la acción correctiva…")}${evid(true)}<div class="stage-actions"><button class="btn" data-action="f-plan-save" data-id="${f.id}">Guardar borrador</button><button class="btn primary" data-action="f-actions-close" data-id="${f.id}">Cerrar acciones y enviar a verificación</button></div>${lock("Para cerrar las acciones se requiere la descripción y al menos una evidencia (archivo o foto).")}` : `${f.action_plan ? `<div class="done-text">${esc(f.action_plan)}</div>` : ""}${evid(false)}${lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la acción.`)}`}`;
  }
  if (st === "verificacion") {
    if (idx > cur) return `<h3>Verificación</h3>${lock(`Disponible cuando se cierren las acciones. Un administrador tendrá ${verifyDays()} días hábiles para aceptar o rechazar.`)}`;
    const recap = `<span class="q-label">Acción realizada</span><div class="done-text">${esc(f.action_plan || "—")}</div>${evid(false)}`;
    if (idx < cur) return `<h3>Verificación</h3>${recap}<span class="q-label">Resultado de la verificación</span><div class="done-text">${esc(f.verification_notes || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">Aceptada por ${esc(db.profileName(f.verified_by))} · ${fmtDateTime(f.verified_at)}</div>`;
    return `<h3>Verificación</h3>${recap}${canVerify(f) ? `<span class="q-label">¿Las acciones fueron efectivas? Describe cómo se verificó</span>${textArea(f, "verify", f.verification_notes, "Resultado de la verificación…")}<div class="stage-actions"><button class="btn primary" data-action="f-verify-accept" data-id="${f.id}">${icon("check2")} Aceptar</button><button class="btn danger" data-action="f-verify-reject" data-id="${f.id}">${icon("close")} Rechazar</button></div>${lock("Aceptar cierra el hallazgo. Rechazar lo reabre y el milestone de cierre continúa donde se quedó.")}` : lock("Solo un <b>administrador</b> puede aceptar o rechazar la verificación.")}`;
  }
  /* cerrado */
  if (idx > cur) return `<h3>Cerrado</h3>${lock("El hallazgo se cierra cuando un administrador acepta la verificación.")}`;
  const { m1, m2 } = milestones(f);
  return `<h3>Hallazgo cerrado</h3><dl class="detail-grid"><div><dt>Cierre de acciones</dt><dd>${esc(m1.text)}</dd></div><div><dt>Verificación</dt><dd>${esc(m2?.text || "—")}</dd></div>
    <div><dt>Verificó</dt><dd>${esc(db.profileName(f.verified_by))}</dd></div><div><dt>Cerrado</dt><dd>${fmtDateTime(f.closed_at || f.verified_at)}</dd></div>
    ${f.reject_count > 0 ? `<div><dt>Rechazos previos</dt><dd>${f.reject_count}</dd></div>` : ""}
    <div class="span-2"><dt>Resultado de la verificación</dt><dd>${esc(f.verification_notes || "—")}</dd></div></dl>`;
}

function drawerHTML(f) {
  const cur = STAGES.indexOf(stageOf(f)), view = viewStage || stageOf(f);
  return `
  <div class="dialog-head"><div><span class="eyebrow mono">${esc(f.code)}</span><h2>${esc(f.title)}</h2>
    <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;align-items:center">${classBadge(f)}${badge(SOURCE, f.source)}${badge(FINDING_STATUS, f.status)}${f.reject_count > 0 ? `<span class="badge" data-tone="danger">Rechazado ${f.reject_count}×</span>` : ""}</div></div>
    <button class="btn ghost icon" data-close aria-label="Cerrar">${icon("close")}</button></div>
  <div class="dialog-body">
    <div class="ms-row" id="msInline">${cloudsInner(f)}</div>
    <div class="stepper" role="tablist" aria-label="Etapas del hallazgo">${STAGES.map((s, i) => `<button class="step ${i < cur ? "done" : ""} ${i === cur ? "current" : ""} ${s === view ? "viewing" : ""} ${i > cur ? "locked" : ""}" role="tab" aria-selected="${s === view}" data-action="f-stage" data-stage="${s}">${STAGE_LABEL[s]}</button>`).join("")}</div>
    <div class="stage" id="f-stage-body">${stageHTML(f, view)}</div>
    <div class="section-title"><span>Historial</span></div>${timelineHTML(f)}
  </div>
  ${db.can.write ? `<div class="dialog-foot"><button class="btn" data-action="f-edit" data-id="${f.id}">${icon("edit")} Editar</button></div>` : ""}`;
}

export function openFinding(id, stage) {
  const f = db.get("findings", id);
  if (!f) { toast("Hallazgo no encontrado", "danger"); return; }
  if (drawerId !== id || stage) viewStage = stage || null;
  drawerId = id;
  if (drawer && document.body.contains(drawer.el)) drawer.set(drawerHTML(f)); else drawer = openDrawer(drawerHTML(f), { onClose: removeClouds });
  paintClouds(f); startTick();
}
const paintDrawer = () => { const f = db.get("findings", drawerId); if (f && drawer && document.body.contains(drawer.el)) { drawer.set(drawerHTML(f)); paintClouds(f); } };
async function refresh() {
  await rerender();
  if (drawer && document.body.contains(drawer.el)) { const f = db.get("findings", drawerId); if (f) { drawer.set(drawerHTML(f)); paintClouds(f); } else drawer.close(); }
}
hooks.finding = () => refresh();

/* ---------------------------------- Lista ---------------------------------- */
function plazoCell(f) {
  const { m1, m2 } = milestones(f), tag = (m, pre) => `<span class="${m.tone === "danger" ? "overdue" : ""}" style="${m.tone === "ok" ? "color:var(--ok-ink);font-weight:600" : ""}">${pre}${esc(m.text)}</span>`;
  if (f.status === "cerrado") return `${tag(m1, "Acciones: ")}<span class="sub">${m2 ? tag(m2, "Verificación: ") : ""}</span>`;
  if (stageOf(f) === "verificacion") return `${tag(m2, "Verificar · ")}<span class="sub">Límite ${fmtDateTime(m2.due)}</span>`;
  return `${tag(m1, "")}<span class="sub">Límite ${fmtDateTime(m1.due)}</span>`;
}
const filtered = () => {
  const q = F.q.toLowerCase();
  const rank = (f) => (db.get("finding_classes", f.class_id)?.days ?? 999);
  return findingsOf(wsId())
    .filter((f) => (!F.status || stageOf(f) === F.status) && (!F.cls || f.class_id === F.cls) && (!F.source || f.source === F.source) && (!F.mine || f.owner_id === db.state.profile.id) &&
      (!q || `${f.code} ${f.title} ${f.area || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.status === "cerrado") - (b.status === "cerrado") || (!!overdueKind(b) - !!overdueKind(a)) || rank(a) - rank(b) || (a.due_date || "9").localeCompare(b.due_date || "9"));
};

export default {
  id: "findings", label: "Hallazgos", icon: "finding",
  render(root, params) {
    setHead({
      title: "Hallazgos", subtitle: `Hallazgos de ${WS_LABEL[wsId()]}: el responsable acepta y registra la acción; un administrador acepta o rechaza la verificación.`,
      actions: `<button class="btn" data-action="f-export">${icon("download")} Exportar CSV</button>${db.can.write ? `<button class="btn primary" data-action="f-new">${icon("plus")} Nuevo hallazgo</button>` : ""}`,
    });
    const list = filtered(), pend = findingsOf(wsId()).filter((f) => f.status === "abierto" && f.owner_id === db.state.profile.id).length;
    root.innerHTML = `
    ${pend ? `<div class="note warn" style="margin-bottom:14px"><b>Tienes ${pend} hallazgo(s) por aceptar.</b> Ábrelos para aceptarlos o trasladarlos.</div>` : ""}
    <div class="panel">
      <div class="toolbar">
        <input class="input grow" type="search" placeholder="Buscar por folio, título o área…" value="${esc(F.q)}" data-input="f-q" id="f-q">
        <select class="select" data-change="f-filter" data-key="status"><option value="">Todas las etapas</option>${Object.entries(FINDING_STATUS).filter(([k]) => k !== "en_analisis").map(([k, [l]]) => `<option value="${k}" ${F.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="f-filter" data-key="cls"><option value="">Toda clasificación</option>${classes(scopesForWs(wsId())).map((c) => `<option value="${c.id}" ${F.cls === c.id ? "selected" : ""}>${esc(classTag(c))}</option>`).join("")}</select>
        <select class="select" data-change="f-filter" data-key="source"><option value="">Todo origen</option>${Object.entries(SOURCE).map(([k, [l]]) => `<option value="${k}" ${F.source === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="f-filter" data-key="mine"><option value="">Todos los responsables</option><option value="1" ${F.mine ? "selected" : ""}>Solo los míos</option></select>
        <span class="count">${list.length} registro(s)</span>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Hallazgo</th><th>Origen</th><th>Clasificación</th><th>Etapa</th><th>Responsable</th><th>Plazo</th></tr></thead><tbody>
        ${list.map((f) => `<tr data-action="f-open" data-id="${f.id}"><td class="code">${esc(f.code)}</td><td><span class="title">${esc(f.title)}</span><span class="sub">${esc(f.area || "Sin área")}</span></td><td>${badge(SOURCE, f.source)}</td><td>${classBadge(f)}</td><td>${badge(FINDING_STATUS, f.status)}${f.reject_count > 0 && f.status === "abierto" ? '<span class="sub overdue">Rechazado</span>' : ""}</td>
          <td>${esc(db.profileName(f.owner_id))}${f.status === "abierto" && f.owner_id ? '<span class="sub" style="color:var(--watch-ink);font-weight:600">Por aceptar</span>' : !f.owner_id ? '<span class="sub overdue">Sin responsable</span>' : ""}</td><td>${plazoCell(f)}</td></tr>`).join("")}
      </tbody></table></div>` : empty("Sin hallazgos", "No hay registros con los filtros actuales.", "finding")}
    </div>`;
    if (params?.[0]) { openFinding(params[0], params[1]); replaceHash(`${wsId()}/hallazgos`); }
  },
};

/* --------------------------------- Eventos --------------------------------- */
const fnd = (el) => db.get("findings", el.dataset.id);
const run = async (fn, nextStage) => { try { await fn(); if (nextStage) viewStage = nextStage; await refresh(); } catch (e) { toast(e.message, "danger"); } };
const val = (id) => (document.getElementById(id)?.value || "").trim();

on("f-open", (el) => openFinding(el.dataset.id));
on("f-new", () => newFinding());
on("f-edit", (el) => editFinding(fnd(el)));
on("f-stage", (el) => { viewStage = el.dataset.stage; paintDrawer(); });
on("f-accept", (el) => run(async () => { await acceptFinding(fnd(el)); toast("Hallazgo aceptado · ahora está En acción", "ok"); }, "en_accion"));
on("f-transfer", (el) => transferForm(fnd(el)));
on("f-plan-save", (el) => run(async () => { await savePlan(fnd(el), val("f-plan")); delete drafts[`${el.dataset.id}:plan`]; toast("Borrador guardado", "ok"); }));
on("f-actions-close", async (el) => {
  const f = fnd(el), text = val("f-plan"), ev = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id && a.ref === "accion").length;
  if (text.length < 5) { toast("Describe qué se hará para corregir el hallazgo.", "danger"); return; }
  if (!ev) { toast("Adjunta al menos una evidencia (archivo o foto) de la acción.", "danger"); return; }
  const m1 = milestones(f).m1, late = m1.state === "overdue";
  if (!(await confirmDialog({ title: "Cerrar acciones", message: `El milestone de cierre se detiene ahora (${late ? "fuera de tiempo: quedará en rojo" : "a tiempo: quedará en verde"}) y empieza la verificación: un administrador tendrá ${verifyDays()} días hábiles para aceptar o rechazar.`, confirmLabel: "Cerrar acciones" }))) return;
  run(async () => { await closeActions(f, text); delete drafts[`${f.id}:plan`]; toast("Acciones cerradas · en Verificación", "ok"); notifyFindings([db.get("findings", f.id)], "verify"); }, "verificacion");
});
on("f-verify-accept", (el) => {
  const notes = val("f-verify");
  if (notes.length < 5) { toast("Describe cómo se verificó la efectividad de las acciones.", "danger"); return; }
  run(async () => { await acceptVerification(fnd(el), notes); delete drafts[`${el.dataset.id}:verify`]; toast("Verificación aceptada · hallazgo cerrado", "ok"); }, "cerrado");
});
on("f-verify-reject", (el) => rejectForm(fnd(el)));
onInput("f-draft", (el) => { drafts[el.dataset.key] = el.value; });
on("f-export", () => downloadCSV(`hallazgos_${wsId()}.csv`, [
  { label: "Folio", value: (r) => r.code }, { label: "Título", value: (r) => r.title }, { label: "Origen", value: (r) => SOURCE[r.source]?.[0] },
  { label: "Clasificación", value: (r) => classOf(r)?.code }, { label: "Etapa", value: (r) => FINDING_STATUS[r.status][0] }, { label: "Responsable", value: (r) => db.profileName(r.owner_id) },
  { label: "Área", value: (r) => r.area }, { label: "Inicio", value: (r) => r.start_date }, { label: "Límite acciones", value: (r) => r.due_at || r.due_date }, { label: "Acciones cerradas", value: (r) => r.actions_closed_at || r.actions_closed_on },
  { label: "Límite verificación", value: (r) => r.verify_due_at || r.verify_due }, { label: "Verificado", value: (r) => r.verified_at || r.verified_on }, { label: "Rechazos", value: (r) => r.reject_count || 0 },
], filtered()));
onChange("f-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("f-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("f-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });
