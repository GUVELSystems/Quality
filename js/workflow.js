/* =====================================================================
   Flujo del hallazgo
   Abierto (aceptar o trasladar) → En acción (acción + evidencia) →
   Verificación (el administrador acepta o rechaza) → Cerrado
   Si se rechaza, el hallazgo se reabre y el milestone de cierre continúa
   con el tiempo que le quedaba.

   Milestones (relojes en tiempo hábil, lunes a viernes, con horas y minutos):
     1) Cierre de acciones: plazo según la clasificación (N1 = 3 días, …)
     2) Verificación: N días hábiles después de cerrar las acciones (5 por defecto)
   ===================================================================== */
import * as db from "./db.js";
import { esc, today, addBusinessDays, businessMs, shiftBusiness, fmtDuration, fmtDate, fmtDateTime, DAY_MS, endOfDay, isoDate, dueDateOf } from "./utils.js";

/* ------------------------------ Clasificaciones ---------------------------- */
/** Tipos a los que puede aplicar una clasificación (Issues = notificaciones de clientes) */
export const SCOPES = ["LPA", "Producto", "Proceso", "Sistema", "Interna", "Issues"];
export const scopesOf = (c) => (Array.isArray(c?.scopes) && c.scopes.length ? c.scopes : SCOPES);
export const WS_SCOPES = { auditorias: ["LPA", "Producto", "Proceso", "Sistema"], internas: ["Interna"], issues: ["Issues"] };
export const scopesForWs = (ws) => WS_SCOPES[ws] || SCOPES;
/** Clasificaciones activas; si se indican tipos, solo las que aplican a alguno de ellos */
export const classes = (scopes) => {
  const list = db.rows("finding_classes").filter((c) => c.active);
  return (scopes ? list.filter((c) => scopesOf(c).some((x) => scopes.includes(x))) : list).sort((a, b) => a.days - b.days || a.code.localeCompare(b.code));
};
export const classOf = (f) => db.get("finding_classes", f?.class_id);
/** Dentro de los mismos tipos, la clasificación con menos días es la más urgente (rojo), luego ámbar y azul */
export const classTone = (c) => { const i = classes(scopesOf(c)).findIndex((x) => x.id === c?.id); return i === 0 ? "danger" : i === 1 ? "warn" : "info"; };
export const classBadge = (f) => {
  const c = classOf(f);
  return c ? `<span class="badge" data-tone="${classTone(c)}" style="text-transform:none" title="${esc(c.name || c.code)} · ${c.days} días hábiles · aplica a ${esc(scopesOf(c).join(", "))}">${esc(c.code)} · ${c.days} d</span>` : `<span class="badge" data-tone="neutral">Sin clasificación</span>`;
};
/** "N1 · 3 d" y, si el mismo código existe para varios tipos, se añade a cuáles aplica */
export const classTag = (c) => `${c.code} · ${c.days} d${classes().filter((x) => x.code === c.code).length > 1 ? ` (${scopesOf(c).join(", ")})` : ""}`;
export const classOptions = (scopes) => classes(scopes).map((c) => [c.id, `${c.code} · ${c.days} días hábiles${c.name && c.name !== c.code && c.name !== `Clasificación ${c.code}` ? " · " + c.name : ""}`]);
/** Fecha límite (YYYY-MM-DD) para una clasificación, contando desde ahora: sirve para mostrar avisos */
export const dueFor = (classId, from = new Date()) => { const c = db.get("finding_classes", classId); return c ? dueDateOf(shiftBusiness(new Date(from), c.days * DAY_MS)) : null; };
/** Campos de inicio y límite (con hora) de un hallazgo nuevo */
export function deadlineFields(classId, start = new Date()) {
  const c = db.get("finding_classes", classId), due = c ? shiftBusiness(start, c.days * DAY_MS) : null;
  return { start_date: isoDate(start), due_at: due ? due.toISOString() : null, due_date: due ? dueDateOf(due) : null };
}
/** Días hábiles de verificación: valor por defecto y, si existe, el definido para el tipo del hallazgo */
export const VERIFY_TYPES = ["LPA", "Producto", "Proceso", "Sistema", "Interna", "Issues"];
export const verifyDays = () => Number(db.setting("verification_days", 5)) || 5;
export const verifyDaysForType = (t) => Number(db.setting(`verification_days_${t}`, verifyDays())) || verifyDays();
/** Tipo de un hallazgo: el de la auditoría que lo originó; si no, según el módulo */
export function findingType(f) {
  const a = db.get("audits", f?.audit_id), p = a && db.get("audit_plans", a.plan_id);
  if (p) return p.audit_type;
  return f?.module === "internas" ? "Interna" : f?.module === "issues" ? "Issues" : null;
}
export const verifyDaysFor = (f) => { const t = findingType(f); return t ? verifyDaysForType(t) : verifyDays(); };

