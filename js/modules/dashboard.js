import * as db from "../db.js";
import { esc, today, addDays, fmtDate, timeAgo, dueText, MONTHS_LONG, isoDate } from "../utils.js";
import { icon } from "../icons.js";
import { setHead } from "../router.js";
import { badge, donut, bars, columns, empty } from "../ui.js";
import { SEVERITY, SEVERITY_COLOR, FINDING_STATUS, FINDING_FLOW, AUDIT_STATUS } from "../constants.js";
import { auditStatus } from "./audits.js";

const kpi = (label, value, sub, { tone = "", href = "" } = {}) =>
  `<${href ? `a href="${href}"` : "div"} class="kpi" data-tone="${tone}"><label>${esc(label)}</label><strong>${value}</strong><small>${sub}</small></${href ? "a" : "div"}>`;

export default {
  id: "dashboard", label: "Dashboard", icon: "dashboard",
  render(root) {
    const t = today();
    setHead({ eyebrow: "Quality Management Platform", title: "Dashboard", subtitle: "Resumen operativo de calidad: hallazgos, auditorías, acciones y clientes." });

    const findings = db.rows("findings");
    const openF = findings.filter((f) => f.status !== "cerrado");
    const overdueF = openF.filter((f) => f.due_date && f.due_date < t);
    const critF = openF.filter((f) => f.severity === "critico");

    const monthStart = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const monthEnd = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
    const monthAud = db.rows("audits").filter((a) => a.scheduled_date >= monthStart && a.scheduled_date <= monthEnd && a.status !== "cancelada");
    const doneAud = monthAud.filter((a) => a.status === "completada");
    const compliance = monthAud.length ? Math.round((doneAud.length / monthAud.length) * 100) : 0;
    const scored = db.rows("audits").filter((a) => a.status === "completada" && a.score != null);
    const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + Number(a.score), 0) / scored.length) : null;

    const openN = db.rows("customer_notifications").filter((n) => n.status !== "cerrada");
    const lateN = openN.filter((n) => n.response_due && n.response_due < t);
    const lateA = db.rows("actions").filter((a) => !["completada", "verificada"].includes(a.status) && a.due_date && a.due_date < t);
    const highR = db.rows("risks").filter((r) => r.status !== "cerrado" && r.score >= 15);

    /* Tendencia: auditorías completadas y hallazgos por mes (6 meses) */
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d; });
    const trend = months.map((d) => {
      const key = isoDate(d).slice(0, 7);
      return { label: MONTHS_LONG[d.getMonth()].slice(0, 3), value: findings.filter((f) => (f.created_at || "").slice(0, 7) === key).length };
    });

    const upcoming = db.rows("audits").filter((a) => ["programada", "en_proceso"].includes(a.status) && a.scheduled_date >= t).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 5);

    const due = [
      ...overdueF.map((f) => ({ k: "Hallazgo", code: f.code, text: f.title, date: f.due_date, to: `findings/${f.id}` })),
      ...lateA.map((a) => ({ k: "Acción", code: a.code, text: a.description, date: a.due_date, to: `findings/${a.finding_id}` })),
      ...lateN.map((n) => ({ k: "Cliente", code: n.code, text: n.subject, date: n.response_due, to: `notifications/${n.id}` })),
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);

    const activity = [
      ...findings.map((r) => ({ at: r.updated_at || r.created_at, text: `Hallazgo ${r.code} · ${r.title}`, to: `findings/${r.id}` })),
      ...db.rows("customer_notifications").map((r) => ({ at: r.updated_at || r.created_at, text: `Cliente ${r.code} · ${r.subject}`, to: `notifications/${r.id}` })),
      ...db.rows("actions").map((r) => ({ at: r.updated_at || r.created_at, text: `Acción ${r.code} · ${r.description}`, to: `findings/${r.finding_id}` })),
    ].filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

    root.innerHTML = `
    <div class="stack">
      <div class="grid cols-4">
        ${kpi("Hallazgos abiertos", openF.length, `${critF.length} crítico(s)`, { href: "#/findings", tone: critF.length ? "danger" : "" })}
        ${kpi("Hallazgos vencidos", overdueF.length, "Fecha compromiso superada", { href: "#/findings", tone: overdueF.length ? "danger" : "ok" })}
        ${kpi("Cumplimiento de auditorías", compliance + "%", `${doneAud.length} de ${monthAud.length} del mes`, { href: "#/audits", tone: compliance >= 90 ? "ok" : compliance >= 70 ? "warn" : "danger" })}
        ${kpi("Resultado promedio", avgScore == null ? "—" : avgScore + "%", `${scored.length} auditoría(s) evaluadas`, { href: "#/audits", tone: avgScore == null ? "" : avgScore >= 90 ? "ok" : "warn" })}
        ${kpi("Notificaciones de cliente", openN.length, `${lateN.length} con respuesta vencida`, { href: "#/notifications", tone: lateN.length ? "warn" : "" })}
        ${kpi("Acciones vencidas", lateA.length, "Pendientes fuera de fecha", { href: "#/actions", tone: lateA.length ? "danger" : "ok" })}
        ${kpi("Riesgos altos", highR.length, "Puntaje ≥ 15 (probabilidad × impacto)", { href: "#/risks", tone: highR.length ? "warn" : "ok" })}
        ${kpi("Cerrados (30 días)", findings.filter((f) => f.closed_at && f.closed_at >= addDays(t, -30)).length, "Hallazgos cerrados", { href: "#/findings", tone: "ok" })}
      </div>

      <div class="grid cols-3">
        <div class="panel"><div class="panel-head"><h2>Hallazgos por severidad</h2><small>Abiertos</small></div><div class="panel-body">
          ${donut(Object.entries(SEVERITY).map(([k, [label]]) => ({ label, color: SEVERITY_COLOR[k], value: openF.filter((f) => f.severity === k).length })), "Abiertos")}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Flujo de hallazgos</h2><small>Por estado</small></div><div class="panel-body">
          ${bars(FINDING_FLOW.map((s) => ({ label: FINDING_STATUS[s][0], value: findings.filter((f) => f.status === s).length, color: s === "cerrado" ? "var(--ok)" : s === "abierto" ? "var(--danger)" : "var(--g-cyan)" })))}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Hallazgos nuevos</h2><small>Últimos 6 meses</small></div><div class="panel-body">${columns(trend)}</div></div>
      </div>

      <div class="grid cols-2">
        <div class="panel"><div class="panel-head"><h2>Vencimientos críticos</h2><a href="#/findings" class="btn sm ghost">Ver hallazgos</a></div>
          ${due.length ? `<div class="table-wrap"><table class="table"><tbody>${due.map((d) => `<tr><td><a href="#/${d.to}" class="code mono">${esc(d.code)}</a><span class="sub">${d.k}</span></td><td>${esc(d.text)}</td><td class="end overdue">${dueText(d.date).text}</td></tr>`).join("")}</tbody></table></div>` : empty("Todo al día", "No hay elementos vencidos.", "check")}
        </div>
        <div class="panel"><div class="panel-head"><h2>Próximas auditorías</h2><a href="#/audits" class="btn sm ghost">Ver auditorías</a></div>
          ${upcoming.length ? `<div class="table-wrap"><table class="table"><tbody>${upcoming.map((a) => { const p = db.get("audit_plans", a.plan_id); return `<tr><td><a href="#/audits/${a.id}" class="code mono">${esc(a.code)}</a><span class="sub">${esc(p?.audit_type || "")}</span></td><td>${esc(db.profileName(a.assigned_to))}</td><td>${fmtDate(a.scheduled_date)}</td><td class="end">${badge(AUDIT_STATUS, auditStatus(a))}</td></tr>`; }).join("")}</tbody></table></div>` : empty("Sin auditorías próximas", "Crea un plan en el módulo de Auditorías.", "calendar")}
        </div>
      </div>

      <div class="panel"><div class="panel-head"><h2>Actividad reciente</h2></div><div class="panel-body">
        ${activity.length ? `<ul class="timeline">${activity.map((a) => `<li><a href="#/${a.to}">${esc(a.text)}</a><time>${timeAgo(a.at)}</time></li>`).join("")}</ul>` : empty("Sin actividad", "Aún no hay registros.")}
      </div></div>
    </div>`;
  },
};
