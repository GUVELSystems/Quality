/* GUVEL Quality · punto de entrada */
import * as db from "./db.js";
import { esc, initials, today } from "./utils.js";
import { icon } from "./icons.js";
import { on, onInput, toast, confirmDialog } from "./ui.js";
import { registerWs, getWs, current, renderRoute, onAfterRender } from "./router.js";
import { ROLES } from "./constants.js";

import dashboard from "./modules/dashboard.js";
import * as audits from "./modules/audits.js";
import findings from "./modules/findings.js";
import actions from "./modules/actions.js";
import notifications from "./modules/notifications.js";
import { risks, opportunities, clients, classifications, users } from "./modules/catalogs.js";
import forms from "./modules/forms.js";
import { classesAndLevels, areas } from "./modules/config.js";
import { updateBell, showReminder, closeInbox, inboxCounts } from "./inbox.js";
import "./modules/attachments.js";
import { findingsOf, lateActionsOf, WS_LABEL, WS_ICON, auditWs, findingWs } from "./scope.js";

/* ------------------- Módulos (portales dentro del portal) ------------------- */
const openF = (ws) => ({ n: findingsOf(ws).filter((f) => f.status !== "cerrado").length });
const lateA = (ws) => ({ n: lateActionsOf(ws).length, hot: true });
const auditTabs = () => [
  { id: "planes", label: "Planes", icon: "calendar", render: audits.renderPlanes },
  { id: "lista", label: "Auditorías", icon: "audit", render: audits.renderLista },
  { id: "hallazgos", label: "Hallazgos", icon: "finding", render: findings.render, count: openF },
  { id: "acciones", label: "Acciones", icon: "action", render: actions.render, count: lateA },
  { id: "formatos", label: "Formatos", icon: "form", render: forms.render },
  { id: "plan", hidden: true, icon: "calendar", activeAs: "planes", render: audits.renderPlan },
  { id: "audit", hidden: true, icon: "audit", activeAs: "lista", render: audits.renderAudit },
];
registerWs({ id: "dashboard", label: "Dashboard", hideTabs: true, tabs: [{ id: "inicio", render: dashboard.render }] });
registerWs({ id: "auditorias", label: WS_LABEL.auditorias, tabs: auditTabs() });
registerWs({ id: "internas", label: WS_LABEL.internas, tabs: auditTabs() });
registerWs({ id: "issues", label: WS_LABEL.issues, tabs: [
  { id: "notificaciones", label: "Notificaciones", icon: "bell", render: notifications.render, count: () => ({ n: db.rows("customer_notifications").filter((n) => n.status !== "cerrada").length }) },
  { id: "hallazgos", label: "Hallazgos", icon: "finding", render: findings.render, count: openF },
  { id: "acciones", label: "Acciones", icon: "action", render: actions.render, count: lateA },
] });
registerWs({ id: "riesgos", label: WS_LABEL.riesgos, hideTabs: true, tabs: [{ id: "riesgos", render: risks.render }] });
registerWs({ id: "oportunidades", label: WS_LABEL.oportunidades, hideTabs: true, tabs: [{ id: "oportunidades", render: opportunities.render }] });
registerWs({ id: "config", label: WS_LABEL.config, tabs: [
  { id: "clientes", label: "Clientes", icon: "client", render: clients.render },
  { id: "clasificaciones", label: "Clasificaciones y niveles", icon: "tag", render: classesAndLevels.render },
  { id: "areas", label: "Áreas", icon: "area", render: areas.render },
  { id: "catalogos", label: "Catálogos", icon: "list", render: classifications.render },
  { id: "usuarios", label: "Usuarios", icon: "users", render: users.render },
] });

const app = document.getElementById("app");
const MENU = ["dashboard", "auditorias", "internas", "issues", "riesgos", "oportunidades"];
const CONFIG_MENU = [["clientes", "Clientes", "client"], ["clasificaciones", "Clasificaciones y niveles", "tag"], ["areas", "Áreas", "area"], ["catalogos", "Catálogos", "list"], ["usuarios", "Usuarios", "users"]];
const MENU_ICON = WS_ICON;
let appShown = false;

