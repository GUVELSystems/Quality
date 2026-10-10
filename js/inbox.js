/* =====================================================================
   Bandeja de notificaciones por usuario
   · Pendientes (calculados en vivo): auditorías asignadas, hallazgos por aceptar / cerrar / verificar,
     respuestas a clientes, riesgos y oportunidades a tu cargo.
   · Avisos guardados (tabla notifications): "se te asignó un hallazgo", rechazos, etc.
   Se agrupan por módulo: la campana muestra los módulos y, al abrir uno, sus pendientes.
   ===================================================================== */
import * as db from "./db.js";
import { esc, today, addDays, fmtDate, fmtDateTime, timeAgo } from "./utils.js";
import { icon } from "./icons.js";
import { on, openDialog, toast } from "./ui.js";
import { navigate } from "./router.js";
import { WS_LABEL, WS_ICON, auditWs, findingWs } from "./scope.js";
import { milestones, stageOf, levelLabel } from "./workflow.js";
import { auditStatus } from "./modules/audits.js";

export const INBOX_WS = ["auditorias", "internas", "issues", "riesgos", "oportunidades"];
const KIND_ICON = { audit: "audit", accept: "check2", close: "action", verify: "check2", reject: "close", client: "bell", risk: "risk", opp: "opportunity", notice: "bell" };

/** Todos los pendientes y avisos del usuario actual */
export function inboxItems() {
  const me = db.state.profile.id, t = today(), items = [], mark = (r) => items.push(r);
  const fWs = (f) => findingWs(f);

  for (const a of db.rows("audits")) {
    if (a.assigned_to !== me || !["programada", "en_proceso"].includes(a.status)) continue;
    const late = auditStatus(a) === "vencida", p = db.get("audit_plans", a.plan_id);
    mark({ ws: auditWs(a), kind: "audit", tone: late ? "danger" : a.scheduled_date <= t ? "warn" : "info", title: `Auditoría ${a.code}${late ? " · vencida" : ""}`, detail: `${p?.name || p?.audit_type || ""} · ${fmtDate(a.scheduled_date)}${a.level ? " · " + levelLabel(a.level) : ""}`, href: `${auditWs(a)}/audit/${a.id}`, at: a.scheduled_date, ref: a.id });
  }
  for (const f of db.rows("findings")) {
    const st = stageOf(f), { m1, m2 } = milestones(f), ws = fWs(f);
    if (f.owner_id === me && st === "abierto") {
      const rej = f.reject_count > 0;
      mark({ ws, kind: rej ? "reject" : "accept", tone: rej || m1.state === "overdue" ? "danger" : "warn", title: rej ? `Rechazado · corrige ${f.code}` : `Por aceptar · ${f.code}`, detail: `${f.title} · ${m1.text}`, href: `${ws}/hallazgos/${f.id}`, at: f.due_date || t, ref: f.id });
    } else if (f.owner_id === me && st === "en_accion") {
      mark({ ws, kind: "close", tone: m1.state === "overdue" ? "danger" : "info", title: `Cerrar acciones · ${f.code}`, detail: `${f.title} · ${m1.text}`, href: `${ws}/hallazgos/${f.id}`, at: f.due_date || t, ref: f.id });
    } else if (db.can.admin && st === "verificacion") {
      mark({ ws, kind: "verify", tone: m2?.state === "overdue" ? "danger" : "warn", title: `Verificar · ${f.code}`, detail: `${f.title} · ${m2?.text || ""}`, href: `${ws}/hallazgos/${f.id}`, at: f.verify_due || t, ref: f.id });
    }
  }
  for (const n of db.rows("customer_notifications")) {
    if (n.owner_id !== me || n.status === "cerrada") continue;
    const late = n.response_due && n.response_due < t;
    mark({ ws: "issues", kind: "client", tone: late ? "danger" : "warn", title: `Responder al cliente · ${n.code}`, detail: `${n.subject}${n.response_due ? " · límite " + fmtDate(n.response_due) : ""}`, href: `issues/notificaciones/${n.id}`, at: n.response_due || t, ref: n.id });
  }
  for (const r of db.rows("risks")) {
    if (r.owner_id !== me || r.status === "cerrado" || !r.review_date || r.review_date > addDays(t, 7)) continue;
    mark({ ws: "riesgos", kind: "risk", tone: r.review_date < t ? "danger" : "warn", title: `Revisar riesgo ${r.code}`, detail: `${r.title} · revisión ${fmtDate(r.review_date)}`, href: "riesgos", at: r.review_date, ref: r.id });
  }
  for (const o of db.rows("opportunities")) {
    if (o.owner_id !== me || ["implementada", "descartada"].includes(o.status) || !o.due_date || o.due_date >= t) continue;
    mark({ ws: "oportunidades", kind: "opp", tone: "danger", title: `Oportunidad vencida · ${o.code}`, detail: `${o.title} · objetivo ${fmtDate(o.due_date)}`, href: "oportunidades", at: o.due_date, ref: o.id });
  }

  // Avisos guardados sin leer: se fusionan con su pendiente (si existe) o se muestran solos
  for (const n of db.rows("notifications").filter((x) => x.user_id === me && !x.read_at)) {
    const twin = n.ref_id && items.find((i) => i.ref === n.ref_id);
    if (twin) { twin.nid = n.id; twin.isNew = true; twin.stamp = n.created_at; }
    else mark({ ws: n.module, kind: "notice", tone: n.kind === "finding_rejected" ? "danger" : "info", title: n.title, detail: n.body || "", href: n.href, at: (n.created_at || "").slice(0, 10), ref: n.ref_id, nid: n.id, isNew: true, stamp: n.created_at });
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  return items.sort((a, b) => (rank[a.tone] - rank[b.tone]) || String(a.at).localeCompare(String(b.at)));
}
export const inboxCounts = (items = inboxItems()) => {
  const by = Object.fromEntries(INBOX_WS.map((w) => [w, { n: 0, hot: 0, fresh: 0 }]));
  for (const i of items) { const b = (by[i.ws] ||= { n: 0, hot: 0, fresh: 0 }); b.n++; if (i.tone === "danger") b.hot++; if (i.isNew) b.fresh++; }
  return { by, total: items.length, hot: items.filter((i) => i.tone === "danger").length };
};

/* ---------------------------- Campana y panel ---------------------------- */
let view = null;                       // null = lista de módulos; "auditorias" = pendientes de ese módulo
export function updateBell() {
  const b = document.getElementById("bellBadge"); if (!b) return;
  const { total, hot } = inboxCounts();
  b.textContent = total > 99 ? "99+" : total; b.classList.toggle("hidden", !total); b.classList.toggle("hot", hot > 0);
}
function panelHTML() {
  const items = inboxItems(), c = inboxCounts(items);
  if (!view) {
    return `<div class="inbox-head"><div><strong>Notificaciones</strong><small>${c.total ? `${c.total} pendiente(s)${c.hot ? ` · ${c.hot} vencido(s)` : ""}` : "Todo al día"}</small></div></div>
      <div class="inbox-mods">${INBOX_WS.map((w) => { const b = c.by[w]; return `<button class="inbox-mod" data-action="inbox-ws" data-ws="${w}"><span class="im-ico">${icon(WS_ICON[w])}</span><span class="im-txt"><b>${esc(WS_LABEL[w])}</b><small>${b.n ? `${b.n} pendiente(s)${b.fresh ? ` · ${b.fresh} nuevo(s)` : ""}` : "Sin pendientes"}</small></span><span class="im-n ${b.hot ? "hot" : b.n ? "on" : ""}">${b.n}</span>${icon("chevR")}</button>`; }).join("")}</div>
      ${db.rows("notifications").some((n) => n.user_id === db.state.profile.id && !n.read_at) ? `<div class="inbox-foot"><button class="btn sm ghost" data-action="inbox-readall">Marcar avisos como leídos</button></div>` : ""}`;
  }
  const list = items.filter((i) => i.ws === view);
  return `<div class="inbox-head"><button class="btn sm ghost icon" data-action="inbox-back" aria-label="Volver">${icon("chevL")}</button><div><strong>${esc(WS_LABEL[view])}</strong><small>${list.length} pendiente(s)</small></div></div>
    <div class="inbox-list">${list.length ? list.map((i) => `<button class="inbox-item" data-tone="${i.tone}" data-action="inbox-go" data-href="${esc(i.href)}" data-nid="${i.nid || ""}"><span class="ii-ico">${icon(KIND_ICON[i.kind] || "bell")}</span><span class="ii-txt"><b>${esc(i.title)}</b>${i.isNew ? '<em>Nuevo</em>' : ""}<small>${esc(i.detail)}</small>${i.stamp ? `<time>${timeAgo(i.stamp)}</time>` : ""}</span></button>`).join("") : `<div class="empty" style="padding:32px 16px">${icon("check2")}<strong>Sin pendientes</strong>Nada por hacer en este módulo.</div>`}</div>`;
}
function paintPanel() { const p = document.getElementById("inbox"); if (p && !p.classList.contains("hidden")) p.innerHTML = panelHTML(); }
export function closeInbox() { document.getElementById("inbox")?.classList.add("hidden"); document.getElementById("bellBtn")?.setAttribute("aria-expanded", "false"); }

on("inbox-toggle", (el) => {
  const p = document.getElementById("inbox"); if (!p) return;
  const open = p.classList.contains("hidden");
  if (!open) return closeInbox();
  view = null; p.innerHTML = panelHTML(); p.classList.remove("hidden"); el.setAttribute("aria-expanded", "true");
  const r = el.getBoundingClientRect(); p.style.top = r.bottom + 6 + "px"; p.style.right = Math.max(8, innerWidth - r.right - 6) + "px";
});
on("inbox-ws", (el) => { view = el.dataset.ws; paintPanel(); });
on("inbox-back", () => { view = null; paintPanel(); });
on("inbox-go", async (el) => {
  const nid = el.dataset.nid, href = el.dataset.href;
  closeInbox();
  if (nid) { try { await db.update("notifications", nid, { read_at: new Date().toISOString() }); } catch { /* sin efecto */ } updateBell(); }
  if (href) navigate(href);
});
on("inbox-readall", async () => {
  const mine = db.rows("notifications").filter((n) => n.user_id === db.state.profile.id && !n.read_at);
  try { for (const n of mine) await db.update("notifications", n.id, { read_at: new Date().toISOString() }); toast("Avisos marcados como leídos", "ok"); } catch (e) { toast(e.message, "danger"); }
  paintPanel(); updateBell();
});
// composedPath() se calcula al despachar el clic: sigue válido aunque el panel se repinte durante el manejador
document.addEventListener("click", (e) => { if (!e.composedPath().some((n) => n.id === "inbox" || n.id === "bellBtn")) closeInbox(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInbox(); });

/* ----------------------- Recordatorio al entrar ----------------------- */
/** Ventana de recordatorios: una vez por sesión, si hay pendientes */
export function showReminder() {
  const key = `gq-reminder-${db.state.profile.id}`;
  if (sessionStorage.getItem(key)) return;
  const items = inboxItems(), c = inboxCounts(items);
  if (!c.total) return;
  sessionStorage.setItem(key, "1");
  const top = items.slice(0, 4);
  const dlg = openDialog({
    eyebrow: "Recordatorios", title: `Tienes ${c.total} pendiente${c.total === 1 ? "" : "s"}`, size: "sm",
    body: `${c.hot ? `<div class="alert" style="margin-bottom:14px"><b>${c.hot} vencido(s)</b> requieren tu atención.</div>` : ""}
      <div class="inbox-mods in-dialog">${INBOX_WS.filter((w) => c.by[w].n).map((w) => `<button class="inbox-mod" data-rem-ws="${w}"><span class="im-ico">${icon(WS_ICON[w])}</span><span class="im-txt"><b>${esc(WS_LABEL[w])}</b><small>${c.by[w].n} pendiente(s)</small></span><span class="im-n ${c.by[w].hot ? "hot" : "on"}">${c.by[w].n}</span></button>`).join("")}</div>
      <div class="section-title" style="margin-top:18px"><span>Lo más urgente</span></div>
      ${top.map((i) => `<div class="inbox-item static" data-tone="${i.tone}"><span class="ii-ico">${icon(KIND_ICON[i.kind] || "bell")}</span><span class="ii-txt"><b>${esc(i.title)}</b><small>${esc(i.detail)}</small></span></div>`).join("")}`,
    footer: `<button class="btn" data-close>Más tarde</button><button class="btn primary" id="rem-open">${icon("bell")} Ver mi bandeja</button>`,
  });
  dlg.el.querySelector("#rem-open").addEventListener("click", () => { dlg.close(); setTimeout(() => document.getElementById("bellBtn")?.click(), 60); });
  dlg.el.querySelectorAll("[data-rem-ws]").forEach((b) => b.addEventListener("click", () => { const w = b.dataset.remWs; dlg.close(); setTimeout(() => { document.getElementById("bellBtn")?.click(); view = w; paintPanel(); }, 60); }));
}
