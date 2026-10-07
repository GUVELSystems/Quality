import * as db from "../db.js";
import { esc, today, dueText, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, wsId, H } from "../router.js";
import { actionsOf, WS_LABEL } from "../scope.js";
import { on, onChange, onInput, badge, empty } from "../ui.js";
import { ACTION_TYPE, ACTION_STATUS } from "../constants.js";
import { actionForm } from "./findings.js";

const FS = {};
const blankF = () => ({ q: "", status: "", type: "", mine: "" });
const F = new Proxy({}, {
  get: (_, k) => (FS[wsId()] ||= blankF())[k],
  set: (_, k, v) => { (FS[wsId()] ||= blankF())[k] = v; return true; },
});
const isDone = (a) => ["completada", "verificada"].includes(a.status);

const filtered = () => {
  const q = F.q.toLowerCase(), t = today();
  return actionsOf(wsId()).filter((a) => {
    if (F.status === "vencidas" ? (isDone(a) || !a.due_date || a.due_date >= t) : F.status === "abiertas" ? isDone(a) : F.status && a.status !== F.status) return false;
    if (F.type && a.action_type !== F.type) return false;
    if (F.mine && a.owner_id !== db.state.profile.id) return false;
    const f = db.get("findings", a.finding_id);
    return !q || `${a.code} ${a.description} ${f?.code || ""}`.toLowerCase().includes(q);
  }).sort((a, b) => isDone(a) - isDone(b) || (a.due_date || "9").localeCompare(b.due_date || "9"));
};

export default {
  id: "actions", label: "Acciones", icon: "action",
  render(root) {
    setHead({
      title: "Acciones", subtitle: `Contención, correctivas y preventivas de los hallazgos de ${WS_LABEL[wsId()]}.`,
      actions: `<button class="btn" data-action="ac-export">${icon("download")} Exportar CSV</button>${db.can.write ? `<button class="btn primary" data-action="ac-new">${icon("plus")} Nueva acción</button>` : ""}`,
    });
    const list = filtered();
    root.innerHTML = `<div class="panel">
      <div class="toolbar">
        <input class="input grow" id="ac-q" type="search" placeholder="Buscar acción u hallazgo…" value="${esc(F.q)}" data-input="ac-q">
        <select class="select" data-change="ac-filter" data-key="status"><option value="">Todos los estados</option><option value="abiertas" ${F.status === "abiertas" ? "selected" : ""}>Abiertas</option><option value="vencidas" ${F.status === "vencidas" ? "selected" : ""}>Vencidas</option>${Object.entries(ACTION_STATUS).map(([k, [l]]) => `<option value="${k}" ${F.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="ac-filter" data-key="type"><option value="">Todo tipo</option>${Object.entries(ACTION_TYPE).map(([k, [l]]) => `<option value="${k}" ${F.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="ac-filter" data-key="mine"><option value="">Todos los responsables</option><option value="1" ${F.mine ? "selected" : ""}>Solo mías</option></select>
        <span class="count">${list.length} acción(es)</span>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Acción</th><th>Hallazgo</th><th>Tipo</th><th>Estado</th><th>Responsable</th><th>Compromiso</th></tr></thead><tbody>
      ${list.map((a) => { const f = db.get("findings", a.finding_id); const d = dueText(a.due_date);
        return `<tr data-action="ac-edit" data-id="${a.id}"><td class="code">${esc(a.code)}</td><td><span class="title">${esc(a.description)}</span></td><td>${f ? `<a class="mono" href="${H("hallazgos/" + f.id)}">${esc(f.code)}</a>` : "—"}</td><td>${badge(ACTION_TYPE, a.action_type)}</td><td>${badge(ACTION_STATUS, a.status)}</td><td>${esc(db.profileName(a.owner_id))}</td><td class="${d.overdue && !isDone(a) ? "overdue" : ""}">${d.text}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin acciones", "No hay acciones con los filtros actuales.", "action")}
    </div>`;
  },
};

on("ac-new", () => actionForm({}));
on("ac-edit", (el) => { const a = db.get("actions", el.dataset.id); if (db.can.write) actionForm({ finding_id: a.finding_id, action: a }); });
on("ac-export", () => downloadCSV(`acciones_${wsId()}.csv`, [
  { label: "Folio", value: (r) => r.code }, { label: "Hallazgo", value: (r) => db.get("findings", r.finding_id)?.code }, { label: "Descripción", value: (r) => r.description },
  { label: "Tipo", value: (r) => ACTION_TYPE[r.action_type][0] }, { label: "Estado", value: (r) => ACTION_STATUS[r.status][0] },
  { label: "Responsable", value: (r) => db.profileName(r.owner_id) }, { label: "Compromiso", value: (r) => r.due_date },
], filtered()));
onChange("ac-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("ac-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("ac-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });
