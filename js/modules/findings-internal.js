/* =====================================================================
   Auditorías Internas · vista de pantalla completa del hallazgo
   Abierto → Descripción del problema → Contención → Causa raíz → Acciones →
   Verificación → Cierre. Columna izquierda: Milestone · Archivos · Historial.
   Centro: pasos + estado de la etapa. Derecha: Detalles (fijo).
   ===================================================================== */
import * as db from "../db.js";
import { esc, uuid, fmtDate, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, navigate, wsId } from "../router.js";
import { WS_LABEL } from "../scope.js";
import { on, onChange, onInput, badge, userCell, empty, openForm, confirmDialog, toast, withFocusPreserved } from "../ui.js";
import { SOURCE, FINDING_STATUS } from "../constants.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { notifyFindings } from "../notify.js";
import { catOpts, clientOpts, mapOpts, catName, clientName } from "./shared.js";
import { fillHTML, readFill, gridOwners } from "../templates.js";
import {
  classes, classBadge, classOptions, classOf, levelOptions, levelLabel, areaOptions, resolveOwner, milestones, overdueKind, canAct, canTransfer, canVerify, verifyDaysFor, verifyDays, scopesForWs,
  STAGES_INTERNAL, STAGE_LABEL_INTERNAL, eventsOf, acceptInternal, transferFinding, saveProblem, advanceProblem, saveContainment, advanceContainment,
  saveRca, advanceRca, savePlan, closeActions, acceptVerification, rejectVerification,
  isEightD, dStages, eightdStages, dLabel, PS_TYPES, RCA_TYPES, canRegister, canSetStrategy, canActD, canVerify8D,
  registerFinding, saveStrategy, saveRcaMethod, acceptD, saveD, advanceD, closeVerification8D, rejectVerification8D, deadlineFields,
  canReview4D, closure4DStatus, sendToReview4D, approveReview4D, rejectReview4D, sendToReview, approveReview, rejectReview,
} from "../workflow.js";
import { exportFinding8D4D } from "../pdf8d.js";

const staff = () => db.activeProfiles().filter((p) => ["admin", "manager", "auditor"].includes(p.role));
const drafts = {};                         // texto sin guardar: `${id}:${campo}`
const tplState = {};                       // plantilla elegida y datos sin guardar: `${id}:${kind}`
let tick = null;

/* --------------------------- Origen: norma, cláusula, proceso ---------------------- */
function originInfo(f) {
  const audit = db.get("audits", f.audit_id);
  if (!audit) return {};
  const form = db.get("forms", audit.form_id), ans = db.rows("audit_answers").find((a) => a.finding_id === f.id);
  const item = ans ? db.get("form_items", ans.item_id) : null;
  return { audit, form, item, standard: form ? db.get("standards", form.standard_id) : null, process: db.get("areas", audit.process_area_id) };
}

