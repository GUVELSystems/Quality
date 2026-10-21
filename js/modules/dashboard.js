import * as db from "../db.js";
import { esc, today, addDays, fmtDate, dueText, MONTHS_LONG, isoDate } from "../utils.js";
import { icon } from "../icons.js";
import { setHead } from "../router.js";
import { badge, donut, bars, columns, empty } from "../ui.js";
import { AUDIT_STATUS, FINDING_STATUS } from "../constants.js";
import { classes, classTag, classTone, classOf, classBadge, overdueKind, stageOf, isInternal, STAGE_LABEL, STAGE_LABEL_INTERNAL } from "../workflow.js";
import { auditStatus } from "./audits.js";
import { WS_LABEL, auditWs, findingWs, auditsOf, plansOf, findingsOf, lateActionsOf, lateVerifyOf } from "../scope.js";
import { t as tr } from "../i18n.js";

const kpi = (label, value, sub, { tone = "", href = "" } = {}) =>
  `<${href ? `a href="${href}"` : "div"} class="kpi" data-tone="${tone}"><label>${esc(label)}</label><strong>${value}</strong><small>${sub}</small></${href ? "a" : "div"}>`;

/** Tarjeta de módulo: 3 métricas y acceso directo a su portal */
const modCard = (title, href, metrics, note = "") =>
  `<a class="panel mod-card" href="${href}"><div class="panel-head"><h2>${esc(title)}</h2><span class="mod-go">${tr("open")} ${icon("chevR")}</span></div>
   <div class="mod-metrics">${metrics.map(([l, v, tone]) => `<div class="mm" data-tone="${tone || ""}"><strong>${v}</strong><span>${esc(l)}</span></div>`).join("")}</div>${note ? `<div class="mod-note">${note}</div>` : ""}</a>`;

