/* =====================================================================
   Soporte · acceso temporal de GUVEL a una empresa cliente.
   El personal de soporte pide acceso (motivo, permiso, vigencia); el
   Administrador de esa empresa lo aprueba o lo rechaza. Sin una concesión
   activa, Soporte no ve ni un dato de la empresa.
   ===================================================================== */
import * as db from "../db.js";
import { esc, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender } from "../router.js";
import { on, empty, openForm, toast } from "../ui.js";

const STATUS = { pending: ["Pendiente", "warn"], active: ["Activa", "ok"], expired: ["Vencida", "neutral"], revoked: ["Revocada", "danger"] };
const isExpired = (g) => g.status === "active" && g.expires_at && g.expires_at < new Date().toISOString();
const statusOf = (g) => (isExpired(g) ? "expired" : g.status);

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
      paint();
    },
  });
}

let root_;
function paint() {
  if (!root_) return;
  const mine = db.rows("support_grants").filter((g) => g.requested_by === db.state.profile.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  root_.innerHTML = `<div class="panel"><div class="panel-head"><h2>Mis solicitudes</h2><small>${mine.length}</small></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Motivo</th><th>Permiso</th><th>Estado</th><th>Vigencia</th></tr></thead><tbody>
    ${mine.map((g) => { const [l, t] = STATUS[statusOf(g)]; return `<tr><td>${esc(db.get("companies", g.company_id)?.name || "—")}</td><td class="sub">${esc(g.reason)}</td>
        <td>${g.permission === "write" ? "Lectura y edición" : "Solo lectura"}</td><td><span class="badge" data-tone="${t}">${l}</span></td>
        <td>${g.expires_at ? fmtDateTime(g.expires_at) : "—"}</td></tr>`; }).join("") || `<tr><td colspan="5">${empty("Sin solicitudes", "Pide acceso a una empresa con el botón de arriba.", "lock")}</td></tr>`}
    </tbody></table></div></div>`;
}

export default {
  id: "soporte", label: "Soporte", icon: "lock",
  async render(root) {
    setHead({ title: "Soporte", subtitle: "Acceso temporal a una empresa cliente: siempre con motivo, permiso acotado y fecha de vencimiento.", actions: `<button class="btn primary" data-action="sp-new">${icon("plus")} Solicitar acceso</button>` });
    root_ = root;
    paint();
  },
};

on("sp-new", () => requestForm());

/* ------------------- Para el Administrador de la empresa ------------------- */
/** Fragmento embebible en la página de Usuarios: solicitudes de soporte pendientes de SU empresa */
export function pendingGrantsHTML() {
  const list = db.rows("support_grants").filter((g) => g.company_id === db.state.profile.company_id && statusOf(g) === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!list.length) return "";
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Solicitudes de acceso de Soporte</h2><small>${list.length} pendiente(s)</small></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Quién pide</th><th>Motivo</th><th>Permiso</th><th>Vigencia</th><th></th></tr></thead><tbody>
    ${list.map((g) => `<tr><td>${esc(db.profileName(g.requested_by))}</td><td class="sub">${esc(g.reason)}</td><td>${g.permission === "write" ? "Lectura y edición" : "Solo lectura"}</td><td>${fmtDateTime(g.expires_at)}</td>
      <td class="end"><button class="btn sm primary" data-action="sp-approve" data-id="${g.id}">Aprobar</button> <button class="btn sm danger" data-action="sp-deny" data-id="${g.id}">Rechazar</button></td></tr>`).join("")}
    </tbody></table></div></div>`;
}
export function activeGrantsHTML() {
  const list = db.rows("support_grants").filter((g) => g.company_id === db.state.profile.company_id && statusOf(g) === "active").sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  if (!list.length) return "";
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Accesos de Soporte activos</h2><small>${list.length}</small></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Quién</th><th>Permiso</th><th>Vence</th><th></th></tr></thead><tbody>
    ${list.map((g) => `<tr><td>${esc(db.profileName(g.requested_by))}</td><td>${g.permission === "write" ? "Lectura y edición" : "Solo lectura"}</td><td>${fmtDateTime(g.expires_at)}</td>
      <td class="end"><button class="btn sm danger" data-action="sp-revoke" data-id="${g.id}">Revocar</button></td></tr>`).join("")}
    </tbody></table></div></div>`;
}
on("sp-approve", async (el) => { await db.update("support_grants", el.dataset.id, { status: "active", granted_by: db.state.profile.id }); toast("Acceso aprobado", "ok"); rerender(); });
on("sp-deny", async (el) => { await db.update("support_grants", el.dataset.id, { status: "revoked", granted_by: db.state.profile.id, revoked_at: new Date().toISOString(), revoked_by: db.state.profile.id }); toast("Solicitud rechazada", "ok"); rerender(); });
on("sp-revoke", async (el) => { await db.update("support_grants", el.dataset.id, { status: "revoked", revoked_at: new Date().toISOString(), revoked_by: db.state.profile.id }); toast("Acceso revocado", "ok"); rerender(); });
