/* Componentes de interfaz reutilizables */
import { esc, initials } from "./utils.js";
import { icon } from "./icons.js";

/* ------------------------ Delegación de eventos ---------------------- */
const handlers = {};
/** Registra un manejador para elementos con data-action="nombre" */
export const on = (name, fn) => { handlers[name] = fn; };
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const link = e.target.closest("a[href]");
  if (link && link !== el && el.contains(link)) return; // un enlace dentro de una fila gana
  const fn = handlers[el.dataset.action];
  if (fn) { if (el.tagName !== "A") e.preventDefault(); fn(el, e); }
});

/** data-change="nombre" (selects/checkbox) y data-input="nombre" (texto) */
const changeH = {}, inputH = {};
export const onChange = (name, fn) => { changeH[name] = fn; };
export const onInput = (name, fn) => { inputH[name] = fn; };
document.addEventListener("change", (e) => { const el = e.target.closest("[data-change]"); if (el) changeH[el.dataset.change]?.(el, e); });
document.addEventListener("input", (e) => { const el = e.target.closest("[data-input]"); if (el) inputH[el.dataset.input]?.(el, e); });

/* ------------------------------ Helpers ------------------------------ */
export const badge = (map, value) => {
  const [label, tone] = map[value] || [value ?? "—", "neutral"];
  return `<span class="badge" data-tone="${tone}">${esc(label)}</span>`;
};
export const pill = (text, tone = "neutral") => `<span class="badge" data-tone="${tone}">${esc(text)}</span>`;
export const userCell = (p) =>
  p ? `<span style="display:inline-flex;align-items:center;gap:8px"><span class="avatar sm">${esc(initials(p.full_name))}</span>${esc(p.full_name)}</span>` : '<span class="muted">Sin asignar</span>';
export const empty = (title, text, ico = "empty") =>
  `<div class="empty">${icon(ico)}<strong>${esc(title)}</strong>${esc(text)}</div>`;
export const options = (list, sel, placeholder) =>
  (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : "") +
  list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");

/* ------------------------------- Toast ------------------------------- */
export function toast(message, tone = "info") {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; document.body.append(box); }
  const t = document.createElement("div");
  t.className = "toast"; t.dataset.tone = tone; t.setAttribute("role", "status");
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), tone === "danger" ? 6000 : 3500);
}

/* ------------------------- Modal / Drawer base ----------------------- */
function mountOverlay(inner, { side = false } = {}) {
  const ov = document.createElement("div");
  ov.className = "overlay" + (side ? " side" : "");
  ov.innerHTML = inner;
  const prevFocus = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === "Escape" && ov === [...document.querySelectorAll(".overlay")].pop()) close(); };
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  ov.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(ov);
  ov.querySelector("input:not([type=hidden]),select,textarea")?.focus();
  return { el: ov, close };
}

export function openDialog({ eyebrow = "", title, body, footer = "", size = "" }) {
  return mountOverlay(`
    <div class="dialog ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="dialog-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div>
        <button class="btn ghost icon" data-close aria-label="Cerrar">${icon("close")}</button></div>
      <div class="dialog-body">${body}</div>${footer ? `<div class="dialog-foot">${footer}</div>` : ""}
    </div>`);
}

export function openDrawer(html) {
  const d = mountOverlay(`<aside class="drawer" role="dialog" aria-modal="true">${html}</aside>`, { side: true });
  d.set = (h) => { d.el.querySelector(".drawer").innerHTML = h; };
  return d;
}

/* -------------------------- Formularios modales ---------------------- */
/**
 * fields: [{name,label,type,options,required,span2,placeholder,hint,readonly}]
 * type: text|textarea|number|date|datetime|email|select|checkbox
 */
