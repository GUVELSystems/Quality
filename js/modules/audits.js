import * as db from "../db.js";
import { esc, today, addDays, fmtDate, fmtDateTime, toLocalInput, fromLocalInput, periodEnd, eachDay, isWeekend, mondayOf, parseDate, DOW_SHORT, rangeText } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, navigate, H, wsId } from "../router.js";
import { typesOf, plansOf, auditsOf, findingsOf, lateActionsOf, planWs, WS_LABEL } from "../scope.js";
import { on, onChange, onInput, badge, pill, empty, openForm, openDialog, confirmDialog, toast } from "../ui.js";
import { AUDIT_STATUS } from "../constants.js";
import { classOptions, dueFor, resolveOwner, levelOptions, levelLabel, classBadge } from "../workflow.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { userOpts } from "./shared.js";

const F = { q: "", status: "", mine: "" };
let currentPlanId = null;
let draft = null; // { auditId, answers: { itemId: {result, comment, finding_id} } }

const PLAN_STATUS = { borrador: ["Borrador", "warn"], enviado: ["Enviado", "ok"] };
const TYPE_INFO = {
  LPA: "Auditoría en capas del proceso",
  Producto: "Verificación de producto terminado",
  Proceso: "Método y parámetros de proceso",
  Sistema: "Sistema de gestión (ISO / IATF)",
  Interna: "Auditoría interna general",
};
const FREQ_INFO = [["Semanal", "Semanal", "7 días"], ["Quincenal", "Quincenal", "15 días"], ["Mensual", "Mensual", "1 mes"], ["Custom", "Personalizado", "Tú eliges"]];
const MAX_CUSTOM_DAYS = 92;

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
const staff = () => db.activeProfiles().filter((p) => ["admin", "quality_manager", "auditor"].includes(p.role));
const planName = (p) => p.name || `${p.audit_type} · ${rangeText(p.start_date, p.end_date)}`;
const isPending = (a) => a.assigned_to && a.status !== "cancelada" && (!a.notified_at || a.notified_to !== a.assigned_to);

/* ===================================================================== */
/*  Asistente: crear plan                                                 */
/* ===================================================================== */
function miniCal(start, end) {
  if (!start || !end || end < start) return "";
  const cells = ["L", "M", "M", "J", "V", "S", "D"].map((d) => `<span class="hdr">${d}</span>`);
  for (let m = mondayOf(start); m <= end; m = addDays(m, 7)) {
    for (const d of eachDay(m, addDays(m, 6))) {
      const inR = d >= start && d <= end;
      cells.push(`<span class="${!inR ? "out" : isWeekend(d) ? "off" : ""}">${inR ? parseDate(d).getDate() : ""}</span>`);
    }
  }
  return `<div class="mini-cal">${cells.join("")}</div>`;
}

