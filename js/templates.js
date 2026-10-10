/* =====================================================================
   Motor de plantillas (CAPA Files / Root Cause Files)
   Una plantilla es un conjunto de SECCIONES con CAMPOS configurables:
   texto, texto largo, fecha, número, selección y "grid" (una tabla editable,
   tipo hoja de cálculo, con columnas fijas y filas que se agregan libremente;
   así cada organización arma su propio 8D, 4D, A4, 5 Porqués, Ishikawa…).
   Este archivo sirve para DOS cosas con el mismo motor: diseñar la plantilla
   (config) y llenarla en un hallazgo (finding-internal).
   ===================================================================== */
import { esc, uuid } from "./utils.js";
import { on } from "./ui.js";

export const FIELD_TYPES = { text: "Texto corto", textarea: "Texto largo", date: "Fecha", number: "Número", select: "Opciones", grid: "Tabla (tipo hoja de cálculo)" };
export const emptySchema = () => ({ sections: [] });
export const emptySection = () => ({ id: uuid(), title: "", fields: [] });
export const emptyField = (type = "text") => ({ id: uuid(), label: "", type, hint: "", options: [], columns: ["Columna 1", "Columna 2"] });

/* --------------------------- Edición del diseño (Configuración) -------------------- */
export function builderHTML(schema) {
  const sc = schema?.sections?.length ? schema : emptySchema();
  return `<div class="tpl-builder" id="tplBuilder">${sc.sections.map((s, si) => sectionBuilderHTML(s, si)).join("")}</div>
    <button type="button" class="btn sm" data-action="tpl-add-section">${"+"} Agregar sección</button>`;
}
function sectionBuilderHTML(s, si) {
  return `<div class="tpl-section" data-si="${si}"><div class="tpl-section-head">
      <input class="input" data-tpl="section-title" data-si="${si}" placeholder="Nombre de la sección (ej. D1 · Equipo)" value="${esc(s.title)}">
      <button type="button" class="btn sm icon danger" data-action="tpl-del-section" data-si="${si}" aria-label="Quitar sección">${"✕"}</button></div>
    <div class="tpl-fields">${s.fields.map((f, fi) => fieldBuilderHTML(f, si, fi)).join("") || '<p class="muted" style="font-size:13px">Sin campos. Agrega uno abajo.</p>'}</div>
    <div class="tpl-add-field"><select class="select sm" data-tpl="new-field-type" data-si="${si}">${Object.entries(FIELD_TYPES).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <button type="button" class="btn sm" data-action="tpl-add-field" data-si="${si}">+ Agregar campo</button></div></div>`;
}
function fieldBuilderHTML(f, si, fi) {
  return `<div class="tpl-field" data-si="${si}" data-fi="${fi}">
    <span class="tpl-field-type">${FIELD_TYPES[f.type] || f.type}</span>
    <input class="input sm" data-tpl="field-label" data-si="${si}" data-fi="${fi}" placeholder="Nombre del campo" value="${esc(f.label)}">
    ${f.type === "select" ? `<input class="input sm" data-tpl="field-options" data-si="${si}" data-fi="${fi}" placeholder="Opciones separadas por coma" value="${esc((f.options || []).join(", "))}">` : ""}
    ${f.type === "grid" ? `<input class="input sm" data-tpl="field-columns" data-si="${si}" data-fi="${fi}" placeholder="Columnas separadas por coma" value="${esc((f.columns || []).join(", "))}">` : ""}
    <button type="button" class="btn sm icon danger" data-action="tpl-del-field" data-si="${si}" data-fi="${fi}" aria-label="Quitar campo">${"✕"}</button></div>`;
}
/** Enlaza los controles del diseñador sobre un objeto `schema` mutable; `onChange` repinta */
export function bindBuilder(root, schema, onChange) {
  const paint = () => { root.innerHTML = builderHTML(schema); };
  root.addEventListener("input", (e) => {
    const t = e.target, si = +t.dataset.si, fi = +t.dataset.fi;
    if (t.dataset.tpl === "section-title") schema.sections[si].title = t.value;
    else if (t.dataset.tpl === "field-label") schema.sections[si].fields[fi].label = t.value;
    else if (t.dataset.tpl === "field-options") schema.sections[si].fields[fi].options = t.value.split(",").map((x) => x.trim()).filter(Boolean);
    else if (t.dataset.tpl === "field-columns") schema.sections[si].fields[fi].columns = t.value.split(",").map((x) => x.trim()).filter(Boolean);
  });
  root.addEventListener("click", (e) => {
    const add = e.target.closest("[data-action=tpl-add-section]"), addF = e.target.closest("[data-action=tpl-add-field]"),
      del = e.target.closest("[data-action=tpl-del-section]"), delF = e.target.closest("[data-action=tpl-del-field]");
    if (add) schema.sections.push(emptySection());
    else if (del) schema.sections.splice(+del.dataset.si, 1);
    else if (addF) { const si = +addF.dataset.si, type = root.querySelector(`[data-tpl=new-field-type][data-si="${si}"]`).value; schema.sections[si].fields.push(emptyField(type)); }
    else if (delF) schema.sections[+delF.dataset.si].fields.splice(+delF.dataset.fi, 1);
    else return;
    paint(); onChange?.();
  });
  paint();
}

