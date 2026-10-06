import * as db from "../db.js";
import { esc, today, isoDate, parseDate, addDays, fmtDate, fmtDateTime, toLocalInput, fromLocalInput, MONTHS_LONG } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, navigate } from "../router.js";
import { on, onChange, onInput, badge, empty, openForm, confirmDialog, toast } from "../ui.js";
import { AUDIT_TYPES, FREQUENCIES, AUDIT_STATUS, SEVERITY, SEVERITY_SLA_DAYS } from "../constants.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { userOpts } from "./shared.js";

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
let tab = "plans";
const F = { q: "", status: "", mine: "" };
const cal = { planId: null, y: 0, m: 0 };
let draft = null; // { auditId, answers: { itemId: {result, comment, finding_id} } }

/** Estado efectivo: una auditoría pendiente fuera de plazo se muestra como vencida */
export function auditStatus(a) {
  if (["programada", "en_proceso"].includes(a.status)) {
    const limit = a.due_at ? new Date(a.due_at) : new Date(a.scheduled_date + "T23:59:59");
    if (limit < new Date()) return "vencida";
  }
  return a.status;
}
const itemsOf = (formId) => db.rows("form_items").filter((i) => i.form_id === formId).sort((a, b) => a.position - b.position);
const firstName = (id) => (db.get("profiles", id)?.full_name || "Sin asignar").split(" ")[0];

/* ------------------------- Generación de calendario ------------------ */
function slotDates(plan) {
  const out = [], { start_date: s, end_date: e, frequency } = plan;
  if (frequency === "Semanal" || frequency === "Quincenal") {
    for (let d = s; d <= e; d = addDays(d, frequency === "Semanal" ? 7 : 14)) out.push(d);
  } else if (frequency === "Mensual") {
    const base = parseDate(s);
    for (let i = 0; i < 60; i++) {
      const lastDay = new Date(base.getFullYear(), base.getMonth() + i + 1, 0).getDate();
      const d = isoDate(new Date(base.getFullYear(), base.getMonth() + i, Math.min(base.getDate(), lastDay)));
      if (d > e) break;
      out.push(d);
    }
  }
  return out;
}
async function generateAudits(plan) {
  const existing = new Set(db.rows("audits").filter((a) => a.plan_id === plan.id).map((a) => a.scheduled_date));
  const form = db.rows("forms").find((f) => f.audit_type === plan.audit_type && f.active);
  const dates = slotDates(plan).filter((d) => !existing.has(d)).slice(0, 200);
  for (const d of dates) {
    await db.insert("audits", { plan_id: plan.id, scheduled_date: d, form_id: form?.id || null, level: plan.audit_type === "LPA" ? 1 : null, due_at: new Date(d + "T17:00:00").toISOString(), status: "programada" });
  }
  return dates.length;
}

/* ------------------------------ Formularios -------------------------- */
function planForm() {
  const start = today();
  openForm({
    eyebrow: "Nuevo plan", title: "Crear plan de auditoría", submitLabel: "Generar calendario",
    values: { audit_type: "LPA", frequency: "Semanal", start_date: start, end_date: addDays(start, 30), generate: true },
    fields: [
      { name: "audit_type", label: "Tipo de auditoría", type: "select", required: true, options: AUDIT_TYPES.map((t) => [t, t]) },
      { name: "frequency", label: "Frecuencia", type: "select", required: true, options: FREQUENCIES.map((t) => [t, t]) },
      { name: "start_date", label: "Fecha inicial", type: "date", required: true },
      { name: "end_date", label: "Fecha final", type: "date", required: true },
      { name: "notes", label: "Notas del plan", type: "textarea", span2: true },
      { name: "generate", label: "Generar automáticamente las auditorías según la frecuencia (Custom = manual)", type: "checkbox", span2: true },
    ],
    onSubmit: async (v) => {
      if (v.end_date < v.start_date) throw new Error("La fecha final no puede ser anterior a la inicial.");
      const { generate, ...data } = v;
      const plan = await db.insert("audit_plans", data);
      const n = generate ? await generateAudits(plan) : 0;
      toast(`${plan.code} creado${n ? ` con ${n} auditoría(s)` : ""}`, "ok");
      navigate(`audits/plan/${plan.id}`);
    },
  });
}

