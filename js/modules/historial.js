/* =====================================================================
   Historial · quién hizo qué, y cuándo. Lee la bitácora que ya registra
   automáticamente cada alta, cambio y baja de auditorías, hallazgos,
   acciones, notificaciones de cliente, riesgos y oportunidades.
   Solo Administradores y Managers la ven (el Auditor no tiene esta
   visibilidad general, igual que el resto de catálogos y ajustes).
   ===================================================================== */
import * as db from "../db.js";
import { esc, fmtDateTime } from "../utils.js";
import { setHead, rerender } from "../router.js";
import { onChange, onInput, empty } from "../ui.js";

const ENTITY_LABEL = {
  audits: "Auditoría", findings: "Hallazgo", actions: "Acción",
  customer_notifications: "Notificación de cliente", risks: "Riesgo", opportunities: "Oportunidad",
};
const ACTION_LABEL = { INSERT: ["Creó", "ok"], UPDATE: ["Actualizó", "info"], DELETE: ["Eliminó", "danger"] };

const F = { q: "", entity: "", action: "", actor: "" };

function filtered() {
  const q = F.q.toLowerCase();
  return db.rows("activity_log")
    .filter((r) => (!F.entity || r.entity === F.entity) && (!F.action || r.action === F.action) && (!F.actor || r.actor === F.actor) &&
      (!q || `${r.summary || ""} ${db.profileName(r.actor)}`.toLowerCase().includes(q)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300);
}

export default {
  id: "historial", label: "Historial", icon: "clock",
  render(root) {
    setHead({ title: "Historial", subtitle: "Qué se creó, cambió o eliminó en el sistema, quién lo hizo y cuándo." });
    const list = filtered();
    const actors = [...new Map(db.rows("profiles").map((p) => [p.id, p.full_name])).entries()].sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
    root.innerHTML = `<div class="panel">
      <div class="toolbar">
        <input class="input grow" type="search" placeholder="Buscar por texto o por quién lo hizo…" value="${esc(F.q)}" data-input="hist-q">
        <select class="select" data-change="hist-filter" data-key="entity"><option value="">Todo tipo</option>${Object.entries(ENTITY_LABEL).map(([k, l]) => `<option value="${k}" ${F.entity === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="hist-filter" data-key="action"><option value="">Toda acción</option>${Object.entries(ACTION_LABEL).map(([k, [l]]) => `<option value="${k}" ${F.action === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="hist-filter" data-key="actor"><option value="">Todos</option>${actors.map(([id, name]) => `<option value="${id}" ${F.actor === id ? "selected" : ""}>${esc(name || "—")}</option>`).join("")}</select>
        <span class="count">${list.length} movimiento(s)${list.length === 300 ? " · mostrando los más recientes" : ""}</span>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>
        ${list.map((r) => { const [l, t] = ACTION_LABEL[r.action] || [r.action, "neutral"]; return `<tr><td class="sub">${fmtDateTime(r.created_at)}</td><td>${esc(db.profileName(r.actor))}</td>
          <td><span class="badge" data-tone="${t}">${l}</span></td><td>${ENTITY_LABEL[r.entity] || esc(r.entity)}</td><td class="sub">${esc(r.summary || "—")}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin movimientos", "No hay registros con los filtros actuales.", "clock")}
    </div>`;
  },
};

onInput("hist-q", (el) => { F.q = el.value; rerender(); });
onChange("hist-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
