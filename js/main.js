/* GUVEL Quality · punto de entrada */
import { CONFIG } from "./config.js";
import * as db from "./db.js";
import { esc, initials, today } from "./utils.js";
import { icon } from "./icons.js";
import { on, onInput, toast, confirmDialog } from "./ui.js";
import { register, getModules, renderRoute, onAfterRender, navigate } from "./router.js";
import { ROLES } from "./constants.js";

import dashboard from "./modules/dashboard.js";
import audits from "./modules/audits.js";
import findings from "./modules/findings.js";
import actions from "./modules/actions.js";
import notifications from "./modules/notifications.js";
import { risks, opportunities, clients, classifications, users } from "./modules/catalogs.js";
import forms from "./modules/forms.js";

[dashboard, audits, findings, actions, notifications, risks, opportunities, clients, classifications, forms, users].forEach(register);

const app = document.getElementById("app");
const GROUPS = [
  ["Operación", ["dashboard"]],
  ["Gestión de calidad", ["audits", "findings", "actions", "notifications"]],
  ["Riesgos y mejora", ["risks", "opportunities"]],
  ["Configuración", ["clients", "classifications", "forms", "users"]],
];

/* ------------------------------- Login ------------------------------- */
function showLogin(error = "") {
  app.innerHTML = `
  <div class="login">
    <section class="login-hero">
      <img src="assets/guvel-logo.png" alt="GUVEL">
      <div>
        <h1>GUVEL<em>Quality</em></h1>
        <p>Plataforma para gestionar auditorías, hallazgos, acciones y notificaciones de cliente en un solo lugar.</p>
        <ul><li>Auditorías y LPA con checklists configurables</li><li>Hallazgos con seguimiento hasta el cierre</li><li>Notificaciones de cliente con control de respuesta</li><li>Riesgos, oportunidades y tablero de indicadores</li></ul>
      </div>
      <small>Smarter Industrial Systems</small>
    </section>
    <section class="login-panel">
      <form class="login-card" id="loginForm" novalidate>
        <div><span class="eyebrow">Acceso</span><h2>Iniciar sesión</h2></div>
        ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ""}
        ${db.state.demo
          ? `<div class="note"><b>Modo demo.</b> Aún no se ha configurado Supabase; los datos de ejemplo se guardan solo en este navegador.</div>
             <button class="btn primary" type="submit">Entrar al modo demo</button>`
          : `<label class="field"><span>Correo</span><input class="input" type="email" name="email" autocomplete="username" required></label>
             <label class="field"><span>Contraseña</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
             <button class="btn primary" type="submit">Entrar</button>`}
      </form>
    </section>
  </div>`;
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button");
    btn.disabled = true;
    try { await db.signIn(f.email?.value.trim(), f.password?.value); await start(); }
    catch (ex) { showLogin(ex.message); }
  });
}