/* ------------------------------- Tema -------------------------------- */
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const currentTheme = () => document.documentElement.dataset.theme || (systemDark() ? "dark" : "light");
(() => { const t = localStorage.getItem("guvel-theme"); if (t) document.documentElement.dataset.theme = t; })();
on("theme", (el) => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; localStorage.setItem("guvel-theme", next);
  el.innerHTML = icon(next === "dark" ? "sun" : "moon");
});

/* ------------------------------ Pantallas de acceso ------------------ */
/** Marca "GUVEL / QUALITY" geométrica: las dos palabras miden exactamente lo mismo (textLength); GUVEL domina */
const brandSvg = () => `<svg class="brand-svg" viewBox="0 0 120 44" role="img" aria-label="GUVEL Quality"><text x="0" y="28" textLength="120" lengthAdjust="spacing" class="bs-main">GUVEL</text><text x="0" y="41.5" textLength="120" lengthAdjust="spacing" class="bs-sub">QUALITY</text></svg>`;
const authBrand = `<div class="auth-brand"><img src="assets/guvel-logo.png" alt="">${brandSvg()}</div>`;
const msg = (m, err) => (m ? `<div class="auth-msg ${err ? "error" : ""}" role="${err ? "alert" : "status"}">${esc(m)}</div>` : "");

function showLogin(error = "", info = "") {
  appShown = false;
  app.innerHTML = `<div class="auth-screen"><div class="auth-card">${authBrand}
    <span class="eyebrow">Quality</span><h1>Iniciar sesión</h1>${msg(error, true)}${msg(info, false)}
    <form class="auth-form" id="loginForm" novalidate>
      ${db.state.demo
        ? `<div class="auth-msg"><b>Modo demo.</b> Aún no se ha configurado Supabase; los datos de ejemplo se guardan solo en este navegador.</div><button class="btn primary" type="submit">Entrar al modo demo</button>`
        : `<label>Correo<input class="input" type="email" name="email" autocomplete="username" required></label>
           <label>Contraseña<input class="input" type="password" name="password" autocomplete="current-password" required></label>
           <button class="btn primary" type="submit">Entrar</button>
           <button class="auth-link" type="button" id="forgot">¿Olvidaste tu contraseña?</button>`}
    </form><div class="auth-foot">Acceso solo por invitación · GUVEL Quality</div></div></div>`;
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try { await db.signIn(f.email?.value.trim(), f.password?.value); await start(); }
    catch (ex) { showLogin(ex.message); }
  });
  document.getElementById("forgot")?.addEventListener("click", () => showForgot(document.querySelector("[name=email]")?.value));
}

function showForgot(email = "") {
  app.innerHTML = `<div class="auth-screen"><div class="auth-card">${authBrand}
    <span class="eyebrow">Quality</span><h1>Recuperar acceso</h1><p class="auth-lead">Te enviaremos un enlace para crear una nueva contraseña.</p>
    <form class="auth-form" id="forgotForm" novalidate>
      <label>Correo<input class="input" type="email" name="email" value="${esc(email)}" autocomplete="username" required></label>
      <button class="btn primary" type="submit">Enviar enlace</button>
      <button class="auth-link" type="button" id="back">Volver</button></form></div></div>`;
  document.getElementById("back").onclick = () => showLogin();
  document.getElementById("forgotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const em = e.target.email.value.trim();
    if (!em) return;
    try { await db.resetPassword(em); showLogin("", "Si el correo está registrado, recibirás un enlace en unos minutos."); }
    catch (ex) { showLogin(ex.message); }
  });
}

