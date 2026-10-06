/* Router por hash (#/modulo/param1/param2) */
import { esc } from "./utils.js";
import { icon } from "./icons.js";

const modules = [];
export const register = (m) => modules.push(m);
export const getModules = () => modules;

export function parseHash() {
  const [path] = location.hash.replace(/^#\/?/, "").split("?");
  const [id, ...params] = path.split("/").filter(Boolean);
  return { id: id || "dashboard", params };
}
export const navigate = (path) => { location.hash = "#/" + path; };
/** Reemplaza el hash sin disparar render (útil tras abrir un detalle) */
export const replaceHash = (path) => history.replaceState(null, "", "#/" + path);

let afterRender = () => {};
export const onAfterRender = (fn) => { afterRender = fn; };

export function setHead({ eyebrow = "GUVEL Quality", title, subtitle = "", actions = "" }) {
  document.getElementById("pageHead").innerHTML = `
    <div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ""}`;
  document.title = `${title} · GUVEL Quality`;
  const c = document.getElementById("crumbTitle");
  if (c) c.textContent = title;
}

let lastId = null;
export async function rerender() { await renderRoute(false); }

export async function renderRoute(scroll = true) {
  const { id, params } = parseHash();
  const mod = modules.find((m) => m.id === id) || modules[0];
  document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.route === mod.id));
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("scrim")?.remove();
  const root = document.getElementById("view");
  try {
    root.innerHTML = "";
    await mod.render(root, params);
  } catch (e) {
    console.error(e);
    setHead({ title: mod.label });
    root.innerHTML = `<div class="panel"><div class="empty">${icon("finding")}<strong>Algo salió mal</strong>${esc(e.message || e)}</div></div>`;
  }
  if (scroll && lastId !== mod.id + params.join("/")) window.scrollTo({ top: 0 });
  lastId = mod.id + params.join("/");
  afterRender();
}