/* ------------------------------ Niveles y áreas --------------------------- */
export const levels = () => db.rows("lpa_levels").filter((l) => l.active).sort((a, b) => a.level - b.level);
export const levelOptions = () => levels().map((l) => [l.level, l.name && l.name !== `Nivel ${l.level}` ? `Nivel ${l.level} · ${l.name}` : `Nivel ${l.level}`]);
export const levelLabel = (n) => { const l = db.rows("lpa_levels").find((x) => x.level === Number(n)); return n ? (l?.name && l.name !== `Nivel ${n}` ? `Nivel ${n} · ${l.name}` : `Nivel ${n}`) : "—"; };
export const areas = () => db.rows("areas").filter((a) => a.active).sort((a, b) => a.name.localeCompare(b.name));
export const areaOptions = () => areas().map((a) => [a.id, a.name]);

/** Responsable de un hallazgo: el de ese nivel LPA en el área; si no hay, el dueño del área */
export function resolveOwner(areaId, level) {
  if (!areaId) return null;
  if (level != null) {
    const r = db.rows("area_level_owners").find((x) => x.area_id === areaId && Number(x.level) === Number(level));
    if (r?.owner_id) return r.owner_id;
  }
  return db.get("areas", areaId)?.owner_id || null;
}

/* -------------------------------- Permisos ------------------------------- */
export const isOwner = (f) => !!f && f.owner_id === db.state.profile.id;
/** Avanzar el hallazgo (aceptar, trasladar, registrar acción): su responsable o un administrador */
export const canAct = (f) => db.can.write && (isOwner(f) || db.can.admin);
export const canTransfer = (f) => canAct(f) && f.status === "abierto" && !(f.transfer_count > 0);
export const canVerify = (f) => db.can.admin && f.status === "verificacion";

/* -------------------------------- Milestones ----------------------------- */
/** Las auditorías internas usan un flujo más completo (8D-like); el resto, el flujo simple */
export const STAGES = ["abierto", "en_accion", "verificacion", "cerrado"];
export const STAGES_INTERNAL = ["abierto", "descripcion", "contencion", "rca", "en_accion", "verificacion", "cerrado"];
/** Etiquetas del flujo simple (Auditorías, Issues) — sin cambios frente a antes */
export const STAGE_LABEL = { abierto: "Abierto", en_analisis: "En acción", en_accion: "En acción", verificacion: "Verificación", cerrado: "Cerrado" };
/** Etiquetas del flujo ampliado de Auditorías Internas */
export const STAGE_LABEL_INTERNAL = {
  abierto: "Abierto", descripcion: "Descripción del problema", contencion: "Acciones de contención", rca: "Análisis causa raíz",
  en_accion: "Acciones", verificacion: "Verificación", cerrado: "Cierre",
};
export const isInternal = (f) => (f?.module || "auditorias") === "internas";
export const stagesFor = (f) => (isInternal(f) ? STAGES_INTERNAL : STAGES);
export const stageOf = (f) => (f.status === "en_analisis" ? (isInternal(f) ? "rca" : "en_accion") : f.status);   // compatibilidad con hallazgos antiguos

