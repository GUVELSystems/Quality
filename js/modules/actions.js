import * as db from "../db.js";
import { esc, fmtDate, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, wsId } from "../router.js";
import { findingsOf, WS_LABEL } from "../scope.js";
import { on, onChange, onInput, empty, pill } from "../ui.js";
import { classBadge, classOf, milestones } from "../workflow.js";
import { openFinding } from "./findings.js";

/* Seguimiento de las acciones: una fila por hallazgo que ya llegó a la etapa "En acción" */
const FS = {};
const blankF = () => ({ q: "", state: "", mine: "" });
const F = new Proxy({}, {
  get: (_, k) => (FS[wsId()] ||= blankF())[k],
  set: (_, k, v) => { (FS[wsId()] ||= blankF())[k] = v; return true; },
});

const STATE = {
  running: ["En curso", "info"], overdue: ["Vencida", "danger"], ontime: ["Cerradas a tiempo", "ok"], late: ["Cerradas tarde", "danger"],
};
const rowsOf = () => findingsOf(wsId()).filter((f) => ["en_accion", "verificacion", "cerrado"].includes(f.status) || f.action_plan).map((f) => ({ f, m: milestones(f).m1 }));
const evCount = (f) => db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === f.id && a.ref === "accion").length;
const filtered = () => {
  const q = F.q.toLowerCase();
  return rowsOf().filter(({ f, m }) => (!F.state || m.state === F.state) && (!F.mine || f.owner_id === db.state.profile.id) && (!q || `${f.code} ${f.title} ${f.action_plan || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => ["overdue", "running"].indexOf(b.m.state) - ["overdue", "running"].indexOf(a.m.state) || (a.f.due_date || "9").localeCompare(b.f.due_date || "9"));
};

export default {
  id: "actions", label: "Acciones", icon: "action",
  render(root) {
    setHead({
      title: "Acciones", subtitle: `Seguimiento de las acciones de los hallazgos de ${WS_LABEL[wsId()]}. Se registran en la etapa «En acción» de cada hallazgo, con su evidencia.`,
      actions: `<button class="btn" data-action="ac-export">${icon("download")} Exportar CSV</button>`,
    });
    const all = rowsOf(), count = (s) => all.filter((r) => r.m.state === s).length, list = filtered();
    root.innerHTML = `<div class="stack">
      <div class="kpi-strip">
        <div class="kpi" data-tone="info"><label>En curso</label><strong>${count("running")}</strong><small>Dentro de su plazo</small></div>
        <div class="kpi" data-tone="${count("overdue") ? "danger" : "ok"}"><label>Vencidas</label><strong>${count("overdue")}</strong><small>Plazo en días hábiles superado</small></div>
        <div class="kpi" data-tone="ok"><label>Cerradas a tiempo</label><strong>${count("ontime")}</strong><small>Milestone en verde</small></div>
        <div class="kpi" data-tone="${count("late") ? "danger" : "ok"}"><label>Cerradas tarde</label><strong>${count("late")}</strong><small>Milestone en rojo</small></div>
      </div>
      <div class="panel"><div class="toolbar">
        <input class="input grow" id="ac-q" type="search" placeholder="Buscar acción u hallazgo…" value="${esc(F.q)}" data-input="ac-q">
        <select class="select" data-change="ac-filter" data-key="state"><option value="">Todos los estados</option>${Object.entries(STATE).map(([k, [l]]) => `<option value="${k}" ${F.state === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-change="ac-filter" data-key="mine"><option value="">Todos los responsables</option><option value="1" ${F.mine ? "selected" : ""}>Solo mías</option></select>
        <span class="count">${list.length} acción(es)</span></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Hallazgo</th><th>Acción</th><th>Responsable</th><th>Clasificación</th><th>Límite</th><th>Estado</th><th class="num">Evidencias</th></tr></thead><tbody>
      ${list.map(({ f, m }) => `<tr data-action="ac-open" data-id="${f.id}"><td><span class="code">${esc(f.code)}</span><span class="sub">${esc(f.title)}</span></td><td>${f.action_plan ? esc(f.action_plan.length > 110 ? f.action_plan.slice(0, 110) + "…" : f.action_plan) : '<span class="muted">Aún sin registrar</span>'}</td>
        <td>${esc(db.profileName(f.owner_id))}</td><td>${classBadge(f)}</td><td>${fmtDate(f.due_date)}</td><td>${pill(STATE[m.state][0], STATE[m.state][1])}${m.end ? `<span class="sub">${fmtDate(m.end)}</span>` : ""}</td><td class="num mono">${evCount(f)}</td></tr>`).join("")}
      </tbody></table></div>` : empty("Sin acciones", "Las acciones aparecen cuando un hallazgo llega a la etapa «En acción».", "action")}</div></div>`;
  },
};

on("ac-open", (el) => openFinding(el.dataset.id, "en_accion"));
on("ac-export", () => downloadCSV(`acciones_${wsId()}.csv`, [
  { label: "Hallazgo", value: (r) => r.f.code }, { label: "Título", value: (r) => r.f.title }, { label: "Acción", value: (r) => r.f.action_plan },
  { label: "Responsable", value: (r) => db.profileName(r.f.owner_id) }, { label: "Clasificación", value: (r) => classOf(r.f)?.code }, { label: "Límite", value: (r) => r.f.due_date },
  { label: "Estado", value: (r) => STATE[r.m.state][0] }, { label: "Cerrada", value: (r) => r.f.actions_closed_on }, { label: "Evidencias", value: (r) => evCount(r.f) },
], filtered()));
onChange("ac-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("ac-q", (el) => { F.q = el.value; const p = el.selectionStart; rerender().then(() => { const i = document.getElementById("ac-q"); i?.focus(); i?.setSelectionRange(p, p); }); });
