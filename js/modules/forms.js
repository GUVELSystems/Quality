import * as db from "../db.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender, wsId } from "../router.js";
import { typesOf, formsOf, WS_LABEL } from "../scope.js";
import { on, badge, pill, empty, openDialog, confirmDialog, toast } from "../ui.js";

const itemsOf = (id) => db.rows("form_items").filter((i) => i.form_id === id).sort((a, b) => a.position - b.position);
let F = { q: "", type: "" };

async function saveForm(form, head, items) {
  const f = form ? await db.update("forms", form.id, head) : await db.insert("forms", head);
  const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
  for (const cur of itemsOf(f.id)) if (!keep.has(cur.id)) await db.remove("form_items", cur.id);
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx], data = { form_id: f.id, position: idx + 1, section: it.section || null, question: it.question, critical: !!it.critical };
    if (it.id) await db.update("form_items", it.id, data); else await db.insert("form_items", data);
  }
  return f;
}

function editor(form) {
  const canEdit = db.can.manage;
  let items = form ? itemsOf(form.id).map((i) => ({ ...i })) : [{ section: "", question: "", critical: false }];
  const dlg = openDialog({
    eyebrow: form ? form.code : "Nuevo formato", title: form ? "Editar formato" : "Crear formato", size: "wide",
    body: `<form id="fm-head" class="form-grid" novalidate>
      <label class="field"><span>Número de formato <i>*</i></span><input class="input" name="code" required value="${esc(form?.code || "")}" placeholder="FOR-LPA-002"></label>
      <label class="field"><span>Tipo de auditoría <i>*</i></span><select class="select" name="audit_type">${typesOf(wsId()).map((t) => `<option ${form?.audit_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field span-2"><span>Nombre <i>*</i></span><input class="input" name="name" required value="${esc(form?.name || "")}"></label>
      <label class="field"><span>Versión</span><input class="input" name="version" value="${esc(form?.version || "1.0")}"></label>
      <label class="check" style="align-self:end;height:38px"><input type="checkbox" name="active" ${form?.active === false ? "" : "checked"}> Formato activo</label></form>
      <div class="section-title"><span>Preguntas del checklist</span><button type="button" class="btn sm" id="fm-add">${icon("plus")} Agregar pregunta</button></div>
      <div id="fm-items"></div>
      <p class="muted" style="margin-top:10px;font-size:12px">Al eliminar una pregunta también se eliminan sus respuestas históricas. Para retirarla de futuras auditorías sin perder historial, crea una nueva versión del formato.</p>
      <div id="fm-err" class="alert hidden" style="margin-top:14px"></div>`,
    footer: `${form && canEdit ? `<button class="btn danger" id="fm-del" style="margin-right:auto">Eliminar formato</button>` : ""}<button class="btn" data-close>Cancelar</button>${canEdit ? `<button class="btn primary" id="fm-save">Guardar formato</button>` : ""}`,
  });
  const box = dlg.el.querySelector("#fm-items");
  const paint = () => {
    box.innerHTML = items.map((it, i) => `<div class="item-row" style="align-items:center;gap:8px">
      <span class="mono muted" style="width:22px">${i + 1}</span>
      <div style="flex:1;display:grid;grid-template-columns:minmax(90px,170px) 1fr;gap:8px"><input class="input" data-k="section" data-i="${i}" placeholder="Sección" value="${esc(it.section || "")}"><input class="input" data-k="question" data-i="${i}" placeholder="Pregunta" value="${esc(it.question || "")}"></div>
      <label class="check" style="white-space:nowrap"><input type="checkbox" data-k="critical" data-i="${i}" ${it.critical ? "checked" : ""}> Crítica</label>
      <button type="button" class="btn sm icon" data-mv="-1" data-i="${i}" aria-label="Subir">${icon("arrowUp")}</button><button type="button" class="btn sm icon" data-mv="1" data-i="${i}" aria-label="Bajar">${icon("arrowDown")}</button><button type="button" class="btn sm icon danger" data-rm="${i}" aria-label="Quitar">${icon("trash")}</button></div>`).join("") || `<div class="muted">Sin preguntas todavía.</div>`;
  };
  paint();
  const sync = (e) => { const t = e.target; if (t.dataset.k) items[+t.dataset.i][t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; };
  box.addEventListener("input", sync); box.addEventListener("change", sync);
  box.addEventListener("click", (e) => {
    const mv = e.target.closest("[data-mv]"), rm = e.target.closest("[data-rm]");
    if (mv) { const i = +mv.dataset.i, j = i + +mv.dataset.mv; if (items[j]) { [items[i], items[j]] = [items[j], items[i]]; paint(); } }
    if (rm) { items.splice(+rm.dataset.rm, 1); paint(); }
  });
  dlg.el.querySelector("#fm-add").onclick = () => { const last = items[items.length - 1]; items.push({ section: last?.section || "", question: "", critical: false }); paint(); box.lastElementChild?.querySelector('[data-k="question"]')?.focus(); };
  const err = dlg.el.querySelector("#fm-err");
  dlg.el.querySelector("#fm-save")?.addEventListener("click", async (e) => {
    const f = dlg.el.querySelector("#fm-head");
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const clean = items.filter((i) => (i.question || "").trim());
    if (!clean.length) { err.textContent = "Agrega al menos una pregunta."; err.classList.remove("hidden"); return; }
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
    const list = formsOf(wsId()).sort((a, b) => a.code.localeCompare(b.code));
    root.innerHTML = `<div class="panel">${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Formato</th><th>Nombre</th><th>Tipo</th><th>Versión</th><th class="num">Preguntas</th><th>Estado</th></tr></thead><tbody>
      ${list.map((f) => { const n = itemsOf(f.id); return `<tr data-action="fm-edit" data-id="${f.id}"><td class="code">${esc(f.code)}</td><td><span class="title">${esc(f.name)}</span></td><td>${pill(f.audit_type, "info")}</td><td class="mono">v${esc(f.version)}</td><td class="num mono">${n.length}${n.some((i) => i.critical) ? ` <span class="muted">(${n.filter((i) => i.critical).length} críticas)</span>` : ""}</td><td>${pill(f.active ? "Activo" : "Inactivo", f.active ? "ok" : "neutral")}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Sin formatos", "Crea tu primer formato de auditoría.", "form")}</div>`;
  },
};
on("fm-new", () => editor(null));
on("fm-edit", (el) => editor(db.get("forms", el.dataset.id)));
