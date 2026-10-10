/* =====================================================================
   Auditorías Internas · vista de pantalla completa del hallazgo
   Abierto → Descripción del problema → Contención → Causa raíz → Acciones →
   Verificación → Cierre. Columna izquierda: Milestone · Archivos · Historial.
   Centro: pasos + estado de la etapa. Derecha: Detalles (fijo).
   ===================================================================== */
import * as db from "../db.js";
import { esc, fmtDate, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, navigate, wsId } from "../router.js";
import { on, onChange, onInput, badge, userCell, empty, openForm, confirmDialog, toast } from "../ui.js";
import { SOURCE, FINDING_STATUS } from "../constants.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { notifyFindings } from "../notify.js";
import { catOpts, clientOpts, mapOpts, catName, clientName } from "./shared.js";
import { fillHTML, readFill, gridOwners } from "../templates.js";
import {
  classes, classBadge, classOptions, classOf, areaOptions, resolveOwner, milestones, overdueKind, canAct, canTransfer, canVerify, verifyDaysFor, verifyDays,
  STAGES_INTERNAL, STAGE_LABEL_INTERNAL, eventsOf, acceptInternal, transferFinding, saveProblem, advanceProblem, saveContainment, advanceContainment,
  saveRca, advanceRca, savePlan, closeActions, acceptVerification, rejectVerification,
} from "../workflow.js";