export default {
  id: "dashboard", label: "Dashboard", icon: "dashboard",
  render(root) {
    const t = today(), me = db.state.profile.id;
    setHead({ eyebrow: "GUVEL Quality", title: "Dashboard", subtitle: tr("dashboardSubtitle") });

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

    const notifs = db.rows("customer_notifications"), openN = notifs.filter((n) => db.get("findings", n.finding_id)?.status !== "cerrado"), lateN = openN.filter((n) => n.response_due && n.response_due < t);
    const risks = db.rows("risks").filter((r) => r.status !== "cerrado"), highR = risks.filter((r) => r.score >= 15);
    const opps = db.rows("opportunities"), activeO = opps.filter((o) => !["implementada", "descartada"].includes(o.status));

    const mine = auds.filter((a) => a.assigned_to === me && ["programada", "en_proceso"].includes(a.status)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    const minePanel = mine.length ? `<div class="panel"><div class="panel-head"><h2>${tr("myPendingAudits")}</h2><small>${mine.length} ${tr("assignedToYou")}</small></div><div class="table-wrap"><table class="table"><tbody>
      ${mine.slice(0, 5).map((a) => { const p = db.get("audit_plans", a.plan_id); return `<tr><td><a href="#/${auditWs(a)}/audit/${a.id}" class="code">${esc(a.code)}</a><span class="sub">${esc(p?.audit_type || "")}${a.level ? ` · ${tr("level")} ` + a.level : ""}</span></td><td>${esc(p?.name || "")}<span class="sub">${WS_LABEL[auditWs(a)]}</span></td><td>${fmtDate(a.scheduled_date)}</td><td>${badge(AUDIT_STATUS, auditStatus(a))}</td><td class="end"><a class="btn sm primary" href="#/${auditWs(a)}/audit/${a.id}">${tr("perform")}</a></td></tr>`; }).join("")}</tbody></table></div></div>` : "";

    const OWNER_STAGES = { generic: ["abierto", "en_accion"], internal: ["abierto", "descripcion", "contencion", "rca", "en_accion"] };
    const myF = allOpen.filter((f) => f.owner_id === me && OWNER_STAGES[isInternal(f) ? "internal" : "generic"].includes(stageOf(f)));
    const NEXT = { abierto: tr("acceptOrTransfer"), descripcion: tr("describeProblem"), contencion: tr("registerContainment"), rca: tr("rootCauseAnalysis"), en_accion: tr("registerActionEvidence") };
    const myFPanel = myF.length ? `<div class="panel"><div class="panel-head"><h2>${tr("myPendingFindings")}</h2><small>${myF.length} ${tr("yourCharge")}</small></div><div class="table-wrap"><table class="table"><tbody>
      ${myF.slice(0, 6).map((f) => `<tr><td><a href="#/${findingWs(f)}/hallazgos/${f.id}" class="code">${esc(f.code)}</a><span class="sub">${WS_LABEL[findingWs(f)]}</span></td><td>${esc(f.title)}</td><td>${classBadge(f)}</td><td><b>${NEXT[stageOf(f)]}</b><span class="sub">${esc((isInternal(f) ? STAGE_LABEL_INTERNAL : STAGE_LABEL)[stageOf(f)])} · ${tr("deadline")} ${fmtDate(f.due_date)}</span></td><td class="end"><a class="btn sm primary" href="#/${findingWs(f)}/hallazgos/${f.id}">${tr("open")}</a></td></tr>`).join("")}</tbody></table></div></div>` : "";

    /* Tendencia: hallazgos nuevos por mes */
    const all = db.rows("findings");
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d; });
    const trend = months.map((d) => { const key = isoDate(d).slice(0, 7); return { label: MONTHS_LONG[d.getMonth()].slice(0, 3), value: all.filter((f) => (f.created_at || "").slice(0, 7) === key).length }; });

    const upcoming = auds.filter((a) => ["programada", "en_proceso"].includes(a.status) && a.scheduled_date >= t).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 5);
    const due = allOpen.filter((f) => overdueKind(f)).map((f) => {
      const verif = overdueKind(f) === "verificacion";
      return { k: `${WS_LABEL[findingWs(f)]} · ${verif ? tr("verification") : tr("closureOfActions")}`, code: f.code, text: f.title, date: verif ? f.verify_due : f.due_date, to: `${findingWs(f)}/hallazgos/${f.id}` };
    }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
    const livePlans = (ws) => plansOf(ws).filter((p) => p.end_date >= t).length;
    root.innerHTML = `
    <div class="stack">
      ${minePanel}
      ${myFPanel}
      <div class="kpi-strip">
        ${kpi(tr("openFindings"), allOpen.length, `${porAceptar.length} ${tr("toAccept")}`, { tone: porAceptar.length ? "warn" : "info" })}
        ${kpi(tr("overdueActions"), lateA.length, tr("overdueActionsDesc"), { tone: lateA.length ? "danger" : "ok" })}
        ${kpi(tr("overdueVerifications"), lateV.length, tr("overdueVerificationsDesc"), { tone: lateV.length ? "danger" : "ok" })}
        ${kpi(tr("auditCompliance"), compliance + "%", `${doneAud.length} ${tr("ofPrep")} ${monthAud.length} ${tr("ofTheMonth")}`, { tone: !monthAud.length ? "" : compliance >= 90 ? "ok" : compliance >= 70 ? "warn" : "danger" })}
        ${kpi(tr("avgScore"), avgScore == null ? "—" : avgScore + "%", `${scored.length} ${tr("auditsEvaluated")}`, { tone: avgScore == null ? "" : avgScore >= 90 ? "ok" : "warn" })}
        ${kpi(tr("openIssues"), openN.length, `${lateN.length} ${tr("lateResponse")}`, { tone: lateN.length ? "warn" : "info" })}
        ${kpi(tr("highRisks"), highR.length, tr("scoreAtLeast"), { tone: highR.length ? "warn" : "ok" })}
        ${kpi(tr("activeOpportunities"), activeO.length, `${opps.filter((o) => o.status === "implementada").length} ${tr("implemented")}`, { tone: "info" })}
      </div>

      <div class="mod-grid">
        ${modCard(WS_LABEL.auditorias, "#/auditorias/planes", [[tr("livePlans"), livePlans("auditorias")], [tr("monthCompliance"), pct("auditorias") + "%", pct("auditorias") >= 90 ? "ok" : "warn"], [tr("openFindingsShort"), open("auditorias").length, open("auditorias").length ? "warn" : "ok"]], tr("lpaProdProcSys"))}
        ${modCard(WS_LABEL.internas, "#/internas/planes", [[tr("livePlans"), livePlans("internas")], [tr("monthCompliance"), pct("internas") + "%", pct("internas") >= 90 ? "ok" : "warn"], [tr("openFindingsShort"), open("internas").length, open("internas").length ? "warn" : "ok"]], tr("mgmtSystem"))}
        ${modCard(WS_LABEL.issues, "#/issues/notificaciones", [[tr("openLabel"), openN.length, "info"], [tr("overdueResponse"), lateN.length, lateN.length ? "danger" : "ok"], [tr("openFindingsShort"), open("issues").length, open("issues").length ? "warn" : "ok"]], tr("customerQualityNotifs"))}
        ${modCard(WS_LABEL.riesgos, "#/riesgos", [[tr("active"), risks.length, "info"], [tr("highGte15"), highR.length, highR.length ? "danger" : "ok"], [tr("mitigating"), risks.filter((r) => r.status === "mitigando").length]], tr("fiveByFive"))}
        ${modCard(WS_LABEL.oportunidades, "#/oportunidades", [[tr("activeLabel"), activeO.length, "info"], [tr("inProgressLabel"), opps.filter((o) => o.status === "en_ejecucion").length], [tr("implementedLabel"), opps.filter((o) => o.status === "implementada").length, "ok"]], tr("continuousImprovement"))}
      </div>

      <div class="grid cols-3">
        <div class="panel"><div class="panel-head"><h2>${tr("openFindingsByModule")}</h2><small>${tr("total")} ${allOpen.length}</small></div><div class="panel-body">
          ${bars([{ label: WS_LABEL.auditorias, value: open("auditorias").length, color: "var(--flow)" }, { label: WS_LABEL.internas, value: open("internas").length, color: "var(--watch)" }, { label: WS_LABEL.issues, value: open("issues").length, color: "var(--stop)" }])}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>${tr("classification")}</h2><small>${tr("openFindingsShort")}</small></div><div class="panel-body">
          ${donut([...classes().map((c) => ({ label: classTag(c), color: { danger: "var(--stop)", warn: "var(--watch)", info: "var(--flow)" }[classTone(c)], value: allOpen.filter((f) => f.class_id === c.id).length })), { label: tr("unclassified"), color: "var(--idle)", value: allOpen.filter((f) => !classOf(f)).length }].filter((x) => x.value || x.label !== tr("unclassified")), tr("openFindingsShort"))}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>${tr("newFindings")}</h2><small>${tr("last6Months")}</small></div><div class="panel-body">${columns(trend)}</div></div>
      </div>

      <div class="grid cols-2">
        <div class="panel"><div class="panel-head"><h2>${tr("criticalDeadlines")}</h2></div>
          ${due.length ? `<div class="table-wrap"><table class="table"><tbody>${due.map((d) => `<tr><td><a href="#/${d.to}" class="code">${esc(d.code)}</a><span class="sub">${esc(d.k)}</span></td><td>${esc(d.text)}</td><td class="end overdue">${dueText(d.date).text}</td></tr>`).join("")}</tbody></table></div>` : empty(tr("allUpToDate"), tr("noOverdueItems"), "check")}
        </div>
        <div class="panel"><div class="panel-head"><h2>${tr("upcomingAudits")}</h2></div>
          ${upcoming.length ? `<div class="table-wrap"><table class="table"><tbody>${upcoming.map((a) => { const p = db.get("audit_plans", a.plan_id); return `<tr><td><a href="#/${auditWs(a)}/audit/${a.id}" class="code">${esc(a.code)}</a><span class="sub">${esc(p?.audit_type || "")}</span></td><td>${esc(db.profileName(a.assigned_to))}<span class="sub">${WS_LABEL[auditWs(a)]}</span></td><td>${fmtDate(a.scheduled_date)}</td><td class="end">${badge(AUDIT_STATUS, auditStatus(a))}</td></tr>`; }).join("")}</tbody></table></div>` : empty(tr("noUpcomingAudits"), tr("createPlanHint"), "calendar")}
        </div>
      </div>
    </div>`;
  },
};
