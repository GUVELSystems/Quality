/* =====================================================================
   Empresas · pantalla de control para el equipo GUVEL.
   Da de alta empresas nuevas (con su primer Administrador y la contraseña
   que el Super Admin define aquí mismo), y las activa/suspende/da de baja.
   Todas comparten la misma base de datos: lo que las separa es
   `company_id` y las reglas de seguridad, nunca una pantalla.
   ===================================================================== */
import * as db from "../db.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { setHead } from "../router.js";
import { on, empty, openForm, confirmDialog, toast } from "../ui.js";

export const isSuperAdmin = () => db.can.superAdmin;

const STATUS = { active: ["Activa", "ok"], suspended: ["Suspendida", "warn"], inactive: ["Dada de baja", "danger"] };

function companyUserStats(id) {
  const users = db.rows("profiles").filter((p) => p.company_id === id);
  return { users: users.length, activeUsers: users.filter((u) => u.active).length };
}

function newCompanyForm() {
  openForm({
    eyebrow: "Nueva empresa", title: "Dar de alta una empresa", submitLabel: "Crear empresa y Administrador", size: "wide",
    intro: `<div class="note" style="margin-bottom:14px">Se crea la empresa y su primer usuario queda como <b>Administrador</b>, activo de inmediato con la contraseña que definas aquí (no se manda invitación por correo).</div>`,
    fields: [
      { name: "company_name", label: "Nombre de la empresa", required: true, span2: true },
      { name: "slug", label: "Subdominio", placeholder: "se genera solo si lo dejas vacío (ej. metricsworkssaltillo)" },
      { name: "email", label: "Correo del primer Administrador", required: true },
      { name: "full_name", label: "Nombre completo", required: true },
      { name: "password", label: "Contraseña", type: "password", required: true, placeholder: "mínimo 8 caracteres" },
    ],
    onSubmit: async (v) => {
      const r = await db.createCompany(v);
      toast(`Empresa «${r.name}» creada · quality.${r.slug}.guvelsystems.com`, "ok");
      renderList();
    },
  });
}

let root_;
function renderList() {
  if (!root_) return;
  const list = db.rows("companies").sort((a, b) => a.name.localeCompare(b.name));
  root_.innerHTML = `<div class="panel"><div class="panel-head"><h2>Empresas</h2><small>${list.length} dada(s) de alta</small></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Subdominio</th><th>Usuarios</th><th>Hallazgos</th><th>Estado</th><th></th></tr></thead><tbody>
    ${list.map((c) => {
      const s = companyUserStats(c.id);
      return `<tr><td><span class="title">${esc(c.name)}</span></td><td class="mono">quality.${esc(c.slug)}.guvelsystems.com</td>
        <td>${s.activeUsers} activo(s) · ${s.users} total</td><td id="co-finds-${c.id}" class="muted">Calculando…</td>
        <td>${(() => { const [l, t] = STATUS[c.status] || ["—", "neutral"]; return `<span class="badge" data-tone="${t}">${l}</span>`; })()}</td>
        <td class="end">
          ${c.status !== "active" ? `<button class="btn sm" data-action="co-status" data-id="${c.id}" data-status="active">Activar</button>` : ""}
          ${c.status !== "suspended" ? `<button class="btn sm" data-action="co-status" data-id="${c.id}" data-status="suspended">Suspender</button>` : ""}
          ${c.status !== "inactive" ? `<button class="btn sm danger" data-action="co-status" data-id="${c.id}" data-status="inactive">Dar de baja</button>` : ""}
        </td></tr>`;
    }).join("") || `<tr><td colspan="6">${empty("Sin empresas todavía", "Da de alta la primera con «Nueva empresa».", "monitor")}</td></tr>`}
    </tbody></table></div><p class="muted" style="font-size:13px;margin-top:10px">El conteo de hallazgos es un número agregado: ni esta pantalla ni el Super Admin pueden ver el contenido de los hallazgos de una empresa, por diseño.</p></div>`;
  list.forEach(async (c) => {
    try { const { total, open } = await db.companyFindingCounts(c.id); const el = document.getElementById(`co-finds-${c.id}`); if (el) { el.classList.remove("muted"); el.textContent = `${open} abierto(s) · ${total} total`; } }
    catch { const el = document.getElementById(`co-finds-${c.id}`); if (el) el.textContent = "—"; }
  });
}

export default {
  id: "portales", label: "Empresas", icon: "monitor",
  async render(root) {
    setHead({ title: "Empresas", subtitle: "Todas comparten la misma base de datos: lo que las separa es la empresa a la que pertenece cada usuario, nunca la pantalla desde la que entran.", actions: isSuperAdmin() ? `<button class="btn primary" data-action="co-new">${icon("plus")} Nueva empresa</button>` : "" });
    if (!isSuperAdmin()) { root.innerHTML = empty("No autorizado", "Esta pantalla es solo para el equipo de GUVEL con permiso de Super Admin.", "lock"); return; }
    root_ = root;
    renderList();
  },
};

on("co-new", () => newCompanyForm());
on("co-status", async (el) => {
  const c = db.get("companies", el.dataset.id), status = el.dataset.status;
  const label = { active: "activar", suspended: "suspender", inactive: "dar de baja a" }[status];
  const msg = status === "inactive" ? "Sus usuarios no podrán volver a entrar hasta reactivarla." : status === "suspended" ? "Sus usuarios verán el portal bloqueado hasta que la actives de nuevo." : "Sus usuarios recuperan el acceso normal.";
  const ok = await confirmDialog({ title: `¿${label.charAt(0).toUpperCase() + label.slice(1)} «${c.name}»?`, message: msg, confirmLabel: label.charAt(0).toUpperCase() + label.slice(1), danger: status !== "active" });
  if (!ok) return;
  await db.update("companies", c.id, { status });
  toast(`Empresa ${STATUS[status][0].toLowerCase()}`, "ok");
  renderList();
});
