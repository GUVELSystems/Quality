import * as db from "../db.js";
import { esc, today, fmtDate, initials, dueText } from "../utils.js";
import { badge, pill, userCell, bars, on, openForm, toast } from "../ui.js";
import { RISK_STATUS, OPP_STATUS, EFFORT, ROLES, CATALOG_KINDS } from "../constants.js";
import { makeCrud } from "./crud.js";
import { rerender } from "../router.js";
import { userOpts, catNameOpts, mapOpts } from "./shared.js";

const yesNo = (v) => (v ? pill("Activo", "ok") : pill("Inactivo", "neutral"));
const riskTone = (s) => (s >= 15 ? "danger" : s >= 10 ? "warn" : s >= 5 ? "info" : "ok");
const zone = (s) => (s <= 4 ? 1 : s <= 9 ? 2 : s <= 14 ? 3 : 4);

/* ------------------------------- Riesgos ----------------------------- */
export const risks = makeCrud({
  id: "risks", label: "Riesgos", icon: "risk", eyebrow: "Riesgos y mejora", singular: "riesgo",
  title: "Riesgos", subtitle: "Matriz de probabilidad × impacto y seguimiento de mitigaciones.",
  table: "risks", newLabel: "Nuevo riesgo", dialogSize: "wide",
  defaults: () => ({ probability: 3, impact: 3, status: "identificado", owner_id: db.state.profile.id }),
  search: (r) => `${r.code} ${r.title} ${r.category || ""}`,
  sort: (a, b) => b.score - a.score,
  filters: [{ key: "status", label: "Todos los estados", options: mapOpts(RISK_STATUS), test: (r, v) => r.status === v }],
  fields: () => [
    { name: "title", label: "Riesgo", required: true, span2: true },
    { name: "description", label: "Descripción", type: "textarea", span2: true },
    { name: "category", label: "Tipo", type: "select", options: catNameOpts("tipo_riesgo") },
    { name: "owner_id", label: "Responsable", type: "select", options: userOpts() },
    { name: "probability", label: "Probabilidad (1-5)", type: "select", required: true, options: [1, 2, 3, 4, 5].map((n) => [n, String(n)]), parse: Number },
    { name: "impact", label: "Impacto (1-5)", type: "select", required: true, options: [1, 2, 3, 4, 5].map((n) => [n, String(n)]), parse: Number },
    { name: "mitigation", label: "Plan de mitigación", type: "textarea", span2: true },
    { name: "status", label: "Estado", type: "select", required: true, options: mapOpts(RISK_STATUS) },
    { name: "review_date", label: "Próxima revisión", type: "date" },
  ],
  columns: [
    { label: "Folio", cls: "code", cell: (r) => esc(r.code) },
    { label: "Riesgo", cell: (r) => `<span class="title">${esc(r.title)}</span><span class="sub">${esc(r.category || "Sin tipo")}</span>` },
    { label: "Puntaje", cell: (r) => `<span class="badge" data-tone="${riskTone(r.score)}">${r.score}</span> <span class="muted mono">${r.probability}×${r.impact}</span>` },
    { label: "Responsable", cell: (r) => esc(db.profileName(r.owner_id)) },
    { label: "Estado", cell: (r) => badge(RISK_STATUS, r.status) },
    { label: "Revisión", cell: (r) => { const d = dueText(r.review_date); return `<span class="${d.overdue && r.status !== "cerrado" ? "overdue" : ""}">${fmtDate(r.review_date)}</span>`; } },
  ],
  top: (rows) => {
    const act = rows.filter((r) => r.status !== "cerrado");
    let cells = "";
    for (let p = 5; p >= 1; p--) {
      cells += `<div class="mx-axis">${p}</div>`;
      for (let i = 1; i <= 5; i++) { const n = act.filter((r) => r.probability === p && r.impact === i).length; cells += `<div class="mx" data-z="${zone(p * i)}" title="Prob ${p} × Impacto ${i}"><small>${p * i}</small>${n || ""}</div>`; }
    }
    cells += `<div></div>${[1, 2, 3, 4, 5].map((i) => `<div class="mx-axis x">${i}</div>`).join("")}`;
    const z = (a, b) => act.filter((r) => r.score >= a && r.score <= b).length;
    return `<div class="grid cols-2" style="align-items:stretch"><div class="panel"><div class="panel-head"><h2>Matriz de riesgos</h2><small>Probabilidad (vertical) × Impacto (horizontal)</small></div><div class="panel-body"><div class="matrix" style="max-width:520px">${cells}</div></div></div>
      <div class="panel"><div class="panel-head"><h2>Distribución</h2><small>Riesgos activos</small></div><div class="panel-body">${bars([
        { label: "Alto (≥15)", value: z(15, 25), color: "var(--danger)" }, { label: "Medio-alto (10-14)", value: z(10, 14), color: "var(--warn)" },
        { label: "Medio (5-9)", value: z(5, 9), color: "var(--g-cyan)" }, { label: "Bajo (1-4)", value: z(1, 4), color: "var(--ok)" }])}
        <p class="muted" style="margin-top:20px">Puntaje = probabilidad × impacto. Los riesgos con puntaje alto deben tener un plan de mitigación con responsable y fecha de revisión.</p></div></div></div>`;
  },
});

