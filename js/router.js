/* Router por hash: #/<módulo>/<pestaña>/<parámetros…>
   Ej.: #/auditorias/plan/<id> · #/internas/hallazgos · #/issues/notificaciones/<id> */
import { esc } from "./utils.js";
import { icon } from "./icons.js";
import * as db from "./db.js";
import { planWs, auditWs, findingWs } from "./scope.js";

/** Módulo: { id, label, tabs:[{ id, label, render(root, params), hidden?, activeAs?, count?() }], hideTabs? } */
const workspaces = new Map();
export const registerWs = (w) => workspaces.set(w.id, w);
export const getWs = (id) => workspaces.get(id);
export const allWs = () => [...workspaces.values()];

let cur = { ws: "dashboard", tab: "inicio", params: [] };
export const current = () => cur;
export const wsId = () => cur.ws;
/** Enlace dentro del módulo actual: H("hallazgos/ID") → #/auditorias/hallazgos/ID */
export const H = (path) => `#/${cur.ws}/${path}`;

export const navigate = (path) => { location.hash = "#/" + path; };
/** Reemplaza el hash sin disparar render (útil tras abrir un detalle) */
export const replaceHash = (path) => history.replaceState(null, "", "#/" + path);

let afterRender = () => {};
export const onAfterRender = (fn) => { afterRender = fn; };

export function setHead({ eyebrow, title, subtitle = "", actions = "" }) {
  const eb = eyebrow ?? (getWs(cur.ws)?.label || "GUVEL Quality");
  document.getElementById("pageHead").innerHTML = `
    <div><span class="eyebrow">${esc(eb)}</span><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ""}`;
  document.title = `${title} · GUVEL Quality`;
}

/** Enlaces antiguos (correos ya enviados, marcadores) → ruta nueva del módulo correcto */
function legacy(parts) {
  const [a, b, c] = parts;
  switch (a) {
    case "audits": {
      if (!b) return "auditorias/planes";
      if (b === "plan") { const p = db.get("audit_plans", c); return `${planWs(p)}/plan/${c}`; }
      const au = db.get("audits", b); return au ? `${auditWs(au)}/audit/${b}` : "auditorias/lista";
    }
    case "findings": { if (!b) return "auditorias/hallazgos"; const f = db.get("findings", b); return `${findingWs(f)}/hallazgos/${b}`; }
    case "actions": return "auditorias/acciones";
    case "notifications": return b ? `issues/notificaciones/${b}` : "issues/notificaciones";
    case "risks": return "riesgos";
    case "opportunities": return "oportunidades";
    case "clients": return "config/clientes";
    case "classifications": return "config/clasificaciones";
    case "users": return "config/usuarios";
    case "forms": return "auditorias/formatos";
    default: return null;
  }
}

let lastKey = null;
export async function rerender() { await renderRoute(false); }

export async function renderRoute(scroll = true) {
  if (scroll) document.querySelectorAll(".overlay").forEach((o) => o._close?.()); // navegar cierra paneles y diálogos abiertos
  let parts = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  const to = parts.length ? legacy(parts) : null;
  if (to) { replaceHash(to); parts = to.split("/"); }
  const w = getWs(parts[0]) || getWs("dashboard");
  const tab = w.tabs.find((t) => t.id === parts[1]) || w.tabs[0];
  const canonical = w.hideTabs ? parts[0] === w.id : parts[0] === w.id && parts[1] === tab.id;
  if (!canonical) replaceHash(w.hideTabs ? w.id : `${w.id}/${tab.id}`);
  cur = { ws: w.id, tab: tab.id, params: !canonical ? [] : parts.slice(w.hideTabs ? 1 : 2) };
  const root = document.getElementById("view");
  const keepY = window.scrollY;
  try {
    root.innerHTML = "";
    await tab.render(root, cur.params);
  } catch (e) {
    console.error(e);
    setHead({ title: tab.label || w.label });
    root.innerHTML = `<div class="panel"><div class="empty">${icon("finding")}<strong>Algo salió mal</strong>${esc(e.message || e)}</div></div>`;
  }
  const key = `${cur.ws}/${cur.tab}/${cur.params.join("/")}`;
  if (!scroll) window.scrollTo({ top: keepY });
  else if (lastKey !== key) window.scrollTo({ top: 0 });
  lastKey = key;
  afterRender();
}