/** Paso intermedio: el token solo se canjea cuando la persona pulsa el botón */
function showConfirmLink() {
  appShown = false;
  const invite = db.state.otp.type !== "recovery";
  app.innerHTML = `<div class="auth-screen"><div class="auth-card">${authBrand}
    <span class="eyebrow">${invite ? "Bienvenido a Quality" : "Recuperación de acceso"}</span>
    <h1>${invite ? "Activa tu acceso" : "Restablece tu contraseña"}</h1>
    <p class="auth-lead">${invite ? "Te invitaron al portal de calidad de GUVEL. Pulsa el botón para continuar y crear tu contraseña." : "Pulsa el botón para continuar y elegir una nueva contraseña."}</p>
    <div id="cl-msg"></div>
    <div class="auth-form"><button class="btn primary" id="cl-go" type="button">Continuar</button></div>
    <div class="auth-foot">GUVEL Quality</div></div></div>`;
  document.getElementById("cl-go").addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Verificando…";
    try { await db.verifyEmailLink(); showSetPassword(db.state.authIntent === "invite"); }
    catch (ex) { showLogin(ex.message); }
  });
}

/** Tras abrir un enlace de invitación o recuperación */
function showSetPassword(invite = true, error = "") {
  appShown = false;
  const u = db.state.session?.user, first = (u?.user_metadata?.full_name || "").split(" ")[0];
  app.innerHTML = `<div class="auth-screen"><div class="auth-card">${authBrand}
    <span class="eyebrow">${invite ? "Bienvenido a Quality" : "Recuperación de acceso"}</span>
    <h1>${invite && first ? `Hola, ${esc(first)}` : "Crea tu contraseña"}</h1>
    <p class="auth-lead">${invite ? "Crea tu contraseña para entrar al portal." : "Elige una nueva contraseña."}${u?.email ? `<br>Tu usuario será <b style="color:#fff">${esc(u.email)}</b>.` : ""}</p>${msg(error, true)}
    <form class="auth-form" id="pwForm" novalidate>
      <label>Nueva contraseña<input class="input" type="password" name="p1" autocomplete="new-password" minlength="8" required placeholder="Mínimo 8 caracteres"></label>
      <label>Confirmar contraseña<input class="input" type="password" name="p2" autocomplete="new-password" minlength="8" required></label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="showPw" style="width:16px;height:16px;accent-color:#0CC0DF"> Mostrar contraseña</label>
      <button class="btn primary" type="submit">Guardar y entrar</button></form>
    <div class="auth-foot">GUVEL Quality</div></div></div>`;
  document.getElementById("showPw").addEventListener("change", (e) => document.querySelectorAll("#pwForm input[type=password], #pwForm input[data-pw]").forEach((i) => { i.type = e.target.checked ? "text" : "password"; i.dataset.pw = "1"; }));
  document.getElementById("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { p1, p2 } = e.target;
    if (p1.value.length < 8) return showSetPassword(invite, "La contraseña debe tener al menos 8 caracteres.");
    if (p1.value !== p2.value) return showSetPassword(invite, "Las contraseñas no coinciden.");
    try { await db.setPassword(p1.value); await start(); } catch (ex) { showSetPassword(invite, ex.message); }
  });
}