function scheduleForm(audit, plan, date) {
  const type = plan?.audit_type;
  openForm({
    eyebrow: audit ? audit.code : `Auditoría programada${plan ? " · " + plan.code : ""}`,
    title: audit ? "Editar programación" : "Agregar auditoría",
    submitLabel: audit ? "Guardar" : "Programar auditoría",
    values: audit ? { ...audit, due_at: toLocalInput(audit.due_at) } : { scheduled_date: date, due_at: `${date}T17:00`, level: 1, form_id: db.rows("forms").find((f) => f.audit_type === type && f.active)?.id },
    fields: [
      { name: "scheduled_date", label: "Fecha programada", type: "date", required: true },
      { name: "assigned_to", label: "Asignado a", type: "select", options: userOpts() },
      ...(type === "LPA" ? [{ name: "level", label: "Nivel de auditoría (LPA)", type: "select", options: [1, 2, 3, 4, 5].map((n) => [n, `Nivel ${n}`]), parse: (v) => (v ? Number(v) : null) }] : []),
      { name: "form_id", label: "Formato / checklist", type: "select", options: db.rows("forms").filter((f) => f.active && (!type || f.audit_type === type)).map((f) => [f.id, `${f.code} · ${f.name}`]) },
      { name: "due_at", label: "Tiempo límite de entrega", type: "datetime" },
      ...(audit ? [{ name: "status", label: "Estado", type: "select", required: true, options: ["programada", "en_proceso", "completada", "cancelada"].map((s) => [s, AUDIT_STATUS[s][0]]) }] : []),
      { name: "notes", label: "Notas", type: "textarea", span2: true },
    ],
    onSubmit: async (v) => {
      const data = { ...v, due_at: fromLocalInput(v.due_at) };
      if (audit) await db.update("audits", audit.id, data);
      else { const r = await db.insert("audits", { ...data, plan_id: plan.id, status: "programada" }); toast(`${r.code} programada`, "ok"); }
      await rerender();
    },
    onDelete: audit && db.can.manage ? async () => { const pid = audit.plan_id; await db.remove("audits", audit.id); toast("Auditoría eliminada"); navigate(pid ? `audits/plan/${pid}` : "audits"); } : null,
  });
}

