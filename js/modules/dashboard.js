import * as db from "../db.js";
import { esc, today, addDays, fmtDate, timeAgo, dueText, MONTHS_LONG, isoDate } from "../utils.js";
import { icon } from "../icons.js";
import { setHead } from "../router.js";
import { badge, donut, bars, columns, empty } from "../ui.js";
import { AUDIT_STATUS, FINDING_STATUS } from "../constants.js";
import { classes, classTag, classTone, classOf, classBadge, overdueKind, stageOf, STAGE_LABEL } from "../workflow.js";
import { auditStatus } from "./audits.js";
import { WS_LABEL, auditWs, findingWs, auditsOf, plansOf, findingsOf, lateActionsOf, lateVerifyOf } from "../scope.js";

const kpi = (label, value, sub, { tone = "", href = "" } = {}) =>
  `<${href ? `a href="${href}"` : "div"} class="kpi" data-tone="${tone}"><label>${esc(label)}</label><strong>${value}</strong><small>${sub}</small></${href ? "a" : "div"}>`;

/** Tarjeta de módulo: 3 métricas y acceso directo a su portal */
const modCard = (title, href, metrics, note = "") =>
  `<a class="panel mod-card" href="${href}"><div class="panel-head"><h2>${esc(title)}</h2><span class="mod-go">Abrir ${icon("chevR")}</span></div>
   <div class="mod-metrics">${metrics.map(([l, v, tone]) => `<div class="mm" data-tone="${tone || ""}"><strong>${v}</strong><span>${esc(l)}</span></div>`).join("")}</div>${note ? `<div class="mod-note">${note}</div>` : ""}</a>`;