/* ---------------------------- Oportunidades -------------------------- */
export const opportunities = makeCrud({
  id: "opportunities", label: "Oportunidades", icon: "opportunity", eyebrow: "Riesgos y mejora", singular: "oportunidad",
  title: "Oportunidades", subtitle: "Ideas de mejora con beneficio esperado, esfuerzo y responsable.",
  table: "opportunities", newLabel: "Nueva oportunidad", dialogSize: "wide",
  defaults: () => ({ effort: "medio", status: "identificada", owner_id: db.state.profile.id }),
  search: (r) => `${r.code} ${r.title} ${r.benefit || ""}`,
  filters: [{ key: "status", label: "Todos los estados", options: mapOpts(OPP_STATUS), test: (r, v) => r.status === v }],
  fields: () => [
    { name: "title", label: "Oportunidad", required: true, span2: true },
    { name: "description", label: "Descripción", type: "textarea", span2: true },
    { name: "benefit", label: "Beneficio esperado", span2: true },
    { name: "effort", label: "Esfuerzo", type: "select", required: true, options: Object.entries(EFFORT) },
    { name: "owner_id", label: "Responsable", type: "select", options: userOpts() },
    { name: "status", label: "Estado", type: "select", required: true, options: mapOpts(OPP_STATUS) },
    { name: "due_date", label: "Fecha objetivo", type: "date" },
  ],
  columns: [
    { label: "Folio", cls: "code", cell: (r) => esc(r.code) },
    { label: "Oportunidad", cell: (r) => `<span class="title">${esc(r.title)}</span><span class="sub">${esc(r.benefit || "")}</span>` },
    { label: "Esfuerzo", cell: (r) => esc(EFFORT[r.effort]) },
    { label: "Estado", cell: (r) => badge(OPP_STATUS, r.status) },
    { label: "Responsable", cell: (r) => esc(db.profileName(r.owner_id)) },
    { label: "Objetivo", cell: (r) => fmtDate(r.due_date) },
  ],
});

/* ------------------------------- Clientes ---------------------------- */
export const clients = makeCrud({
  id: "clients", label: "Clientes", icon: "client", eyebrow: "Configuración", singular: "cliente",
  title: "Clientes", subtitle: "Catálogo de clientes para notificaciones y hallazgos.",
  table: "clients", newLabel: "Nuevo cliente", canWrite: () => db.can.manage,
  defaults: () => ({ active: true }),
  search: (r) => `${r.code} ${r.name} ${r.contact_name || ""} ${r.plant || ""}`, sort: (a, b) => a.name.localeCompare(b.name),
  fields: () => [
    { name: "name", label: "Nombre del cliente", required: true, span2: true },
    { name: "contact_name", label: "Contacto" }, { name: "contact_email", label: "Correo de contacto", type: "email" },
    { name: "plant", label: "Planta / Ubicación" }, { name: "active", label: "Cliente activo", type: "checkbox" },
  ],
  columns: [
    { label: "Folio", cls: "code", cell: (r) => esc(r.code) },
    { label: "Cliente", cell: (r) => `<span class="title">${esc(r.name)}</span>` },
    { label: "Contacto", cell: (r) => `${esc(r.contact_name || "—")}<span class="sub">${esc(r.contact_email || "")}</span>` },
    { label: "Planta", cell: (r) => esc(r.plant || "—") }, { label: "Estado", cell: (r) => yesNo(r.active) },
  ],
});