/* --------------------------------- Vistas ---------------------------- */
function listView(root) {
  setHead({
    eyebrow: "Gestión de calidad", title: "Auditorías", subtitle: "Planifica, programa y controla tus auditorías: LPA, producto, proceso, sistema e internas.",
    actions: db.can.manage ? `<button class="btn primary" data-action="au-plan-new">${icon("plus")} Crear plan de auditoría</button>` : "",
  });
  const plans = db.rows("audit_plans").sort((a, b) => b.start_date.localeCompare(a.start_date));
  const all = db.rows("audits");
  let body;
  if (tab === "plans") {
    body = plans.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Plan</th><th>Tipo</th><th>Frecuencia</th><th>Periodo</th><th style="min-width:180px">Avance</th><th></th></tr></thead><tbody>
      ${plans.map((p) => { const au = all.filter((a) => a.plan_id === p.id && a.status !== "cancelada"), done = au.filter((a) => a.status === "completada").length, pct = au.length ? Math.round((done / au.length) * 100) : 0;
        return `<tr data-action="au-plan-open" data-id="${p.id}"><td class="code">${esc(p.code)}</td><td><span class="title">${esc(p.audit_type)}</span>${p.notes ? `<span class="sub">${esc(p.notes)}</span>` : ""}</td><td>${esc(p.frequency)}</td><td>${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}</td>
        <td><div class="progress"><i style="width:${pct}%"></i></div><span class="sub mono">${done}/${au.length} · ${pct}%</span></td><td class="end"><a class="btn sm" href="#/audits/plan/${p.id}">${icon("calendar")} Abrir calendario</a></td></tr>`; }).join("")}
      </tbody></table></div>` : empty("No hay planes de auditoría", "Comienza creando tu primer plan para generar el calendario.", "calendar");
  } else {
    const q = F.q.toLowerCase();
    const list = all.filter((a) => (!F.status || auditStatus(a) === F.status) && (!F.mine || a.assigned_to === db.state.profile.id) && (!q || a.code.toLowerCase().includes(q)))
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
    body = `<div class="toolbar"><input class="input grow" id="au-q" type="search" placeholder="Buscar por folio…" value="${esc(F.q)}" data-input="au-q">
      <select class="select" data-change="au-filter" data-key="status"><option value="">Todos los estados</option>${Object.entries(AUDIT_STATUS).map(([k, [l]]) => `<option value="${k}" ${F.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="select" data-change="au-filter" data-key="mine"><option value="">Todos los auditores</option><option value="1" ${F.mine ? "selected" : ""}>Solo mis auditorías</option></select><span class="count">${list.length} auditoría(s)</span></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Plan</th><th>Fecha</th><th>Asignado a</th><th>Formato</th><th>Estado</th><th class="num">Resultado</th></tr></thead><tbody>
      ${list.map((a) => { const p = db.get("audit_plans", a.plan_id), f = db.get("forms", a.form_id); return `<tr data-action="au-open" data-id="${a.id}"><td class="code">${esc(a.code)}</td><td>${esc(p?.audit_type || "—")}${a.level ? ` · N${a.level}` : ""}<span class="sub">${esc(p?.code || "")}</span></td><td>${fmtDate(a.scheduled_date)}</td><td>${esc(db.profileName(a.assigned_to))}</td><td class="mono">${esc(f?.code || "—")}</td><td>${badge(AUDIT_STATUS, auditStatus(a))}</td><td class="num mono">${a.score != null ? Number(a.score).toFixed(0) + "%" : "—"}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin auditorías", "No hay auditorías con los filtros actuales.", "audit")}`;
  }
  root.innerHTML = `<div class="panel"><div style="padding:0 20px;padding-top:6px"><div class="tabs" style="margin:0;border:0"><button class="tab ${tab === "plans" ? "active" : ""}" data-action="au-tab" data-tab="plans">Planes (${plans.length})</button><button class="tab ${tab === "audits" ? "active" : ""}" data-action="au-tab" data-tab="audits">Todas las auditorías (${all.length})</button></div></div><div style="border-top:1px solid var(--line-soft)">${body}</div></div>`;
}

function calendarView(root, planId) {
  const plan = db.get("audit_plans", planId);
  if (!plan) { root.innerHTML = `<div class="panel">${empty("Plan no encontrado", "Es posible que haya sido eliminado.")}</div>`; setHead({ title: "Auditorías" }); return; }
  if (cal.planId !== planId) {
    const t = new Date(), s = parseDate(plan.start_date), e = parseDate(plan.end_date);
    const ref = t < s ? s : t > e ? e : t;
    Object.assign(cal, { planId, y: ref.getFullYear(), m: ref.getMonth() });
  }
  setHead({
    eyebrow: `${plan.code} · ${plan.audit_type} · ${plan.frequency}`, title: "Calendario de auditorías",
    subtitle: `Periodo ${fmtDate(plan.start_date)} → ${fmtDate(plan.end_date)}${plan.notes ? " · " + plan.notes : ""}`,
    actions: `<a class="btn" href="#/audits">${icon("chevL")} Planes</a>${db.can.write && plan.frequency !== "Custom" ? `<button class="btn" data-action="au-generate" data-id="${plan.id}">Completar calendario</button>` : ""}${db.can.manage ? `<button class="btn danger" data-action="au-plan-del" data-id="${plan.id}">${icon("trash")}</button>` : ""}`,
  });
  const audits = db.rows("audits").filter((a) => a.plan_id === plan.id);
  const first = new Date(cal.y, cal.m, 1), offset = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: Math.ceil((offset + new Date(cal.y, cal.m + 1, 0).getDate()) / 7) * 7 }, (_, i) => new Date(cal.y, cal.m, 1 - offset + i, 12));
  const t = today();
  root.innerHTML = `<div class="panel">
    <div class="panel-head"><div class="cal-nav"><button class="btn icon" data-action="au-month" data-d="-1" aria-label="Mes anterior">${icon("chevL")}</button><strong>${MONTHS_LONG[cal.m]} ${cal.y}</strong><button class="btn icon" data-action="au-month" data-d="1" aria-label="Mes siguiente">${icon("chevR")}</button><button class="btn sm ghost" data-action="au-month" data-d="0">Hoy</button></div>
      <small>${audits.length} auditoría(s) en el plan</small></div>
    <div class="calendar-scroll" style="overflow-x:auto"><div class="calendar">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("")}
    ${cells.map((d) => { const key = isoDate(d), inMonth = d.getMonth() === cal.m, inRange = key >= plan.start_date && key <= plan.end_date;
      return `<div class="day ${inMonth ? "" : "out"} ${key === t ? "today" : ""}"><span class="day-num">${d.getDate()}</span>
      ${audits.filter((a) => a.scheduled_date === key).map((a) => `<button class="slot" data-action="au-open" data-id="${a.id}" data-status="${auditStatus(a)}"><b>${esc(a.code)}${a.level ? " · N" + a.level : ""}</b><small>${esc(firstName(a.assigned_to))}</small></button>`).join("")}
      ${db.can.write && inRange ? `<button class="add-day" data-action="au-add" data-date="${key}">＋ Agregar</button>` : ""}</div>`; }).join("")}
    </div></div></div>`;
}