export default {
  id: "dashboard", label: "Dashboard", icon: "dashboard",
  render(root) {
    const t = today(), me = db.state.profile.id;
    setHead({ eyebrow: "GUVEL Quality", title: "Dashboard", subtitle: "Panorama general de todos los módulos. Entra a cada uno para trabajar en él." });

    const open = (ws) => findingsOf(ws).filter((f) => f.status !== "cerrado");
    const allOpen = [...open("auditorias"), ...open("internas"), ...open("issues")];
    const WSS = ["auditorias", "internas", "issues"];
    const lateA = WSS.flatMap(lateActionsOf), lateV = WSS.flatMap(lateVerifyOf), porAceptar = allOpen.filter((f) => f.status === "abierto");

    const monthKey = t.slice(0, 7);
    const auds = [...auditsOf("auditorias"), ...auditsOf("internas")].filter((a) => a.status !== "cancelada");
    const monthAud = auds.filter((a) => a.scheduled_date.startsWith(monthKey)), doneAud = monthAud.filter((a) => a.status === "completada");
    const pct = (ws) => { const m = auditsOf(ws).filter((a) => a.status !== "cancelada" && a.scheduled_date.startsWith(monthKey)); return m.length ? Math.round((m.filter((a) => a.status === "completada").length / m.length) * 100) : 0; };
    const compliance = monthAud.length ? Math.round((doneAud.length / monthAud.length) * 100) : 0;
    const scored = auds.filter((a) => a.status === "completada" && a.score != null);
    const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + Number(a.score), 0) / scored.length) : null;

    const notifs = db.rows("customer_notifications"), openN = notifs.filter((n) => n.status !== "cerrada"), lateN = openN.filter((n) => n.response_due && n.response_due < t);
    const risks = db.rows("risks").filter((r) => r.status !== "cerrado"), highR = risks.filter((r) => r.score >= 15);
    const opps = db.rows("opportunities"), activeO = opps.filter((o) => !["implementada", "descartada"].includes(o.status));

    const mine = auds.filter((a) => a.assigned_to === me && ["programada", "en_proceso"].includes(a.status)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    const minePanel = mine.length ? `<div class="panel"><div class="panel-head"><h2>Mis auditorías pendientes</h2><small>${mine.length} asignada(s) a ti</small></div><div class="table-wrap"><table class="table"><tbody>
      ${mine.slice(0, 5).map((a) => { const p = db.get("audit_plans", a.plan_id); return `<tr><td><a href="#/${auditWs(a)}/audit/${a.id}" class="code">${esc(a.code)}</a><span class="sub">${esc(p?.audit_type || "")}${a.level ? " · Nivel " + a.level : ""}</span></td><td>${esc(p?.name || "")}<span class="sub">${WS_LABEL[auditWs(a)]}</span></td><td>${fmtDate(a.scheduled_date)}</td><td>${badge(AUDIT_STATUS, auditStatus(a))}</td><td class="end"><a class="btn sm primary" href="#/${auditWs(a)}/audit/${a.id}">Realizar</a></td></tr>`; }).join("")}</tbody></table></div></div>` : "";

    const myF = allOpen.filter((f) => f.owner_id === me && ["abierto", "en_accion"].includes(stageOf(f)));
    const NEXT = { abierto: "Aceptar o trasladar", en_accion: "Registrar acción y evidencia" };
    const myFPanel = myF.length ? `<div class="panel"><div class="panel-head"><h2>Mis hallazgos pendientes</h2><small>${myF.length} a tu cargo</small></div><div class="table-wrap"><table class="table"><tbody>
      ${myF.slice(0, 6).map((f) => `<tr><td><a href="#/${findingWs(f)}/hallazgos/${f.id}" class="code">${esc(f.code)}</a><span class="sub">${WS_LABEL[findingWs(f)]}</span></td><td>${esc(f.title)}</td><td>${classBadge(f)}</td><td><b>${NEXT[stageOf(f)]}</b><span class="sub">${esc(STAGE_LABEL[stageOf(f)])} · límite ${fmtDate(f.due_date)}</span></td><td class="end"><a class="btn sm primary" href="#/${findingWs(f)}/hallazgos/${f.id}">Abrir</a></td></tr>`).join("")}</tbody></table></div></div>` : "";

    /* Tendencia: hallazgos nuevos por mes */
    const all = db.rows("findings");
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d; });
    const trend = months.map((d) => { const key = isoDate(d).slice(0, 7); return { label: MONTHS_LONG[d.getMonth()].slice(0, 3), value: all.filter((f) => (f.created_at || "").slice(0, 7) === key).length }; });

    const upcoming = auds.filter((a) => ["programada", "en_proceso"].includes(a.status) && a.scheduled_date >= t).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 5);
    const due = allOpen.filter((f) => overdueKind(f)).map((f) => {
      const verif = overdueKind(f) === "verificacion";
      return { k: `${WS_LABEL[findingWs(f)]} · ${verif ? "Verificación" : "Cierre de acciones"}`, code: f.code, text: f.title, date: verif ? f.verify_due : f.due_date, to: `${findingWs(f)}/hallazgos/${f.id}` };
    }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
    const activity = [
      ...all.map((r) => ({ at: r.updated_at || r.created_at, text: `${WS_LABEL[findingWs(r)]} · Hallazgo ${r.code} · ${r.title}`, to: `${findingWs(r)}/hallazgos/${r.id}` })),
      ...notifs.map((r) => ({ at: r.updated_at || r.created_at, text: `Issues · ${r.code} · ${r.subject}`, to: `issues/notificaciones/${r.id}` })),
    ].filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

    const livePlans = (ws) => plansOf(ws).filter((p) => p.end_date >= t).length;
    root.innerHTML = `
    <div class="stack">
      ${minePanel}
      ${myFPanel}
      <div class="kpi-strip">
        ${kpi("Hallazgos abiertos", allOpen.length, `${porAceptar.length} por aceptar · todos los módulos`, { tone: porAceptar.length ? "warn" : "info" })}
        ${kpi("Acciones vencidas", lateA.length, "Plazo de cierre en días hábiles superado", { tone: lateA.length ? "danger" : "ok" })}
        ${kpi("Verificaciones vencidas", lateV.length, "Pendientes de verificar fuera de plazo", { tone: lateV.length ? "danger" : "ok" })}
        ${kpi("Cumplimiento de auditorías", compliance + "%", `${doneAud.length} de ${monthAud.length} del mes`, { tone: !monthAud.length ? "" : compliance >= 90 ? "ok" : compliance >= 70 ? "warn" : "danger" })}
        ${kpi("Resultado promedio", avgScore == null ? "—" : avgScore + "%", `${scored.length} auditoría(s) evaluadas`, { tone: avgScore == null ? "" : avgScore >= 90 ? "ok" : "warn" })}
        ${kpi("Issues abiertos", openN.length, `${lateN.length} con respuesta vencida`, { tone: lateN.length ? "warn" : "info" })}
        ${kpi("Riesgos altos", highR.length, "Puntaje ≥ 15", { tone: highR.length ? "warn" : "ok" })}
        ${kpi("Oportunidades activas", activeO.length, `${opps.filter((o) => o.status === "implementada").length} implementada(s)`, { tone: "info" })}
      </div>

      <div class="mod-grid">
        ${modCard("Auditorías", "#/auditorias/planes", [["Planes vigentes", livePlans("auditorias")], ["Cumplimiento del mes", pct("auditorias") + "%", pct("auditorias") >= 90 ? "ok" : "warn"], ["Hallazgos abiertos", open("auditorias").length, open("auditorias").length ? "warn" : "ok"]], "LPA · Producto · Proceso · Sistema")}
        ${modCard("Auditorías Internas", "#/internas/planes", [["Planes vigentes", livePlans("internas")], ["Cumplimiento del mes", pct("internas") + "%", pct("internas") >= 90 ? "ok" : "warn"], ["Hallazgos abiertos", open("internas").length, open("internas").length ? "warn" : "ok"]], "Sistema de gestión")}
        ${modCard("Issues", "#/issues/notificaciones", [["Abiertos", openN.length, "info"], ["Respuesta vencida", lateN.length, lateN.length ? "danger" : "ok"], ["Hallazgos abiertos", open("issues").length, open("issues").length ? "warn" : "ok"]], "Notificaciones de calidad de clientes")}
        ${modCard("Riesgos", "#/riesgos", [["Activos", risks.length, "info"], ["Altos (≥15)", highR.length, highR.length ? "danger" : "ok"], ["En mitigación", risks.filter((r) => r.status === "mitigando").length]], "Matriz 5×5")}
        ${modCard("Oportunidades", "#/oportunidades", [["Activas", activeO.length, "info"], ["En ejecución", opps.filter((o) => o.status === "en_ejecucion").length], ["Implementadas", opps.filter((o) => o.status === "implementada").length, "ok"]], "Mejora continua")}
      </div>

      <div class="grid cols-3">
        <div class="panel"><div class="panel-head"><h2>Hallazgos abiertos por módulo</h2><small>Total ${allOpen.length}</small></div><div class="panel-body">
          ${bars([{ label: "Auditorías", value: open("auditorias").length, color: "var(--flow)" }, { label: "Internas", value: open("internas").length, color: "var(--watch)" }, { label: "Issues", value: open("issues").length, color: "var(--stop)" }])}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Clasificación</h2><small>Hallazgos abiertos</small></div><div class="panel-body">
          ${donut([...classes().map((c) => ({ label: classTag(c), color: { danger: "var(--stop)", warn: "var(--watch)", info: "var(--flow)" }[classTone(c)], value: allOpen.filter((f) => f.class_id === c.id).length })), { label: "Sin clasificar", color: "var(--idle)", value: allOpen.filter((f) => !classOf(f)).length }].filter((x) => x.value || x.label !== "Sin clasificar"), "Abiertos")}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Hallazgos nuevos</h2><small>Últimos 6 meses</small></div><div class="panel-body">${columns(trend)}</div></div>
      </div>

      <div class="grid cols-2">
        <div class="panel"><div class="panel-head"><h2>Vencimientos críticos</h2></div>
          ${due.length ? `<div class="table-wrap"><table class="table"><tbody>${due.map((d) => `<tr><td><a href="#/${d.to}" class="code">${esc(d.code)}</a><span class="sub">${esc(d.k)}</span></td><td>${esc(d.text)}</td><td class="end overdue">${dueText(d.date).text}</td></tr>`).join("")}</tbody></table></div>` : empty("Todo al día", "No hay elementos vencidos.", "check")}
        </div>
        <div class="panel"><div class="panel-head"><h2>Próximas auditorías</h2></div>
          ${upcoming.length ? `<div class="table-wrap"><table class="table"><tbody>${upcoming.map((a) => { const p = db.get("audit_plans", a.plan_id); return `<tr><td><a href="#/${auditWs(a)}/audit/${a.id}" class="code">${esc(a.code)}</a><span class="sub">${esc(p?.audit_type || "")}</span></td><td>${esc(db.profileName(a.assigned_to))}<span class="sub">${WS_LABEL[auditWs(a)]}</span></td><td>${fmtDate(a.scheduled_date)}</td><td class="end">${badge(AUDIT_STATUS, auditStatus(a))}</td></tr>`; }).join("")}</tbody></table></div>` : empty("Sin auditorías próximas", "Crea un plan en el módulo de Auditorías.", "calendar")}
        </div>
      </div>

      <div class="panel"><div class="panel-head"><h2>Actividad reciente</h2></div><div class="panel-body">
        ${activity.length ? `<ul class="timeline">${activity.map((a) => `<li><a href="#/${a.to}">${esc(a.text)}</a><time>${timeAgo(a.at)}</time></li>`).join("")}</ul>` : empty("Sin actividad", "Aún no hay registros.")}
      </div></div>
    </div>`;
  },
};
