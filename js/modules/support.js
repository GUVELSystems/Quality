/* =====================================================================
   Soporte · dos caminos, en la misma pantalla según quién la vea:
     - Personal de GUVEL (Soporte): pide acceso temporal a una empresa, y
       ve los tickets que las empresas han abierto pidiendo ayuda.
     - Administrador/Manager de una empresa: abre tickets pidiendo ayuda a
       GUVEL, y aquí mismo aprueba o rechaza los accesos que Soporte le
       pida (antes vivía escondido dentro de Usuarios, solo si había algo
       pendiente — ahora es su propia pantalla, siempre visible).
   ===================================================================== */
import * as db from "../db.js";
import { esc, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender } from "../router.js";
import { on, empty, openForm, toast } from "../ui.js";

const STATUS = { pending: ["Pendiente", "warn"], active: ["Activa", "ok"], expired: ["Vencida", "neutral"], revoked: ["Revocada", "danger"] };
const TICKET_STATUS = { open: ["Abierto", "warn"], in_progress: ["En proceso", "info"], resolved: ["Resuelto", "ok"] };
const isExpired = (g) => g.status === "active" && g.expires_at && g.expires_at < new Date().toISOString();
const statusOf = (g) => (isExpired(g) ? "expired" : g.status);
/** Si la cuenta pertenece a una empresa, se le trata como de esa empresa (aunque también tenga
 *  un rol de plataforma, como pasa con el primer admin de GUVEL) — solo el personal SIN empresa
 *  ve "todas las empresas". */
const forCompany = () => db.state.profile?.company_id || null;

/* --------------------------- Personal de GUVEL: pedir acceso --------------------------- */
function requestForm() {
  const companies = db.rows("companies").filter((c) => c.status === "active").sort((a, b) => a.name.localeCompare(b.name));
  openForm({
    eyebrow: "Soporte", title: "Solicitar acceso a una empresa", submitLabel: "Enviar solicitud",
    intro: `<div class="note" style="margin-bottom:14px">El Administrador de esa empresa tiene que aprobarla antes de que puedas entrar. Queda registrado el motivo y hasta cuándo es válida.</div>`,
    fields: [
      { name: "company_id", label: "Empresa", type: "select", required: true, options: companies.map((c) => [c.id, c.name]) },
      { name: "reason", label: "Motivo", type: "textarea", required: true, span2: true, placeholder: "Ej. Ticket #482: el cliente reporta un error al exportar el PDF del 8D." },
      { name: "permission", label: "Permiso necesario", type: "select", required: true, options: [["read", "Solo lectura"], ["write", "Lectura y edición"]] },
      { name: "hours", label: "Vigencia (horas)", type: "number", required: true, min: 1, max: 168 },
    ],
    values: { permission: "read", hours: 24 },
    onSubmit: async (v) => {
      await db.insert("support_grants", { company_id: v.company_id, requested_by: db.state.profile.id, reason: v.reason, permission: v.permission, status: "pending", expires_at: new Date(Date.now() + v.hours * 3600000).toISOString() });
      toast("Solicitud enviada · queda pendiente de que la aprueben", "ok");
      rerender();
    },
  });
}