/* ---------------------------- Ejecución ------------------------------ */
function initDraft(audit) {
  if (draft?.auditId === audit.id) return;
  draft = { auditId: audit.id, answers: {} };
  db.rows("audit_answers").filter((a) => a.audit_id === audit.id).forEach((a) => (draft.answers[a.item_id] = { result: a.result, comment: a.comment || "", finding_id: a.finding_id }));
}
const RES = { ok: "Cumple", nok: "No cumple", na: "N/A" };

function questionHTML(it, readonly, auditId) {
  const a = draft.answers[it.id] || {};
  const f = db.get("findings", a.finding_id);
  return `<div class="q" id="q_${it.id}" data-result="${a.result || ""}">
    <div class="q-text"><span>${esc(it.question)}</span>${it.critical ? '<span class="badge" data-tone="danger">Crítica</span>' : ""}</div>
    ${readonly ? `<div style="margin-top:10px">${a.result ? `<span class="badge" data-tone="${a.result === "ok" ? "ok" : a.result === "nok" ? "danger" : "neutral"}">${RES[a.result]}</span>` : '<span class="muted">Sin responder</span>'}${a.comment ? `<div class="muted" style="margin-top:8px">${esc(a.comment)}</div>` : ""}${f ? `<div style="margin-top:8px"><a class="mono" href="#/findings/${f.id}">${esc(f.code)}</a> <span class="muted">hallazgo generado</span></div>` : ""}</div>`
    : `<div class="seg" role="group">${Object.entries(RES).map(([v, l]) => `<button type="button" data-action="au-ans" data-item="${it.id}" data-v="${v}" aria-pressed="${a.result === v}">${l}</button>`).join("")}</div>
       <textarea class="textarea" data-input="au-comment" data-item="${it.id}" placeholder="Comentario o evidencia (obligatorio si no cumple)">${esc(a.comment || "")}</textarea>`}
    ${attachmentsSection("audit", auditId, { ref: it.id, compact: true, canEdit: !readonly })}
  </div>`;
}

function progressHTML(items) {
  const answered = items.filter((i) => draft.answers[i.id]?.result).length;
  const ok = items.filter((i) => draft.answers[i.id]?.result === "ok").length, nok = items.filter((i) => draft.answers[i.id]?.result === "nok").length;
  const score = ok + nok ? Math.round((ok / (ok + nok)) * 100) : null;
  return `<div class="score-ring"><strong>${score == null ? "—" : score + "%"}</strong><div><div class="eyebrow">Resultado parcial</div><div class="muted">${answered} de ${items.length} respondidas · ${nok} no cumple</div></div></div>
    <div class="progress" style="margin-top:12px"><i style="width:${items.length ? (answered / items.length) * 100 : 0}%"></i></div>`;
}