/* -------------------------------- Shell ------------------------------ */
function shell() {
  const p = db.state.profile;
  const mods = getModules();
  app.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><img src="assets/guvel-logo.png" alt=""><div class="brand-text"><strong>GUVEL <em>Quality</em></strong><small>Smarter Industrial Systems</small></div></div>
      <nav class="nav" aria-label="Principal">
        ${GROUPS.map(([label, ids]) => `<div class="nav-group"><div class="nav-label">${label}</div>${ids.map((id) => {
          const m = mods.find((x) => x.id === id);
          return `<a class="nav-item" href="#/${m.id}" data-route="${m.id}">${icon(m.icon)}<span>${m.label}</span><span class="nav-count hidden" data-count="${m.id}"></span></a>`;
        }).join("")}</div>`).join("")}
      </nav>
      <div class="sidebar-foot"><span>v1.0 · ${db.state.demo ? "Modo demo" : "Conectado"}</span>${db.state.demo ? `<a href="#" data-action="reset-demo">Restablecer</a>` : ""}</div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <button class="menu-btn" data-action="menu" aria-label="Abrir menú">${icon("menu")}</button>
        <span class="crumbs">GUVEL / Quality / <b id="crumbTitle"></b></span>
        <span class="topbar-spacer"></span>
        <div class="search" style="position:relative">${icon("search")}<input id="gsearch" type="search" placeholder="Buscar hallazgo, auditoría, folio…" data-input="gsearch" autocomplete="off"><div id="sresults"></div></div>
        ${db.state.demo ? "" : `<button class="btn ghost icon" data-action="reload" title="Actualizar datos" aria-label="Actualizar datos">${icon("refresh")}</button>`}
        <div class="user-chip"><div class="avatar">${esc(initials(p.full_name))}</div><div class="user-meta"><strong>${esc(p.full_name)}</strong><small>${esc(ROLES[p.role])}</small></div></div>
        <button class="btn ghost icon" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("logout")}</button>
      </header>
      <main><div class="page-head" id="pageHead"></div><section id="view"></section></main>
    </div>
  </div>`;
}

function updateCounts() {
  const t = today();
  const set = (id, n, alert) => {
    const el = document.querySelector(`[data-count="${id}"]`);
    if (!el) return;
    el.textContent = n; el.classList.toggle("hidden", !n); el.classList.toggle("hot", !!alert);
  };
  set("findings", db.rows("findings").filter((f) => f.status !== "cerrado").length);
  set("actions", db.rows("actions").filter((a) => !["completada", "verificada"].includes(a.status) && a.due_date && a.due_date < t).length, true);
  set("notifications", db.rows("customer_notifications").filter((n) => n.status !== "cerrada").length);
}
onAfterRender(updateCounts);

/* --------------------------- Búsqueda global ------------------------- */
onInput("gsearch", (el) => {
  const q = el.value.trim().toLowerCase();
  const box = document.getElementById("sresults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const hit = (...v) => v.some((x) => String(x || "").toLowerCase().includes(q));
  const res = [
    ...db.rows("findings").filter((r) => hit(r.code, r.title)).map((r) => ({ t: "Hallazgo", c: r.code, l: r.title, to: `findings/${r.id}` })),
    ...db.rows("audits").filter((r) => hit(r.code)).map((r) => ({ t: "Auditoría", c: r.code, l: db.get("audit_plans", r.plan_id)?.code || "", to: `audits/${r.id}` })),
    ...db.rows("customer_notifications").filter((r) => hit(r.code, r.subject, r.part_number)).map((r) => ({ t: "Cliente", c: r.code, l: r.subject, to: `notifications/${r.id}` })),
    ...db.rows("actions").filter((r) => hit(r.code, r.description)).map((r) => ({ t: "Acción", c: r.code, l: r.description, to: `findings/${r.finding_id}` })),
  ].slice(0, 8);
  box.innerHTML = `<div class="sr-pop">${res.length ? res.map((r) => `<a href="#/${r.to}" data-action="close-search"><small>${r.t}</small><span class="mono">${esc(r.c)}</span><span>${esc(r.l)}</span></a>`).join("") : '<div class="sr-none">Sin resultados</div>'}</div>`;
});
on("close-search", () => { document.getElementById("sresults").innerHTML = ""; document.getElementById("gsearch").value = ""; });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) { const b = document.getElementById("sresults"); if (b) b.innerHTML = ""; } });

/* ------------------------------ Acciones ----------------------------- */
on("menu", () => {
  document.getElementById("sidebar").classList.add("open");
  const s = document.createElement("div"); s.id = "scrim"; s.className = "scrim";
  s.onclick = () => { document.getElementById("sidebar").classList.remove("open"); s.remove(); };
  document.body.append(s);
});
on("logout", async () => { await db.signOut(); location.hash = ""; showLogin(); });
on("reload", async () => { await db.loadAll(); await renderRoute(false); toast("Datos actualizados", "ok"); });
on("reset-demo", async (_el, e) => {
  e.preventDefault();
  if (await confirmDialog({ title: "Restablecer demo", message: "Se borrarán los cambios y volverán los datos de ejemplo.", confirmLabel: "Restablecer", danger: true })) {
    db.resetDemo(); await db.loadAll(); await renderRoute(false); toast("Datos de ejemplo restaurados", "ok");
  }
});

/* -------------------------------- Inicio ----------------------------- */
async function start() {
  try {
    await db.loadAll();
    shell();
    window.addEventListener("hashchange", () => renderRoute());
    await renderRoute();
  } catch (e) {
    console.error(e);
    await db.signOut().catch(() => {});
    showLogin(e.message);
  }
}

(async function boot() {
  app.innerHTML = `<div class="loading"><img src="assets/guvel-logo.png" alt="Cargando"></div>`;
  try {
    const signed = await db.init();
    signed ? await start() : showLogin();
  } catch (e) {
    console.error(e);
    showLogin("No se pudo conectar con Supabase: " + e.message);
  }
})();
