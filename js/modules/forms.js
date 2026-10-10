import * as db from "../db.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, wsId } from "../router.js";
import { typesOf, formsOf, WS_LABEL } from "../scope.js";
import { areas as activeAreas } from "../workflow.js";
import { KINDS, isDimension, specText, rangeText, validateDim, parseValue, typedDecimals } from "../dimension.js";
import { on, onChange, badge, pill, empty, openDialog, confirmDialog, toast } from "../ui.js";

const itemsOf = (id) => db.rows("form_items").filter((i) => i.form_id === id).sort((a, b) => a.position - b.position);
let F = { q: "", type: "" };

async function saveForm(form, head, items) {
  const f = form ? await db.update("forms", form.id, head) : await db.insert("forms", head);
  const product = head.audit_type === "Producto";
  const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
  for (const cur of itemsOf(f.id)) if (!keep.has(cur.id)) await db.remove("form_items", cur.id);
  const num = (v) => (v === "" || v === null || v === undefined ? null : parseValue(v));
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx], dim = product && isDimension(it);
    const internal = head.audit_type === "Interna";
    const data = {
      form_id: f.id, position: idx + 1, area_id: it.area_id || null, section: db.get("areas", it.area_id)?.name || null, question: it.question, critical: !!it.critical,
      kind: dim ? "dimension" : "inspeccion", nominal: dim ? num(it.nominal) : null, tol_plus: dim ? num(it.tol_plus) : null, tol_minus: dim ? num(it.tol_minus) : null, unit: dim ? (it.unit || "").trim() || null : null,
      decimals: dim ? Math.min(6, Math.max(typedDecimals(it.nominal, it.tol_plus, it.tol_minus), Number.isInteger(it.decimals) ? it.decimals : 0)) : null,
      clause: internal ? (it.clause || "").trim() || null : null,
    };
    if (it.id) await db.update("form_items", it.id, data); else await db.insert("form_items", data);
  }
  return f;
}