/* --------------------------- Clasificaciones ------------------------- */
export const classifications = makeCrud({
  id: "classifications", label: "Catálogos", icon: "list", eyebrow: "Configuración", singular: "elemento",
  title: "Catálogos", subtitle: "Listas configurables: categorías de hallazgo, causas raíz y tipos de riesgo. (Las áreas y las clasificaciones N1/N2 tienen su propia pestaña.)",
  scope: (r) => r.kind !== "area",
  table: "classifications", newLabel: "Nuevo elemento", canWrite: () => db.can.manage,
  defaults: () => ({ kind: "categoria_hallazgo", active: true }),
  search: (r) => `${r.kind} ${r.name} ${r.description || ""}`, sort: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  filters: [{ key: "kind", label: "Todos los catálogos", options: Object.entries(CATALOG_KINDS), test: (r, v) => r.kind === v }],
  fields: () => [
    { name: "kind", label: "Catálogo", type: "select", required: true, options: Object.entries(CATALOG_KINDS) },
    { name: "name", label: "Nombre", required: true }, { name: "description", label: "Descripción", span2: true },
    { name: "active", label: "Activo", type: "checkbox" },
  ],
  columns: [
    { label: "Catálogo", cell: (r) => pill(CATALOG_KINDS[r.kind] || r.kind, "info") },
    { label: "Nombre", cell: (r) => `<span class="title">${esc(r.name)}</span>` },
    { label: "Descripción", cell: (r) => esc(r.description || "—") }, { label: "Estado", cell: (r) => yesNo(r.active) },
  ],
});

/* -------------------------------- Usuarios --------------------------- */
const inviteForm = () => openForm({
  eyebrow: "Nuevo acceso", title: "Invitar usuario", submitLabel: db.state.demo ? "Agregar" : "Enviar invitación", values: { role: "auditor" },
  intro: `<div class="note" style="margin-bottom:14px">${db.state.demo ? "Modo demo: el usuario se agrega localmente, sin correo." : "La persona recibirá un correo para crear su contraseña y entrar. El rol queda asignado desde ahora."}</div>`,
  fields: [
    { name: "email", label: "Correo", type: "email", required: true, span2: true },
    { name: "full_name", label: "Nombre completo", required: true, span2: true },
    { name: "role", label: "Rol", type: "select", required: true, options: Object.entries(ROLES) },
    { name: "area", label: "Área" },
  ],
  onSubmit: async (v) => { await db.inviteUser(v); toast(db.state.demo ? "Usuario agregado" : `Invitación enviada a ${v.email}`, "ok"); await rerender(); },
});
on("user-reset", async (el) => {
  try { await db.resetPassword(el.dataset.email); toast(`Enlace de acceso enviado a ${el.dataset.email}`, "ok"); } catch (e) { toast(e.message, "danger"); }
});

export const users = makeCrud({
  id: "users", label: "Usuarios", icon: "users", eyebrow: "Configuración", singular: "usuario",
  title: "Usuarios", subtitle: "Invita a tu equipo y asigna su rol. Solo las personas invitadas pueden entrar.",
  table: "profiles", newLabel: "Invitar usuario", onCreate: inviteForm, canWrite: () => db.can.admin, canRemove: false,
  search: (r) => `${r.full_name} ${r.email} ${r.area || ""}`, sort: (a, b) => (a.full_name || "").localeCompare(b.full_name || ""),
  filters: [{ key: "role", label: "Todos los roles", options: Object.entries(ROLES), test: (r, v) => r.role === v }],
  intro: `<div class="note"><b>Cómo funciona:</b> al invitar, la persona recibe un correo con un enlace para crear su contraseña. Los usuarios desactivados no pueden ver ningún dato. Para dar de baja a alguien, desmarca «Usuario activo».</div>`,
  editIntro: (r) => (db.state.demo || !r.email ? "" : `<p style="margin-bottom:14px"><button type="button" class="btn sm" data-action="user-reset" data-email="${esc(r.email)}">${"Enviar enlace de acceso"}</button> <small class="muted">Útil si perdió su contraseña o su invitación venció.</small></p>`),
  fields: () => [
    { name: "full_name", label: "Nombre completo", required: true, span2: true },
    { name: "role", label: "Rol", type: "select", required: true, options: Object.entries(ROLES) },
    { name: "area", label: "Área" }, { name: "active", label: "Usuario activo", type: "checkbox" },
  ],
  columns: [
    { label: "Usuario", cell: (r) => userCell(r) }, { label: "Correo", cell: (r) => esc(r.email || "—") },
    { label: "Rol", cell: (r) => pill(ROLES[r.role], r.role === "admin" ? "danger" : r.role === "viewer" ? "neutral" : "info") },
    { label: "Área", cell: (r) => esc(r.area || "—") }, { label: "Estado", cell: (r) => yesNo(r.active) },
  ],
});