function planWizard() {
  const types = typesOf(wsId());
  const w = { type: types[0], frequency: "Mensual", start: today(), end: addDays(today(), 13) };
  const body = `
    <div class="wiz-step"><div class="wiz-label"><i>1</i>¿Qué tipo de auditoría es?</div>
      <div class="opt-cards" id="w-types">${types.map((t) => `<button type="button" class="opt-card" data-type="${t}"><b>${t}</b><small>${TYPE_INFO[t]}</small></button>`).join("")}</div></div>
    <div class="wiz-step"><div class="wiz-label"><i>2</i>¿Cada cuánto? <span class="muted" style="font-weight:400">El calendario se arma solo, con la duración de la frecuencia.</span></div>
      <div class="freq-seg" id="w-freq">${FREQ_INFO.map(([v, l, s]) => `<button type="button" data-freq="${v}"><b>${l}</b><small>${s}</small></button>`).join("")}</div></div>
    <div class="wiz-step"><div class="wiz-label"><i>3</i>¿Desde qué día inicia?</div>
      <div class="form-grid"><label class="field"><span>Fecha de inicio</span><input class="input" type="date" id="w-start" value="${w.start}"></label>
      <label class="field" id="w-end-wrap" hidden><span>Fecha final</span><input class="input" type="date" id="w-end" value="${w.end}"></label></div>
      <div class="period-box" id="w-preview" style="margin-top:14px"></div></div>
    <div class="wiz-step" style="margin-bottom:0"><div class="wiz-label"><i>4</i>Detalles <span class="muted" style="font-weight:400">(opcionales)</span></div>
      <div class="form-grid"><label class="field span-2"><span>Nombre del plan</span><input class="input" id="w-name" maxlength="80" placeholder=""></label>
      <label class="field span-2"><span>Notas</span><textarea class="textarea" id="w-notes" style="min-height:60px" placeholder="Línea, turno, alcance…"></textarea></label></div></div>
    <div class="alert hidden" id="w-err" style="margin-top:14px"></div>`;
  const dlg = openDialog({
    eyebrow: "Nuevo plan", title: "Crear plan de auditoría", size: "wide", body,
    footer: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="w-ok">${icon("calendar")} Crear plan y abrir calendario</button>`,
  });
  const $ = (s) => dlg.el.querySelector(s);
  const endOf = () => (w.frequency === "Custom" ? w.end : periodEnd(w.frequency, w.start));
  const paint = () => {
    $("#w-types").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === w.type)));
    $("#w-freq").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.freq === w.frequency)));
    $("#w-end-wrap").hidden = w.frequency !== "Custom";
    const end = endOf(), box = $("#w-preview");
    if (!w.start || !end || end < w.start) { box.innerHTML = `<div><div class="big">Elige las fechas</div><div class="sub">La fecha final debe ser igual o posterior a la inicial.</div></div>`; return; }
    const days = eachDay(w.start, end), off = days.filter(isWeekend).length;
    box.innerHTML = `<div><div class="big">${fmtDate(w.start)} → ${fmtDate(end)}</div>
      <div class="sub">${days.length} días · ${days.length - off} hábiles · <b>${off} inhábiles (sáb y dom, en naranja)</b>. Si asignas a alguien en fin de semana, ese día se habilita.</div></div>${miniCal(w.start, end)}`;
    $("#w-name").placeholder = `${w.type} · ${fmtDate(w.start)} al ${fmtDate(end)}`;
  };
  $("#w-types").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) { w.type = b.dataset.type; paint(); } });
  $("#w-freq").addEventListener("click", (e) => { const b = e.target.closest("[data-freq]"); if (b) { w.frequency = b.dataset.freq; paint(); } });
  $("#w-start").addEventListener("input", (e) => { w.start = e.target.value; if (w.end < w.start) w.end = addDays(w.start, 13), ($("#w-end").value = w.end); paint(); });
  $("#w-end").addEventListener("input", (e) => { w.end = e.target.value; paint(); });
  paint();
  $("#w-ok").addEventListener("click", async (e) => {
    const err = $("#w-err"), end = endOf();
    const fail = (m) => { err.textContent = m; err.classList.remove("hidden"); };
    if (!w.start) return fail("Elige la fecha de inicio.");
    if (!end || end < w.start) return fail("La fecha final debe ser igual o posterior a la inicial.");
    if (eachDay(w.start, end).length > MAX_CUSTOM_DAYS) return fail(`El periodo no puede exceder ${MAX_CUSTOM_DAYS} días.`);
    e.target.disabled = true;
    try {
      const plan = await db.insert("audit_plans", { name: $("#w-name").value.trim() || `${w.type} · ${fmtDate(w.start)} al ${fmtDate(end)}`, audit_type: w.type, frequency: w.frequency, start_date: w.start, end_date: end, notes: $("#w-notes").value.trim(), status: "borrador" });
      dlg.close(); toast(`${plan.code} creado. Asigna a tu equipo en el calendario.`, "ok"); navigate(`${wsId()}/plan/${plan.id}`);
    } catch (ex) { fail(ex.message); e.target.disabled = false; }
  });
}

/* ===================================================================== */
/*  Formularios: auditoría individual, edición del plan, asignación rápida */
/* ===================================================================== */
function scheduleForm(audit, plan, date) {
  const type = plan?.audit_type;
  openForm({
    eyebrow: audit ? audit.code : `${plan?.code || "Plan"} · ${fmtDate(date)}`,
    title: audit ? "Editar auditoría" : "Asignar auditoría", submitLabel: audit ? "Guardar" : "Asignar",
    intro: audit ? `<p style="margin-bottom:14px"><a class="btn sm" href="${H("audit/" + audit.id)}" data-close>${icon("audit")} Abrir checklist de la auditoría</a></p>` : "",
    values: audit ? { ...audit, due_at: toLocalInput(audit.due_at) } : { scheduled_date: date, due_at: `${date}T17:00`, level: levelOptions()[0]?.[0] ?? 1, form_id: db.rows("forms").find((f) => f.audit_type === type && f.active)?.id },
    fields: [
      { name: "scheduled_date", label: "Fecha", type: "date", required: true },
      { name: "assigned_to", label: "Asignado a", type: "select", options: staff().map((p) => [p.id, p.full_name]) },
      ...(type === "LPA" ? [{ name: "level", label: "Nivel (LPA)", type: "select", options: levelOptions(), parse: (v) => (v ? Number(v) : null) }] : []),
      { name: "form_id", label: "Formato / checklist", type: "select", options: db.rows("forms").filter((f) => f.active && (!type || f.audit_type === type)).map((f) => [f.id, `${f.code} · ${f.name}`]) },
      { name: "due_at", label: "Límite de entrega", type: "datetime" },
      ...(audit ? [{ name: "status", label: "Estado", type: "select", required: true, options: ["programada", "en_proceso", "completada", "cancelada"].map((s) => [s, AUDIT_STATUS[s][0]]) }] : []),
      { name: "notes", label: "Notas", type: "textarea", span2: true },
    ],
    onSubmit: async (v) => {
      if (plan && (v.scheduled_date < plan.start_date || v.scheduled_date > plan.end_date)) throw new Error(`La fecha debe estar dentro del plan (${rangeText(plan.start_date, plan.end_date)}).`);
      const data = { ...v, due_at: fromLocalInput(v.due_at) };
      if (audit) await db.update("audits", audit.id, data);
      else { const r = await db.insert("audits", { ...data, plan_id: plan.id, status: "programada" }); toast(`${r.code} asignada`, "ok"); }
      await rerender();
    },
    onDelete: audit && db.can.manage ? async () => { const pid = audit.plan_id; await db.remove("audits", audit.id); toast("Auditoría eliminada"); navigate(pid ? `${wsId()}/plan/${pid}` : `${wsId()}/planes`); } : null,
  });
}

function editPlan(plan) {
  openForm({
    eyebrow: plan.code, title: "Editar plan", values: plan, submitLabel: "Guardar",
    fields: [{ name: "name", label: "Nombre del plan", required: true, span2: true }, { name: "notes", label: "Notas", type: "textarea", span2: true }],
    onSubmit: async (v) => { await db.update("audit_plans", plan.id, v); toast("Plan actualizado", "ok"); await rerender(); },
    onDelete: db.can.manage ? async () => { await db.remove("audit_plans", plan.id); toast("Plan eliminado"); navigate(`${wsId()}/planes`); } : null,
  });
}

function bulkAssign(plan) {
  const days = eachDay(plan.start_date, plan.end_date);
  const forms = db.rows("forms").filter((f) => f.active && f.audit_type === plan.audit_type);
  const people = staff();
  const st = { wd: new Set([1, 2, 3, 4, 5]), people: new Set(), skip: true };
  const WD = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]];
  const dlg = openDialog({
    eyebrow: plan.code, title: "Asignación rápida", size: "wide",
    body: `<p class="muted" style="margin-bottom:16px">Crea varias auditorías de una vez: elige los días, las personas (se turnan en orden) y el formato.</p>
      <div class="wiz-step"><div class="wiz-label"><i>1</i>Días de la semana</div><div class="chips" id="b-days">${WD.map(([n, l]) => `<button type="button" class="chip ${n === 0 || n === 6 ? "off" : ""}" data-wd="${n}" aria-pressed="${st.wd.has(n)}">${l}</button>`).join("")}</div>
        <small class="muted" style="display:block;margin-top:6px">Sáb y Dom son inhábiles; si los eliges, esos días quedan habilitados.</small></div>
      <div class="wiz-step"><div class="wiz-label"><i>2</i>Auditores <span class="muted" style="font-weight:400">(se turnan en orden)</span></div>
        <div class="pick-list" id="b-people">${people.map((p) => `<label><input type="checkbox" value="${p.id}">${esc(p.full_name)}<small>${esc(p.area || "")}</small></label>`).join("") || '<div class="muted" style="padding:12px">No hay usuarios con rol de auditor.</div>'}</div></div>
      <div class="wiz-step"><div class="wiz-label"><i>3</i>Formato y límite</div><div class="form-grid">
        <label class="field span-2"><span>Formato / checklist</span><select class="select" id="b-form">${forms.map((f) => `<option value="${f.id}">${esc(f.code)} · ${esc(f.name)}</option>`).join("")}</select></label>
        ${plan.audit_type === "LPA" ? `<label class="field"><span>Nivel (LPA)</span><select class="select" id="b-level">${levelOptions().map(([n, l]) => `<option value="${n}">${esc(l)}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>Hora límite de entrega</span><input class="input" type="time" id="b-time" value="17:00"></label>
        <label class="check span-2"><input type="checkbox" id="b-skip" checked> Omitir días que ya tienen una auditoría</label></div></div>
      <div class="note" id="b-sum"></div><div class="alert hidden" id="b-err" style="margin-top:12px"></div>`,
    footer: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="b-ok">${icon("wand")} Crear auditorías</button>`,
  });
  const $ = (s) => dlg.el.querySelector(s);
  const targets = () => {
    const taken = new Set(db.rows("audits").filter((a) => a.plan_id === plan.id && a.status !== "cancelada").map((a) => a.scheduled_date));
    return days.filter((d) => st.wd.has(parseDate(d).getDay()) && !($("#b-skip").checked && taken.has(d)));
  };
  const sum = () => { const n = targets().length; $("#b-sum").innerHTML = n ? `Se crearán <b>${n}</b> auditoría(s)${st.people.size ? ` repartidas entre <b>${st.people.size}</b> persona(s)` : ", <b>sin asignar</b> (elige al menos un auditor para asignarlas)"}.` : "No hay días que cumplan con la selección."; };
  $("#b-days").addEventListener("click", (e) => { const b = e.target.closest("[data-wd]"); if (!b) return; const n = Number(b.dataset.wd); st.wd.has(n) ? st.wd.delete(n) : st.wd.add(n); b.setAttribute("aria-pressed", String(st.wd.has(n))); sum(); });
  $("#b-people").addEventListener("change", (e) => { e.target.checked ? st.people.add(e.target.value) : st.people.delete(e.target.value); sum(); });
  $("#b-skip").addEventListener("change", sum);
  sum();
  $("#b-ok").addEventListener("click", async (e) => {
    const list = targets(), who = people.filter((p) => st.people.has(p.id)).map((p) => p.id);
    if (!list.length) { $("#b-err").textContent = "No hay días para crear."; $("#b-err").classList.remove("hidden"); return; }
    e.target.disabled = true;
    try {
      for (const [i, d] of list.entries()) {
        await db.insert("audits", { plan_id: plan.id, scheduled_date: d, assigned_to: who.length ? who[i % who.length] : null, form_id: $("#b-form").value || null, level: $("#b-level") ? Number($("#b-level").value) : null, due_at: new Date(`${d}T${$("#b-time").value || "17:00"}:00`).toISOString(), status: "programada" });
      }
      dlg.close(); toast(`${list.length} auditoría(s) creadas`, "ok"); await rerender();
    } catch (ex) { $("#b-err").textContent = ex.message; $("#b-err").classList.remove("hidden"); e.target.disabled = false; }
  });
}

/* ===================================================================== */
/*  Terminar y enviar                                                     */
/* ===================================================================== */
async function sendPlan(plan) {
  const unassigned = db.rows("audits").filter((a) => a.plan_id === plan.id && a.status !== "cancelada" && !a.assigned_to).length;
  let all = false, rec = db.planRecipients(plan.id);
  if (!rec.length) {
    const any = db.planRecipients(plan.id, { all: true });
    if (!any.length) { toast("Asigna al menos una auditoría a una persona antes de enviar.", "danger"); return; }
    if (!(await confirmDialog({ title: "Todo ya fue notificado", message: "No hay cambios pendientes. ¿Quieres reenviar el plan y las notificaciones a todos?", confirmLabel: "Reenviar a todos" }))) return;
    all = true; rec = any;
  }
  const total = rec.reduce((n, r) => n + r.audits.length, 0);
  const dlg = openDialog({
    eyebrow: plan.code, title: plan.status === "enviado" ? "Reenviar notificaciones" : "Terminar y enviar", size: "wide",
    body: `<p style="margin-bottom:14px">Se enviarán <b>${rec.length} correo(s) con el plan</b> y <b>${total} notificación(es) individuales</b>. Cada persona recibe el plan (PDF adjunto) y un aviso por cada auditoría asignada, con un enlace directo para realizarla.</p>
      ${db.state.demo ? `<div class="note warn" style="margin-bottom:14px"><b>Modo demo:</b> no se envían correos reales; el plan se marcará como enviado y se descargará el PDF.</div>` : ""}
      ${unassigned ? `<div class="note warn" style="margin-bottom:14px"><b>${unassigned} auditoría(s) sin asignar</b> no se notificarán.</div>` : ""}
      <div style="border:1px solid var(--line-soft)">${rec.map((r) => `<div class="recipient"><div><b>${esc(r.profile.full_name)}</b><div class="muted" style="font-size:13px">${esc(r.profile.email || "sin correo")}</div></div><div style="text-align:right"><b>${r.audits.length}</b> <span class="muted">auditoría(s)</span><div class="muted" style="font-size:12.5px">${r.audits.slice(0, 4).map((a) => fmtDate(a.scheduled_date).slice(0, -5)).join(" · ")}${r.audits.length > 4 ? "…" : ""}</div></div></div>`).join("")}</div>
      <div class="alert hidden" id="s-err" style="margin-top:14px"></div>`,
    footer: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="s-ok">${icon("send")} Enviar ahora</button>`,
  });
  dlg.el.querySelector("#s-ok").addEventListener("click", async (e) => {
    const btn = e.target.closest("button"), err = dlg.el.querySelector("#s-err");
    btn.disabled = true; btn.textContent = "Enviando…"; err.classList.add("hidden");
    try {
      const { buildPlanPDF } = await import("../pdf.js");
      const { doc, filename } = await buildPlanPDF(plan.id);
      const res = await db.notifyPlan(plan.id, { pdfBase64: db.state.demo ? null : doc.output("datauristring").split(",")[1], all });
      doc.save(filename);
      dlg.close();
      const failed = res.failed?.length || 0;
      toast(db.state.demo ? `Plan marcado como enviado (demo) · PDF descargado` : `Enviado: ${res.sent_plan} plan(es) y ${res.sent_audits} notificación(es)${failed ? ` · ${failed} con error` : ""} · PDF descargado`, failed ? "danger" : "ok");
      if (failed) openDialog({ eyebrow: "Envío", title: "Algunos correos no se enviaron", body: `<div>${res.failed.map((f) => `<div class="item-row"><div><b>${esc(f.email || "")}</b><div class="meta">${esc(f.kind)} · ${esc(f.error)}</div></div></div>`).join("")}</div>`, footer: `<button class="btn" data-close>Cerrar</button>` });
      await rerender();
    } catch (ex) {
      const m = /not found|404|Failed to send a request/i.test(ex.message) ? "La función de correo no está disponible. Revisa que esté desplegada (docs/SETUP_SUPABASE.md)." : ex.message;
      err.textContent = m; err.classList.remove("hidden"); btn.disabled = false; btn.innerHTML = `${icon("send")} Reintentar`;
    }
  });
}

/* ===================================================================== */
/*  Vistas                                                                */
/* ===================================================================== */
function moduleKpis(ws) {
  const t = today(), au = auditsOf(ws).filter((a) => a.status !== "cancelada"), month = au.filter((a) => a.scheduled_date.startsWith(t.slice(0, 7)));
  const done = month.filter((a) => a.status === "completada").length, pct = month.length ? Math.round((done / month.length) * 100) : 0;
  const openF = findingsOf(ws).filter((f) => f.status !== "cerrado"), late = lateActionsOf(ws);
  const live = plansOf(ws).filter((p) => p.end_date >= t).length;
  return `<div class="kpi-strip">
    <div class="kpi" data-tone="info"><label>Planes vigentes</label><strong>${live}</strong><small>${plansOf(ws).length} en total</small></div>
    <div class="kpi" data-tone="${!month.length ? "" : pct >= 90 ? "ok" : pct >= 70 ? "warn" : "danger"}"><label>Cumplimiento del mes</label><strong>${pct}%</strong><small>${done} de ${month.length} realizadas</small></div>
    <a class="kpi" href="${H("hallazgos")}" data-tone="${openF.length ? "warn" : "ok"}"><label>Hallazgos abiertos</label><strong>${openF.length}</strong><small>${openF.filter((f) => f.status === "abierto").length} por aceptar · solo de este módulo</small></a>
    <a class="kpi" href="${H("acciones")}" data-tone="${late.length ? "danger" : "ok"}"><label>Acciones vencidas</label><strong>${late.length}</strong><small>Plazo en días hábiles superado</small></a></div>`;
}

function renderPlanes(root) {
  const ws = wsId(), internal = ws === "internas";
  setHead({
    title: internal ? "Planes de auditoría interna" : "Planes de auditoría",
    subtitle: internal ? "Planifica las auditorías internas por periodo, asigna a tu equipo y envía las notificaciones." : "Crea planes por periodo (LPA, producto, proceso, sistema), asigna a tu equipo y envía las notificaciones para que realicen cada auditoría.",
    actions: db.can.write ? `<button class="btn primary" data-action="au-plan-new">${icon("plus")} Crear plan de auditoría</button>` : "",
  });
  const plans = plansOf(ws).sort((a, b) => b.start_date.localeCompare(a.start_date)), all = auditsOf(ws);
  const body = plans.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Plan</th><th>Tipo</th><th>Periodo</th><th style="min-width:170px">Avance</th><th>Envío</th><th></th></tr></thead><tbody>
      ${plans.map((p) => { const au = all.filter((a) => a.plan_id === p.id && a.status !== "cancelada"), done = au.filter((a) => a.status === "completada").length, pct = au.length ? Math.round((done / au.length) * 100) : 0, st = p.status || "borrador";
        return `<tr data-action="au-plan-open" data-id="${p.id}"><td><span class="title">${esc(planName(p))}</span><span class="sub mono">${esc(p.code)}</span></td><td>${esc(p.audit_type)}<span class="sub">${p.frequency === "Custom" ? "Personalizado" : esc(p.frequency)}</span></td><td>${rangeText(p.start_date, p.end_date)}</td>
        <td><div class="progress"><i style="width:${pct}%"></i></div><span class="sub mono">${done}/${au.length} realizadas · ${pct}%</span></td><td>${badge(PLAN_STATUS, st)}${p.sent_at ? `<span class="sub">${fmtDate(p.sent_at.slice(0, 10))}</span>` : ""}</td>
        <td class="end"><a class="btn sm" href="${H("plan/" + p.id)}">${icon("calendar")} Calendario</a> <button class="btn sm icon" data-action="au-export" data-id="${p.id}" title="Exportar PDF" aria-label="Exportar PDF">${icon("download")}</button></td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Aún no hay planes", "Crea tu primer plan: elige tipo, frecuencia y fecha de inicio; el calendario se genera solo.", "calendar");
  root.innerHTML = `<div class="stack">${moduleKpis(ws)}<div class="panel">${body}</div></div>`;
}

function renderLista(root) {
  const ws = wsId();
  setHead({ title: ws === "internas" ? "Auditorías internas" : "Auditorías", subtitle: "Todas las auditorías programadas, en proceso y completadas. Entra a una para ejecutar su checklist." });
  const all = auditsOf(ws), q = F.q.toLowerCase();
  const list = all.filter((a) => (!F.status || auditStatus(a) === F.status) && (!F.mine || a.assigned_to === db.state.profile.id) && (!q || a.code.toLowerCase().includes(q)))
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  root.innerHTML = `<div class="panel"><div class="toolbar"><input class="input grow" id="au-q" type="search" placeholder="Buscar por folio…" value="${esc(F.q)}" data-input="au-q">
      <select class="select" data-change="au-filter" data-key="status"><option value="">Todos los estados</option>${Object.entries(AUDIT_STATUS).map(([k, [l]]) => `<option value="${k}" ${F.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="select" data-change="au-filter" data-key="mine"><option value="">Todos los auditores</option><option value="1" ${F.mine ? "selected" : ""}>Solo mis auditorías</option></select><span class="count">${list.length} auditoría(s)</span></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Plan</th><th>Fecha</th><th>Asignado a</th><th>Formato</th><th>Estado</th><th class="num">Resultado</th></tr></thead><tbody>
      ${list.map((a) => { const p = db.get("audit_plans", a.plan_id), f = db.get("forms", a.form_id); return `<tr data-action="au-open" data-id="${a.id}"><td class="code">${esc(a.code)}</td><td>${esc(p?.audit_type || "—")}${a.level ? ` · N${a.level}` : ""}<span class="sub">${esc(p?.code || "")}</span></td><td>${fmtDate(a.scheduled_date)}</td><td>${esc(db.profileName(a.assigned_to))}</td><td class="mono">${esc(f?.code || "—")}</td><td>${badge(AUDIT_STATUS, auditStatus(a))}</td><td class="num mono">${a.score != null ? Number(a.score).toFixed(0) + "%" : "—"}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin auditorías", "No hay auditorías con los filtros actuales.", "audit")}</div>`;
}

function calendarView(root, planId) {
  const plan = db.get("audit_plans", planId);
  if (!plan) { root.innerHTML = `<div class="panel">${empty("Plan no encontrado", "Es posible que haya sido eliminado.")}</div>`; setHead({ title: "Auditorías" }); return; }
  if (planWs(plan) !== wsId()) { navigate(`${planWs(plan)}/plan/${planId}`); return; }
  currentPlanId = planId;
  const audits = db.rows("audits").filter((a) => a.plan_id === plan.id && a.status !== "cancelada");
  const byDay = new Map();
  audits.forEach((a) => byDay.set(a.scheduled_date, [...(byDay.get(a.scheduled_date) || []), a]));
  const days = eachDay(plan.start_date, plan.end_date), hab = days.filter((d) => !isWeekend(d)).length;
  const pending = audits.filter(isPending).length, unassigned = audits.filter((a) => !a.assigned_to).length;
  const sent = plan.status === "enviado";
  setHead({
    eyebrow: `${plan.code} · ${plan.audit_type} · ${plan.frequency === "Custom" ? "Personalizado" : plan.frequency}`, title: planName(plan),
    subtitle: `${rangeText(plan.start_date, plan.end_date)} · ${days.length} días (${hab} hábiles, ${days.length - hab} inhábiles)`,
    actions: `<a class="btn" href="${H("planes")}">${icon("chevL")} Planes</a>${db.can.write ? `<button class="btn" data-action="au-plan-edit" data-id="${plan.id}">${icon("edit")} Editar</button><button class="btn" data-action="au-bulk" data-id="${plan.id}">${icon("wand")} Asignación rápida</button>` : ""}<button class="btn" data-action="au-export" data-id="${plan.id}">${icon("download")} Exportar PDF</button>${db.can.write ? `<button class="btn primary" data-action="au-send" data-id="${plan.id}">${icon("send")} ${sent ? "Reenviar" : "Terminar y Enviar"}</button>` : ""}`,
  });
  const t = today(), weeks = [];
  for (let m = mondayOf(plan.start_date); m <= plan.end_date; m = addDays(m, 7)) weeks.push(eachDay(m, addDays(m, 6)));
  const cell = (d) => {
    const inR = d >= plan.start_date && d <= plan.end_date, list = byDay.get(d) || [], off = inR && isWeekend(d) && !list.length;
    const dd = parseDate(d), showMon = inR && (dd.getDate() === 1 || d === plan.start_date);
    if (!inR) return `<div class="day out"><div class="day-top"><span class="day-num" style="color:var(--text-3)">${dd.getDate()}</span></div></div>`;
    return `<div class="day ${off ? "weekend" : ""} ${d === t ? "today" : ""}"><div class="day-top"><span class="day-num">${dd.getDate()}${showMon ? ` <span class="day-mon">${fmtDate(d).split(" ")[1]}</span>` : ""}</span>${off ? '<span class="day-off">Inhábil</span>' : ""}</div>
      ${list.map((a) => { const un = !a.assigned_to; return `<button class="slot ${un ? "unassigned" : ""}" data-action="au-slot" data-id="${a.id}" data-status="${auditStatus(a)}"><b><span>${esc(a.code)}${a.level ? " · N" + a.level : ""}</span>${a.notified_at && a.notified_to === a.assigned_to ? icon("mail") : ""}</b><small>${un ? "Sin asignar" : esc(firstName(a.assigned_to))}</small></button>`; }).join("")}
      ${db.can.write ? `<button class="add-day" data-action="au-add" data-date="${d}">＋ ${off ? "Habilitar y asignar" : "Asignar"}</button>` : ""}</div>`;
  };
  root.innerHTML = `<div class="stack">
    <div class="kpi-strip">
      <div class="kpi" data-tone="info"><label>Auditorías en el plan</label><strong>${audits.length}</strong><small>${audits.filter((a) => a.status === "completada").length} realizadas</small></div>
      <div class="kpi" data-tone="${unassigned ? "warn" : "ok"}"><label>Sin asignar</label><strong>${unassigned}</strong><small>${unassigned ? "No se notificarán" : "Todas con responsable"}</small></div>
      <div class="kpi" data-tone="info"><label>Auditores</label><strong>${new Set(audits.map((a) => a.assigned_to).filter(Boolean)).size}</strong><small>personas asignadas</small></div>
      <div class="kpi" data-tone="${sent && !pending ? "ok" : "warn"}"><label>Envío</label><strong>${sent ? "Enviado" : "Borrador"}</strong><small>${pending ? `${pending} auditoría(s) por notificar` : sent ? fmtDate(plan.sent_at?.slice(0, 10)) : "Aún no se envía"}</small></div>
    </div>
    <div class="panel"><div class="panel-head"><div class="legend-row"><span><i class="as"></i>Asignada</span><span><i class="un"></i>Sin asignar</span><span><i class="wk"></i>Inhábil (sin asignación)</span><span>${icon("mail").replace("<svg", '<svg style="width:13px;height:13px"')} Notificada</span></div><small>Clic en un día para asignar · clic en una auditoría para editarla</small></div>
    <div class="panel-body cal-scroll"><div class="cal"><div class="cal-grid">
      ${DOW_SHORT.slice(1).concat(DOW_SHORT[0]).map((n, i) => `<div class="cal-dow ${i >= 5 ? "off" : ""}">${n}</div>`).join("")}
      ${weeks.map((w) => w.map(cell).join("")).join("")}
    </div></div></div></div></div>`;
}

/* ---------------------------- Ejecución ------------------------------ */
function initDraft(audit) {
  if (draft?.auditId === audit.id) return;
  draft = { auditId: audit.id, answers: {} };
  db.rows("audit_answers").filter((a) => a.audit_id === audit.id).forEach((a) => (draft.answers[a.item_id] = { result: a.result, comment: a.comment || "", class_id: a.class_id || "", finding_id: a.finding_id }));
}
const RES = { ok: "Cumple", nok: "No cumple", na: "N/A" };
const areaName = (it) => db.get("areas", it.area_id)?.name || it.section || "General";

/** Texto de ayuda al marcar "No cumple": plazo en días hábiles y responsable automático */
function nokHint(it, audit, classId) {
  const c = db.get("finding_classes", classId), owner = resolveOwner(it.area_id, audit.level), ar = db.get("areas", it.area_id);
  const plazo = c ? `Plazo: <b>${c.days} días hábiles</b> → vence <b>${fmtDate(dueFor(classId, today()))}</b>` : "Elige la clasificación para calcular el plazo.";
  const resp = owner ? `Se asignará a <b>${esc(db.profileName(owner))}</b>${ar ? ` (${esc(ar.name)}${audit.level ? " · Nivel " + audit.level : ""})` : ""}` : `<span class="overdue">Sin responsable definido${ar ? ` en ${esc(ar.name)}` : ""}: un administrador deberá asignarlo</span>`;
  return `${plazo}<br>${resp}`;
}

function questionHTML(it, readonly, audit) {
  const a = draft.answers[it.id] || {}, f = db.get("findings", a.finding_id), nok = a.result === "nok";
  return `<div class="q" id="q_${it.id}" data-result="${a.result || ""}">
    <div class="q-text"><span>${esc(it.question)}</span>${it.critical ? '<span class="badge" data-tone="danger">Crítica</span>' : ""}</div>
    ${readonly ? `<div style="margin-top:10px">${a.result ? `<span class="badge" data-tone="${a.result === "ok" ? "ok" : a.result === "nok" ? "danger" : "neutral"}">${RES[a.result]}</span>` : '<span class="muted">Sin responder</span>'}${nok && f ? ` ${classBadge(f)}` : ""}${a.comment ? `<div class="muted" style="margin-top:8px">${esc(a.comment)}</div>` : ""}${f ? `<div style="margin-top:8px"><a class="mono" href="${H("hallazgos/" + f.id)}">${esc(f.code)}</a> <span class="muted">hallazgo generado · responsable ${esc(db.profileName(f.owner_id))}</span></div>` : ""}</div>`
    : `<div class="seg" role="group">${Object.entries(RES).map(([v, l]) => `<button type="button" data-action="au-ans" data-item="${it.id}" data-v="${v}" aria-pressed="${a.result === v}">${l}</button>`).join("")}</div>
       <div class="q-nok ${nok ? "" : "hidden"}">
         <label class="field" style="margin-top:12px;max-width:340px"><span>Clasificación <i>*</i></span>
           <select class="select" data-change="au-class" data-item="${it.id}"><option value="">Seleccionar clasificación</option>${classOptions().map(([v, l]) => `<option value="${v}" ${v === a.class_id ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
         <div class="q-hint" id="qh_${it.id}">${nokHint(it, audit, a.class_id)}</div>
       </div>
       <textarea class="textarea" data-input="au-comment" data-item="${it.id}" placeholder="${nok ? "Comentario obligatorio: describe lo encontrado (aunque adjuntes evidencia)" : "Comentario (opcional)"}">${esc(a.comment || "")}</textarea>`}
    ${attachmentsSection("audit", audit.id, { ref: it.id, compact: true, canEdit: !readonly })}
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
  if (plan && planWs(plan) !== wsId()) { navigate(`${planWs(plan)}/audit/${id}`); return; }
  initDraft(audit);
  const st = auditStatus(audit), locked = ["completada", "cancelada"].includes(audit.status) || !db.can.write;
  setHead({
    eyebrow: `${plan?.code || "Auditoría"} · ${plan?.audit_type || ""}`, title: audit.code, subtitle: form ? `${form.code} · ${form.name}` : "Sin formato asignado",
    actions: `<a class="btn" href="${H(plan ? "plan/" + plan.id : "lista")}">${icon("chevL")} ${plan ? "Calendario" : "Auditorías"}</a>${db.can.write ? `<button class="btn" data-action="au-edit" data-id="${audit.id}">${icon("edit")} Programación</button>` : ""}${audit.status === "completada" && db.can.manage ? `<button class="btn" data-action="au-reopen" data-id="${audit.id}">Reabrir</button>` : ""}`,
  });
  const sections = [...new Set(items.map(areaName))];
  const linked = db.rows("findings").filter((f) => f.audit_id === audit.id);
  root.innerHTML = `<div class="grid cols-main" style="align-items:start">
    <div class="panel"><div class="panel-head"><h2>Checklist</h2>${badge(AUDIT_STATUS, st)}</div><div class="panel-body">
      ${!form ? empty("Sin formato", "Asigna un formato en “Programación” para poder ejecutar la auditoría.", "form")
        : !items.length ? empty("El formato no tiene preguntas", "Agrega preguntas en la pestaña Formatos.", "form")
        : sections.map((s) => `<div class="check-section">${esc(s)}</div>${items.filter((i) => areaName(i) === s).map((i) => questionHTML(i, locked, audit)).join("")}`).join("")}
    </div>${!locked && items.length ? `<div class="dialog-foot"><button class="btn" data-action="au-save" data-id="${audit.id}">Guardar avance</button><button class="btn primary" data-action="au-finish" data-id="${audit.id}">Finalizar auditoría</button></div>` : ""}</div>
    <div class="stack">
      <div class="panel"><div class="panel-body" id="au-progress">${audit.status === "completada" ? `<div class="score-ring"><strong>${audit.score != null ? Number(audit.score).toFixed(0) + "%" : "—"}</strong><div><div class="eyebrow">Resultado final</div><div class="muted">Completada ${fmtDateTime(audit.completed_at)}</div></div></div>` : progressHTML(items)}</div></div>
      <div class="panel"><div class="panel-head"><h2>Datos</h2></div><div class="panel-body"><dl class="detail-grid">
        <div><dt>Fecha</dt><dd>${fmtDate(audit.scheduled_date)}</dd></div><div><dt>Nivel</dt><dd>${esc(levelLabel(audit.level))}</dd></div>
        <div><dt>Asignado a</dt><dd>${esc(db.profileName(audit.assigned_to))}</dd></div><div><dt>Límite</dt><dd>${fmtDateTime(audit.due_at)}</dd></div>
        ${audit.notes ? `<div class="span-2"><dt>Notas</dt><dd>${esc(audit.notes)}</dd></div>` : ""}</dl></div></div>
      <div class="panel"><div class="panel-body">${attachmentsSection("audit", audit.id, { title: "Evidencias generales", canEdit: audit.status !== "cancelada" })}</div></div>
      <div class="panel"><div class="panel-head"><h2>Hallazgos generados</h2><small>${linked.length}</small></div><div class="panel-body">
        ${linked.length ? linked.map((f) => `<div class="item-row"><div><a class="mono" href="${H("hallazgos/" + f.id)}">${esc(f.code)}</a><div style="margin-top:4px">${esc(f.title)}</div></div>${classBadge(f)}</div>`).join("") : '<span class="muted">Aún no se han generado hallazgos.</span>'}</div></div>
    </div></div>`;
}

async function saveAnswers(audit) {
  const rowsToSave = Object.entries(draft.answers).filter(([, a]) => a.result).map(([item_id, a]) => ({ audit_id: audit.id, item_id, result: a.result, comment: a.comment || null, class_id: a.class_id || null, finding_id: a.finding_id || null }));
  await db.upsertMany("audit_answers", rowsToSave, ["audit_id", "item_id"]);
}

hooks.audit = () => rerender();


/* -------------------------------- Pestañas del módulo ----------------------------- */
export { renderPlanes, renderLista };
export const renderPlan = (root, params) => calendarView(root, params[0]);
export const renderAudit = (root, params) => auditView(root, params[0]);

/* -------------------------------- Eventos ---------------------------- */
const curPlan = () => db.get("audit_plans", currentPlanId);
on("au-plan-new", planWizard);
on("au-plan-open", (el) => navigate(`${wsId()}/plan/${el.dataset.id}`));
on("au-open", (el) => navigate(`${wsId()}/audit/${el.dataset.id}`));
on("au-add", (el) => scheduleForm(null, curPlan(), el.dataset.date));
on("au-slot", (el) => { const a = db.get("audits", el.dataset.id); db.can.write ? scheduleForm(a, curPlan()) : navigate(`${wsId()}/audit/${a.id}`); });
on("au-edit", (el) => { const a = db.get("audits", el.dataset.id); scheduleForm(a, db.get("audit_plans", a.plan_id)); });
on("au-plan-edit", (el) => editPlan(db.get("audit_plans", el.dataset.id)));
on("au-bulk", (el) => bulkAssign(db.get("audit_plans", el.dataset.id)));
on("au-send", (el) => sendPlan(db.get("audit_plans", el.dataset.id)));
on("au-export", async (el) => {
  try { toast("Generando PDF…"); const { downloadPlanPDF } = await import("../pdf.js"); await downloadPlanPDF(el.dataset.id); toast("PDF descargado", "ok"); }
  catch (e) { toast(e.message, "danger"); }
});
on("au-reopen", async (el) => { await db.update("audits", el.dataset.id, { status: "en_proceso", completed_at: null }); toast("Auditoría reabierta"); rerender(); });
onChange("au-filter", (el) => { F[el.dataset.key] = el.value; rerender(); });
onInput("au-q", (el) => { F.q = el.value; const pos = el.selectionStart; rerender().then(() => { const i = document.getElementById("au-q"); i?.focus(); i?.setSelectionRange(pos, pos); }); });

function refreshProgress() {
  const audit = db.get("audits", draft.auditId), items = itemsOf(audit.form_id);
  const el = document.getElementById("au-progress");
  if (el) el.innerHTML = progressHTML(items);
}
const auditOfDraft = () => db.get("audits", draft.auditId);
const itemById = (id) => db.get("form_items", id);
on("au-ans", (el) => {
  const id = el.dataset.item, a = (draft.answers[id] ||= { result: "", comment: "", class_id: "" });
  a.result = a.result === el.dataset.v ? "" : el.dataset.v;
  const q = document.getElementById("q_" + id);
  q.dataset.result = a.result; q.classList.remove("q-error");
  q.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === a.result)));
  q.querySelector(".q-nok")?.classList.toggle("hidden", a.result !== "nok");
  const ta = q.querySelector("textarea"); if (ta) ta.placeholder = a.result === "nok" ? "Comentario obligatorio: describe lo encontrado (aunque adjuntes evidencia)" : "Comentario (opcional)";
  const h = document.getElementById("qh_" + id); if (h) h.innerHTML = nokHint(itemById(id), auditOfDraft(), a.class_id);
  refreshProgress();
});
onChange("au-class", (el) => {
  const id = el.dataset.item, a = (draft.answers[id] ||= { result: "nok", comment: "", class_id: "" });
  a.class_id = el.value; document.getElementById("q_" + id)?.classList.remove("q-error");
  const h = document.getElementById("qh_" + id); if (h) h.innerHTML = nokHint(itemById(id), auditOfDraft(), a.class_id);
});
onInput("au-comment", (el) => { (draft.answers[el.dataset.item] ||= { result: "", comment: "", class_id: "" }).comment = el.value; document.getElementById("q_" + el.dataset.item)?.classList.remove("q-error"); });

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
  const flag = (list, msg) => { list.forEach((i) => document.getElementById("q_" + i.id)?.classList.add("q-error")); toast(msg, "danger"); document.getElementById("q_" + list[0].id)?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const noComment = items.filter((i) => draft.answers[i.id].result === "nok" && !draft.answers[i.id].comment?.trim());
  if (noComment.length) return flag(noComment, "Cada pregunta que no cumple necesita un comentario, aunque tenga evidencia adjunta.");
  const noClass = items.filter((i) => draft.answers[i.id].result === "nok" && !draft.answers[i.id].class_id);
  if (noClass.length) return flag(noClass, "Selecciona la clasificación en cada pregunta que no cumple.");
  const noks = items.filter((i) => draft.answers[i.id].result === "nok" && !draft.answers[i.id].finding_id);
  if (!(await confirmDialog({ title: "Finalizar auditoría", message: `Se calculará el resultado y se generarán ${noks.length} hallazgo(s) por los puntos que no cumplen, con su plazo en días hábiles y su responsable. Después no podrás editar las respuestas.`, confirmLabel: "Finalizar" }))) return;
  try {
    const day = today();
    for (const it of noks) {
      const ans = draft.answers[it.id], cls = db.get("finding_classes", ans.class_id);
      const f = await db.insert("findings", {
        title: `${audit.code} · ${it.question.replace(/[¿?]/g, "").trim()}`.slice(0, 160) + " (No cumple)", description: ans.comment,
        source: "auditoria", module: planWs(db.get("audit_plans", audit.plan_id)), class_id: ans.class_id, area_id: it.area_id || null, area: db.get("areas", it.area_id)?.name || null,
        audit_id: audit.id, owner_id: resolveOwner(it.area_id, audit.level), start_date: day, due_date: dueFor(cls.id, day), status: "abierto",
      });
      ans.finding_id = f.id;
    }
    await saveAnswers(audit);
    const ok = items.filter((i) => draft.answers[i.id].result === "ok").length, nok = items.filter((i) => draft.answers[i.id].result === "nok").length;
    await db.update("audits", audit.id, { status: "completada", completed_at: new Date().toISOString(), score: ok + nok ? Math.round((ok / (ok + nok)) * 10000) / 100 : null });
    draft = null;
    toast(`Auditoría finalizada${noks.length ? ` · ${noks.length} hallazgo(s) generados` : ""}`, "ok");
    rerender();
  } catch (e) { toast(e.message, "danger"); }
});
