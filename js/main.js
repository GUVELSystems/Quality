/* GUVEL Quality · punto de entrada */
import * as db from "./db.js";
import { esc, initials, today } from "./utils.js";
import { icon } from "./icons.js";
import { on, onInput, toast, confirmDialog } from "./ui.js";
import { register, getModules, renderRoute, onAfterRender } from "./router.js";
import { ROLES } from "./constants.js";

import dashboard from "./modules/dashboard.js";
import audits from "./modules/audits.js";
import findings from "./modules/findings.js";
import actions from "./modules/actions.js";
import notifications from "./modules/notifications.js";
import { risks, opportunities, clients, classifications, users } from "./modules/catalogs.js";
import forms from "./modules/forms.js";
import "./modules/attachments.js";

[dashboard, audits, findings, actions, notifications, risks, opportunities, clients, classifications, forms, users].forEach(register);

const app = document.getElementById("app");
const MAIN_NAV = ["dashboard", "audits", "findings", "actions", "notifications", "risks", "opportunities"];
const CONFIG_NAV = ["clients", "classifications", "forms", "users"];
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
const authBrand = `<div class="auth-brand"><img src="assets/guvel-logo.png" alt=""><strong>GUVEL</strong><small>Smarter industrial systems</small></div>`;
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
    <div class="auth-foot">GUVEL · Smarter industrial systems</div></div></div>`;
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
    <div class="auth-foot">GUVEL · Smarter industrial systems</div></div></div>`;
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
  const p = db.state.profile, mods = getModules(), mod = (id) => mods.find((m) => m.id === id);
  const link = (id, extra = "") => `<a class="nav-item" href="#/${id}" data-route="${id}">${mod(id).label}${extra}</a>`;
  app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#/dashboard"><img src="assets/guvel-logo.png" alt=""><span class="brand-word"><strong>GUVEL</strong><small>Smarter industrial systems</small></span><span class="brand-product">Quality</span></a>
    <nav class="top-nav" aria-label="Principal">
      ${MAIN_NAV.map((id) => link(id, ["findings", "actions", "notifications"].includes(id) ? `<span class="nav-count hidden" data-count="${id}"></span>` : "")).join("")}
      <div class="nav-more"><button class="nav-item" data-action="nav-more" id="navMoreBtn" aria-haspopup="true">Configuración ${icon("more")}</button></div>
    </nav>
    <div class="nav-menu hidden" id="navMenu">${CONFIG_NAV.map((id) => `<a href="#/${id}" data-route="${id}">${mod(id).label}</a>`).join("")}</div>
    <div class="top-actions">
      <label class="search">${icon("search")}<input id="gsearch" type="search" placeholder="Buscar folio o título…" data-input="gsearch" autocomplete="off" aria-label="Búsqueda global"><div id="sresults"></div></label>
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

on("nav-more", (el) => {
  const m = document.getElementById("navMenu"), r = el.getBoundingClientRect();
  m.style.top = r.bottom + "px"; m.style.left = Math.min(r.left, innerWidth - 230) + "px";
  m.classList.toggle("hidden");
});
document.addEventListener("click", (e) => { if (!e.target.closest("#navMenu, #navMoreBtn")) document.getElementById("navMenu")?.classList.add("hidden"); });

function updateNav() {
  const t = today();
  const set = (id, n, hot) => { const el = document.querySelector(`[data-count="${id}"]`); if (!el) return; el.textContent = n; el.classList.toggle("hidden", !n); el.classList.toggle("hot", !!hot); };
  set("findings", db.rows("findings").filter((f) => f.status !== "cerrado").length);
  set("actions", db.rows("actions").filter((a) => !["completada", "verificada"].includes(a.status) && a.due_date && a.due_date < t).length, true);
  set("notifications", db.rows("customer_notifications").filter((n) => n.status !== "cerrada").length);
  const route = location.hash.replace(/^#\//, "").split("/")[0] || "dashboard";
  document.getElementById("navMoreBtn")?.classList.toggle("active", CONFIG_NAV.includes(route));
  document.querySelectorAll("#navMenu a").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
}
onAfterRender(updateNav);

/* --------------------------- Búsqueda global ------------------------- */
onInput("gsearch", (el) => {
  const q = el.value.trim().toLowerCase(), box = document.getElementById("sresults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const hit = (...v) => v.some((x) => String(x || "").toLowerCase().includes(q));
  const res = [
    ...db.rows("findings").filter((r) => hit(r.code, r.title)).map((r) => ({ t: "Hallazgo", c: r.code, l: r.title, to: `findings/${r.id}` })),
    ...db.rows("audits").filter((r) => hit(r.code)).map((r) => ({ t: "Auditoría", c: r.code, l: db.get("audit_plans", r.plan_id)?.name || "", to: `audits/${r.id}` })),
    ...db.rows("customer_notifications").filter((r) => hit(r.code, r.subject, r.part_number)).map((r) => ({ t: "Cliente", c: r.code, l: r.subject, to: `notifications/${r.id}` })),
    ...db.rows("actions").filter((r) => hit(r.code, r.description)).map((r) => ({ t: "Acción", c: r.code, l: r.description, to: `findings/${r.finding_id}` })),
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
