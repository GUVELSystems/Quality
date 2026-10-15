/* Avisos de hallazgos: bandeja del usuario (siempre) + correo (Edge Function notify-finding) */
import * as db from "./db.js";
import { fmtDateTime } from "./utils.js";
import { toast } from "./ui.js";
import { classOf } from "./workflow.js";

const TEXT = {
  assigned: (f) => [`Se te asignó el hallazgo ${f.code}`, "Acéptalo o trasládalo y registra la acción para cerrarlo a tiempo."],
  transferred: (f) => [`Te trasladaron el hallazgo ${f.code}`, "Acéptalo y registra la acción para cerrarlo a tiempo."],
  rejected: (f) => [`Verificación rechazada: ${f.code}`, f.rejection_reason ? `Motivo: ${f.rejection_reason}` : "Corrige y vuelve a cerrar las acciones."],
  verify: (f) => [`Hallazgo ${f.code} listo para verificar`, "El responsable cerró las acciones; acepta o rechaza la verificación."],
  review_requested: (f) => [`Te asignaron revisar el 4D ${f.code}`, "Entra a revisarlo y da tu aprobación o rechazo."],
  review_approved: (f) => [`Tu 4D ${f.code} fue revisado y aprobado`, "Pasa a verificación."],
  review_rejected: (f) => [`Tu 4D ${f.code} fue revisado y rechazado`, f.d_data?.closure4d?.review_notes ? `Motivo: ${f.d_data.closure4d.review_notes}` : "Corrige las acciones y vuelve a enviarlo a revisar."],
};

/** Quién recibe el aviso: el responsable (asignado, trasladado, rechazado), los administradores (verificar),
 *  el revisor elegido (review_requested) o quien preparó el 4D (review_approved / review_rejected) */
function recipients(f, kind) {
  // "verify" avisa a los administradores — SOLO los de la MISMA empresa del hallazgo, nunca de otra
  if (kind === "verify") return db.rows("profiles").filter((p) => p.active && p.role === "admin" && p.company_id === f.company_id).map((p) => p.id);
  if (kind === "review_requested") return [f.reviewer_id];
  if (kind === "review_approved" || kind === "review_rejected") return [f.d_data?.closure4d?.preparer_id];
  return [f.owner_id];
}

/** Crea los avisos en la bandeja y envía el correo. Nunca bloquea ni rompe la acción que lo origina. */
export async function notifyFindings(list, kind) {
  const me = db.state.profile.id, mk = TEXT[kind];
  if (!mk) return;
  let sent = 0;
  for (const f of list) {
    const [title, tail] = mk(f), c = classOf(f);
    for (const uid of recipients(f, kind)) {
      if (!uid || uid === me) continue;
      try {
        await db.insert("notifications", {
          user_id: uid, module: f.module || "auditorias", kind: `finding_${kind}`, title,
          body: `${f.title}${c ? ` · ${c.code}` : ""}${f.due_at || f.due_date ? ` · límite ${f.due_at ? fmtDateTime(f.due_at) : f.due_date}` : ""}. ${tail}`,
          href: `${f.module || "auditorias"}/hallazgos/${f.id}`, ref_id: f.id,
        }); sent++;
      } catch { /* la bandeja es secundaria */ }
    }
  }
  if (!db.state.demo && list.length) {
    try { await db.invokeFn("notify-finding", { finding_ids: list.map((f) => f.id), kind, site_url: db.siteUrl() }); }
    catch (e) { toast(`El aviso por correo no se envió: ${/No se pudo contactar/i.test(e.message) ? "la función notify-finding no está desplegada" : e.message}`, "danger"); }
  }
  return sent;
}
