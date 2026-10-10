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
export const verifyDays = () => Number(db.setting("verification_days", 5)) || 5;

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
export const STAGES = ["abierto", "en_accion", "verificacion", "cerrado"];
export const STAGE_LABEL = { abierto: "Abierto", en_analisis: "En acción", en_accion: "En acción", verificacion: "Verificación", cerrado: "Cerrado" };
export const stageOf = (f) => (f.status === "en_analisis" ? "en_accion" : f.status);   // la etapa "En análisis" ya no existe

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
export async function closeActions(f, text) {
  const now = new Date(), verifyDue = shiftBusiness(now, verifyDays() * DAY_MS), late = businessMs(now, dueInstant(f) || now) < 0;
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