const startInstant = (f) => {
  const c = f.created_at ? new Date(f.created_at) : new Date();
  return f.start_date && isoDate(c) !== f.start_date ? new Date(f.start_date + "T00:00:00") : c;
};
export const dueInstant = (f) => (f.due_at ? new Date(f.due_at) : f.due_date ? endOfDay(f.due_date) : null);
export const verifyInstant = (f) => (f.verify_due_at ? new Date(f.verify_due_at) : f.verify_due ? endOfDay(f.verify_due) : null);
const closedInstant = (f) => (f.actions_closed_at ? new Date(f.actions_closed_at) : f.actions_closed_on ? new Date(f.actions_closed_on + "T12:00:00") : null);
const verifiedInstant = (f) => (f.verified_at ? new Date(f.verified_at) : f.verified_on ? new Date(f.verified_on + "T12:00:00") : null);

function evalMilestone(label, start, due, end, now) {
  let state, rem = null;
  if (end) { rem = due ? businessMs(end, due) : 0; state = rem >= 0 ? "ontime" : "late"; }
  else if (!due) state = "pending";
  else { rem = businessMs(now, due); state = rem >= 0 ? "running" : "overdue"; }
  const total = start && due ? Math.max(1, businessMs(start, due)) : 1, used = start ? Math.max(0, businessMs(start, end || now)) : 0;
  const dur = fmtDuration(rem ?? 0);
  const text = {
    ontime: `Cerrado a tiempo · sobraron ${dur.text}`, late: `Cerrado tarde · +${dur.text}`,
    overdue: `Vencido hace ${dur.text}`, running: `Quedan ${dur.text}`, pending: "Sin iniciar",
  }[state];
  const caption = { ontime: "Sobraron", late: "De retraso", overdue: "Vencido hace", running: "Quedan", pending: "" }[state];
  return {
    label, start, due, end, state, text, caption, dur, ms: rem,
    tone: state === "ontime" ? "ok" : state === "late" || state === "overdue" ? "danger" : state === "running" ? "info" : "neutral",
    pct: Math.min(100, Math.round((used / total) * 100)),
  };
}
/** Dos relojes independientes: el de cierre se detiene (verde/rojo) al cerrar las acciones y el de verificación
 *  empieza ahí. Si el administrador rechaza, el hallazgo se reabre y el de cierre continúa con el tiempo que le quedaba. */
export function milestones(f, now = new Date()) {
  const closed = ["verificacion", "cerrado"].includes(stageOf(f)) ? closedInstant(f) : null;
  const m1 = evalMilestone("Cierre de acciones", startInstant(f), dueInstant(f), closed, now);
  const m2 = closed ? evalMilestone("Verificación", closed, verifyInstant(f), stageOf(f) === "cerrado" ? verifiedInstant(f) : null, now) : null;
  return { m1, m2 };
}
/** ¿Qué plazo está corriendo ahora y está vencido? */
export function overdueKind(f, now = new Date()) {
  if (f.status === "cerrado") return null;
  const { m1, m2 } = milestones(f, now);
  if (stageOf(f) === "verificacion") return m2?.state === "overdue" ? "verificacion" : null;
  return m1.state === "overdue" ? "cierre" : null;
}