const staff = () => db.activeProfiles().filter((p) => ["admin", "quality_manager", "auditor"].includes(p.role));
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
function detailsHTML(f) {
  const area = db.get("areas", f.area_id), { audit, standard, item, process } = originInfo(f);
  const row = (k, v) => `<div class="if-d-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  return `<div class="if-card"><h3>${icon("list")} Detalles</h3>
    ${row("Responsable", userCell(db.get("profiles", f.owner_id)) + (f.status === "abierto" && f.owner_id ? ' <span class="badge" data-tone="warn">Por aceptar</span>' : ""))}
    ${row("Clasificación", classBadge(f))}
    ${row("Proceso / Área", esc(process?.name || area?.name || f.area || "—"))}
    ${standard ? row("Norma aplicable", esc(standard.name)) : ""}
    ${item?.clause ? row("Cláusula", `<span class="mono">${esc(item.clause)}</span>`) : ""}
    ${row("Categoría", esc(catName(f.classification_id)))}
    ${row("Origen", audit ? `<a href="#/internas/audit/${audit.id}">${esc(audit.code)}</a>` : esc(SOURCE[f.source]?.[0] || "—"))}
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
      <select class="select" data-change="if-tpl-pick" data-id="${f.id}" data-kind="${kind}" ${editable ? "" : "disabled"}><option value="">— Texto libre —</option>${templates.map((t) => `<option value="${t.id}" ${t.id === st.templateId ? "selected" : ""}>${esc(t.code)} · ${esc(t.name)}</option>`).join("")}</select></label>
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
function stepBody(f, st) {
  const STAGES = STAGES_INTERNAL, cur = STAGES.indexOf(f.status === "en_analisis" ? "rca" : f.status), idx = STAGES.indexOf(st), act = canAct(f), ownerName = esc(db.profileName(f.owner_id));
  const draftKey = (k) => `${f.id}:${k}`, draftVal = (k, saved) => drafts[draftKey(k)] ?? saved ?? "";
  const ta = (k, saved, ph) => `<textarea class="textarea" id="ta-${k}" data-input="if-draft" data-key="${draftKey(k)}" rows="5" placeholder="${esc(ph)}">${esc(draftVal(k, saved))}</textarea>`;

  if (st === "abierto") {
    let controls = "";
    if (f.status === "abierto") {
      if (!f.owner_id) controls = lock("Este hallazgo no tiene responsable. Un administrador debe asignarlo desde <b>Editar</b>.");
      else if (act) controls = `<div class="stage-actions"><button class="btn primary" data-action="if-accept" data-id="${f.id}">${icon("check2")} Aceptar hallazgo</button>${canTransfer(f) ? `<button class="btn" data-action="if-transfer" data-id="${f.id}">${icon("swap")} Trasladar</button>` : ""}</div>${f.transfer_count > 0 ? lock("Este hallazgo ya fue trasladado una vez; no puede trasladarse de nuevo.") : ""}`;
      else controls = lock(`Solo <b>${ownerName}</b> (o un administrador) puede aceptar o trasladar este hallazgo.`);
    } else controls = `<div class="done-text">Aceptado por <b>${esc(db.profileName(f.accepted_by))}</b> · ${fmtDateTime(f.accepted_at)}</div>`;
    const rejected = f.reject_count > 0 && f.status === "abierto" ? `<div class="reject-note"><b>Verificación rechazada${f.rejected_at ? " el " + fmtDateTime(f.rejected_at) : ""}</b><br>${esc(f.rejection_reason || "")}</div>` : "";
    return `${rejected}<p class="muted" style="margin-bottom:14px">${esc(f.description || "Sin descripción inicial.")}</p>${controls}${attachmentsSection("finding", f.id, { ref: null, title: "Evidencia inicial", canEdit: act && idx <= cur })}`;
  }
  if (st === "descripcion") {
    if (idx > cur) return lock("Disponible cuando el responsable acepte el hallazgo.");
    if (idx < cur) return `<div class="done-text">${esc(f.problem_desc || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.problem_at)}</div>`;
    return act ? `<p class="q-label">¿Qué, cuándo, dónde y cuánto? Describe el problema con el mayor detalle posible.</p>${ta("problem_desc", f.problem_desc, "Describe el problema…")}${attachmentsSection("finding", f.id, { ref: "descripcion", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="if-save" data-id="${f.id}" data-field="problem_desc">Guardar borrador</button><button class="btn primary" data-action="if-advance" data-id="${f.id}" data-to="contencion" data-field="problem_desc">Guardar y continuar</button></div>` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la descripción.`);
  }
  if (st === "contencion") {
    if (idx > cur) return lock("Disponible cuando se registre la descripción del problema.");
    if (idx < cur) return `<div class="done-text">${esc(f.containment_text || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.containment_at)}</div>`;
    return act ? `<p class="q-label">¿Qué se hizo de inmediato para contener el problema?</p>${ta("containment_text", f.containment_text, "Acciones de contención inmediatas…")}${attachmentsSection("finding", f.id, { ref: "contencion", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="if-save" data-id="${f.id}" data-field="containment_text">Guardar borrador</button><button class="btn primary" data-action="if-advance" data-id="${f.id}" data-to="rca" data-field="containment_text">Guardar y continuar</button></div>` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la contención.`);
  }
  if (st === "rca") {
    if (idx > cur) return lock("Disponible cuando se registren las acciones de contención.");
    if (idx < cur) return `<div class="done-text">${esc(f.analysis_text || "Ver formato de causa raíz guardado.")}</div><div class="muted" style="margin-top:6px;font-size:13px">Registrado ${fmtDateTime(f.analysis_at)}</div>`;
    return act ? `<p class="q-label">Análisis de causa raíz</p>${templateBlock(f, "rca", true)}${attachmentsSection("finding", f.id, { ref: "rca", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="if-save-tpl" data-id="${f.id}" data-kind="rca">Guardar borrador</button><button class="btn primary" data-action="if-advance-rca" data-id="${f.id}">Guardar y continuar</button></div>` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar el análisis.`);
  }
  if (st === "en_accion") {
    if (idx > cur) return lock("Disponible cuando se registre el análisis de causa raíz.");
    if (idx < cur) return `<div class="done-text">${esc(f.action_plan || "Ver formato de acción correctiva guardado.")}</div><div class="muted" style="margin-top:6px;font-size:13px">Acciones cerradas el ${fmtDateTime(f.actions_closed_at || f.actions_closed_on)}</div>`;
    return act ? `<p class="q-label">¿Qué se hará para corregir el hallazgo de forma definitiva?</p>${templateBlock(f, "capa", true)}${attachmentsSection("finding", f.id, { ref: "accion", title: "Evidencia", canEdit: true })}<div class="stage-actions"><button class="btn" data-action="if-save-tpl" data-id="${f.id}" data-kind="capa">Guardar borrador</button><button class="btn primary" data-action="if-close-actions" data-id="${f.id}">Cerrar acciones y enviar a verificación</button></div>${lock(`Un administrador tendrá ${verifyDaysFor(f)} días hábiles para aceptar o rechazar. Se requiere descripción (o formato) y al menos una evidencia.`)}` : lock(`Solo <b>${ownerName}</b> (o un administrador) puede registrar la acción.`);
  }
  if (st === "verificacion") {
    if (idx > cur) return lock("Disponible cuando se cierren las acciones.");
    const recap = `<p class="q-label">Causa raíz</p>${templateBlock(f, "rca", false)}<p class="q-label" style="margin-top:14px">Acción correctiva</p>${templateBlock(f, "capa", false)}${attachmentsSection("finding", f.id, { ref: "accion", title: "Evidencia de la acción", canEdit: false })}`;
    if (idx < cur) return `${recap}<p class="q-label" style="margin-top:14px">Resultado de la verificación</p><div class="done-text">${esc(f.verification_notes || "—")}</div><div class="muted" style="margin-top:6px;font-size:13px">${fmtDateTime(f.verified_at)}</div>`;
    return `${recap}${canVerify(f) ? `<p class="q-label" style="margin-top:14px">¿Las acciones fueron efectivas?</p>${ta("verification_notes", f.verification_notes, "Resultado de la verificación…")}<div class="stage-actions"><button class="btn primary" data-action="if-verify-accept" data-id="${f.id}">${icon("check2")} Aceptar</button><button class="btn danger" data-action="if-verify-reject" data-id="${f.id}">${icon("close")} Rechazar</button></div>` : lock("Solo un <b>administrador</b> puede aceptar o rechazar la verificación.")}`;
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
function pageHTML(f) {
  const STAGES = STAGES_INTERNAL, cur = STAGES.indexOf(f.status === "en_analisis" ? "rca" : f.status), view = viewStage || (f.status === "en_analisis" ? "rca" : f.status);
  return `<div class="if-page">
    <div class="if-head">
      <button class="btn ghost icon" data-action="if-back" aria-label="Volver a la lista">${icon("chevL")}</button>
      <div class="if-head-t"><span class="eyebrow mono">${esc(f.code)}</span><h1>${esc(f.title)}</h1></div>
      <div class="if-head-badges">${badge(FINDING_STATUS, f.status)}${f.reject_count > 0 ? `<span class="badge" data-tone="danger">Rechazado ${f.reject_count}×</span>` : ""}</div>
      ${db.can.write ? `<button class="btn" data-action="if-edit" data-id="${f.id}">${icon("edit")} Editar</button>` : ""}
    </div>
    <div class="if-grid">
      <aside class="if-side">${milestoneCard(f)}${filesCard(f)}${historyCard(f)}</aside>
      <main class="if-main">
        <div class="if-steps" role="tablist" aria-label="Etapas del hallazgo">${STAGES.map((s, i) => `<button class="if-step ${i < cur ? "done" : ""} ${i === cur ? "current" : ""} ${s === view ? "viewing" : ""} ${i > cur ? "locked" : ""}" role="tab" aria-selected="${s === view}" data-action="if-stage" data-stage="${s}"><span>${STAGE_LABEL_INTERNAL[s]}</span></button>`).join("")}</div>
        <div class="if-status" id="if-status-box"><div class="if-status-k">${STAGE_LABEL_INTERNAL[view]}</div>${stepBody(f, view)}</div>
      </main>
      <aside class="if-details">${detailsHTML(f)}</aside>
    </div>
  </div>`;
}
function paint() {
  const f = db.get("findings", curId);
  const root = document.getElementById("if-root");
  if (!f || !root) return;
  root.innerHTML = pageHTML(f);
}
export function renderInternalFinding(root, id, stage) {
  const f = db.get("findings", id);
  clearInterval(tick);
  if (!f) { setHead({ title: "Hallazgo no encontrado" }); root.innerHTML = empty("No se encontró el hallazgo", "Puede que haya sido eliminado.", "finding"); return; }
  curId = id; if (stage) viewStage = stage; else if (!viewStage) viewStage = null;
  setHead({ eyebrow: "Auditorías Internas", title: f.code, subtitle: f.title });
  root.innerHTML = `<div id="if-root"></div>`;
  paint();
  tick = setInterval(paint, 15000);
}
hooks.finding = async () => paint();

/* ------------------------------------- Formularios ------------------------------------ */
function editFinding(f) {
  openForm({
    eyebrow: f.code, title: "Editar hallazgo", size: "wide",
    values: f,
    fields: [
      { name: "title", label: "Título del hallazgo", required: true, span2: true },
      { name: "description", label: "Descripción", type: "textarea", span2: true },
      { name: "source", label: "Origen", type: "select", required: true, options: mapOpts(SOURCE) },
      { name: "class_id", label: "Clasificación", type: "select", required: true, options: classOptions(["Interna"]) },
      { name: "area_id", label: "Área", type: "select", options: areaOptions() },
      { name: "owner_id", label: "Responsable", type: "select", options: staff().map((p) => [p.id, p.full_name]) },
      { name: "classification_id", label: "Categoría", type: "select", options: catOpts("categoria_hallazgo") },
    ],
    onSubmit: async (v) => { await db.update("findings", f.id, { ...v, area: db.get("areas", v.area_id)?.name || null }); toast("Hallazgo actualizado", "ok"); paint(); },
    onDelete: db.can.manage ? async () => { await db.remove("findings", f.id); toast("Hallazgo eliminado"); navigate(`${wsId()}/hallazgos`); } : null,
  });
}
function transferForm(f) {
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
function rejectForm(f) {
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
on("if-edit", (el) => editFinding(fnd(el.dataset.id)));
on("if-stage", (el) => { viewStage = el.dataset.stage; paint(); });
on("if-accept", (el) => run(async () => { await acceptInternal(fnd(el.dataset.id)); toast("Hallazgo aceptado", "ok"); }, "descripcion"));
on("if-transfer", (el) => transferForm(fnd(el.dataset.id)));
on("if-save", (el) => run(async () => { const f = fnd(el.dataset.id), field = el.dataset.field, text = val(field); await db.update("findings", f.id, { [field]: text }); toast("Borrador guardado", "ok"); }));
on("if-advance", (el) => {
  const f = fnd(el.dataset.id), field = el.dataset.field, to = el.dataset.to, text = val(field);
  if (text.length < 5) { toast("Escribe el contenido de esta etapa.", "danger"); return; }
  const fn = field === "problem_desc" ? () => advanceProblem(f, text) : () => advanceContainment(f, text);
  run(async () => { await fn(); delete drafts[`${f.id}:${field}`]; toast("Guardado · siguiente etapa", "ok"); }, to);
});
on("if-save-tpl", (el) => run(async () => { await saveTemplateIfAny(fnd(el.dataset.id), el.dataset.kind); const f = fnd(el.dataset.id); const free = val(TPL[el.dataset.kind].free); if (free) await db.update("findings", f.id, { [TPL[el.dataset.kind].free]: free }); toast("Borrador guardado", "ok"); }));
on("if-advance-rca", (el) => {
  const f = fnd(el.dataset.id), free = val("analysis_text"), tpl = hasTemplateContent(f, "rca");
  if (!tpl && free.length < 5) { toast("Describe la causa raíz o elige y llena un formato.", "danger"); return; }
  run(async () => { await saveTemplateIfAny(f, "rca"); await advanceRca(f, tpl ? (f.analysis_text || "Ver formato de causa raíz guardado.") : free); toast("Guardado · pasa a Acciones", "ok"); }, "en_accion");
});
on("if-close-actions", async (el) => {
  const f = fnd(el.dataset.id), free = val("action_plan"), tpl = hasTemplateContent(f, "capa");
  const ev = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id && a.ref === "accion").length;
  if (!tpl && free.length < 5) { toast("Describe la acción correctiva o elige y llena un formato.", "danger"); return; }
  if (!ev) { toast("Adjunta al menos una evidencia de la acción.", "danger"); return; }
  const m1 = milestones(f).m1, late = m1.state === "overdue";
  if (!(await confirmDialog({ title: "Cerrar acciones", message: `El milestone de cierre se detiene ahora (${late ? "fuera de tiempo" : "a tiempo"}) y empieza la verificación: un administrador tendrá ${verifyDaysFor(f)} días hábiles.`, confirmLabel: "Cerrar acciones" }))) return;
  run(async () => { await saveTemplateIfAny(f, "capa"); await closeActions(f, tpl ? (f.action_plan || "Ver formato de acción correctiva guardado.") : free); toast("Acciones cerradas · en Verificación", "ok"); notifyFindings([db.get("findings", f.id)], "verify"); }, "verificacion");
});
on("if-verify-accept", (el) => {
  const notes = val("verification_notes");
  if (notes.length < 5) { toast("Describe cómo se verificó la efectividad de las acciones.", "danger"); return; }
  run(async () => { await acceptVerification(fnd(el.dataset.id), notes); toast("Verificación aceptada · hallazgo cerrado", "ok"); }, "cerrado");
});
on("if-verify-reject", (el) => rejectForm(fnd(el.dataset.id)));
onInput("if-draft", (el) => { drafts[el.dataset.key] = el.value; });
onChange("if-tpl-pick", (el) => { tplDraftFor(fnd(el.dataset.id), el.dataset.kind).templateId = el.value; paint(); });