/** Para Soporte (sin empresa): sus propias solicitudes de acceso y en qué quedaron */
function myRequestsHTML() {
  const mine = db.rows("support_grants").filter((g) => g.requested_by === db.state.profile.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Mis solicitudes</h2><small>${mine.length}</small></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Motivo</th><th>Permiso</th><th>Estado</th><th>Vigencia</th></tr></thead><tbody>
    ${mine.map((g) => { const [l, t2] = STATUS[statusOf(g)]; return `<tr><td>${esc(db.get("companies", g.company_id)?.name || "—")}</td><td class="sub">${esc(g.reason)}</td>
        <td>${g.permission === "write" ? "Lectura y edición" : "Solo lectura"}</td><td><span class="badge" data-tone="${t2}">${l}</span></td>
        <td>${g.expires_at ? fmtDateTime(g.expires_at) : "—"}</td></tr>`; }).join("") || `<tr><td colspan="5">${empty("Sin solicitudes", "Pide acceso a una empresa con el botón de arriba.", "lock")}</td></tr>`}
    </tbody></table></div></div>`;
}

/* --------------------------- Empresa: abrir un ticket --------------------------- */
function ticketForm() {
  openForm({
    eyebrow: "Soporte", title: "Pedir ayuda a GUVEL", submitLabel: "Enviar ticket",
    fields: [
      { name: "subject", label: "Asunto", required: true, span2: true, placeholder: "Ej. No puedo exportar el PDF del 8D" },
      { name: "message", label: "Cuéntanos qué pasa", type: "textarea", required: true, span2: true },
    ],
    onSubmit: async (v) => {
      await db.insert("support_tickets", { company_id: db.state.profile.company_id, created_by: db.state.profile.id, subject: v.subject, message: v.message, status: "open" });
      toast("Ticket enviado · el equipo de GUVEL te contactará", "ok");
      rerender();
    },
  });
}
function ticketsHTML() {
  const mine = forCompany();
  const list = (mine ? db.rows("support_tickets").filter((t) => t.company_id === mine) : db.rows("support_tickets")).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return `<div class="panel"><div class="panel-head"><h2>${mine ? "Mis tickets" : "Tickets de las empresas"}</h2><small>${list.length}</small></div>
    <div class="table-wrap"><table class="table"><thead><tr>${mine ? "" : "<th>Empresa</th>"}<th>Asunto</th><th>Mensaje</th><th>Estatus</th><th>Cuándo</th>${mine ? "" : "<th></th>"}</tr></thead><tbody>
    ${list.map((t2) => { const [l, tone] = TICKET_STATUS[t2.status]; return `<tr><td>${mine ? "" : esc(db.get("companies", t2.company_id)?.name || "—")}</td><td><span class="title">${esc(t2.subject)}</span></td><td class="sub">${esc(t2.message)}</td>
        <td><span class="badge" data-tone="${tone}">${l}</span></td><td class="sub">${fmtDateTime(t2.created_at)}</td>
        ${mine ? "" : `<td class="end">${t2.status === "open" ? `<button class="btn sm" data-action="tk-progress" data-id="${t2.id}">Tomar</button>` : ""}${t2.status !== "resolved" ? `<button class="btn sm primary" data-action="tk-resolve" data-id="${t2.id}">Resolver</button>` : ""}</td>`}
      </tr>`; }).join("") || `<tr><td colspan="6">${empty("Sin tickets", mine ? "Si necesitas ayuda, ábrelo con el botón de arriba." : "No hay tickets abiertos por ninguna empresa.", "lock")}</td></tr>`}
    </tbody></table></div></div>`;
}
on("tk-ticket-new", () => ticketForm());
on("tk-progress", async (el) => { await db.update("support_tickets", el.dataset.id, { status: "in_progress", assigned_to: db.state.profile.id }); toast("Ticket tomado", "ok"); rerender(); });
on("tk-resolve", async (el) => { await db.update("support_tickets", el.dataset.id, { status: "resolved", resolved_at: new Date().toISOString(), resolved_by: db.state.profile.id }); toast("Ticket resuelto", "ok"); rerender(); });

/* --------------------------- Empresa: aprobar accesos de Soporte --------------------------- */
function grantsHTML() {
  const mine = db.state.profile.company_id;
  const pending = db.rows("support_grants").filter((g) => g.company_id === mine && statusOf(g) === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const active = db.rows("support_grants").filter((g) => g.company_id === mine && statusOf(g) === "active").sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Solicitudes de acceso de Soporte GUVEL</h2><small>${pending.length} pendiente(s) · ${active.length} activa(s)</small></div>
    ${pending.length || active.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Quién</th><th>Motivo</th><th>Permiso</th><th>Estatus</th><th>Vigencia</th><th></th></tr></thead><tbody>
      ${pending.map((g) => `<tr><td>${esc(db.profileName(g.requested_by))}</td><td class="sub">${esc(g.reason)}</td><td>${g.permission === "write" ? "Lectura y edición" : "Solo lectura"}</td><td><span class="badge" data-tone="warn">Pendiente</span></td><td>${fmtDateTime(g.expires_at)}</td>
        <td class="end"><button class="btn sm primary" data-action="sp-approve" data-id="${g.id}">Aprobar</button> <button class="btn sm danger" data-action="sp-deny" data-id="${g.id}">Rechazar</button></td></tr>`).join("")}
      ${active.map((g) => `<tr><td>${esc(db.profileName(g.requested_by))}</td><td class="sub">${esc(g.reason)}</td><td>${g.permission === "write" ? "Lectura y edición" : "Solo lectura"}</td><td><span class="badge" data-tone="ok">Activa</span></td><td>${fmtDateTime(g.expires_at)}</td>
        <td class="end"><button class="btn sm danger" data-action="sp-revoke" data-id="${g.id}">Revocar</button></td></tr>`).join("")}
      </tbody></table></div>` : empty("Sin solicitudes", "Cuando el equipo de soporte de GUVEL necesite entrar a revisar algo, aparecerá aquí para que lo autorices.", "lock")}
    </div>`;
}
on("sp-approve", async (el) => { await db.update("support_grants", el.dataset.id, { status: "active", granted_by: db.state.profile.id }); toast("Acceso aprobado", "ok"); rerender(); });
on("sp-deny", async (el) => { await db.update("support_grants", el.dataset.id, { status: "revoked", granted_by: db.state.profile.id, revoked_at: new Date().toISOString(), revoked_by: db.state.profile.id }); toast("Solicitud rechazada", "ok"); rerender(); });
on("sp-revoke", async (el) => { await db.update("support_grants", el.dataset.id, { status: "revoked", revoked_at: new Date().toISOString(), revoked_by: db.state.profile.id }); toast("Acceso revocado", "ok"); rerender(); });

/* --------------------------- Página --------------------------- */
export default {
  id: "soporte", label: "Soporte", icon: "lock",
  async render(root) {
    // Quien pertenece a una empresa (aunque también tenga un rol de plataforma) usa la vista de
    // empresa: pide ayuda y autoriza accesos. Solo el personal de GUVEL SIN empresa (Soporte puro)
    // usa la otra: solicitar acceso a una empresa.
    const company = forCompany();
    setHead({ title: "Soporte", subtitle: company ? "Pide ayuda a GUVEL cuando la necesites, y autoriza aquí los accesos que el equipo de soporte te pida." : "Acceso temporal a una empresa cliente: siempre con motivo, permiso acotado y fecha de vencimiento.", actions: `<button class="btn primary" data-action="${company ? "tk-ticket-new" : "sp-new"}">${icon("plus")} ${company ? "Pedir ayuda a GUVEL" : "Solicitar acceso"}</button>` });
    root.innerHTML = `${company ? (db.can.admin ? grantsHTML() : "") : myRequestsHTML()}${ticketsHTML()}`;
  },
};

on("sp-new", () => requestForm());