/* ------------------------------ Historial ------------------------------- */
export const logEvent = (f, kind, detail = null) => db.insert("finding_events", { finding_id: f.id, kind, detail, actor: db.state.profile.id }).catch(() => null);
export const eventsOf = (f) => db.rows("finding_events").filter((e) => e.finding_id === f.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

/* ------------------------------ Acciones del flujo ------------------------ */
const nowISO = () => new Date().toISOString();
export async function acceptFinding(f) {
  const r = await db.update("findings", f.id, { status: "en_accion", accepted_at: nowISO(), accepted_by: db.state.profile.id });
  logEvent(f, "accepted"); return r;
}
export async function transferFinding(f, to, reason) {
  const r = await db.update("findings", f.id, { owner_id: to, transfer_count: 1, transferred_from: f.owner_id, transferred_at: nowISO(), transfer_reason: reason });
  logEvent(f, "transferred", `${db.profileName(f.owner_id)} → ${db.profileName(to)} · ${reason}`); return r;
}
export const savePlan = (f, text) => db.update("findings", f.id, { action_plan: text });

/* -------------------------- Flujo ampliado (Auditorías Internas) ---------------------- */
export async function acceptInternal(f) {
  const r = await db.update("findings", f.id, { status: "descripcion", accepted_at: nowISO(), accepted_by: db.state.profile.id });
  logEvent(f, "accepted"); return r;
}
export const saveProblem = (f, text) => db.update("findings", f.id, { problem_desc: text });
export async function advanceProblem(f, text) {
  const r = await db.update("findings", f.id, { problem_desc: text, problem_at: nowISO(), status: "contencion" });
  logEvent(f, "problem", "Descripción del problema registrada"); return r;
}
export const saveContainment = (f, text) => db.update("findings", f.id, { containment_text: text });
export async function advanceContainment(f, text) {
  const r = await db.update("findings", f.id, { containment_text: text, containment_at: nowISO(), status: "rca" });
  logEvent(f, "containment", "Acciones de contención registradas"); return r;
}
export const saveRca = (f, text) => db.update("findings", f.id, { analysis_text: text });
export async function advanceRca(f, text) {
  const r = await db.update("findings", f.id, { analysis_text: text, analysis_at: nowISO(), status: "en_accion" });
  logEvent(f, "rca", "Análisis de causa raíz registrado"); return r;
}
export async function closeActions(f, text) {
  const now = new Date(), verifyDue = shiftBusiness(now, verifyDaysFor(f) * DAY_MS), late = businessMs(now, dueInstant(f) || now) < 0;
  const r = await db.update("findings", f.id, {
    action_plan: text, actions_closed_at: now.toISOString(), actions_closed_on: isoDate(now), verify_due_at: verifyDue.toISOString(), verify_due: dueDateOf(verifyDue), status: "verificacion",
  });
  logEvent(f, "actions_closed", late ? "Cerradas fuera de tiempo" : "Cerradas a tiempo"); return r;
}
/** El administrador acepta la verificación: el hallazgo se cierra */
export async function acceptVerification(f, notes) {
  const r = await db.update("findings", f.id, { verification_notes: notes, verified_at: nowISO(), verified_by: db.state.profile.id, verified_on: today(), status: "cerrado" });
  const m = milestones({ ...f, status: "cerrado", verified_at: nowISO() }).m2;
  logEvent(f, "verified", `${notes}${m ? ` · verificación ${m.state === "ontime" ? "a tiempo" : "tardía"}` : ""}`); return r;
}
/** El administrador rechaza: se reabre y el milestone de cierre continúa con el tiempo que le quedaba */
export async function rejectVerification(f, reason) {
  const now = new Date(), due = dueInstant(f), closed = closedInstant(f);
  const remaining = due && closed ? businessMs(closed, due) : 0;               // positivo = sobraba tiempo; negativo = ya iba tarde
  const newDue = shiftBusiness(now, remaining);
  const r = await db.update("findings", f.id, {
    status: "abierto", reject_count: (f.reject_count || 0) + 1, rejected_at: now.toISOString(), rejection_reason: reason,
    actions_closed_at: null, actions_closed_on: null, verify_due_at: null, verify_due: null, verification_notes: null,
    due_at: newDue.toISOString(), due_date: dueDateOf(newDue),
  });
  logEvent(f, "rejected", reason); return r;
}


/* =====================================================================
   Flujo 8D / 4D (Auditorías Internas)
   Registro → Detalles del problema → Solicitud → D1…D8 (8D) o D1→D4 (4D) → Verificación
   Todo el contenido de D1…D8 vive en `finding.d_data` (su forma cambia según
   sea 8D o 4D y según el tipo de causa raíz elegido).
   ===================================================================== */
export const PS_TYPES = { "8D": "8D", "4D": "4D" };
export const RCA_TYPES = { "5whys": "5 Porqués", ishikawa: "Ishikawa" };
/** Clave de ajuste para el número de control de cada FORMATO (no de cada hallazgo): se asigna una
 *  vez por tipo en Configuración → CAPA Files y se imprime en todos los PDF de ese tipo. */
export const controlKey = (ps, rca) => `control_${ps}${ps === "8D" ? "_" + rca : ""}`;
const NEW_FLOW_STATUSES = new Set(["registro", "detalles", "solicitud", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"]);
/** Un hallazgo nuevo nace en "registro" sin estrategia todavía; se distingue del flujo anterior por su etapa,
 *  no por strategy_ps (que solo se llena hasta "Detalles del problema"). */
export const isEightD = (f) => !!f?.strategy_ps || NEW_FLOW_STATUSES.has(f?.status);

/** Las etapas D que aplican según la estrategia: 8D ve las 8; 4D se detiene en D4 (que ya incluye el cierre) */
/** D6 y D7 se trabajan juntos (lo correctivo y lo preventivo pueden avanzar en paralelo); un 4D
 *  termina en D4 (ya incluye el cierre) y nunca ve D5-D8. */
export function dStages(f) {
  return f?.strategy_ps === "4D" ? ["d1", "d2", "d3", "d4", "d4_revision"] : ["d1", "d2", "d3", "d4", "d5", "d6", "d8", "d8_revision"];
}
export function eightdStages(f) {
  return ["registro", "detalles", "solicitud", ...dStages(f), "verificacion", "cerrado"];
}
export const D_LABEL = {
  registro: "Registro", detalles: "Detalles del problema", solicitud: "Solicitud de hallazgo",
  d1: "Equipo", d2: "Descripción del problema", d4_revision: "Revisión", d8_revision: "Revisión",
  verificacion: "Verificación", cerrado: "Cierre",
};
/** D3/D4 cambian de título según 8D o 4D. Solo el título corto se muestra en el portal: el PDF
 *  sigue llevando el "D1", "D2"… como en la plantilla oficial. */
export function dLabel(stage, f) {
  if (D_LABEL[stage]) return D_LABEL[stage];
  const d4D = f?.strategy_ps === "4D";
  if (stage === "d3") return d4D ? "Causa raíz" : "Acciones de contención";
  if (stage === "d4") return d4D ? "Acciones inmediatas y cierre" : `Causa raíz (${RCA_TYPES[f?.strategy_rca] || "—"})`;
  return { d5: "Plan de acciones correctivas", d6: "Correctivas implementadas y preventivas", d8: "Reconocimiento y cierre" }[stage] || stage;
}
export const canRegister = (f) => db.can.admin && f.status === "registro";
export const canSetStrategy = (f) => db.can.admin && f.status === "detalles";
export const canActD = (f) => db.can.write && f.status !== "registro" && f.status !== "detalles" && (isOwner(f) || db.can.admin) && !["verificacion", "cerrado"].includes(f.status);
export const canVerify8D = (f) => db.can.admin && f.status === "verificacion";

export async function registerFinding(f, patch) {
  const r = await db.update("findings", f.id, { ...patch, status: "detalles", registered_at: nowISO(), registered_by: db.state.profile.id });
  logEvent(f, "registered"); return r;
}
export async function saveStrategy(f, strategy) {
  const r = await db.update("findings", f.id, { ...strategy, status: "solicitud", strategy_at: nowISO(), strategy_by: db.state.profile.id });
  logEvent(f, "strategy", strategy.strategy_ps); return r;
}
/** El responsable elige el método de causa raíz (5 Whys o Ishikawa) hasta llegar a esa etapa, no antes */
export async function saveRcaMethod(f, rca) {
  const r = await db.update("findings", f.id, { strategy_rca: rca });
  logEvent(f, "rca_method", RCA_TYPES[rca]); return r;
}
export async function acceptD(f) {
  const r = await db.update("findings", f.id, { status: "d1", accepted_at: nowISO(), accepted_by: db.state.profile.id });
  logEvent(f, "accepted"); return r;
}
export const saveD = (f, patch) => db.update("findings", f.id, { d_data: { ...f.d_data, ...patch } });
export async function advanceD(f, stage, patch) {
  const stages = eightdStages(f), i = stages.indexOf(stage), next = stages[i + 1];
  const data = { d_data: { ...f.d_data, ...patch }, status: next };
  if (next === "verificacion") {                            // última D: aquí se "cierran las acciones" para el milestone
    const now = new Date(), verifyDue = shiftBusiness(now, verifyDaysFor(f) * DAY_MS);
    Object.assign(data, { actions_closed_at: now.toISOString(), actions_closed_on: isoDate(now), verify_due_at: verifyDue.toISOString(), verify_due: dueDateOf(verifyDue) });
  }
  const r = await db.update("findings", f.id, data);
  logEvent(f, "d_stage", dLabel(stage, f)); return r;
}
/* ------------------------- Revisión (D4 del 4D, D8 del 8D) ------------------------- */
/** Mismo mecanismo para los dos: alguien elegido revisa, aprueba o rechaza, antes de Verificación.
 *  "stage" es "d4" (4D) o "d8" (8D) — cada uno guarda su propio "<stage>_revision" como estatus. */
export const canReview = (f) => db.can.write && /_revision$/.test(f.status) && (f.reviewer_id === db.state.profile.id || db.can.admin);
export const canReview4D = canReview;   // alias por compatibilidad con el nombre anterior
/** Estatus automático que se muestra en el cierre del 4D/8D (ya no se escribe a mano) */
export function closure4DStatus(f) {
  if (f.status === "cerrado") return "Aprobado";
  if (f.status === "verificacion") return "En verificación";
  if (f.status === "d4_revision" || f.status === "d8_revision") return "En revisión";
  if (f.d_data?.closure4d?.decision === "rechazado") return "Rechazado · en corrección";
  return "Borrador";
}
export async function sendToReview(f, stage, reviewerId, patch) {
  const closure4d = { ...(f.d_data?.closure4d || {}), ...(patch?.closure4d || {}), preparer_id: f.owner_id, prepared_date: today() };
  const r = await db.update("findings", f.id, { status: `${stage}_revision`, reviewer_id: reviewerId, d_data: { ...f.d_data, ...patch, closure4d } });
  logEvent(f, "sent_review", db.profileName(reviewerId)); return r;
}
export async function approveReview(f, notes) {
  const now = new Date(), verifyDue = shiftBusiness(now, verifyDaysFor(f) * DAY_MS);
  const closure4d = { ...(f.d_data?.closure4d || {}), reviewed_by_id: db.state.profile.id, reviewed_date: today(), review_notes: notes, decision: "aprobado" };
  const r = await db.update("findings", f.id, {
    status: "verificacion", actions_closed_at: now.toISOString(), actions_closed_on: isoDate(now), verify_due_at: verifyDue.toISOString(), verify_due: dueDateOf(verifyDue),
    d_data: { ...f.d_data, closure4d },
  });
  logEvent(f, "review_approved", notes); return r;
}
export async function rejectReview(f, stage, notes) {
  const closure4d = { ...(f.d_data?.closure4d || {}), reviewed_by_id: db.state.profile.id, reviewed_date: today(), review_notes: notes, decision: "rechazado" };
  const r = await db.update("findings", f.id, { status: stage, d_data: { ...f.d_data, closure4d } });
  logEvent(f, "review_rejected", notes); return r;
}
// Alias con el nombre anterior, para el código del 4D que ya los usaba así
export const sendToReview4D = (f, reviewerId, patch) => sendToReview(f, "d4", reviewerId, patch);
export const approveReview4D = approveReview;
export const rejectReview4D = (f, notes) => rejectReview(f, "d4", notes);
export async function closeVerification8D(f, notes) {
  const r = await db.update("findings", f.id, { verification_notes: notes, verified_at: nowISO(), verified_by: db.state.profile.id, verified_on: today(), status: "cerrado" });
  logEvent(f, "verified", notes); return r;
}
export async function rejectVerification8D(f, reason) {
  const r = await db.update("findings", f.id, { status: "registro", reject_count: (f.reject_count || 0) + 1, rejected_at: nowISO(), rejection_reason: reason });
  logEvent(f, "rejected", reason); return r;
}