export function fieldHTML(f, values) {
  const v = values[f.name] ?? f.default ?? "";
  const common = `name="${f.name}" id="f_${f.name}" ${f.required ? "required" : ""} ${f.readonly ? "readonly" : ""} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}`;
  let control;
  if (f.type === "textarea") control = `<textarea class="textarea" ${common}>${esc(v)}</textarea>`;
  else if (f.type === "select") control = `<select class="select" ${common}>${options(typeof f.options === "function" ? f.options(values) : f.options, v, f.required ? undefined : "— Sin seleccionar —")}</select>`;
  else if (f.type === "checkbox") return `<label class="check ${f.span2 ? "span-2" : ""}"><input type="checkbox" name="${f.name}" ${v === true || v === "true" ? "checked" : ""}> ${esc(f.label)}</label>`;
  else {
    const t = f.type === "datetime" ? "datetime-local" : f.type || "text";
    control = `<input class="input" type="${t}" ${f.type === "number" ? `min="${f.min ?? ""}" max="${f.max ?? ""}" step="${f.step ?? 1}"` : ""} value="${esc(v)}" ${common}>`;
  }
  return `<label class="field ${f.span2 ? "span-2" : ""}"><span>${esc(f.label)}${f.required ? " <i>*</i>" : ""}</span>${control}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ""}</label>`;
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === "checkbox") out[f.name] = el.checked;
    else if (f.type === "number") out[f.name] = el.value === "" ? null : Number(el.value);
    else out[f.name] = f.parse ? f.parse(el.value) : el.value;
  }
  return out;
}

export function openForm({ eyebrow, title, fields, values = {}, submitLabel = "Guardar", onSubmit, onDelete, size = "", intro = "" }) {
  const id = "form_" + Math.random().toString(36).slice(2, 8);
  const dlg = openDialog({
    eyebrow, title, size,
    body: `${intro}<form id="${id}" class="form-grid" novalidate>${fields.map((f) => fieldHTML(f, values)).join("")}</form><div id="${id}_err" class="alert hidden" style="margin-top:16px"></div>`,
    footer: `${onDelete ? `<button type="button" class="btn danger" data-del style="margin-right:auto">Eliminar</button>` : ""}<button type="button" class="btn" data-close>Cancelar</button><button type="submit" form="${id}" class="btn primary">${esc(submitLabel)}</button>`,
  });
  const form = dlg.el.querySelector("form");
  const err = dlg.el.querySelector(`#${id}_err`);
  const showErr = (m) => { err.textContent = m; err.classList.remove("hidden"); };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.add("hidden");
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = dlg.el.querySelector('button[type="submit"]');
    btn.disabled = true;
    try { const res = await onSubmit(readForm(form, fields)); if (res !== false) dlg.close(); }
    catch (ex) { showErr(ex.message || String(ex)); }
    finally { btn.disabled = false; }
  });
  dlg.el.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "¿Eliminar registro?", message: "Esta acción no se puede deshacer.", confirmLabel: "Eliminar", danger: true }))) return;
    try { await onDelete(); dlg.close(); } catch (ex) { showErr(ex.message || String(ex)); }
  });
  return dlg;
}

export function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const d = openDialog({
      eyebrow: "Confirmación", title, size: "sm",
      body: `<p class="muted">${esc(message)}</p>`,
      footer: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? "danger solid" : "primary"}" data-ok>${esc(confirmLabel)}</button>`,
    });
    d.el.querySelector("[data-ok]").addEventListener("click", () => { answer = true; d.close(); });
    new MutationObserver((_, o) => { if (!document.body.contains(d.el)) { o.disconnect(); resolve(answer); } }).observe(document.body, { childList: true });
  });
}

/* ------------------------------ Gráficas ----------------------------- */
export function donut(segments, centerLabel) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 62, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = total
    ? segments.filter((s) => s.value).map((s) => {
        const len = (s.value / total) * C;
        const el = `<circle r="${R}" cx="84" cy="84" fill="none" stroke="${s.color}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}"/>`;
        acc += len; return el;
      }).join("")
    : "";
  return `<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 168 168"><circle r="${R}" cx="84" cy="84" fill="none" stroke="var(--bg-1)" stroke-width="20"/>${arcs}</svg>
    <div class="center"><strong>${total}</strong><small>${esc(centerLabel)}</small></div></div>
    <div class="legend">${segments.map((s) => `<div style="--c:${s.color}"><i></i>${esc(s.label)}<b>${s.value}</b></div>`).join("")}</div></div>`;
}

export function bars(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars">${items.map((i) => `<div class="bar-row" style="--c:${i.color || "var(--g-cyan)"}"><span>${esc(i.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(i.value / max) * 100}%"></div></div><b>${i.value}</b></div>`).join("")}</div>`;
}

export function columns(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="columns">${items.map((i) => `<div class="col"><b>${i.value}</b><div class="stick" style="height:${(i.value / max) * 100}%"></div><span>${esc(i.label)}</span></div>`).join("")}</div>`;
}