function auditView(root, id) {
  const audit = db.get("audits", id);
  if (!audit) { setHead({ title: "Auditoría" }); root.innerHTML = `<div class="panel">${empty("Auditoría no encontrada", "Es posible que haya sido eliminada.", "audit")}</div>`; return; }
  const plan = db.get("audit_plans", audit.plan_id), form = db.get("forms", audit.form_id), items = form ? itemsOf(form.id) : [];
  initDraft(audit);
  const st = auditStatus(audit), locked = ["completada", "cancelada"].includes(audit.status) || !db.can.write;
  setHead({
    eyebrow: `${plan?.code || "Auditoría"} · ${plan?.audit_type || ""}`, title: audit.code, subtitle: form ? `${form.code} · ${form.name}` : "Sin formato asignado",
    actions: `<a class="btn" href="#/audits${plan ? "/plan/" + plan.id : ""}">${icon("chevL")} ${plan ? "Calendario" : "Auditorías"}</a>${db.can.write ? `<button class="btn" data-action="au-edit" data-id="${audit.id}">${icon("edit")} Programación</button>` : ""}${audit.status === "completada" && db.can.manage ? `<button class="btn" data-action="au-reopen" data-id="${audit.id}">Reabrir</button>` : ""}`,
  });
  const sections = [...new Set(items.map((i) => i.section || "General"))];
  const linked = db.rows("findings").filter((f) => f.audit_id === audit.id);
  root.innerHTML = `<div class="grid cols-main" style="align-items:start">
    <div class="panel"><div class="panel-head"><h2>Checklist</h2>${badge(AUDIT_STATUS, st)}</div><div class="panel-body">
      ${!form ? empty("Sin formato", "Asigna un formato en “Programación” para poder ejecutar la auditoría.", "form")
        : !items.length ? empty("El formato no tiene preguntas", "Agrega preguntas en Configuración → Formularios.", "form")
        : sections.map((s) => `<div class="check-section">${esc(s)}</div>${items.filter((i) => (i.section || "General") === s).map((i) => questionHTML(i, locked, audit.id)).join("")}`).join("")}
    </div>${!locked && items.length ? `<div class="dialog-foot"><button class="btn" data-action="au-save" data-id="${audit.id}">Guardar avance</button><button class="btn primary" data-action="au-finish" data-id="${audit.id}">Finalizar auditoría</button></div>` : ""}</div>
    <div class="stack">
      <div class="panel"><div class="panel-body" id="au-progress">${audit.status === "completada" ? `<div class="score-ring"><strong>${audit.score != null ? Number(audit.score).toFixed(0) + "%" : "—"}</strong><div><div class="eyebrow">Resultado final</div><div class="muted">Completada ${fmtDateTime(audit.completed_at)}</div></div></div>` : progressHTML(items)}</div></div>
      <div class="panel"><div class="panel-head"><h2>Datos</h2></div><div class="panel-body"><dl class="detail-grid">
        <div><dt>Fecha</dt><dd>${fmtDate(audit.scheduled_date)}</dd></div><div><dt>Nivel</dt><dd>${audit.level ? "Nivel " + audit.level : "—"}</dd></div>
        <div><dt>Asignado a</dt><dd>${esc(db.profileName(audit.assigned_to))}</dd></div><div><dt>Límite</dt><dd>${fmtDateTime(audit.due_at)}</dd></div>
        ${audit.notes ? `<div class="span-2"><dt>Notas</dt><dd>${esc(audit.notes)}</dd></div>` : ""}</dl></div></div>
      <div class="panel"><div class="panel-body">${attachmentsSection("audit", audit.id, { title: "Evidencias generales", canEdit: audit.status !== "cancelada" })}</div></div>
      <div class="panel"><div class="panel-head"><h2>Hallazgos generados</h2><small>${linked.length}</small></div><div class="panel-body">
        ${linked.length ? linked.map((f) => `<div class="item-row"><div><a class="mono" href="#/findings/${f.id}">${esc(f.code)}</a><div style="margin-top:4px">${esc(f.title)}</div></div>${badge(SEVERITY, f.severity)}</div>`).join("") : '<span class="muted">Aún no se han generado hallazgos.</span>'}</div></div>
    </div></div>`;
}

async function saveAnswers(audit) {
  const rowsToSave = Object.entries(draft.answers).filter(([, a]) => a.result).map(([item_id, a]) => ({ audit_id: audit.id, item_id, result: a.result, comment: a.comment || null, finding_id: a.finding_id || null }));
  await db.upsertMany("audit_answers", rowsToSave, ["audit_id", "item_id"]);
}

hooks.audit = () => rerender();

/* -------------------------------- Módulo ----------------------------- */
export default {
  id: "audits", label: "Auditorías", icon: "audit",
  render(root, params) {
    if (params[0] === "plan" && params[1]) return calendarView(root, params[1]);
    if (params[0]) return auditView(root, params[0]);
    cal.planId = null;
    return listView(root);
  },
};

