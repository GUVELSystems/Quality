/* =====================================================================
   Flujo del hallazgo
   Abierto (aceptar o trasladar) → En análisis (¿por qué?) → En acción
   (¿qué se hará? + evidencia) → Verificación (solo admin) → Cerrado
   Milestones: (1) cierre de acciones, con plazo según la clasificación
               (2) verificación, N días hábiles después de cerrar acciones
   ===================================================================== */
import * as db from "./db.js";
import { esc, today, addBusinessDays, businessDaysBetween, fmtDate } from "./utils.js";

/* ------------------------------ Clasificaciones ---------------------------- */
export const classes = () => db.rows("finding_classes").filter((c) => c.active).sort((a, b) => a.days - b.days || a.code.localeCompare(b.code));
export const classOf = (f) => db.get("finding_classes", f?.class_id);
/** La clasificación con menos días es la más urgente (rojo), luego ámbar y azul */
export const classTone = (c) => { const i = classes().findIndex((x) => x.id === c?.id); return i === 0 ? "danger" : i === 1 ? "warn" : "info"; };
export const classBadge = (f) => {
  const c = classOf(f);
  return c ? `<span class="badge" data-tone="${classTone(c)}" style="text-transform:none" title="${esc(c.name || c.code)} · ${c.days} días hábiles">${esc(c.code)} · ${c.days} d</span>` : `<span class="badge" data-tone="neutral">Sin clasificación</span>`;
};
export const classOptions = () => classes().map((c) => [c.id, `${c.code} · ${c.days} días hábiles`]);
export const dueFor = (classId, from = today()) => { const c = db.get("finding_classes", classId); return c ? addBusinessDays(from, c.days) : null; };
export const verifyDays = () => Number(db.setting("verification_days", 15)) || 15;

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
/** Avanzar el hallazgo (aceptar, trasladar, análisis, acción): su responsable o un administrador */
export const canAct = (f) => db.can.write && (isOwner(f) || db.can.admin);
export const canTransfer = (f) => canAct(f) && f.status === "abierto" && !(f.transfer_count > 0);
export const canVerify = (f) => db.can.admin && f.status === "verificacion";

/* -------------------------------- Milestones ----------------------------- */
function evalMilestone(label, start, due, end) {
  const t = today(), total = start && due ? Math.max(1, businessDaysBetween(start, due)) : 1;
  let state, days;
  if (end) { days = due ? businessDaysBetween(due, end) : 0; state = days > 0 ? "late" : "ontime"; }
  else if (!due) { state = "pending"; days = null; }
  else { days = businessDaysBetween(t, due); state = days < 0 ? "overdue" : "running"; }
  const used = start ? Math.max(0, businessDaysBetween(start, end || t)) : 0;
  const tone = state === "ontime" ? "ok" : state === "late" || state === "overdue" ? "danger" : state === "running" ? "info" : "neutral";
  const text = {
    ontime: `Cerrado a tiempo · ${fmtDate(end)}`,
    late: `Cerrado tarde (+${days} d hábiles) · ${fmtDate(end)}`,
    overdue: `Vencido hace ${-days} d hábiles`,
    running: days === 0 ? "Vence hoy" : `Quedan ${days} d hábiles`,
    pending: "Sin iniciar",
  }[state];
  return { label, start, due, end, state, tone, days, text, pct: Math.min(100, Math.round((used / total) * 100)) };
}
/** Dos ventanas independientes: la de cierre se congela al cerrar las acciones (verde/rojo) y
 *  la de verificación empieza ahí; así no se pierde la trazabilidad de haber cerrado a tiempo o no. */
export function milestones(f) {
  const m1 = evalMilestone("Cierre de acciones", f.start_date || (f.created_at || today()).slice(0, 10), f.due_date, f.actions_closed_on);
  const m2 = f.actions_closed_on ? evalMilestone("Verificación", f.actions_closed_on, f.verify_due, f.verified_on) : null;
  return { m1, m2 };
}
/** ¿Qué plazo está corriendo ahora y está vencido? */
export function overdueKind(f) {
  const { m1, m2 } = milestones(f);
  if (f.status === "cerrado") return null;
  if (!f.actions_closed_on) return m1.state === "overdue" ? "cierre" : null;
  return m2?.state === "overdue" ? "verificacion" : null;
}
export const STAGES = ["abierto", "en_analisis", "en_accion", "verificacion", "cerrado"];
export const STAGE_LABEL = { abierto: "Abierto", en_analisis: "En análisis", en_accion: "En acción", verificacion: "Verificación", cerrado: "Cerrado" };

/* ------------------------------ Acciones del flujo ------------------------ */
const nowISO = () => new Date().toISOString();
export const acceptFinding = (f) => db.update("findings", f.id, { status: "en_analisis", accepted_at: nowISO(), accepted_by: db.state.profile.id });
export const transferFinding = (f, to, reason) => db.update("findings", f.id, { owner_id: to, transfer_count: 1, transferred_from: f.owner_id, transferred_at: nowISO(), transfer_reason: reason });
export const saveAnalysis = (f, text, advance) => db.update("findings", f.id, advance ? { analysis_text: text, analysis_at: nowISO(), status: "en_accion" } : { analysis_text: text });
export const savePlan = (f, text) => db.update("findings", f.id, { action_plan: text });
export const closeActions = (f, text) => db.update("findings", f.id, { action_plan: text, actions_closed_on: today(), verify_due: addBusinessDays(today(), verifyDays()), status: "verificacion" });
export const verifyFinding = (f, notes) => db.update("findings", f.id, { verification_notes: notes, verified_at: nowISO(), verified_by: db.state.profile.id, verified_on: today(), status: "cerrado" });