/* ------------------------------------- Detalles ------------------------------------ */
function detailsEvidenceHTML(f) {
  const list = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id);
  if (!list.length) return `<span class="muted">Sin evidencia todavía</span>`;
  return `<div class="if-d-evidence">${list.map((a) => (a.mime_type || "").startsWith("image/")
    ? `<a class="if-d-ev-item" data-att="${a.id}" target="_blank" rel="noopener" title="${esc(a.file_name)}"><img alt="${esc(a.file_name)}"></a>`
    : `<a class="if-d-ev-item file" data-att="${a.id}" target="_blank" rel="noopener" download="${esc(a.file_name)}" title="${esc(a.file_name)}">${icon("form")}</a>`).join("")}</div>`;
}
function detailsHTML(f) {
  const area = db.get("areas", f.area_id), { audit, standard, item, process } = originInfo(f);
  const row = (k, v) => `<div class="if-d-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  return `<div class="if-card"><h3>${icon("list")} Detalles</h3>
    ${row("Responsable", userCell(db.get("profiles", f.owner_id)) + (f.status === "abierto" && f.owner_id ? ' <span class="badge" data-tone="warn">Por aceptar</span>' : ""))}
    ${row("Evidencia", detailsEvidenceHTML(f))}
    ${(() => { const n = db.rows("customer_notifications").find((x) => x.finding_id === f.id); return n ? row("Notificación", `<a href="#/issues/notificaciones/${n.id}">${icon("bell")} ${esc(n.code)} · ${esc(n.subject)}</a>`) : ""; })()}
    ${row("Clasificación", classBadge(f))}
    ${row("Proceso / Área", f.process_id ? `${esc(db.get("processes", f.process_id)?.code || "")} · ${esc(db.get("processes", f.process_id)?.name || "")}` : esc(process?.name || area?.name || f.area || "—"))}
    ${standard ? row("Norma aplicable", esc(standard.name)) : ""}
    ${item?.clause ? row("Cláusula", `<span class="mono">${esc(item.clause)}</span>`) : ""}
    ${row("Categoría", esc(catName(f.classification_id)))}
    ${row("Origen", audit ? `<a href="#/${f.module}/audit/${audit.id}">${esc(audit.code)}</a>` : esc(SOURCE[f.source]?.[0] || f.source || "—"))}
    ${f.client_id ? row("Cliente", esc(clientName(f.client_id))) : ""}
    ${row("Registrado", fmtDateTime(f.created_at))}
    ${row("Límite de acciones", fmtDateTime(f.due_at || f.due_date))}
    ${f.transfer_count > 0 ? row("Traslado", `De <b>${esc(db.profileName(f.transferred_from))}</b> a <b>${esc(db.profileName(f.owner_id))}</b><br><span class="muted">«${esc(f.transfer_reason || "")}»</span>`) : ""}
    ${f.reject_count > 0 ? row("Rechazos", `<span class="overdue">${f.reject_count}</span>`) : ""}
  </div>`;
}

/* ------------------------------------- Milestone ------------------------------------ */
function msSideHTML(m, title, soon) {
  if (!m) return `<div class="if-ms off"><div class="if-ms-k">${title}</div><div class="if-ms-clock"><div><b>—</b><span>d</span></div><div><b>—</b><span>h</span></div><div><b>—</b><span>min</span></div></div><div class="if-ms-cap">${soon || "Sin iniciar"}</div></div>`;
  const tag = { ontime: "✔ A tiempo", late: "✖ Tarde", overdue: "● Vencido", running: "● En curso" }[m.state] || "";
  return `<div class="if-ms" data-tone="${m.tone}"><div class="if-ms-k"><span>${title}</span><i>${tag}</i></div>
    <div class="if-ms-clock"><div><b>${m.dur.d}</b><span>d</span></div><div><b>${String(m.dur.h).padStart(2, "0")}</b><span>h</span></div><div><b>${String(m.dur.m).padStart(2, "0")}</b><span>min</span></div></div>
    <div class="if-ms-cap"><b>${esc(m.caption)}</b> · límite ${fmtDateTime(m.due)}</div><div class="progress"><i style="width:${m.pct}%"></i></div></div>`;
}
function milestoneCard(f) {
  const { m1, m2 } = milestones(f);
  return `<div class="if-card"><h3>${icon("calendar")} Milestone</h3>${msSideHTML(m1, "Cierre de acciones")}${msSideHTML(m2, "Verificación", `Empieza al cerrar las acciones · ${verifyDaysFor(f)} días hábiles`)}</div>`;
}

/* ------------------------------------- Archivos ------------------------------------- */
function filesCard(f) {
  const list = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id);
  return `<div class="if-card"><h3>${icon("form")} Archivos<span class="if-count">${list.length}</span></h3>
    ${list.length ? `<div class="att-grid compact">${list.map((a) => (a.mime_type || "").startsWith("image/")
        ? `<div class="att-item"><a class="att-thumb" data-att="${a.id}" target="_blank" rel="noopener" title="${esc(a.file_name)}"><img alt="${esc(a.file_name)}"></a></div>`
        : `<div class="att-item file"><a data-att="${a.id}" target="_blank" rel="noopener" download="${esc(a.file_name)}">${icon("form")}<span><b>${esc(a.file_name)}</b></span></a></div>`).join("")}</div>`
      : `<p class="if-empty">Aún sin archivos. Se adjuntan dentro de cada etapa.</p>`}</div>`;
}

/* ------------------------------------- Historial ------------------------------------- */
const EV_TEXT = {
  accepted: (e) => `Aceptado por <b>${esc(db.profileName(e.actor))}</b>`,
  transferred: (e) => `Trasladado · ${esc(e.detail || "")}`,
  problem: () => "Descripción del problema registrada",
  containment: () => "Acciones de contención registradas",
  rca: () => "Análisis de causa raíz registrado",
  actions_closed: (e) => `Acciones cerradas · ${esc(e.detail || "")}`,
  rejected: (e) => `Verificación <b>rechazada</b> por ${esc(db.profileName(e.actor))} · «${esc(e.detail || "")}»`,
  verified: (e) => `Verificado y cerrado por <b>${esc(db.profileName(e.actor))}</b> · ${esc(e.detail || "")}`,
  registered: (e) => `Registrado y clasificado por <b>${esc(db.profileName(e.actor))}</b>`,
  strategy: (e) => `Estrategia definida: <b>${esc(e.detail || "")}</b>`,
  rca_method: (e) => `Método de causa raíz elegido: <b>${esc(e.detail || "")}</b>`,
  d_stage: (e) => `Etapa completada: ${esc(e.detail || "")}`,
  sent_review: (e) => `Enviado a revisar · revisor: <b>${esc(e.detail || "")}</b>`,
  review_approved: (e) => `Revisado y <b>aprobado</b> por ${esc(db.profileName(e.actor))} · «${esc(e.detail || "")}»`,
  review_rejected: (e) => `Revisado y <b>rechazado</b> por ${esc(db.profileName(e.actor))} · «${esc(e.detail || "")}»`,
};
function historyCard(f) {
  const ev = [{ at: f.created_at, text: "Hallazgo registrado" }, ...eventsOf(f).map((e) => ({ at: e.created_at, text: (EV_TEXT[e.kind] || (() => esc(e.kind)))(e) }))];
  ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return `<div class="if-card"><h3>${icon("audit")} Historial</h3><ul class="if-history">${ev.map((e) => `<li>${e.text}<time>${fmtDateTime(e.at)}</time></li>`).join("")}</ul></div>`;
}

/* ------------------------------------- Plantillas ------------------------------------ */
const TPL = { rca: { table: "rca_templates", label: "Análisis de causa raíz", free: "analysis_text" }, capa: { table: "capa_templates", label: "Acción correctiva", free: "action_plan" } };
function tplDraftFor(f, kind) {
  const key = `${f.id}:${kind}`;
  if (!tplState[key]) { const doc = db.rows("finding_documents").find((d) => d.finding_id === f.id && d.kind === kind); tplState[key] = { templateId: doc?.template_id || "", data: doc?.data ? { ...doc.data } : {} }; }
  return tplState[key];
}
function templateBlock(f, kind, editable) {
  const C = TPL[kind], key = `${f.id}:${kind}`, st = tplDraftFor(f, kind), templates = db.rows(C.table).filter((t) => t.active);
  const tpl = templates.find((t) => t.id === st.templateId);
  const freeVal = drafts[`${f.id}:${C.free}`] ?? f[C.free] ?? "";
  if (tpl) gridOwners[key] = { schema: tpl.schema, getData: () => tplDraftFor(f, kind).data, repaint: (data) => { tplDraftFor(f, kind).data = data; paint(); } };
  return `<label class="field" style="max-width:360px"><span>Formato ${kind === "rca" ? "de causa raíz" : "de acción correctiva"}</span>
      <select class="select" data-change="lif-tpl-pick" data-id="${f.id}" data-kind="${kind}" ${editable ? "" : "disabled"}><option value="">— Texto libre —</option>${templates.map((t) => `<option value="${t.id}" ${t.id === st.templateId ? "selected" : ""}>${esc(t.code)} · ${esc(t.name)}</option>`).join("")}</select></label>
    <div id="if-tpl-${kind}" class="if-tpl-body" data-tpl-root="${key}">${tpl
      ? fillHTML(tpl.schema, st.data, !editable)
      : (editable ? `<textarea class="textarea" data-input="if-draft" data-key="${f.id}:${C.free}" rows="4" placeholder="${kind === "rca" ? "¿Por qué se presentó esta situación? (puedes elegir un formato arriba, como 5 Porqués o Ishikawa)" : "¿Qué se hará para corregir el hallazgo?"}">${esc(freeVal)}</textarea>`
                   : `<div class="tpl-ro">${freeVal ? esc(freeVal).replace(/\n/g, "<br>") : '<span class="muted">—</span>'}</div>`)}</div>`;
}
async function saveTemplateIfAny(f, kind) {
  const key = `${f.id}:${kind}`, st = tplState[key];
  if (!st?.templateId) return null;
  const root = document.getElementById(`if-tpl-${kind}`), tpl = db.get(TPL[kind].table, st.templateId);
  const data = root ? readFill(root, tpl.schema) : st.data;
  await db.upsertMany("finding_documents", [{ finding_id: f.id, kind, template_id: st.templateId, data, updated_by: db.state.profile.id }], ["finding_id", "kind"]);
  return data;
}
const hasTemplateContent = (f, kind) => { const st = tplDraftFor(f, kind); if (!st.templateId) return false; const d = st.data || {}; return Object.values(d).some((v) => Array.isArray(v) ? v.some((r) => r.some((c) => String(c || "").trim())) : String(v || "").trim()); };

/* --------------------------------------- Pasos --------------------------------------- */
const lock = (t) => `<div class="lock-note">${t}</div>`;
function legacyStepBody(f, st) {
  const STAGES = STAGES_INTERNAL, cur = STAGES.indexOf(f.status === "en_analisis" ? "rca" : f.status), idx = STAGES.indexOf(st), act = canAct(f), ownerName = esc(db.profileName(f.owner_id));
  const draftKey = (k) => `${f.id}:${k}`, draftVal = (k, saved) => drafts[draftKey(k)] ?? saved ?? "";
  const ta = (k, saved, ph) => `<textarea class="textarea" id="ta-${k}" data-input="if-draft" data-key="${draftKey(k)}" rows="5" placeholder="${esc(ph)}">${esc(draftVal(k, saved))}</textarea>`;

  if (st === "abierto") {
    let controls = "";
    if (f.status === "abierto") {
      if (!f.owner_id) controls = lock("Este hallazgo no tiene responsable. Un administrador debe asignarlo desde <b>Editar</b>.");
      else if (act) controls = `<div class="stage-actions"><button class="btn primary" data-action="lif-accept" data-id="${f.id}">${icon("check2")} Aceptar hallazgo</button>${canTransfer(f) ? `<button class="btn" data-action="lif-transfer" data-id="${f.id}">${icon("swap")} Trasladar</button>` : ""}</div>${f.transfer_count > 0 ? lock("Este hallazgo ya fue trasladado una vez; no puede trasladarse de nuevo.") : ""}`;
      else controls = lock(`Solo <b>${ownerName}</b> (o un administrador) puede aceptar o trasladar este hallazgo.`);
    } else controls = `<div class="done-text">Aceptado por <b>${esc(db.profileName(f.accepted_by))}</b> · ${fmtDateTime(f.accepted_at)}</div>`;
    const rejected = f.reject_count > 0 && f.status === "abierto" ? `<div class="reject-note"><b>Verificación rechazada${f.rejected_at ? " el " + fmtDateTime(f.rejected_at) : ""}</b><br>${esc(f.rejection_reason || "")}</div>` : "";
    return `${rejected}<p class="muted" style="margin-bottom:14px">${esc(f.description || "Sin descripción inicial.")}</p>${controls}${attachmentsSection("finding", f.id, { ref: null, title: "Evidencia inicial", canEdit: act && idx <= cur })}`;
  }
  if (st === "descripcion") {
    if (idx > cur) return lock("Disponible cuando el responsable acepte el hallazgo.");
    if (idx < cur) return `<div class="done-text">${esc(f.problem_desc || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.problem_at)}</div>`;
    return act ? `<p class="q-label">¿Qué, cuándo, dónde y cuánto? Describe el problema con el mayor detalle posible.</p>${ta("problem_desc", f.problem_desc, "Describe el problema…")}${attachmentsSection("finding", f.id, { ref: "descripcion", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="lif-save" data-id="${f.id}" data-field="problem_desc">Guardar borrador</button><button class="btn primary" data-action="lif-advance" data-id="${f.id}" data-to="contencion" data-field="problem_desc">Guardar y continuar</button></div>` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la descripción.`);
  }
  if (st === "contencion") {
    if (idx > cur) return lock("Disponible cuando se registre la descripción del problema.");
    if (idx < cur) return `<div class="done-text">${esc(f.containment_text || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.containment_at)}</div>`;
    return act ? `<p class="q-label">¿Qué se hizo de inmediato para contener el problema?</p>${ta("containment_text", f.containment_text, "Acciones de contención inmediatas…")}${attachmentsSection("finding", f.id, { ref: "contencion", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="lif-save" data-id="${f.id}" data-field="containment_text">Guardar borrador</button><button class="btn primary" data-action="lif-advance" data-id="${f.id}" data-to="rca" data-field="containment_text">Guardar y continuar</button></div>` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la contención.`);
  }
  if (st === "rca") {
    if (idx > cur) return lock("Disponible cuando se registren las acciones de contención.");
    if (idx < cur) return `<div class="done-text">${esc(f.analysis_text || "Ver formato de causa raíz guardado.")}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.analysis_at)}</div>`;
    return act ? `<p class="q-label">Análisis de causa raíz</p>${templateBlock(f, "rca", true)}${attachmentsSection("finding", f.id, { ref: "rca", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="lif-save-tpl" data-id="${f.id}" data-kind="rca">Guardar borrador</button><button class="btn primary" data-action="lif-advance-rca" data-id="${f.id}">Guardar y continuar</button></div>` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar el análisis.`);
  }
  if (st === "en_accion") {
    if (idx > cur) return lock("Disponible cuando se registre el análisis de causa raíz.");
    if (idx < cur) return `<div class="done-text">${esc(f.action_plan || "Ver formato de acción correctiva guardado.")}</div><div class="muted" style="margin-top:6px;font-size:13px">Acciones cerradas el ${fmtDateTime(f.actions_closed_at || f.actions_closed_on)}</div>`;
    return act ? `<p class="q-label">¿Qué se hará para corregir el hallazgo de forma definitiva?</p>${templateBlock(f, "capa", true)}${attachmentsSection("finding", f.id, { ref: "accion", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="lif-save-tpl" data-id="${f.id}" data-kind="capa">Guardar borrador</button><button class="btn primary" data-action="lif-close-actions" data-id="${f.id}">Cerrar acciones y enviar a verificación</button></div>${lock(`Un administrador tendrá ${verifyDaysFor(f)} días hábiles para aceptar o rechazar. Se requiere descripción (o formato) y al menos una evidencia.`)}` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la acción.`);
  }
  if (st === "verificacion") {
    if (idx > cur) return lock("Disponible cuando se cierren las acciones.");
    const recap = `<p class="q-label">Causa raíz</p>${templateBlock(f, "rca", false)}<p class="q-label" style="margin-top:14px">Acción correctiva</p>${templateBlock(f, "capa", false)}${attachmentsSection("finding", f.id, { ref: "accion", title: "Evidencia de la acción", canEdit: false })}`;
    if (idx < cur) return `${recap}<p class="q-label" style="margin-top:14px">Resultado de la verificación</p><div class="done-text">${esc(f.verification_notes || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">${fmtDateTime(f.verified_at)}</div>`;
    return `${recap}${canVerify(f) ? `<p class="q-label" style="margin-top:14px">¿Las acciones fueron efectivas?</p>${ta("verification_notes", f.verification_notes, "Resultado de la verificación…")}<div class="stage-actions"><button class="btn primary" data-action="lif-verify-accept" data-id="${f.id}">${icon("check2")} Aceptar</button><button class="btn danger" data-action="lif-verify-reject" data-id="${f.id}">${icon("close")} Rechazar</button></div>` : lock("Solo un <b>administrador</b> puede aceptar o rechazar la verificación.")}`;
  }
  /* cerrado */
  if (idx > cur) return lock("El hallazgo se cierra cuando un administrador acepta la verificación.");
  const { m1, m2 } = milestones(f);
  return `<div class="if-closed-grid"><div><dt>Cierre de acciones</dt><dd>${esc(m1.text)}</dd></div><div><dt>Verificación</dt><dd>${esc(m2?.text || "—")}</dd></div>
    <div><dt>Verificó</dt><dd>${esc(db.profileName(f.verified_by))}</dd></div><div><dt>Cerrado</dt><dd>${fmtDateTime(f.closed_at || f.verified_at)}</dd></div></div>
    <p class="q-label" style="margin-top:14px">Resultado de la verificación</p><div class="done-text">${esc(f.verification_notes || "—")}</div>`;
}

/* ---------------------------------------- Página -------------------------------------- */
let viewStage = null, curId = null;
function legacyPageHTML(f) {
  const STAGES = STAGES_INTERNAL, cur = STAGES.indexOf(f.status === "en_analisis" ? "rca" : f.status), view = viewStage || (f.status === "en_analisis" ? "rca" : f.status);
  return `<div class="if-page">
    <div class="if-head">
      <button class="btn ghost icon" data-action="if-back" aria-label="Volver a la lista">${icon("chevL")}</button>
      <div class="if-head-t"><span class="eyebrow mono">${esc(f.code)}</span><h1>${esc(f.title)}</h1></div>
      <div class="if-head-badges">${badge(FINDING_STATUS, f.status)}${f.reject_count > 0 ? `<span class="badge" data-tone="danger">Rechazado ${f.reject_count}×</span>` : ""}</div>
      ${db.can.write ? `<button class="btn" data-action="lif-edit" data-id="${f.id}">${icon("edit")} Editar</button>` : ""}
    </div>
    <div class="if-grid">
      <aside class="if-side">${milestoneCard(f)}${filesCard(f)}${historyCard(f)}</aside>
      <main class="if-main">
        <div class="if-steps" role="tablist" aria-label="Etapas del hallazgo">${STAGES.map((s, i) => `<button class="if-step ${i < cur ? "done" : ""} ${i === cur ? "current" : ""} ${s === view ? "viewing" : ""} ${i > cur ? "locked" : ""}" role="tab" aria-selected="${s === view}" data-action="if-stage" data-stage="${s}"><span>${STAGE_LABEL_INTERNAL[s]}</span></button>`).join("")}</div>
        <div class="if-status" id="if-status-box"><div class="if-status-k">${STAGE_LABEL_INTERNAL[view]}</div>${legacyStepBody(f, view)}</div>
      </main>
      <aside class="if-details">${detailsHTML(f)}</aside>
    </div>
  </div>`;
}
function paint() {
  withFocusPreserved(() => {
    const f = db.get("findings", curId);
    const root = document.getElementById("if-root");
    if (!f || !root) return;
    root.innerHTML = isEightD(f) ? e8dPageHTML(f) : legacyPageHTML(f);
  });
}
export function renderInternalFinding(root, id, stage) {
  const f = db.get("findings", id);
  clearInterval(tick);
  if (!f) { setHead({ title: "Hallazgo no encontrado" }); root.innerHTML = empty("No se encontró el hallazgo", "Puede que haya sido eliminado.", "finding"); return; }
  curId = id; if (stage) viewStage = stage; else if (!viewStage) viewStage = null;
  setHead({ eyebrow: WS_LABEL[f.module] || WS_LABEL[wsId()], title: f.code, subtitle: f.title });
  root.innerHTML = `<div id="if-root"></div>`;
  paint();
  tick = setInterval(paint, 15000);
}
hooks.finding = async () => paint();

/* ------------------------------------- Formularios ------------------------------------ */
function legacyEditFinding(f) {
  openForm({
    eyebrow: f.code, title: "Editar hallazgo", size: "wide",
    values: f,
    fields: [
      { name: "title", label: "Título del hallazgo", required: true, span2: true },
      { name: "description", label: "Descripción", type: "textarea", span2: true },
      { name: "source", label: "Origen", type: "select", required: true, options: mapOpts(SOURCE) },
      { name: "class_id", label: "Clasificación", type: "select", required: true, options: classOptions(scopesForWs(f.module)) },
      { name: "area_id", label: "Área", type: "select", options: areaOptions() },
      { name: "owner_id", label: "Responsable", type: "select", options: staff().map((p) => [p.id, p.full_name]) },
      { name: "classification_id", label: "Categoría", type: "select", options: catOpts("categoria_hallazgo") },
    ],
    onSubmit: async (v) => { await db.update("findings", f.id, { ...v, area: db.get("areas", v.area_id)?.name || null }); toast("Hallazgo actualizado", "ok"); paint(); },
    onDelete: db.can.manage ? async () => { await db.remove("findings", f.id); toast("Hallazgo eliminado"); navigate(`${wsId()}/hallazgos`); } : null,
  });
}
function legacyTransferForm(f) {
  openForm({
    eyebrow: f.code, title: "Trasladar hallazgo", submitLabel: "Trasladar",
    intro: `<div class="note warn" style="margin-bottom:14px"><b>Solo se puede trasladar una vez.</b></div>`,
    fields: [
      { name: "to", label: "Nuevo responsable", type: "select", required: true, span2: true, options: staff().filter((p) => p.id !== f.owner_id).map((p) => [p.id, p.full_name]) },
      { name: "reason", label: "Motivo del traslado", type: "textarea", required: true, span2: true },
    ],
    onSubmit: async (v) => { await transferFinding(f, v.to, v.reason.trim()); toast(`Hallazgo trasladado a ${db.profileName(v.to)}`, "ok"); notifyFindings([db.get("findings", f.id)], "transferred"); paint(); },
  });
}
function legacyRejectForm(f) {
  openForm({
    eyebrow: f.code, title: "Rechazar verificación", submitLabel: "Rechazar y reabrir",
    intro: `<div class="note warn" style="margin-bottom:14px">El hallazgo se <b>reabre</b> en la etapa Abierto. El milestone de cierre continúa con el tiempo que le quedaba.</div>`,
    fields: [{ name: "reason", label: "Motivo del rechazo", type: "textarea", required: true, span2: true }],
    onSubmit: async (v) => { await rejectVerification(f, v.reason.trim()); viewStage = "abierto"; toast("Verificación rechazada · hallazgo reabierto", "ok"); notifyFindings([db.get("findings", f.id)], "rejected"); paint(); },
  });
}

/* ---------------------------------------- Eventos --------------------------------------- */
const fnd = (id) => db.get("findings", id);
const val = (k) => (document.getElementById(`ta-${k}`)?.value ?? drafts[Object.keys(drafts).find((x) => x.endsWith(":" + k))] ?? "").trim();
const run = async (fn, next) => { try { await fn(); if (next) viewStage = next; paint(); } catch (e) { toast(e.message, "danger"); } };

on("if-back", () => navigate(`${wsId()}/hallazgos`));
on("lif-edit", (el) => legacyEditFinding(fnd(el.dataset.id)));
on("if-stage", (el) => { viewStage = el.dataset.stage; paint(); });
on("lif-accept", (el) => run(async () => { await acceptInternal(fnd(el.dataset.id)); toast("Hallazgo aceptado", "ok"); }, "descripcion"));
on("lif-transfer", (el) => legacyTransferForm(fnd(el.dataset.id)));
on("lif-save", (el) => run(async () => { const f = fnd(el.dataset.id), field = el.dataset.field, text = val(field); await db.update("findings", f.id, { [field]: text }); toast("Borrador guardado", "ok"); }));
on("lif-advance", (el) => {
  const f = fnd(el.dataset.id), field = el.dataset.field, to = el.dataset.to, text = val(field);
  if (text.length < 5) { toast("Escribe el contenido de esta etapa.", "danger"); return; }
  const fn = field === "problem_desc" ? () => advanceProblem(f, text) : () => advanceContainment(f, text);
  run(async () => { await fn(); delete drafts[`${f.id}:${field}`]; toast("Guardado · siguiente etapa", "ok"); }, to);
});
on("lif-save-tpl", (el) => run(async () => { await saveTemplateIfAny(fnd(el.dataset.id), el.dataset.kind); const f = fnd(el.dataset.id); const free = val(TPL[el.dataset.kind].free); if (free) await db.update("findings", f.id, { [TPL[el.dataset.kind].free]: free }); toast("Borrador guardado", "ok"); }));
on("lif-advance-rca", (el) => {
  const f = fnd(el.dataset.id), free = val("analysis_text"), tpl = hasTemplateContent(f, "rca");
  if (!tpl && free.length < 5) { toast("Describe la causa raíz o elige y llena un formato.", "danger"); return; }
  run(async () => { await saveTemplateIfAny(f, "rca"); await advanceRca(f, tpl ? (f.analysis_text || "Ver formato de causa raíz guardado.") : free); toast("Guardado · pasa a Acciones", "ok"); }, "en_accion");
});
on("lif-close-actions", async (el) => {
  const f = fnd(el.dataset.id), free = val("action_plan"), tpl = hasTemplateContent(f, "capa");
  const ev = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id && a.ref === "accion").length;
  if (!tpl && free.length < 5) { toast("Describe la acción correctiva o elige y llena un formato.", "danger"); return; }
  if (!ev) { toast("Adjunta al menos una evidencia de la acción.", "danger"); return; }
  const m1 = milestones(f).m1, late = m1.state === "overdue";
  if (!(await confirmDialog({ title: "Cerrar acciones", message: `El milestone de cierre se detiene ahora (${late ? "fuera de tiempo" : "a tiempo"}) y empieza la verificación: un administrador tendrá ${verifyDaysFor(f)} días hábiles.`, confirmLabel: "Cerrar acciones" }))) return;
  run(async () => { await saveTemplateIfAny(f, "capa"); await closeActions(f, tpl ? (f.action_plan || "Ver formato de acción correctiva guardado.") : free); toast("Acciones cerradas · en Verificación", "ok"); notifyFindings([db.get("findings", f.id)], "verify"); }, "verificacion");
});
on("lif-verify-accept", (el) => {
  const notes = val("verification_notes");
  if (notes.length < 5) { toast("Describe cómo se verificó la efectividad de las acciones.", "danger"); return; }
  run(async () => { await acceptVerification(fnd(el.dataset.id), notes); toast("Verificación aceptada · hallazgo cerrado", "ok"); }, "cerrado");
});
on("lif-verify-reject", (el) => legacyRejectForm(fnd(el.dataset.id)));
onInput("if-draft", (el) => { drafts[el.dataset.key] = el.value; });
onChange("lif-tpl-pick", (el) => { tplDraftFor(fnd(el.dataset.id), el.dataset.kind).templateId = el.value; paint(); });

/* =====================================================================
   Flujo 8D / 4D (nuevo) · Registro → Detalles → Solicitud → D1…D8/D4 → Verificación
   ===================================================================== */
const staffAll = () => db.activeProfiles().filter((p) => ["admin", "manager", "auditor"].includes(p.role));
const gridFieldId = (key) => `g_${key}`;
/** Lo que hay escrito en cada tabla AHORA MISMO (aunque no se haya guardado): evita que un repintado
 *  de fondo (reloj del milestone, refresco al subir una evidencia…) borre lo que la persona ya tecleó. */
const gridDrafts = {};
const clearGridDrafts = (findingId) => { for (const k of Object.keys(gridDrafts)) if (k.startsWith(`${findingId}:`)) delete gridDrafts[k]; };
document.addEventListener("input", (e) => {
  const cell = e.target.closest("[data-grid]"), root = e.target.closest("[data-tpl-root]");
  if (!cell || !root) return;
  const fid = cell.dataset.grid;
  gridDrafts[root.dataset.tplRoot] = [...root.querySelectorAll("tr[data-ri]")].map((tr) => [...tr.querySelectorAll(`[data-grid="${fid}"]`)].map((i) => i.value));
});

/** Sección con una sola tabla tipo hoja de cálculo (reutiliza el motor de plantillas) */
function gridSection(title, key, columns, f, editable, rows) {
  const gid = `${f.id}:${key}`, fieldId = gridFieldId(key);
  const schema = { sections: [{ id: key, title: " ", fields: [{ id: fieldId, label: "", type: "grid", columns }] }] };
  const live = gridDrafts[gid] ?? (f.d_data?.[key]?.length ? f.d_data[key] : rows);
  const data = { [fieldId]: live || undefined };
  if (editable) gridOwners[gid] = { schema, getData: () => ({ [fieldId]: gridDrafts[gid] ?? f.d_data?.[key] ?? [] }), repaint: (d) => { gridDrafts[gid] = d[fieldId]; paint(); } };
  return `<div class="e8-block"><h4>${esc(title)}</h4><div data-tpl-root="${gid}">${fillHTML(schema, data, !editable)}</div></div>`;
}
function readGrid(f, key) {
  const root = document.querySelector(`[data-tpl-root="${f.id}:${key}"]`);
  if (!root) return f.d_data?.[key] || [];
  const fid = gridFieldId(key);
  const rows = [...root.querySelectorAll("tr[data-ri]")].map((tr) => [...tr.querySelectorAll(`[data-grid="${fid}"]`)].map((i) => i.value));
  return rows.filter((r) => r.some((c) => c.trim()));
}

/* -------------------------- Acciones con evidencia obligatoria ------------------------- */
/** Cada fila de "Acciones" es una tarjeta (no una hoja de cálculo): Acción, Responsable, Fecha
 *  límite (con calendario, sin pasar el milestone de cierre) y su propia Evidencia. La fecha de
 *  cierre NO se escribe a mano: se pone sola en cuanto se adjunta la primera evidencia de esa fila. */
function actionRows(f, key) { return drafts[`${f.id}:act.${key}`] ?? f.d_data?.[key] ?? []; }
function evidenceDateFor(f, ref) {
  const atts = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id && a.ref === ref).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return atts[0]?.created_at || null;
}
function actionField(f, key, i, field, row, type = "text", extra = "") {
  const dk = `${f.id}:act.${key}.${i}.${field}`, v = drafts[dk] ?? row[field] ?? "";
  return `<input class="input" type="${type}" data-input="e8-dd" data-key="${dk}" value="${esc(v)}" ${extra}>`;
}
function rootCausesOf(f) { return db.rows("root_causes").filter((rc) => rc.finding_id === f.id).sort((a, b) => (a.code || "").localeCompare(b.code || "")); }
function rcSelect(f, key, i, r) {
  const dk = `${f.id}:act.${key}.${i}.root_cause_id`, v = drafts[dk] ?? r.root_cause_id ?? "";
  const rcs = rootCausesOf(f);
  return `<label class="field span-2"><span>Causa raíz relacionada <i>*</i></span><select class="select" data-input="e8-dd" data-key="${dk}">${rcs.length ? `<option value="">— Elegir causa raíz —</option>${rcs.map((rc) => `<option value="${rc.id}" ${rc.id === v ? "selected" : ""}>${esc(rc.code)} · ${esc(rc.text)}</option>`).join("")}` : `<option value="">No hay causas raíz registradas todavía</option>`}</select></label>`;
}
function actionGrid(title, key, f, editable, { maxDue, withRootCause } = {}) {
  const rows = actionRows(f, key);
  const cards = rows.map((r, i) => {
    const ref = `${key}:${r.id}`, closedAt = evidenceDateFor(f, ref);
    return `<div class="act-card">
      <div class="act-fields">
        <label class="field span-2"><span>Acción <i>*</i></span>${actionField(f, key, i, "action", r, "text", editable ? "" : "disabled")}</label>
        <label class="field"><span>Responsable</span>${actionField(f, key, i, "responsible", r, "text", editable ? "" : "disabled")}</label>
        <label class="field"><span>Fecha límite</span>${actionField(f, key, i, "due", r, "date", `${maxDue ? `max="${maxDue}"` : ""} ${editable ? "" : "disabled"}`)}</label>
        ${withRootCause ? rcSelect(f, key, i, r) : ""}
      </div>
      ${attachmentsSection("finding", f.id, { ref, title: "Evidencia (obligatoria para cerrar)", canEdit: editable })}
      <div class="act-close ${closedAt ? "done" : "pending"}">${closedAt ? `${icon("check2")} Cerrada automáticamente al adjuntar evidencia · ${fmtDateTime(closedAt)}` : "Pendiente de cerrar: se cierra sola en cuanto adjuntes una evidencia"}</div>
      ${editable ? `<button type="button" class="btn sm ghost" data-action="e8-act-del" data-key="${key}" data-ri="${i}">${icon("close")} Quitar</button>` : ""}
    </div>`;
  }).join("") || '<p class="muted" style="margin-bottom:10px">Sin acciones todavía.</p>';
  return `<div class="e8-block" data-act-section="${key}"><h4>${esc(title)}</h4>${cards}${editable ? `<button type="button" class="btn sm" data-action="e8-act-add" data-key="${key}">${icon("plus")} Agregar acción</button>` : ""}</div>`;
}

function readActionRows(f, key) {
  return actionRows(f, key).map((r, i) => ({ id: r.id, action: (drafts[`${f.id}:act.${key}.${i}.action`] ?? r.action ?? "").trim(), responsible: (drafts[`${f.id}:act.${key}.${i}.responsible`] ?? r.responsible ?? "").trim(), due: drafts[`${f.id}:act.${key}.${i}.due`] ?? r.due ?? "", root_cause_id: drafts[`${f.id}:act.${key}.${i}.root_cause_id`] ?? r.root_cause_id ?? null }))
    .filter((r) => r.action || r.responsible || r.due);
}
const textField = (f, key, label, ph = "", required = false) => {
  const v = drafts[`${f.id}:dd.${key}`] ?? f.d_data?.[key] ?? "";
  return `<label class="field"><span>${esc(label)}${required ? " <i>*</i>" : ""}</span><input class="input" data-input="e8-dd" data-key="${f.id}:dd.${key}" value="${esc(v)}" placeholder="${esc(ph)}"></label>`;
};
const textAreaField = (f, key, label, ph = "", span2 = true) => {
  const v = drafts[`${f.id}:dd.${key}`] ?? f.d_data?.[key] ?? "";
  return `<label class="field ${span2 ? "span-2" : ""}"><span>${esc(label)}</span><textarea class="textarea" rows="3" data-input="e8-dd" data-key="${f.id}:dd.${key}" placeholder="${esc(ph)}">${esc(v)}</textarea></label>`;
};
function readDraftDD(f, keys) {
  const out = {};
  for (const k of keys) out[k] = (document.querySelector(`[data-key="${f.id}:dd.${k}"]`)?.value ?? f.d_data?.[k] ?? "").trim();
  return out;
}

/* ------------------------------- Detalles (panel derecho) ------------------------------ */
function e8dDetailsHTML(f) {
  const area = db.get("areas", f.area_id), { audit, standard, item, process } = originInfo(f);
  const row = (k, v) => `<div class="if-d-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  return `<div class="if-card"><h3>${icon("list")} Detalles</h3>
    ${f.strategy_ps ? row("Estrategia", `<span class="badge" data-tone="info">${esc(f.strategy_ps)}</span>${f.strategy_ps === "8D" ? ` <span class="badge" data-tone="info">${esc(RCA_TYPES[f.strategy_rca] || "—")}</span>` : ""}`) : ""}
    ${f.status !== "registro" ? row("Responsable", userCell(db.get("profiles", f.owner_id)) + (f.status === "solicitud" ? ' <span class="badge" data-tone="warn">Por aceptar</span>' : "")) : ""}
    ${(() => { const n = db.rows("customer_notifications").find((x) => x.finding_id === f.id); return n ? row("Notificación", `<a href="#/issues/notificaciones/${n.id}" class="if-d-notif-link"><span class="if-d-notif-icon">${icon("bell")}</span> ${esc(n.code)} · ${esc(n.subject)}</a>`) : ""; })()}
    ${f.class_id ? row("Clasificación", classBadge(f)) : ""}
    ${row("Proceso / Área", f.process_id ? `${esc(db.get("processes", f.process_id)?.code || "")} · ${esc(db.get("processes", f.process_id)?.name || "")}` : esc(process?.name || area?.name || f.area || "—"))}
    ${standard ? row("Norma aplicable", esc(standard.name)) : ""}
    ${(f.clause || item?.clause) ? row("Cláusula", `<span class="mono">${esc(f.clause || item?.clause)}</span>`) : ""}
    ${row("Origen", audit ? `<a href="#/${f.module}/audit/${audit.id}">${esc(audit.code)}</a>` : esc(SOURCE[f.source]?.[0] || f.source || "—"))}
    ${row("Registrado", fmtDateTime(f.created_at))}
    ${f.due_at ? row("Límite de acciones", fmtDateTime(f.due_at)) : ""}
    ${f.transfer_count > 0 ? row("Traslado", `De <b>${esc(db.profileName(f.transferred_from))}</b> a <b>${esc(db.profileName(f.owner_id))}</b><br><span class="muted">«${esc(f.transfer_reason || "")}»</span>`) : ""}
    ${f.reject_count > 0 ? row("Rechazos", `<span class="overdue">${f.reject_count}</span>`) : ""}
  </div>`;
}

/* ------------------------------- Etapas: Registro / Detalles / Solicitud ------------------------------ */
function stageRegistro(f) {
  if (!canRegister(f)) return lock("Solo un administrador puede registrar y clasificar este hallazgo.");
  const areaKind = drafts[`${f.id}:areaKind`] ?? (f.process_id ? "process" : "area");
  return `<p class="muted" style="margin-bottom:14px">${esc(f.description || "Sin descripción inicial.")}</p>
    <div class="form-grid">
      <label class="field"><span>Clasificación <i>*</i></span><select class="select" data-input="e8-reg" data-key="class_id">${classOptions(scopesForWs(f.module)).map(([v, l]) => `<option value="${v}" ${v === f.class_id ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="field span-2"><span>Proceso / Área</span>
        <div class="seg-mini" role="tablist" aria-label="Proceso o Área">
          <button type="button" class="seg-mini-opt ${areaKind !== "process" ? "active" : ""}" data-action="e8-reg-kind" data-kind="area">Área</button>
          <button type="button" class="seg-mini-opt ${areaKind === "process" ? "active" : ""}" data-action="e8-reg-kind" data-kind="process">Proceso</button>
        </div>
        ${areaKind === "process"
          ? `<select class="select" data-input="e8-reg" data-key="process_id"><option value="">— Proceso —</option>${db.rows("processes").filter((p) => p.active).sort((a, b) => (a.code || "").localeCompare(b.code || "")).map((p) => `<option value="${p.id}" ${p.id === f.process_id ? "selected" : ""}>${esc(p.code)} · ${esc(p.name)}</option>`).join("")}</select>`
          : `<select class="select" data-input="e8-reg" data-key="area_id"><option value="">— Área —</option>${areaOptions().map(([v, l]) => `<option value="${v}" ${v === f.area_id ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`}
      </label>
      <label class="field"><span>Cláusula / punto afectado</span><input class="input" data-input="e8-reg" data-key="clause" value="${esc(f.clause || "")}"></label>
      <label class="field"><span>Responsable <i>*</i></span><select class="select" data-input="e8-reg" data-key="owner_id"><option value="">— Responsable —</option>${staffAll().map((p) => `<option value="${p.id}" ${p.id === f.owner_id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></label>
    </div>
    ${attachmentsSection("finding", f.id, { ref: null, title: "Evidencia inicial", canEdit: true })}
    <div class="stage-actions"><button class="btn primary" data-action="e8-register" data-id="${f.id}">${icon("check2")} Registrar y continuar</button></div>`;
}
function stageDetalles(f) {
  const idx = eightdStages(f).indexOf("detalles"), cur = eightdStages(f).indexOf(f.status);
  if (idx > cur) return lock("Disponible cuando se registre y clasifique el hallazgo.");
  if (idx < cur) return `<div class="done-text">Estrategia: <b>${esc(f.strategy_ps)}</b> · Correctivas ${f.corrective_mandatory ? "obligatorias" : "opcionales"} · Preventivas ${f.preventive_mandatory ? "obligatorias" : "opcionales"}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.strategy_at)}</div>`;
  if (!canSetStrategy(f)) return lock("Solo un administrador define la estrategia de solución.");
  const ps = drafts[`${f.id}:ps`] ?? f.strategy_ps ?? "8D";
  return `<p class="muted" style="margin-bottom:14px">Define cómo se resolverá este hallazgo. El equipo seguirá esta estrategia paso a paso. El responsable elegirá el método de causa raíz (5 Whys o Ishikawa) más adelante, en la etapa de Causa raíz.</p>
    <div class="form-grid">
      <label class="field"><span>Problem Solving <i>*</i></span><select class="select" data-change="e8-ps" data-id="${f.id}">${Object.keys(PS_TYPES).map((k) => `<option value="${k}" ${k === ps ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" data-input="e8-strategy" data-key="corrective" ${((drafts[`${f.id}:corrective`] ?? f.corrective_mandatory) !== false) ? "checked" : ""}> Acciones correctivas obligatorias</label>
      <label class="check"><input type="checkbox" data-input="e8-strategy" data-key="preventive" ${(drafts[`${f.id}:preventive`] ?? (f.preventive_mandatory ?? (ps !== "4D"))) ? "checked" : ""}> Acciones preventivas obligatorias</label>
    </div>
    <p class="muted" style="font-size:13px;margin-top:4px">Un 4D no incluye D5–D8: termina en D4 (acciones inmediatas) y pasa directo a Verificación.</p>
    <div class="stage-actions"><button class="btn primary" data-action="e8-strategy-save" data-id="${f.id}">${icon("check2")} Guardar estrategia y continuar</button></div>`;
}
function stageSolicitud(f) {
  const idx = eightdStages(f).indexOf("solicitud"), cur = eightdStages(f).indexOf(f.status), ownerName = esc(db.profileName(f.owner_id));
  if (idx > cur) return lock("Disponible cuando se defina la estrategia.");
  let controls;
  if (idx < cur) controls = `<div class="done-text">Aceptado por <b>${esc(db.profileName(f.accepted_by))}</b> · ${fmtDateTime(f.accepted_at)}</div>`;
  else if (canActD(f)) controls = `<div class="stage-actions"><button class="btn primary" data-action="e8-accept" data-id="${f.id}">${icon("check2")} Aceptar hallazgo</button>${canTransfer(f) ? `<button class="btn" data-action="e8-transfer" data-id="${f.id}">${icon("swap")} Trasladar</button>` : ""}</div>${f.transfer_count > 0 ? lock("Este hallazgo ya fue trasladado una vez; no puede trasladarse de nuevo.") : ""}`;
  else controls = lock(`Solo <b>${ownerName}</b> (o un administrador) puede aceptar o trasladar este hallazgo.`);
  const rejected = f.reject_count > 0 && f.status === "registro" ? "" : "";
  return `<p class="muted" style="margin-bottom:10px">${esc(f.title)}</p>${rejected}${controls}`;
}

/* ------------------------------- D1…D8 ------------------------------ */
function stageD1(f, editable) {
  return gridSection("Integrantes del equipo", "team", ["Nombre", "Departamento", "Responsabilidad"], f, editable);
}
function stageD2(f, editable) {
  const is8D = f.strategy_ps !== "4D";
  const w5 = f.d_data?.problem5w || {};
  const field5 = (k, l) => `<label class="field"><span>${esc(l)}</span><input class="input" data-input="e8-dd" data-key="${f.id}:dd.problem5w.${k}" value="${esc(drafts[`${f.id}:dd.problem5w.${k}`] ?? w5[k] ?? "")}"></label>`;
  return `${textAreaField(f, "failure_desc", "Descripción de la falla", "¿Qué pasó? Descríbelo con el mayor detalle.")}
    <div class="form-grid">${field5("what", "¿Qué?")}${field5("where", "¿Dónde?")}${field5("when", "¿Cuándo?")}${field5("who", "¿Quién?")}${field5("why", "¿Por qué?")}${is8D ? field5("how_much", "¿Cuánto?") + field5("batch", "Lote") : ""}</div>
    ${attachmentsSection("finding", f.id, { ref: "d2_nok", title: "Foto de la condición encontrada (NO OK)", canEdit: editable })}
    ${attachmentsSection("finding", f.id, { ref: "d2_ok", title: "Foto de la condición correcta, para comparar (OK)", canEdit: editable })}`;
}
function stageD3(f, editable) {
  if (f.strategy_ps === "4D") {
    const r = f.d_data?.rootcause4d || {};
    const w = (k, l) => `<label class="field"><span>${esc(l)}</span><input class="input" data-input="e8-dd" data-key="${f.id}:dd.rootcause4d.${k}" value="${esc(drafts[`${f.id}:dd.rootcause4d.${k}`] ?? r[k] ?? "")}"></label>`;
    return `<p class="muted">Problema: ${esc(f.d_data?.failure_desc || f.description || "—")}</p><div class="form-grid">${w("why1", "¿Por qué? 1")}${w("why2", "¿Por qué? 2")}${w("why3", "¿Por qué? 3")}${w("why4", "¿Por qué? 4")}${w("root_cause", "Causa raíz")}</div>${attachmentsSection("finding", f.id, { ref: "d3", title: "Evidencia", canEdit: editable })}`;
  }
  return actionGrid("Acciones de contención", "containment", f, editable, { maxDue: f.due_date });
}
function stageD4(f, editable) {
  if (f.strategy_ps === "4D") {
    const c = f.d_data?.closure4d || {};
    const reviewerKey = `${f.id}:dd.closure4d.__reviewer`, reviewerVal = drafts[reviewerKey] ?? f.reviewer_id ?? "";
    const reviewerField = editable
      ? `<label class="field"><span>Revisado por</span><select class="select" data-input="e8-dd" data-key="${reviewerKey}"><option value="">— Elegir revisor —</option>${staffAll().filter((p) => p.id !== f.owner_id).map((p) => `<option value="${p.id}" ${p.id === reviewerVal ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></label>`
      : `<div class="field"><span>Revisado por</span><div class="done-text">${esc(db.profileName(f.reviewer_id) || "—")}</div></div>`;
    return `${actionGrid("Acciones inmediatas", "immediate", f, editable, { maxDue: f.due_date })}
      <div class="e8-block"><h4>Cierre del 4D</h4><div class="form-grid">
        <div class="field"><span>Preparado por</span><div class="done-text">${esc(db.profileName(c.preparer_id || f.owner_id))}</div></div>
        <div class="field"><span>Fecha</span><div class="done-text">${c.prepared_date ? fmtDate(c.prepared_date) : "Se fija al enviar a revisar"}</div></div>
        ${reviewerField}
        <div class="field"><span>Estatus</span><div class="done-text">${esc(closure4DStatus(f) || "—")}</div></div>
      </div></div>`;
  }
  if (!f.strategy_rca) {
    if (!editable) return lock(`<b>${esc(db.profileName(f.owner_id))}</b> todavía no elige el método de análisis (5 Whys o Ishikawa).`);
    const rca = drafts[`${f.id}:rca`] ?? "5whys";
    return `<p class="muted" style="margin-bottom:14px">Elige cómo vas a analizar la causa raíz de este hallazgo.</p>
      <label class="field" style="max-width:360px"><span>Método de análisis <i>*</i></span><select class="select" data-change="e8-rca-pick" data-id="${f.id}">${Object.entries(RCA_TYPES).map(([k, l]) => `<option value="${k}" ${k === rca ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="stage-actions"><button class="btn primary" data-action="e8-rca-save" data-id="${f.id}">Elegir y continuar</button></div>`;
  }
  if (f.strategy_rca === "ishikawa") {
    const d = f.d_data?.ishikawa || {};
    const cats = [0, 1, 2].map((i) => `<label class="field"><span>Categoría ${i + 1}</span><input class="input" data-input="e8-dd" data-key="${f.id}:dd.ishikawa.cat${i}" value="${esc(drafts[`${f.id}:dd.ishikawa.cat${i}`] ?? d[`cat${i}`] ?? "")}"></label>${gridSection(`Causas · Categoría ${i + 1}`, `ishikawa_causes${i}`, ["Causa"], f, editable)}`).join("");
    return `<div class="form-grid">${cats}</div>${textAreaField(f, "ishikawa_problem", "Problema (efecto)", "Enunciado del problema al que convergen las causas")}${attachmentsSection("finding", f.id, { ref: "d4", title: "Evidencia", canEdit: editable })}${rootCausesBlock(f, editable)}`;
  }
  const chains = [["why_occur", "¿Por qué ocurrió el defecto?"], ["why_detect", "¿Por qué no se detectó?"], ["why_prevent", "¿Por qué no se previno?"]];
  const chain = (key, label) => { const r = f.d_data?.[key] || {}; const w = (k) => `<input class="input" data-input="e8-dd" data-key="${f.id}:dd.${key}.${k}" placeholder="¿Por qué?" value="${esc(drafts[`${f.id}:dd.${key}.${k}`] ?? r[k] ?? "")}">`; return `<div class="e8-block"><h4>${esc(label)}</h4><div class="e8-why-row">${w("why1")}${w("why2")}${w("why3")}${w("why4")}<input class="input" data-input="e8-dd" data-key="${f.id}:dd.${key}.root_cause" placeholder="Causa raíz" value="${esc(drafts[`${f.id}:dd.${key}.root_cause`] ?? r.root_cause ?? "")}"></div></div>`; };
  return `${chains.map(([k, l]) => chain(k, l)).join("")}${attachmentsSection("finding", f.id, { ref: "d4", title: "Evidencia", canEdit: editable })}${rootCausesBlock(f, editable)}`;
}
/** Cada causa raíz que se anota aquí queda con su propio folio (RC-AÑO-0001), para que las acciones
 *  correctivas y preventivas se vinculen a una en específico — nunca a las de otro hallazgo */
function rootCausesBlock(f, editable) {
  const list = rootCausesOf(f), manual = f.strategy_rca !== "5whys";   // en 5 Whys se agregan solas al llenar "Causa raíz" en cada cadena
  return `<div class="e8-block"><h4>Causas raíz identificadas</h4>
    ${list.length ? `<ul class="rc-list">${list.map((rc) => `<li><span class="mono">${esc(rc.code)}</span> ${esc(rc.text)}</li>`).join("")}</ul>` : `<p class="muted">${manual ? "Sin causas raíz registradas todavía." : "Aparecerán aquí en automático al llenar la Causa raíz de cada «Por qué»."}</p>`}
    ${editable && manual ? `<div class="toolbar" style="margin-top:10px"><input class="input grow" id="rc-new-${f.id}" placeholder="Describe una causa raíz identificada…"><button type="button" class="btn sm primary" data-action="rc-add" data-id="${f.id}">${icon("plus")} Agregar causa raíz</button></div>` : ""}
  </div>`;
}
/* ---------------------- Plan de acciones correctivas (solo el plan, sin evidencia) ---------------------- */
const ACTION_TYPE_OPTS = [["correctiva", "Correctiva"], ["preventiva", "Preventiva"]];
function rcChecklist(f, i, r) {
  const dk = `${f.id}:act.corrective_plan.${i}.root_cause_ids`, v = drafts[dk] ?? r.root_cause_ids ?? [];
  const rcs = rootCausesOf(f);
  if (!rcs.length) return `<label class="field span-2"><span>Causa(s) raíz <i>*</i></span><p class="muted" style="margin:4px 0 0">Registra al menos una causa raíz en la etapa anterior.</p></label>`;
  return `<label class="field span-2"><span>Causa(s) raíz <i>*</i></span><div class="rc-check-list" data-rc-group="${dk}">${rcs.map((rc) => `<label class="rc-check"><input type="checkbox" data-change="e8-rc-check" data-group="${dk}" value="${rc.id}" ${v.includes(rc.id) ? "checked" : ""}> ${esc(rc.code)} · ${esc(rc.text)}</label>`).join("")}</div></label>`;
}
function planGrid(f, editable) {
  const key = "corrective_plan", rows = actionRows(f, key);
  const cards = rows.map((r, i) => {
    const typeDk = `${f.id}:act.${key}.${i}.type`, typeVal = drafts[typeDk] ?? r.type ?? "correctiva";
    return `<div class="act-card">
      <div class="act-fields">
        <label class="field span-2"><span>Acción <i>*</i></span>${actionField(f, key, i, "action", r, "text", editable ? "" : "disabled")}</label>
        <label class="field"><span>Responsable</span>${actionField(f, key, i, "responsible", r, "text", editable ? "" : "disabled")}</label>
        <label class="field"><span>Fecha límite</span>${actionField(f, key, i, "due", r, "date", `${f.due_date ? `max="${f.due_date}"` : ""} ${editable ? "" : "disabled"}`)}</label>
        <label class="field"><span>Tipo <i>*</i></span><select class="select" data-input="e8-dd" data-key="${typeDk}" ${editable ? "" : "disabled"}>${ACTION_TYPE_OPTS.map(([v, l]) => `<option value="${v}" ${v === typeVal ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${rcChecklist(f, i, r)}
      </div>
      ${editable ? `<button type="button" class="btn sm ghost" data-action="e8-act-del" data-key="${key}" data-ri="${i}">${icon("close")} Quitar</button>` : ""}
    </div>`;
  }).join("") || '<p class="muted" style="margin-bottom:10px">Sin acciones todavía.</p>';
  return `<div class="e8-block" data-act-section="${key}"><h4>Plan de acciones correctivas permanentes</h4>
    <p class="muted" style="margin-bottom:10px">Solo el plan: qué se va a hacer, quién y para cuándo. La evidencia se sube más adelante, al implementarlas.</p>
    ${cards}${editable ? `<button type="button" class="btn sm" data-action="e8-act-add" data-key="${key}">${icon("plus")} Agregar acción</button>` : ""}</div>`;
}
function readPlanRows(f) {
  return actionRows(f, "corrective_plan").map((r, i) => ({
    id: r.id, action: (drafts[`${f.id}:act.corrective_plan.${i}.action`] ?? r.action ?? "").trim(),
    responsible: (drafts[`${f.id}:act.corrective_plan.${i}.responsible`] ?? r.responsible ?? "").trim(),
    due: drafts[`${f.id}:act.corrective_plan.${i}.due`] ?? r.due ?? "",
    type: drafts[`${f.id}:act.corrective_plan.${i}.type`] ?? r.type ?? "correctiva",
    root_cause_ids: drafts[`${f.id}:act.corrective_plan.${i}.root_cause_ids`] ?? r.root_cause_ids ?? [],
    implemented: r.implemented ?? null,
  })).filter((r) => r.action || r.responsible || r.due);
}
function stageD5(f, editable) { return planGrid(f, editable); }
/** D6 y D7 se trabajan juntos: no tiene por qué terminarse lo correctivo para empezar lo preventivo */
/** Una fila de "implementación": hereda del Plan (acción/responsable/fecha/causas raíz, todo de
 *  solo lectura) y solo pregunta si se definió — si Sí, evidencia compacta; si No, se cancela. */
function implRow(f, planRow, editable) {
  const implKey = `${f.id}:dd.action_impl.${planRow.id}.implemented`;
  const curVal = drafts[implKey] ?? f.d_data?.action_impl?.[planRow.id]?.implemented ?? "";
  const ref = `plan:${planRow.id}`, closedAt = evidenceDateFor(f, ref);
  const rcNames = (planRow.root_cause_ids || []).map((id) => rootCausesOf(f).find((rc) => rc.id === id)?.code).filter(Boolean).join(", ");
  return `<div class="impl-row">
    <div class="impl-head"><b>${esc(planRow.action)}</b><span class="impl-meta">${esc(planRow.responsible || "—")} · ${planRow.due ? fmtDate(planRow.due) : "sin fecha"} · <span class="mono">${esc(rcNames || "—")}</span></span></div>
    <div class="impl-controls">
      <label class="field sm"><span>¿Fue definida?</span><select class="select" data-change="e8-impl-pick" data-key="${implKey}" ${editable ? "" : "disabled"}>
        <option value="">— Elegir —</option><option value="si" ${curVal === "si" ? "selected" : ""}>Sí</option><option value="no" ${curVal === "no" ? "selected" : ""}>No, se cancela</option>
      </select></label>
      ${curVal === "si" ? `<span class="impl-evidence">${attachmentsSection("finding", f.id, { ref, compact: true, canEdit: editable })}<span class="impl-status ${closedAt ? "done" : "pending"}">${closedAt ? `${icon("check2")} Cerrada` : "Pendiente de evidencia"}</span></span>` : ""}
      ${curVal === "no" ? `<span class="muted impl-cancelled">Cancelada — no aparecerá en el PDF de correctivas/preventivas (sí en el plan).</span>` : ""}
    </div>
  </div>`;
}
function implGroup(title, rows, f, editable) {
  if (!rows.length) return `<div class="e8-block"><h4>${esc(title)}</h4><p class="muted">Sin acciones de este tipo en el plan.</p></div>`;
  return `<div class="e8-block" data-impl-group="1"><h4>${esc(title)}</h4>${rows.map((r) => implRow(f, r, editable)).join("")}</div>`;
}
function stageD6(f, editable) {
  const plan = readPlanRows(f);
  const a = f.d_data?.additional || {};
  const yn = (k, l, needsEvidence) => { const v = a[k] || {}; const dk = (field) => `${f.id}:dd.additional.${k}.${field}`;
    const flagVal = drafts[dk("flag")] ?? v.flag ?? "no";
    return `<div class="e8-block"><h4>${esc(l)}</h4><div class="form-grid">
    <label class="field"><span>¿Necesario?</span><select class="select" data-change="e8-yn-pick" data-key="${dk("flag")}">${[["no", "No"], ["si", "Sí"]].map(([v2, o]) => `<option value="${v2}" ${flagVal === v2 ? "selected" : ""}>${o}</option>`).join("")}</select></label>
    <label class="field"><span>Responsable</span><input class="input" data-input="e8-dd" data-key="${dk("responsible")}" value="${esc(drafts[dk("responsible")] ?? v.responsible ?? "")}"></label>
    <label class="field"><span>Fecha límite</span><input class="input" type="date" data-input="e8-dd" data-key="${dk("due")}" ${f.due_date ? `max="${f.due_date}"` : ""} value="${esc(drafts[dk("due")] ?? v.due ?? "")}"></label></div>
    ${flagVal === "si" && needsEvidence === "evidence" ? `<div style="margin-top:10px">${attachmentsSection("finding", f.id, { ref: `additional:${k}`, compact: true, canEdit: editable })}</div>` : ""}
    ${flagVal === "si" && needsEvidence === "rollacross" ? rollAcrossPicker(f, editable) : ""}
    </div>`; };
  return `${implGroup("Correctivas implementadas", plan.filter((r) => r.type === "correctiva"), f, editable)}
    ${implGroup("Preventivas", plan.filter((r) => r.type === "preventiva"), f, editable)}
    ${yn("fmea", "¿Es necesario actualizar el FMEA?", "evidence")}${yn("cp", "¿Es necesario actualizar el Plan de Control?", "evidence")}${yn("rollacross", "¿Es necesario un Roll-Across?", "rollacross")}`;
}
function rollAcrossPicker(f, editable) {
  const dk = `${f.id}:dd.additional.rollacross.targets`, v = drafts[dk] ?? f.d_data?.additional?.rollacross?.targets ?? [];
  const options = [...db.rows("areas").map((a2) => ({ id: `area:${a2.id}`, label: a2.name })), ...db.rows("processes").filter((p) => p.active).map((p) => ({ id: `process:${p.id}`, label: `${p.code} · ${p.name}` }))];
  return `<label class="field span-2" style="margin-top:10px"><span>Procesos/Áreas que comparten esta condición <i>*</i></span>
    <div class="rc-check-list">${options.map((o) => `<label class="rc-check"><input type="checkbox" data-change="e8-rc-check" data-group="${dk}" value="${o.id}" ${v.includes(o.id) ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div></label>`;
}
function stageD8(f, editable) {
  const c = f.d_data?.closure4d || {};
  const reviewerKey = `${f.id}:dd.closure4d.__reviewer`, reviewerVal = drafts[reviewerKey] ?? f.reviewer_id ?? "";
  const reviewerField = editable
    ? `<label class="field"><span>Revisado por</span><select class="select" data-input="e8-dd" data-key="${reviewerKey}"><option value="">— Elegir revisor —</option>${staffAll().filter((p) => p.id !== f.owner_id).map((p) => `<option value="${p.id}" ${p.id === reviewerVal ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></label>`
    : `<div class="field"><span>Revisado por</span><div class="done-text">${esc(db.profileName(f.reviewer_id) || "—")}</div></div>`;
  return `<p class="muted" style="margin-bottom:14px">El equipo es reconocido por su esfuerzo y colaboración resolviendo el problema.</p>
    <div class="e8-block"><h4>Cierre del 8D</h4><div class="form-grid">
      <div class="field"><span>Preparado por</span><div class="done-text">${esc(db.profileName(c.preparer_id || f.owner_id))}</div></div>
      <div class="field"><span>Fecha</span><div class="done-text">${c.prepared_date ? fmtDate(c.prepared_date) : "Se fija al enviar a revisar"}</div></div>
      ${reviewerField}
      <div class="field"><span>Estatus</span><div class="done-text">${esc(closure4DStatus(f) || "—")}</div></div>
    </div></div>`;
}
const D_BODY = { d1: stageD1, d2: stageD2, d3: stageD3, d4: stageD4, d5: stageD5, d6: stageD6, d8: stageD8 };

function stageDGeneric(f, stage) {
  const stages = eightdStages(f), idx = stages.indexOf(stage), cur = stages.indexOf(f.status), act = canActD(f), ownerName = esc(db.profileName(f.owner_id));
  if (idx > cur) return lock(`Disponible al llegar a ${esc(dLabel(stage, f))}.`);
  const editable = idx === cur && act;
  const body = D_BODY[stage](f, editable);
  if (idx < cur) return body;                     // ya hecho: vista de solo lectura
  if (!act) return `${body}${lock(`Solo <b>${ownerName}</b> (o un administrador) puede continuar.`)}`;
  if ((stage === "d4" && f.strategy_ps === "4D") || stage === "d8") {   // el 4D en D4, y el 8D en D8: no "avanzan", se envían a revisar a alguien elegido
    return `<div class="stage-actions" style="margin-bottom:14px">${pdfBtn(f)}</div>${body}<div class="stage-actions"><button class="btn" data-action="e8-d-save" data-id="${f.id}" data-stage="${stage}">Guardar borrador</button>
      <button class="btn primary" data-action="e8-send-review" data-id="${f.id}" data-stage="${stage}">${icon("check2")} Guardar y enviar a revisar</button></div>`;
  }
  if (stage === "d4" && f.strategy_ps !== "4D" && !f.strategy_rca) return body;   // falta elegir 5 Whys/Ishikawa: sus propios botones ya están en el body
  const isLast = stages[idx + 1] === "verificacion";
  return `${body}<div class="stage-actions"><button class="btn" data-action="e8-d-save" data-id="${f.id}" data-stage="${stage}">Guardar borrador</button>
    <button class="btn primary" data-action="e8-d-advance" data-id="${f.id}" data-stage="${stage}">${isLast ? "Guardar y enviar a Verificación" : "Guardar y continuar"}</button></div>
    ${isLast ? lock(`Un administrador tendrá ${verifyDaysFor(f)} días hábiles para aceptar o rechazar la verificación.`) : ""}`;
}

const pdfBtn = (f) => `<button class="btn" data-action="e8-pdf" data-id="${f.id}">${icon("download")} Descargar PDF (${esc(f.strategy_ps)})</button>`;
function stageVerificacion8D(f) {
  const stages = eightdStages(f), idx = stages.indexOf("verificacion"), cur = stages.indexOf(f.status);
  if (idx > cur) return lock("Disponible cuando se completen las acciones.");
  if (idx < cur) return `<div class="done-text">${esc(f.verification_notes || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">${fmtDateTime(f.verified_at)}</div><div class="stage-actions" style="margin-top:12px">${pdfBtn(f)}</div>`;
  const notes = drafts[`${f.id}:verification_notes`] ?? f.verification_notes ?? "";
  return `<div class="stage-actions" style="margin-bottom:14px">${pdfBtn(f)}</div>${canVerify8D(f) ? `<p class="q-label">¿El 8D/4D fue efectivo y está completo?</p>
    <textarea class="textarea" rows="4" data-input="e8-dd" data-key="${f.id}:verification_notes" placeholder="Resultado de la verificación…">${esc(notes)}</textarea>
    <div class="stage-actions"><button class="btn primary" data-action="e8-verify-accept" data-id="${f.id}">${icon("check2")} Aceptar y cerrar</button><button class="btn danger" data-action="e8-verify-reject" data-id="${f.id}">${icon("close")} Rechazar</button></div>`
    : lock("Solo un <b>administrador</b> puede aceptar o rechazar la verificación.")}`;
}
function stageCerrado8D(f) {
  if (f.status !== "cerrado") return lock("El hallazgo se cierra cuando un administrador acepta la verificación.");
  const { m1, m2 } = milestones(f);
  return `<div class="if-closed-grid"><div><dt>Cierre de acciones</dt><dd>${esc(m1.text)}</dd></div><div><dt>Verificación</dt><dd>${esc(m2?.text || "—")}</dd></div>
    <div><dt>Verificó</dt><dd>${esc(db.profileName(f.verified_by))}</dd></div><div><dt>Cerrado</dt><dd>${fmtDateTime(f.closed_at || f.verified_at)}</dd></div></div>
    <p class="q-label" style="margin-top:14px">Resultado de la verificación</p><div class="done-text">${esc(f.verification_notes || "—")}</div>
    <div class="stage-actions" style="margin-top:14px">${pdfBtn(f)}</div>`;
}

function stageRevision(f, revStage) {
  const stages = eightdStages(f), idx = stages.indexOf(revStage), cur = stages.indexOf(f.status), c = f.d_data?.closure4d || {};
  const sourceStage = revStage === "d8_revision" ? "D8" : "D4";
  if (idx > cur) return lock(`Disponible cuando se envíe el ${sourceStage} a revisar.`);
  const recap = `<div class="stage-actions" style="margin-bottom:14px">${pdfBtn(f)}</div><div class="form-grid">
    <div class="field"><span>Preparado por</span><div class="done-text">${esc(db.profileName(c.preparer_id))}</div></div>
    <div class="field"><span>Fecha de envío</span><div class="done-text">${fmtDate(c.prepared_date)}</div></div>
    <div class="field"><span>Revisor</span><div class="done-text">${esc(db.profileName(f.reviewer_id))}</div></div></div>`;
  if (idx < cur) return `${recap}<p class="q-label" style="margin-top:14px">Resultado de la revisión</p><div class="done-text">${esc(c.review_notes || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">${fmtDate(c.reviewed_date)}</div>`;
  if (!canReview4D(f)) return `${recap}${lock(`Esperando la revisión de <b>${esc(db.profileName(f.reviewer_id))}</b>.`)}`;
  const notes = drafts[`${f.id}:dd.closure4d.review_notes`] ?? c.review_notes ?? "";
  return `${recap}<p class="q-label" style="margin-top:14px">¿Las acciones resuelven el hallazgo?</p>
    <textarea class="textarea" rows="4" data-input="e8-dd" data-key="${f.id}:dd.closure4d.review_notes" placeholder="Comentarios de la revisión…">${esc(notes)}</textarea>
    <div class="stage-actions"><button class="btn primary" data-action="e8-review-approve" data-id="${f.id}">${icon("check2")} Revisado y aprobado</button><button class="btn danger" data-action="e8-review-reject" data-id="${f.id}">${icon("close")} Revisado y rechazado</button></div>`;
}
function e8dStepBody(f, st) {
  if (st === "registro") return stageRegistro(f);
  if (st === "detalles") return stageDetalles(f);
  if (st === "solicitud") return stageSolicitud(f);
  if (st === "d4_revision" || st === "d8_revision") return stageRevision(f, st);
  if (st === "verificacion") return stageVerificacion8D(f);
  if (st === "cerrado") return stageCerrado8D(f);
  return stageDGeneric(f, st);
}

function e8dPageHTML(f) {
  const stages = eightdStages(f), cur = stages.indexOf(f.status), view = viewStage && stages.includes(viewStage) ? viewStage : f.status;
  return `<div class="if-page">
    <div class="if-head">
      <button class="btn ghost icon" data-action="if-back" aria-label="Volver a la lista">${icon("chevL")}</button>
      <div class="if-head-t"><span class="eyebrow mono">${esc(f.code)}</span><h1>${esc(f.title)}</h1></div>
      <div class="if-head-badges">${badge(FINDING_STATUS, f.status === "cerrado" ? "cerrado" : f.status === "verificacion" ? "verificacion" : "abierto")}${f.strategy_ps ? `<span class="badge" data-tone="info">${esc(f.strategy_ps)}</span>` : ""}${f.reject_count > 0 ? `<span class="badge" data-tone="danger">Rechazado ${f.reject_count}×</span>` : ""}</div>
      ${db.can.write && f.status !== "registro" ? `<button class="btn" data-action="lif-edit" data-id="${f.id}">${icon("edit")} Editar</button>` : ""}
    </div>
    <div class="if-grid">
      <aside class="if-side">${milestoneCard(f)}${filesCard(f)}${historyCard(f)}</aside>
      <main class="if-main">
        <div class="if-steps e8-steps" role="tablist" aria-label="Etapas del hallazgo">${stages.map((s, i) => `<button class="if-step ${i < cur ? "done" : ""} ${i === cur ? "current" : ""} ${s === view ? "viewing" : ""} ${i > cur ? "locked" : ""}" role="tab" aria-selected="${s === view}" data-action="if-stage" data-stage="${s}"><span>${esc(dLabel(s, f))}</span></button>`).join("")}</div>
        <div class="if-status" id="if-status-box"><div class="if-status-k">${esc(dLabel(view, f))}</div>${e8dStepBody(f, view)}</div>
      </main>
      <aside class="if-details">${e8dDetailsHTML(f)}</aside>
    </div>
  </div>`;
}

/* ------------------------------------- Formularios del 8D/4D ------------------------------------ */
function e8dTransferForm(f) {
  openForm({
    eyebrow: f.code, title: "Trasladar hallazgo", submitLabel: "Trasladar",
    intro: `<div class="note warn" style="margin-bottom:14px"><b>Solo se puede trasladar una vez.</b></div>`,
    fields: [
      { name: "to", label: "Nuevo responsable", type: "select", required: true, span2: true, options: staffAll().filter((p) => p.id !== f.owner_id).map((p) => [p.id, p.full_name]) },
      { name: "reason", label: "Motivo del traslado", type: "textarea", required: true, span2: true },
    ],
    onSubmit: async (v) => { await transferFinding(f, v.to, v.reason.trim()); toast(`Hallazgo trasladado a ${db.profileName(v.to)}`, "ok"); notifyFindings([db.get("findings", f.id)], "transferred"); paint(); },
  });
}
function e8dRejectForm(f) {
  openForm({
    eyebrow: f.code, title: "Rechazar verificación", submitLabel: "Rechazar y reabrir",
    intro: `<div class="note warn" style="margin-bottom:14px">El hallazgo se reabre en <b>Registro</b> para que un administrador lo revise de nuevo.</div>`,
    fields: [{ name: "reason", label: "Motivo del rechazo", type: "textarea", required: true, span2: true }],
    onSubmit: async (v) => { await rejectVerification8D(f, v.reason.trim()); viewStage = "registro"; toast("Verificación rechazada · vuelve a Registro", "ok"); notifyFindings([db.get("findings", f.id)], "rejected"); paint(); },
  });
}

/* ------------------------------------- Eventos del 8D/4D ------------------------------------ */
const setPath = (obj, path, val) => { const keys = path.split("."); let o = obj; for (let i = 0; i < keys.length - 1; i++) o = (o[keys[i]] ??= {}); o[keys[keys.length - 1]] = val; };
onInput("e8-dd", (el) => { drafts[el.dataset.key] = el.value; });
on("e8-reg-kind", (el) => { drafts[`${fnd(el.closest("[data-id]")?.dataset.id || curId).id}:areaKind`] = el.dataset.kind; paint(); });
on("e8-register", (el) => {
  const f = fnd(el.dataset.id), box = document.getElementById("if-status-box");
  const classId = box.querySelector('[data-key="class_id"]').value, clause = box.querySelector('[data-key="clause"]').value.trim(), ownerId = box.querySelector('[data-key="owner_id"]').value;
  const areaId = box.querySelector('[data-key="area_id"]')?.value || "", processId = box.querySelector('[data-key="process_id"]')?.value || "";
  if (!classId || !ownerId) { toast("Elige la clasificación y el responsable.", "danger"); return; }
  run(async () => { await registerFinding(f, { class_id: classId, area_id: areaId || null, area: db.get("areas", areaId)?.name || null, process_id: processId || null, clause: clause || null, owner_id: ownerId, ...deadlineFields(classId) }); viewStage = null; toast("Hallazgo registrado · define la estrategia", "ok"); notifyFindings([db.get("findings", f.id)], "assigned"); });
});
onChange("e8-ps", (el) => { drafts[`${el.dataset.id}:ps`] = el.value; });
onChange("e8-rca-pick", (el) => { drafts[`${el.dataset.id}:rca`] = el.value; });
on("e8-rca-save", (el) => {
  const f = fnd(el.dataset.id), rca = drafts[`${f.id}:rca`] ?? "5whys";
  run(async () => { await saveRcaMethod(f, rca); toast(`Método elegido: ${RCA_TYPES[rca]}`, "ok"); });
});
onInput("e8-strategy", (el) => { drafts[`${fnd_id(el)}:${el.dataset.key}`] = el.type === "checkbox" ? el.checked : el.value; });
function fnd_id(el) { return el.closest("[data-id]")?.dataset.id || curId; }
on("e8-strategy-save", (el) => {
  const f = fnd(el.dataset.id), box = document.getElementById("if-status-box");
  const ps = box.querySelector('[data-change="e8-ps"]')?.value || drafts[`${f.id}:ps`] || "8D";
  const corrective = box.querySelector('[data-key="corrective"]')?.checked ?? true;
  const preventive = box.querySelector('[data-key="preventive"]')?.checked ?? (ps !== "4D");
  run(async () => { await saveStrategy(f, { strategy_ps: ps, corrective_mandatory: corrective, preventive_mandatory: preventive }); viewStage = null; toast("Estrategia guardada · pasa a Solicitud", "ok"); });
});
on("e8-accept", (el) => run(async () => { await acceptD(fnd(el.dataset.id)); viewStage = null; toast("Hallazgo aceptado · D1 Equipo", "ok"); }));
on("e8-transfer", (el) => e8dTransferForm(fnd(el.dataset.id)));
const ACTION_KEYS = ["containment", "immediate"];   // "corrective_plan" ya no pide evidencia (solo es el plan); "corrective_done"/"preventive" ahora se validan aparte (ver gateD6)
const RC_REQUIRED_KEYS = new Set(["corrective_done", "preventive"]);   // las que sí piden causa raíz vinculada
function clearActionDrafts(findingId) { for (const k of Object.keys(drafts)) if (k.startsWith(`${findingId}:act.`)) delete drafts[k]; }
function collectDD(f, stage) {
  const patch = {};
  document.querySelectorAll(`#if-status-box [data-key^="${f.id}:dd."]`).forEach((el) => { const path = el.dataset.key.split(":dd.")[1]; setPath(patch, path, el.type === "checkbox" ? el.checked : el.value); });
  // Tablas (grid) visibles en esta etapa: se leen por lo que está EN PANTALLA, no por lo que ya existiera guardado
  document.querySelectorAll(`#if-status-box [data-tpl-root^="${f.id}:"]`).forEach((root) => {
    const key = root.dataset.tplRoot.slice(`${f.id}:`.length);
    const m = /^ishikawa_causes(\d)$/.exec(key);
    if (m) { patch.ishikawa ??= { ...(f.d_data?.ishikawa || {}) }; patch.ishikawa[`causes${m[1]}`] = readGrid(f, key); }
    else patch[key] = readGrid(f, key);
  });
  // Acciones con evidencia (contención, inmediatas) y el plan (su propio formato, sin evidencia)
  document.querySelectorAll(`#if-status-box [data-act-section]`).forEach((sec) => {
    const k = sec.dataset.actSection;
    patch[k] = k === "corrective_plan" ? readPlanRows(f) : readActionRows(f, k);
  });
  // Checklists de casillas (causas raíz del plan, procesos/áreas del Roll-Across): viven solo en drafts
  const rollKey = `${f.id}:dd.additional.rollacross.targets`;
  if (document.querySelector(`[data-group="${CSS.escape(rollKey)}"]`)) { patch.additional ??= { ...(f.d_data?.additional || {}) }; patch.additional.rollacross = { ...(patch.additional.rollacross || f.d_data?.additional?.rollacross), targets: drafts[rollKey] ?? f.d_data?.additional?.rollacross?.targets ?? [] }; }
  return patch;
}
/** ¿Puede enviarse esta etapa? Toda acción declarada en pantalla necesita su evidencia. */
const ACTION_LABEL = { containment: "una acción de contención", corrective_plan: "una acción correctiva", corrective_done: "una acción correctiva implementada", preventive: "una acción preventiva", immediate: "una acción inmediata" };
/** D6: toda acción del plan (correctiva o preventiva) necesita decir si se definió; si sí, su evidencia.
 *  Y si FMEA/Plan de Control/Roll-Across se marcaron "Sí", piden lo suyo antes de continuar. */
function gateD6(f) {
  if (!document.querySelector("#if-status-box [data-impl-group]")) return null;
  for (const r of readPlanRows(f)) {
    const implKey = `${f.id}:dd.action_impl.${r.id}.implemented`, val = drafts[implKey] ?? f.d_data?.action_impl?.[r.id]?.implemented ?? "";
    if (!val) return `Indica si «${r.action}» fue definida (Sí/No) antes de continuar.`;
    if (val === "si" && !evidenceDateFor(f, `plan:${r.id}`)) return `Adjunta la evidencia de «${r.action}» para poder cerrarla y continuar.`;
  }
  const a = f.d_data?.additional || {};
  for (const [k, label] of [["fmea", "el FMEA"], ["cp", "el Plan de Control"]]) {
    const flag = drafts[`${f.id}:dd.additional.${k}.flag`] ?? a[k]?.flag ?? "no";
    if (flag === "si" && !evidenceDateFor(f, `additional:${k}`)) return `Adjunta la evidencia de ${label} actualizado para poder continuar.`;
  }
  const rollFlag = drafts[`${f.id}:dd.additional.rollacross.flag`] ?? a.rollacross?.flag ?? "no";
  if (rollFlag === "si" && !(drafts[`${f.id}:dd.additional.rollacross.targets`] ?? a.rollacross?.targets ?? []).length) return "Elige al menos un proceso/área para el Roll-Across antes de continuar.";
  return null;
}
function actionGate(f) {
  const d6 = gateD6(f);
  if (d6) return d6;
  for (const key of ACTION_KEYS) {
    if (!document.querySelector(`#if-status-box [data-act-section="${key}"]`)) continue;
    const required = key !== "preventive" || f.preventive_mandatory;
    const rows = readActionRows(f, key);
    if (required && !rows.length) return `Agrega al menos ${ACTION_LABEL[key]} antes de continuar. No puedes dar por terminada esta etapa sin ninguna acción.`;
    const pending = rows.filter((r) => !evidenceDateFor(f, `${key}:${r.id}`));
    if (pending.length) return `Adjunta la evidencia de «${pending[0].action || "la acción sin nombre"}» para poder cerrarla y continuar.`;
    if (RC_REQUIRED_KEYS.has(key)) { const noRc = rows.filter((r) => !r.root_cause_id); if (noRc.length) return `Elige la causa raíz relacionada de «${noRc[0].action || "la acción sin nombre"}» para poder continuar.`; }
  }
  return null;
}
on("e8-act-add", (el) => { const f = fnd(curId), key = el.dataset.key; drafts[`${f.id}:act.${key}`] = [...actionRows(f, key), { id: uuid(), action: "", responsible: "", due: "" }]; paint(); });
onChange("e8-impl-pick", (el) => { drafts[el.dataset.key] = el.value; paint(); });
onChange("e8-yn-pick", (el) => { drafts[el.dataset.key] = el.value; paint(); });
onChange("e8-rc-check", (el) => {
  const group = el.dataset.group, checked = [...document.querySelectorAll(`[data-group="${CSS.escape(group)}"]:checked`)].map((c) => c.value);
  drafts[group] = checked;
});
on("rc-add", (el) => {
  const f = fnd(el.dataset.id), input = document.getElementById(`rc-new-${f.id}`), text = (input?.value || "").trim();
  if (!text) { toast("Describe la causa raíz antes de agregarla.", "danger"); return; }
  run(async () => { const r = await db.insert("root_causes", { finding_id: f.id, text }); toast(`Causa raíz ${r.code} agregada`, "ok"); });
});
on("e8-act-del", (el) => {
  const f = fnd(curId), key = el.dataset.key, ri = +el.dataset.ri, rows = readActionRows(f, key);
  rows.splice(ri, 1); for (const k of Object.keys(drafts)) if (k.startsWith(`${f.id}:act.${key}.`)) delete drafts[k];
  drafts[`${f.id}:act.${key}`] = rows; paint();
});
/** 5 Whys: la "Causa raíz" de cada una de las 3 cadenas se vuelve su propia causa raíz (RC-AÑO-0001) en
 *  automático al guardar — Ishikawa sigue pidiéndolo a mano, con el botón "Agregar causa raíz" */
const WHY_CHAINS = ["why_occur", "why_detect", "why_prevent"];
async function syncRootCausesFrom5Whys(f, patch) {
  if (f.strategy_rca !== "5whys") return;
  const merged = { ...f.d_data, ...patch };
  const existing = new Set(rootCausesOf(f).map((rc) => rc.text.trim().toLowerCase()));
  for (const key of WHY_CHAINS) {
    const text = (merged[key]?.root_cause || "").trim();
    if (text && !existing.has(text.toLowerCase())) { await db.insert("root_causes", { finding_id: f.id, text }); existing.add(text.toLowerCase()); }
  }
}
on("e8-d-save", (el) => run(async () => { const f = fnd(el.dataset.id), patch = collectDD(f, el.dataset.stage); await saveD(f, patch); if (el.dataset.stage === "d4") await syncRootCausesFrom5Whys(f, patch); clearGridDrafts(f.id); clearActionDrafts(f.id); toast("Borrador guardado", "ok"); }));
on("e8-d-advance", (el) => {
  const f = fnd(el.dataset.id), gate = actionGate(f);
  if (gate) { toast(gate, "danger"); return; }
  run(async () => {
    const patch = collectDD(f, el.dataset.stage);
    if (el.dataset.stage === "d4") {
      await syncRootCausesFrom5Whys(f, patch);
      if (!rootCausesOf(f).length) { toast("Agrega al menos una causa raíz identificada antes de continuar.", "danger"); return; }
    }
    if (el.dataset.stage === "d5") {
      const planRows = (patch.corrective_plan || []).filter((r) => r.action);
      const noRc = planRows.find((r) => !r.root_cause_ids?.length);
      if (noRc) { toast(`Elige al menos una causa raíz para «${noRc.action}».`, "danger"); return; }
      const covered = new Set(planRows.flatMap((r) => r.root_cause_ids || []));
      const missing = rootCausesOf(f).find((rc) => !covered.has(rc.id));
      if (missing) { toast(`Falta al menos una acción para la causa raíz ${missing.code}.`, "danger"); return; }
    }
    await advanceD(f, el.dataset.stage, patch); clearGridDrafts(f.id); clearActionDrafts(f.id); viewStage = null; toast("Guardado · siguiente etapa", "ok");
  });
});
/* --------------------------- Revisión del 4D: notificaciones --------------------------- */
/** Avisos de la revisión del 4D: bandeja + correo (reutiliza notifyFindings, como el resto de los hallazgos) */
const notifyReviewer = (f) => notifyFindings([f], "review_requested");
const notifyPreparer = (f, approved) => notifyFindings([f], approved ? "review_approved" : "review_rejected");
on("e8-send-review", (el) => {
  const f = fnd(el.dataset.id), stage = el.dataset.stage || "d4";
  const reviewerId = document.querySelector(`[data-key="${f.id}:dd.closure4d.__reviewer"]`)?.value;
  if (!reviewerId) { toast("Elige quién revisará esto.", "danger"); return; }
  const gate = actionGate(f);
  if (gate) { toast(gate, "danger"); return; }
  run(async () => {
    const patch = collectDD(f, stage);
    if (patch.closure4d) delete patch.closure4d.__reviewer;
    const r = await sendToReview(f, stage, reviewerId, patch);
    clearGridDrafts(f.id); clearActionDrafts(f.id); viewStage = null;
    await notifyReviewer(r);
    toast(`Enviado a revisar · se avisó a ${db.profileName(reviewerId)}`, "ok");
  });
});
on("e8-review-approve", (el) => {
  const notes = (document.querySelector(`[data-key="${el.dataset.id}:dd.closure4d.review_notes"]`)?.value || "").trim();
  if (notes.length < 5) { toast("Describe el resultado de la revisión.", "danger"); return; }
  run(async () => {
    const f = fnd(el.dataset.id), r = await approveReview(f, notes); viewStage = null;
    await notifyPreparer(r, true);
    await notifyFindings([r], "verify");   // al aprobar la revisión se avisa a TODOS los administradores que toca verificar
    toast("Revisión aprobada · pasa a Verificación", "ok");
  });
});
on("e8-review-reject", (el) => {
  const notes = (document.querySelector(`[data-key="${el.dataset.id}:dd.closure4d.review_notes"]`)?.value || "").trim();
  if (notes.length < 5) { toast("Describe el motivo del rechazo.", "danger"); return; }
  run(async () => { const f = fnd(el.dataset.id), stage = f.strategy_ps === "4D" ? "d4" : "d8", r = await rejectReview(f, stage, notes); viewStage = null; await notifyPreparer(r, false); toast(`Revisión rechazada · vuelve a ${stage.toUpperCase()}`, "ok"); });
});
on("e8-verify-accept", (el) => {
  const notes = (document.querySelector(`[data-key="${el.dataset.id}:verification_notes"]`)?.value || "").trim();
  if (notes.length < 5) { toast("Describe el resultado de la verificación.", "danger"); return; }
  run(async () => { await closeVerification8D(fnd(el.dataset.id), notes); viewStage = null; toast("Verificación aceptada · hallazgo cerrado", "ok"); });
});
on("e8-verify-reject", (el) => e8dRejectForm(fnd(el.dataset.id)));
on("e8-pdf", async (el) => {
  try { await exportFinding8D4D(fnd(el.dataset.id)); } catch (e) { toast(e.message, "danger"); }
});