/* -------------------------------- Eventos ---------------------------- */
on("au-plan-new", planForm);
on("au-plan-open", (el) => navigate(`audits/plan/${el.dataset.id}`));
on("au-tab", (el) => { tab = el.dataset.tab; rerender(); });
on("au-open", (el) => navigate(`audits/${el.dataset.id}`));
on("au-add", (el) => scheduleForm(null, db.get("audit_plans", cal.planId), el.dataset.date));
on("au-edit", (el) => { const a = db.get("audits", el.dataset.id); scheduleForm(a, db.get("audit_plans", a.plan_id)); });
on("au-month", (el) => {
  const d = Number(el.dataset.d);
  if (d === 0) { const n = new Date(); cal.y = n.getFullYear(); cal.m = n.getMonth(); }
  else { const n = new Date(cal.y, cal.m + d, 1); cal.y = n.getFullYear(); cal.m = n.getMonth(); }
  rerender();
});
on("au-generate", async (el) => { const n = await generateAudits(db.get("audit_plans", el.dataset.id)); toast(n ? `${n} auditoría(s) agregadas` : "El calendario ya está completo", n ? "ok" : "info"); rerender(); });
on("au-plan-del", async (el) => {
  if (await confirmDialog({ title: "¿Eliminar plan?", message: "Se eliminarán también sus auditorías y respuestas. Los hallazgos generados se conservan.", confirmLabel: "Eliminar", danger: true })) {
    try { await db.remove("audit_plans", el.dataset.id); toast("Plan eliminado"); navigate("audits"); } catch (e) { toast(e.message, "danger"); }
  }
});
on("au-reopen", async (el) => { await db.update("audits", el.dataset.id, { status: "en_proceso", completed_at: null }); toast("Auditoría reabierta"); rerender(); });
onChange("au-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("au-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("au-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });

function refreshProgress() {
  const audit = db.get("audits", draft.auditId), items = itemsOf(audit.form_id);
  const el = document.getElementById("au-progress");
  if (el) el.innerHTML = progressHTML(items);
}
on("au-ans", (el) => {
  const id = el.dataset.item, a = (draft.answers[id] ||= { result: "", comment: "" });
  a.result = a.result === el.dataset.v ? "" : el.dataset.v;
  const q = document.getElementById("q_" + id);
  q.dataset.result = a.result;
  q.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === a.result)));
  refreshProgress();
});
onInput("au-comment", (el) => { (draft.answers[el.dataset.item] ||= { result: "", comment: "" }).comment = el.value; });

on("au-save", async (el) => {
  const audit = db.get("audits", el.dataset.id);
  try {
    await saveAnswers(audit);
    if (audit.status === "programada") await db.update("audits", audit.id, { status: "en_proceso" });
    toast("Avance guardado", "ok");
  } catch (e) { toast(e.message, "danger"); }
});

on("au-finish", async (el) => {
  const audit = db.get("audits", el.dataset.id), items = itemsOf(audit.form_id);
  const pending = items.filter((i) => !draft.answers[i.id]?.result);
  if (pending.length) { toast(`Faltan ${pending.length} pregunta(s) por responder.`, "danger"); document.getElementById("q_" + pending[0].id)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const noComment = items.filter((i) => draft.answers[i.id].result === "nok" && !draft.answers[i.id].comment?.trim());
  if (noComment.length) { toast("Agrega un comentario en cada pregunta que no cumple.", "danger"); document.getElementById("q_" + noComment[0].id)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const noks = items.filter((i) => draft.answers[i.id].result === "nok" && !draft.answers[i.id].finding_id);
  if (!(await confirmDialog({ title: "Finalizar auditoría", message: `Se calculará el resultado y se generarán ${noks.length} hallazgo(s) por los puntos que no cumplen. Después no podrás editar las respuestas.`, confirmLabel: "Finalizar" }))) return;
  try {
    for (const it of noks) {
      const severity = it.critical ? "mayor" : "menor";
      const f = await db.insert("findings", {
        title: `${audit.code} · ${it.question.replace(/[¿?]/g, "").trim()}`.slice(0, 160) + " (No cumple)", description: draft.answers[it.id].comment,
        source: "auditoria", severity, audit_id: audit.id, owner_id: audit.assigned_to, due_date: addDays(today(), SEVERITY_SLA_DAYS[severity]),
      });
      draft.answers[it.id].finding_id = f.id;
    }
    await saveAnswers(audit);
    const ok = items.filter((i) => draft.answers[i.id].result === "ok").length, nok = items.filter((i) => draft.answers[i.id].result === "nok").length;
    await db.update("audits", audit.id, { status: "completada", completed_at: new Date().toISOString(), score: ok + nok ? Math.round((ok / (ok + nok)) * 10000) / 100 : null });
    draft = null;
    toast(`Auditoría finalizada${noks.length ? ` · ${noks.length} hallazgo(s) generados` : ""}`, "ok");
    rerender();
  } catch (e) { toast(e.message, "danger"); }
});