/* -------------------------------- Shell ------------------------------ */
function shell() {
  const p = db.state.profile;
  app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#/dashboard" aria-label="GUVEL Quality"><img src="assets/guvel-logo.png" alt="">${brandSvg()}</a>
    <nav class="top-nav" aria-label="Principal">
      <button class="ws-chip" id="wsBtn" data-action="ws-menu" aria-haspopup="true" aria-expanded="false"></button>
      <span class="nav-tabs" id="navTabs"></span>
    </nav>
    <div class="ws-menu hidden" id="wsMenu" role="menu"></div><div class="inbox hidden" id="inbox" role="dialog" aria-label="Notificaciones"></div>
    <div class="top-actions">
      <label class="search">${icon("search")}<input id="gsearch" type="search" placeholder="Buscar folio o título…" data-input="gsearch" autocomplete="off" aria-label="Búsqueda global"><div id="sresults"></div></label>
      <span class="bell-wrap"><button class="top-btn" id="bellBtn" data-action="inbox-toggle" title="Notificaciones" aria-label="Notificaciones" aria-expanded="false">${icon("bell")}</button><span class="bell-badge hidden" id="bellBadge"></span></span>
      <button class="top-btn" data-action="theme" title="Cambiar tema" aria-label="Cambiar tema">${icon(currentTheme() === "dark" ? "sun" : "moon")}</button>
      ${db.state.demo ? "" : `<button class="top-btn" data-action="reload" title="Actualizar datos" aria-label="Actualizar datos">${icon("refresh")}</button>`}
      <div class="user-chip"><div class="user-meta"><strong>${esc(p.full_name)}</strong><small>${esc(ROLES[p.role])}${db.state.demo ? " · demo" : ""}</small></div><div class="avatar">${esc(initials(p.full_name))}</div></div>
      ${db.state.demo ? `<button class="top-btn" data-action="reset-demo" title="Restablecer datos demo" aria-label="Restablecer datos demo">${icon("wand")}</button>` : ""}
      <button class="top-btn" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("logout")}</button>
    </div>
  </header>
  <main class="content"><div class="page-head" id="pageHead"></div><section id="view"></section></main>`;
  appShown = true;
}

/* Selector de módulo (chip "Quality ▾"): lista de módulos y, aparte, Configuración */
on("ws-menu", (el) => {
  const m = document.getElementById("wsMenu"), r = el.getBoundingClientRect();
  m.style.top = r.bottom + 4 + "px"; m.style.left = Math.max(8, Math.min(r.left, innerWidth - 270)) + "px";
  const hidden = m.classList.toggle("hidden");
  el.setAttribute("aria-expanded", String(!hidden));
});
document.addEventListener("click", (e) => { if (!e.target.closest("#wsMenu, #wsBtn") || e.target.closest(".ws-tile")) document.getElementById("wsMenu")?.classList.add("hidden"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.getElementById("wsMenu")?.classList.add("hidden"); });

/* Tooltip de los iconos: un único elemento flotante (z-index alto) para que siempre se lea */
(() => {
  let tip = null;
  const show = (el) => {
    tip ||= Object.assign(document.createElement("div"), { id: "wsTip", className: "ws-tooltip", role: "tooltip" }); if (!tip.isConnected) document.body.append(tip);
    tip.textContent = el.getAttribute("aria-label"); tip.style.display = "block";
    const r = el.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px"; tip.style.top = r.bottom + 8 + "px";
  };
  const hide = () => { if (tip) tip.style.display = "none"; };
  document.addEventListener("mouseover", (e) => { const t = e.target.closest?.(".ws-tile"); t ? show(t) : hide(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest?.(".ws-tile"); t ? show(t) : hide(); });
  document.addEventListener("focusout", hide); document.addEventListener("click", hide);
})();

function renderNav() {
  const c = current(), w = getWs(c.ws);
  if (!w || !document.getElementById("wsBtn")) return;
  document.getElementById("wsBtn").innerHTML = `${esc(w.label)} ${icon("more")}`;
  const tile = (href, label, ico, active) => `<a href="${href}" class="ws-tile ${active ? "active" : ""}" role="menuitem" aria-label="${esc(label)}" title="${esc(label)}">${icon(ico)}<span class="ws-tip">${esc(label)}</span></a>`;
  document.getElementById("wsMenu").innerHTML = `<div class="ws-grid">${MENU.map((id) => tile(`#/${id}`, getWs(id).label, MENU_ICON[id], id === c.ws)).join("")}</div>`
    + `<div class="menu-sep">Configuración</div><div class="ws-grid">${CONFIG_MENU.map(([id, l, ico]) => tile(`#/config/${id}`, l, ico, c.ws === "config" && c.tab === id)).join("")}</div>`;
  document.getElementById("wsMenu").classList.add("hidden");
  document.getElementById("navTabs").innerHTML = w.hideTabs ? "" : w.tabs.filter((t) => !t.hidden).map((t) => {
    const k = t.count?.(w.id), active = t.id === c.tab || t.activeAs === c.tab;
    return `<a class="nav-item ${active ? "active" : ""}" href="#/${w.id}/${t.id}">${t.icon ? icon(t.icon) : ""}<span>${esc(t.label)}</span>${k && k.n ? `<span class="nav-count ${k.hot ? "hot" : ""}">${k.n}</span>` : ""}</a>`;
  }).join("");
}
onAfterRender(() => { renderNav(); updateBell(); closeInbox(); });

/* --------------------------- Búsqueda global ------------------------- */
onInput("gsearch", (el) => {
  const q = el.value.trim().toLowerCase(), box = document.getElementById("sresults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const hit = (...v) => v.some((x) => String(x || "").toLowerCase().includes(q));
  const res = [
    ...db.rows("findings").filter((r) => hit(r.code, r.title)).map((r) => ({ t: "Hallazgo", c: r.code, l: r.title, to: `${findingWs(r)}/hallazgos/${r.id}` })),
    ...db.rows("audits").filter((r) => hit(r.code)).map((r) => ({ t: "Auditoría", c: r.code, l: db.get("audit_plans", r.plan_id)?.name || "", to: `${auditWs(r)}/audit/${r.id}` })),
    ...db.rows("customer_notifications").filter((r) => hit(r.code, r.subject, r.part_number)).map((r) => ({ t: "Cliente", c: r.code, l: r.subject, to: `issues/notificaciones/${r.id}` })),
    ...db.rows("actions").filter((r) => hit(r.code, r.description)).map((r) => ({ t: "Acción", c: r.code, l: r.description, to: `${findingWs(db.get("findings", r.finding_id))}/hallazgos/${r.finding_id}` })),
  ].slice(0, 8);
  box.innerHTML = `<div class="sr-pop">${res.length ? res.map((r) => `<a href="#/${r.to}" data-action="close-search"><small>${r.t}</small><span class="mono">${esc(r.c)}</span><span>${esc(r.l)}</span></a>`).join("") : '<div class="sr-none">Sin resultados</div>'}</div>`;
});
on("close-search", () => { document.getElementById("sresults").innerHTML = ""; document.getElementById("gsearch").value = ""; });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) { const b = document.getElementById("sresults"); if (b) b.innerHTML = ""; } });

/* ------------------------------ Acciones ----------------------------- */
on("logout", async () => { await db.signOut(); location.hash = ""; showLogin(); });
on("reload", async () => { await db.loadAll(); await renderRoute(false); toast("Datos actualizados", "ok"); });
on("reset-demo", async () => {
  if (await confirmDialog({ title: "Restablecer demo", message: "Se borrarán los cambios y volverán los datos de ejemplo.", confirmLabel: "Restablecer", danger: true })) {
    db.resetDemo(); await db.loadAll(); await renderRoute(false); toast("Datos de ejemplo restaurados", "ok");
  }
});

/* -------------------------------- Inicio ----------------------------- */
let hashListener = false;
async function start() {
  try {
    await db.loadAll();
    shell();
    if (!hashListener) { window.addEventListener("hashchange", () => appShown && renderRoute()); hashListener = true; }
    await renderRoute();
    updateBell(); showReminder();
    if (!db.state.demo) setInterval(async () => { if (document.hidden) return; try { await db.reload("notifications"); updateBell(); } catch { /* sin conexión */ } }, 60000);
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
    db.onAuthEvent((ev) => {
      if (ev === "SIGNED_OUT" && appShown) showLogin("Tu sesión terminó. Vuelve a iniciar sesión.");
      if (ev === "PASSWORD_RECOVERY") showSetPassword(false);
    });
    if (db.state.otp) showConfirmLink();
    else if (db.state.authError) showLogin(db.state.authError);
    else if (signed && db.state.authIntent) showSetPassword(db.state.authIntent === "invite" || db.state.authIntent === "signup");
    else if (signed) await start();
    else showLogin();
  } catch (e) {
    console.error(e);
    showLogin("No se pudo conectar con Supabase: " + e.message);
  }
})();