/* --------------------------------- Llenado (en un hallazgo) ------------------------ */
function gridHTML(f, value, readonly) {
  const cols = f.columns?.length ? f.columns : ["Columna 1"], rows = Array.isArray(value) && value.length ? value : [cols.map(() => "")];
  const row = (r, ri) => `<tr data-ri="${ri}">${cols.map((_, ci) => `<td>${readonly ? esc(r[ci] || "") : `<input data-grid="${f.id}" data-ri="${ri}" data-ci="${ci}" value="${esc(r[ci] || "")}">`}</td>`).join("")}${readonly ? "" : `<td><button type="button" class="btn sm icon danger" data-action="tpl-grid-del" data-field="${f.id}" data-ri="${ri}" aria-label="Quitar fila">✕</button></td>`}</tr>`;
  return `<div class="tpl-grid-wrap"><table class="tpl-grid" data-grid-table="${f.id}"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}${readonly ? "" : "<th></th>"}</tr></thead><tbody>${rows.map(row).join("")}</tbody></table>
    ${readonly ? "" : `<button type="button" class="btn sm ghost" data-action="tpl-grid-add" data-field="${f.id}">+ Agregar fila</button>`}</div>`;
}
function fieldFillHTML(f, value, readonly) {
  if (f.type === "grid") return `<div class="field span-2"><span>${esc(f.label)}</span>${gridHTML(f, value, readonly)}</div>`;
  if (readonly) return `<div class="field"><span>${esc(f.label)}</span><div class="tpl-ro">${value ? esc(String(value)).replace(/\n/g, "<br>") : '<span class="muted">—</span>'}</div></div>`;
  if (f.type === "textarea") return `<label class="field span-2"><span>${esc(f.label)}</span><textarea class="textarea" data-field="${f.id}" rows="3">${esc(value || "")}</textarea></label>`;
  if (f.type === "select") return `<label class="field"><span>${esc(f.label)}</span><select class="select" data-field="${f.id}"><option value=""></option>${(f.options || []).map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  return `<label class="field"><span>${esc(f.label)}</span><input class="input" type="${f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}" data-field="${f.id}" value="${esc(value ?? "")}"></label>`;
}
/** HTML para llenar (o mostrar, si readonly) una plantilla con los datos guardados */
export function fillHTML(schema, data = {}, readonly = false) {
  if (!schema?.sections?.length) return `<p class="muted">Esta plantilla aún no tiene secciones.</p>`;
  return schema.sections.map((s) => `<div class="tpl-view-section"><h4>${esc(s.title || "Sección")}</h4><div class="form-grid">${s.fields.map((f) => fieldFillHTML(f, data[f.id], readonly)).join("") || '<p class="muted">Sin campos.</p>'}</div></div>`).join("");
}
/** Lee los valores capturados de un contenedor pintado con fillHTML(schema, data, false) */
export function readFill(root, schema) {
  const out = {};
  for (const s of schema.sections || []) for (const f of s.fields) {
    if (f.type === "grid") {
      const rows = [...root.querySelectorAll(`tr[data-ri]`)].filter((tr) => tr.querySelector(`[data-grid="${f.id}"]`))
        .map((tr) => (f.columns || []).map((_, ci) => tr.querySelector(`[data-grid="${f.id}"][data-ci="${ci}"]`)?.value || ""));
      out[f.id] = rows.filter((r) => r.some((c) => c.trim()));
    } else { const el = root.querySelector(`[data-field="${f.id}"]`); if (el) out[f.id] = el.value; }
  }
  return out;
}
/** Los botones "+ Agregar fila" / quitar fila de cualquier campo grid: delegados globalmente.
 *  El contenedor que use fillHTML(...) en modo edición debe marcarse con data-tpl-root
 *  y el llamador debe registrar, antes de pintar, `gridOwners[id] = { schema, getData, repaint }`. */
export const gridOwners = {};
on("tpl-grid-add", (el) => gridAction(el, true));
on("tpl-grid-del", (el) => gridAction(el, false));
/** Lee del DOM, tal cual está ahora mismo, las filas ya escritas de un campo grid (lo que el usuario tecleó
 *  pero aún no se ha guardado) para no perderlo al agregar o quitar una fila. */
function readGridLive(root, field) {
  const table = root.querySelector(`[data-grid-table="${field.id}"]`);
  if (!table) return [field.columns.map(() => "")];
  const rows = [...table.querySelectorAll("tr[data-ri]")].map((tr) => field.columns.map((_, ci) => tr.querySelector(`[data-ci="${ci}"]`)?.value || ""));
  return rows.length ? rows : [field.columns.map(() => "")];
}
function gridAction(el, add) {
  const root = el.closest("[data-tpl-root]"); if (!root) return;
  const owner = gridOwners[root.dataset.tplRoot]; if (!owner) return;
  const data = owner.getData();
  for (const s of owner.schema.sections) for (const f of s.fields) if (f.type === "grid" && f.id === el.dataset.field) {
    data[f.id] = readGridLive(root, f);                 // conserva lo ya escrito en pantalla, no lo que había antes de teclear
    if (add) data[f.id].push(f.columns.map(() => ""));
    else data[f.id].splice(+el.dataset.ri, 1);
    if (!data[f.id].length) data[f.id] = [f.columns.map(() => "")];
  }
  owner.repaint(data);
}