function editor(form) {
  const canEdit = db.can.manage;
  let items = form ? itemsOf(form.id).map((i) => ({ ...i, kind: i.kind || "inspeccion", area_id: i.area_id || db.rows("areas").find((a) => a.name === i.section)?.id || "" })) : [{ kind: "inspeccion", area_id: "", question: "", critical: false }];
  const dlg = openDialog({
    eyebrow: form ? form.code : "Nuevo formato", title: form ? "Editar formato" : "Crear formato", size: "wide",
    body: `<form id="fm-head" class="form-grid" novalidate>
      <label class="field"><span>Número de formato <i>*</i></span><input class="input" name="code" required value="${esc(form?.code || "")}" placeholder="FOR-LPA-002"></label>
      <label class="field"><span>Tipo de auditoría <i>*</i></span><select class="select" name="audit_type">${typesOf(wsId()).map((t) => `<option ${form?.audit_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field span-2"><span>Nombre <i>*</i></span><input class="input" name="name" required value="${esc(form?.name || "")}"></label>
      <label class="field"><span>Versión</span><input class="input" name="version" value="${esc(form?.version || "1.0")}"></label>
      <label class="check" style="align-self:end;height:38px"><input type="checkbox" name="active" ${form?.active === false ? "" : "checked"}> Formato activo</label>
      <label class="field" id="fm-process-wrap"><span>Proceso a auditar</span><select class="select" name="process_area_id"><option value="">— Proceso —</option>${activeAreas().map((a) => `<option value="${a.id}" ${a.id === form?.process_area_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="field" id="fm-standard-wrap"><span>Norma aplicable</span><select class="select" name="standard_id"><option value="">— Norma —</option>${db.rows("standards").filter((s) => s.active).map((s) => `<option value="${s.id}" ${s.id === form?.standard_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label></form>
      <div class="section-title"><span>Preguntas del checklist</span><button type="button" class="btn sm" id="fm-add">${icon("plus")} Agregar pregunta</button></div>
      <div id="fm-items"></div>
      <p id="fm-note" class="muted hidden" style="margin-top:10px;font-size:13px"><b>Sección «Dimensión»:</b> en la auditoría no se responde Cumple / No cumple, sino que se captura el valor medido; si queda fuera de nominal ± tolerancia se marca en rojo como No cumple. <b>«Inspección»</b> se responde como siempre.</p>
      <p class="muted" style="margin-top:10px;font-size:12px">Al eliminar una pregunta también se eliminan sus respuestas históricas. Para retirarla de futuras auditorías sin perder historial, crea una nueva versión del formato.</p>
      <div id="fm-err" class="alert hidden" style="margin-top:14px"></div>`,
    footer: `${form && canEdit ? `<button class="btn danger" id="fm-del" style="margin-right:auto">Eliminar formato</button>` : ""}<button class="btn" data-close>Cancelar</button>${canEdit ? `<button class="btn primary" id="fm-save">Guardar formato</button>` : ""}`,
  });
  const box = dlg.el.querySelector("#fm-items");
  const head = () => dlg.el.querySelector("#fm-head");
  const isProduct = () => head().elements.audit_type.value === "Producto";
  const areaSelect = (it, i) => `<select class="select" data-k="area_id" data-i="${i}" aria-label="Área"><option value="">— Área —</option>${activeAreas().map((a) => `<option value="${a.id}" ${a.id === it.area_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`;
  const dimPreview = (it) => (validateDim(it) ? "Completa nominal y tolerancia para ver el rango." : `Especificación <b>${esc(specText(it))}</b> · rango aceptado <b>${esc(rangeText(it))}</b>`);
  const paint = () => {
    const P = isProduct();
    box.innerHTML = items.map((it, i) => {
      const dim = P && isDimension(it);
      const I = isProduct() ? false : head().elements.audit_type.value === "Interna";
      const kindSel = P ? `<select class="select" data-k="kind" data-i="${i}" aria-label="Sección"><option value="" disabled>Sección</option>${Object.entries(KINDS).map(([v, l]) => `<option value="${v}" ${(it.kind || "inspeccion") === v ? "selected" : ""}>${l}</option>`).join("")}</select>` : "";
      const clauseInput = I ? `<input class="input" data-k="clause" data-i="${i}" placeholder="Cláusula (ej. 8.5.1)" value="${esc(it.clause || "")}">` : "";
      return `<div class="item-row it-row" style="align-items:flex-start;gap:8px">
      <span class="mono muted" style="width:22px;padding-top:9px">${i + 1}</span>
      <div class="it-main"><div class="it-line ${P ? "prod" : I ? "internal" : ""}">${kindSel}${clauseInput}${areaSelect(it, i)}<input class="input" data-k="question" data-i="${i}" placeholder="${dim ? "Característica (ej. Diámetro exterior)" : "Pregunta"}" value="${esc(it.question || "")}"></div>
        ${dim ? `<div class="it-dim"><label class="field"><span>Nominal</span><input class="input" inputmode="decimal" data-k="nominal" data-i="${i}" placeholder="12.000" value="${esc(it.nominal ?? "")}"></label>
          <label class="field"><span>Tolerancia +</span><input class="input" inputmode="decimal" data-k="tol_plus" data-i="${i}" placeholder="0.021" value="${esc(it.tol_plus ?? "")}"></label>
          <label class="field"><span>Tolerancia −</span><input class="input" inputmode="decimal" data-k="tol_minus" data-i="${i}" placeholder="igual a +" value="${esc(it.tol_minus ?? "")}"></label>
          <label class="field"><span>Unidad</span><input class="input" data-k="unit" data-i="${i}" placeholder="mm" value="${esc(it.unit ?? "")}"></label>
          <div class="dim-preview" id="dp_${i}">${dimPreview(it)}</div></div>` : ""}</div>
      <label class="check" style="white-space:nowrap;padding-top:8px"><input type="checkbox" data-k="critical" data-i="${i}" ${it.critical ? "checked" : ""}> Crítica</label>
      <button type="button" class="btn sm icon" data-mv="-1" data-i="${i}" aria-label="Subir">${icon("arrowUp")}</button><button type="button" class="btn sm icon" data-mv="1" data-i="${i}" aria-label="Bajar">${icon("arrowDown")}</button><button type="button" class="btn sm icon danger" data-rm="${i}" aria-label="Quitar">${icon("trash")}</button></div>`;
    }).join("") || `<div class="muted">Sin preguntas todavía.</div>`;
    dlg.el.querySelector("#fm-note").classList.toggle("hidden", !P);
    const I = head().elements.audit_type.value === "Interna";
    dlg.el.querySelector("#fm-process-wrap").classList.toggle("hidden", !I);
    dlg.el.querySelector("#fm-standard-wrap").classList.toggle("hidden", !I);
  };

  paint();
  const sync = (e) => {
    const t = e.target;
    if (!t.dataset.k) return;
    const it = items[+t.dataset.i];
    it[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value;
    if (t.dataset.k === "kind" && e.type === "change") paint();                                   // Dimensión muestra nominal y tolerancias
    if (["nominal", "tol_plus", "tol_minus", "unit"].includes(t.dataset.k)) { const p = dlg.el.querySelector(`#dp_${t.dataset.i}`); if (p) p.innerHTML = dimPreview(it); }
  };
  box.addEventListener("input", sync); box.addEventListener("change", sync);
  head().elements.audit_type.addEventListener("change", paint);                                   // Sección / dimensiones solo aparecen en Producto
  box.addEventListener("click", (e) => {
    const mv = e.target.closest("[data-mv]"), rm = e.target.closest("[data-rm]");
    if (mv) { const i = +mv.dataset.i, j = i + +mv.dataset.mv; if (items[j]) { [items[i], items[j]] = [items[j], items[i]]; paint(); } }
    if (rm) { items.splice(+rm.dataset.rm, 1); paint(); }
  });
  dlg.el.querySelector("#fm-add").onclick = () => { const last = items[items.length - 1]; items.push({ kind: isProduct() ? last?.kind || "inspeccion" : "inspeccion", area_id: last?.area_id || "", question: "", critical: false }); paint(); box.lastElementChild?.querySelector('[data-k="question"]')?.focus(); };
  const err = dlg.el.querySelector("#fm-err");
  dlg.el.querySelector("#fm-save")?.addEventListener("click", async (e) => {
    const f = dlg.el.querySelector("#fm-head");
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const clean = items.filter((i) => (i.question || "").trim());
    if (!clean.length) { err.textContent = "Agrega al menos una pregunta."; err.classList.remove("hidden"); return; }
    if (isProduct()) {
      const bad = clean.map((i, n) => (isDimension(i) ? [n + 1, i, validateDim(i)] : null)).find((x) => x && x[2]);
      if (bad) { err.textContent = `«${bad[1].question}»: ${bad[2]}`; err.classList.remove("hidden"); return; }
    }
    err.classList.add("hidden");
    e.target.disabled = true;
    try {
      await saveForm(form, { code: f.elements.code.value.trim(), name: f.elements.name.value.trim(), audit_type: f.elements.audit_type.value, version: f.elements.version.value.trim() || "1.0", active: f.elements.active.checked }, clean);
      toast("Formato guardado", "ok"); dlg.close(); await rerender();
    } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); e.target.disabled = false; }
  });
  dlg.el.querySelector("#fm-del")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "¿Eliminar formato?", message: "Se eliminan sus preguntas y las respuestas históricas asociadas.", confirmLabel: "Eliminar", danger: true }))) return;
    try { await db.remove("forms", form.id); toast("Formato eliminado"); dlg.close(); await rerender(); } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
  });
}

export default {
  id: "forms", label: "Formularios", icon: "form",
  render(root) {
    setHead({ title: "Formatos", subtitle: `Checklists que se usan al ejecutar las auditorías de ${WS_LABEL[wsId()]}.`, actions: db.can.manage ? `<button class="btn primary" data-action="fm-new">${icon("plus")} Nuevo formato</button>` : "" });
    const types = typesOf(wsId()), list = formsOf(wsId()).filter((f) => !F.type || f.audit_type === F.type).sort((a, b) => a.code.localeCompare(b.code));
    root.innerHTML = `<div class="panel">${types.length > 1 ? `<div class="toolbar"><select class="select" data-change="fm-filter"><option value="">Todos los tipos</option>${types.map((t) => `<option ${F.type === t ? "selected" : ""}>${t}</option>`).join("")}</select><span class="count">${list.length} formato(s)</span></div>` : ""}${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Formato</th><th>Nombre</th><th>Tipo</th><th>Versión</th><th class="num">Preguntas</th><th>Estado</th></tr></thead><tbody>
      ${list.map((f) => { const n = itemsOf(f.id), nd = n.filter(isDimension).length; return `<tr data-action="fm-edit" data-id="${f.id}"><td class="code">${esc(f.code)}</td><td><span class="title">${esc(f.name)}</span></td><td>${pill(f.audit_type, "info")}</td><td class="mono">v${esc(f.version)}</td><td class="num mono">${n.length}${nd ? ` <span class="muted">(${nd} dimensión)</span>` : ""}${n.some((i) => i.critical) ? ` <span class="muted">(${n.filter((i) => i.critical).length} críticas)</span>` : ""}</td><td>${pill(f.active ? "Activo" : "Inactivo", f.active ? "ok" : "neutral")}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin formatos", "Crea tu primer formato de auditoría.", "form")}</div>`;
  },
};
onChange("fm-filter", (el) => { F.type = el.value; rerender(); });
on("fm-new", () => editor(null));
on("fm-edit", (el) => editor(db.get("forms", el.dataset.id)));
