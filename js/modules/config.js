/* Configuración: clasificaciones (días hábiles), niveles LPA y áreas con responsables por nivel */
import * as db from "../db.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender } from "../router.js";
import { on, onInput, empty, openForm, toast, pill } from "../ui.js";
import { makeCrud } from "./crud.js";
import { classes, classTone, levels, levelLabel, verifyDays, verifyDaysForType, VERIFY_TYPES, SCOPES, scopesOf } from "../workflow.js";

const staff = () => db.activeProfiles().filter((p) => ["admin", "quality_manager", "auditor"].includes(p.role));
const yesNo = (v) => (v ? pill("Activo", "ok") : pill("Inactivo", "neutral"));

/* ------------------- Clasificaciones (N1, N2… con días hábiles) ------------------- */
export const findingClasses = makeCrud({
  id: "fclasses", label: "Clasificaciones", icon: "tag", singular: "clasificación",
  title: "Clasificaciones de hallazgo", subtitle: "Cada clasificación define cuántos días hábiles hay para cerrar las acciones y a qué tipo de auditoría aplica.",
  table: "finding_classes", newLabel: "Nueva clasificación", canWrite: () => db.can.manage,
  defaults: () => ({ active: true, days: 5, scopes: [...SCOPES.filter((s) => s !== "Interna")] }),
  search: (r) => `${r.code} ${r.name || ""} ${scopesOf(r).join(" ")}`,
  sort: (a, b) => scopesOf(a).join().localeCompare(scopesOf(b).join()) || a.days - b.days,
  filters: [{ key: "scope", label: "Todos los tipos", options: SCOPES.map((s) => [s, s === "Issues" ? "Issues (clientes)" : s]), test: (r, v) => scopesOf(r).includes(v) }],
  fields: () => [
    { name: "code", label: "Código", required: true, placeholder: "N1, NCM, NCm…", hint: "Es lo que se verá en el hallazgo." },
    { name: "name", label: "Nombre", placeholder: "Clasificación N1 / No conformidad mayor" },
    { name: "days", label: "Días hábiles para cerrar acciones", type: "number", required: true, min: 0, max: 365 },
    { name: "active", label: "Activa", type: "checkbox" },
    { name: "scopes", label: "Aplica a", type: "multicheck", required: true, span2: true, options: SCOPES.map((s) => [s, s === "Issues" ? "Issues (clientes)" : s]), hint: "Solo se podrá elegir en auditorías de los tipos marcados. Ej.: en Interna usa NCM / NCm en lugar de N1." },
  ],
  beforeSave: (v) => { if (!(v.scopes || []).length) throw new Error("Marca al menos un tipo en «Aplica a»."); return { ...v, code: v.code.trim() }; },
  intro: () => `<div class="panel"><div class="panel-head"><h2>Días de verificación por tipo</h2><small>Días hábiles que tiene el administrador para aceptar o rechazar, después de cerrar las acciones</small></div><div class="panel-body">
      <div class="verify-grid">${VERIFY_TYPES.map((t) => `<label class="field"><span>${t === "Issues" ? "Issues (clientes)" : t}</span><input class="input" type="number" min="1" max="365" data-vtype="${t}" value="${verifyDaysForType(t)}" ${db.can.manage ? "" : "disabled"}></label>`).join("")}
        <label class="field"><span>Por defecto <small class="muted">(sin tipo)</small></span><input class="input" type="number" min="1" max="365" data-vtype="default" value="${verifyDays()}" ${db.can.manage ? "" : "disabled"}></label></div>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:14px">${db.can.manage ? `<button class="btn" data-action="cfg-save-verify">Guardar días de verificación</button>` : ""}
        <span class="muted" style="font-size:13px">Ejemplo: LPA → 5 días · Interna → 10 días. Se aplica a los hallazgos cuyas acciones se cierren a partir de ahora.</span></div></div></div>`,
  columns: [
    { label: "Código", cell: (r) => `<span class="badge" data-tone="${classTone(r)}" style="text-transform:none">${esc(r.code)}</span>` },
    { label: "Nombre", cell: (r) => `<span class="title">${esc(r.name || r.code)}</span>` },
    { label: "Aplica a", cell: (r) => (scopesOf(r).length === SCOPES.length ? '<span class="muted">Todos los tipos</span>' : scopesOf(r).map((s) => `<span class="badge" data-tone="info" style="margin:2px 10px 2px 0;text-transform:none">${esc(s === "Issues" ? "Issues" : s)}</span>`).join("")) },
    { label: "Días hábiles", cls: "num", cell: (r) => `<b class="mono">${r.days}</b> días` },
    { label: "En uso", cls: "num", cell: (r) => `<span class="mono">${db.rows("findings").filter((f) => f.class_id === r.id).length}</span> hallazgos` },
    { label: "Estado", cell: (r) => yesNo(r.active) },
  ],
});
on("cfg-save-verify", async () => {
  const vals = [...document.querySelectorAll("[data-vtype]")].map((i) => [i.dataset.vtype, Number(i.value)]);
  if (vals.some(([, v]) => !(v >= 1))) { toast("Escribe un número de días válido (1 o más) en cada tipo.", "danger"); return; }
  try {
    for (const [t, v] of vals) await db.saveSetting(t === "default" ? "verification_days" : `verification_days_${t}`, v);
    toast("Días de verificación guardados", "ok"); await rerender();
  } catch (e) { toast(e.message, "danger"); }
});

/* ------------------------------- Niveles de LPA --------------------------------- */
export const lpaLevels = makeCrud({
  id: "lpalevels", label: "Niveles LPA", icon: "layers", singular: "nivel",
  title: "Niveles de LPA", subtitle: "Define cuántos niveles usa tu LPA. Se eligen al programar una auditoría y sirven para asignar responsables por área.",
  table: "lpa_levels", newLabel: "Nuevo nivel", canWrite: () => db.can.manage,
  defaults: () => ({ active: true, level: Math.max(0, ...db.rows("lpa_levels").map((l) => l.level)) + 1 }),
  search: (r) => `${r.level} ${r.name || ""}`, sort: (a, b) => a.level - b.level,
  fields: () => [
    { name: "level", label: "Número de nivel", type: "number", required: true, min: 1, max: 20 },
    { name: "name", label: "Nombre / quién audita", placeholder: "Ej. Líder de línea" },
    { name: "active", label: "Activo", type: "checkbox" },
  ],
  columns: [
    { label: "Nivel", cell: (r) => `<span class="badge" data-tone="info">N${r.level}</span>` },
    { label: "Nombre", cell: (r) => `<span class="title">${esc(r.name || "Nivel " + r.level)}</span>` },
    { label: "Responsables en áreas", cls: "num", cell: (r) => `<span class="mono">${db.rows("area_level_owners").filter((x) => Number(x.level) === r.level).length}</span>` },
    { label: "Auditorías", cls: "num", cell: (r) => `<span class="mono">${db.rows("audits").filter((a) => a.level === r.level).length}</span>` },
    { label: "Estado", cell: (r) => yesNo(r.active) },
  ],
  beforeSave: (v) => ({ ...v, level: Number(v.level) }),
});

/* ---------------------- Áreas y responsables por nivel -------------------------- */
const ownersOf = (areaId) => db.rows("area_level_owners").filter((r) => r.area_id === areaId).sort((a, b) => a.level - b.level);

function areaForm(area) {
  const lv = levels(), mine = area ? ownersOf(area.id) : [];
  openForm({
    eyebrow: area ? "Editar área" : "Nueva área", title: area ? area.name : "Nueva área", size: "wide", submitLabel: area ? "Guardar" : "Crear área",
    intro: `<div class="note" style="margin-bottom:14px">El <b>dueño</b> es el responsable general del área. Si un nivel LPA tiene su propio responsable, los hallazgos de ese nivel se le asignan a él; si no, al dueño.</div>`,
    values: { name: area?.name || "", owner_id: area?.owner_id || "", active: area ? area.active : true, ...Object.fromEntries(lv.map((l) => [`lvl_${l.level}`, mine.find((m) => Number(m.level) === l.level)?.owner_id || ""])) },
    fields: [
      { name: "name", label: "Nombre del área", required: true, span2: true, placeholder: "Calidad" },
      { name: "owner_id", label: "Dueño del área (responsable)", type: "select", options: staff().map((p) => [p.id, p.full_name]), span2: true },
      ...lv.map((l) => ({ name: `lvl_${l.level}`, label: `Responsable ${levelLabel(l.level)}`, type: "select", options: staff().map((p) => [p.id, p.full_name]) })),
      { name: "active", label: "Área activa", type: "checkbox", span2: true },
    ],
    onSubmit: async (v) => {
      const data = { name: v.name.trim(), owner_id: v.owner_id || null, active: v.active };
      const a = area ? await db.update("areas", area.id, data) : await db.insert("areas", data);
      for (const l of lv) {
        const want = v[`lvl_${l.level}`] || "", cur = db.rows("area_level_owners").find((r) => r.area_id === a.id && Number(r.level) === l.level);
        if (want && !cur) await db.insert("area_level_owners", { area_id: a.id, level: l.level, owner_id: want });
        else if (want && cur && cur.owner_id !== want) await db.update("area_level_owners", cur.id, { owner_id: want });
        else if (!want && cur) await db.remove("area_level_owners", cur.id);
      }
      toast(area ? "Área actualizada" : "Área creada", "ok"); await rerender();
    },
    onDelete: area && db.can.manage ? async () => { await db.remove("areas", area.id); toast("Área eliminada"); await rerender(); } : null,
  });
}

let areaQ = "";
export const areas = {
  id: "areas", label: "Áreas", icon: "area",
  render(root) {
    setHead({ title: "Áreas", subtitle: "Áreas de la planta con su responsable y los responsables por nivel de LPA. Los formatos asignan cada pregunta a un área.", actions: db.can.manage ? `<button class="btn primary" data-action="ar-new">${icon("plus")} Nueva área</button>` : "" });
    const list = db.rows("areas").filter((a) => !areaQ || a.name.toLowerCase().includes(areaQ)).sort((a, b) => a.name.localeCompare(b.name));
    root.innerHTML = `<div class="panel">
      <div class="toolbar"><input class="input grow" id="ar-q" type="search" placeholder="Buscar área…" value="${esc(areaQ)}" data-input="ar-q"><span class="count">${list.length} área(s)</span></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Área</th><th>Dueño</th><th>Responsables por nivel</th><th>Preguntas</th><th>Estado</th></tr></thead><tbody>
      ${list.map((a) => { const o = ownersOf(a.id); return `<tr ${db.can.manage ? `data-action="ar-edit" data-id="${a.id}"` : ""}><td><span class="title">${esc(a.name)}</span></td><td>${esc(db.profileName(a.owner_id))}</td>
        <td>${o.length ? o.map((r) => `<span class="badge" data-tone="info" style="margin:2px 10px 2px 0;text-transform:none">N${r.level} · ${esc(db.profileName(r.owner_id).split(" ")[0])}</span>`).join("") : '<span class="muted">Solo el dueño</span>'}</td>
        <td class="mono">${db.rows("form_items").filter((i) => i.area_id === a.id).length}</td><td>${yesNo(a.active)}</td></tr>`; }).join("")}</tbody></table></div>` : empty("Sin áreas", "Crea tu primera área, por ejemplo «Calidad».", "area")}</div>`;
  },
};
on("ar-new", () => areaForm(null));
on("ar-edit", (el) => areaForm(db.get("areas", el.dataset.id)));
onInput("ar-q", (el) => { areaQ = el.value.toLowerCase(); const p = el.selectionStart; rerender().then(() => { const i = document.getElementById("ar-q"); i?.focus(); i?.setSelectionRange(p, p); }); });

/* ------------------ Clasificaciones y niveles en una sola página ----------------- */
export const classesAndLevels = {
  id: "clevels", label: "Clasificaciones y niveles", icon: "tag",
  render(root) {
    root.innerHTML = `<div class="stack">
      <section><div class="sec-title">${icon("tag")}<span>Clasificaciones de hallazgo</span><small>N1, N2… con sus días hábiles</small></div><div id="cl-a"></div></section>
      <section><div class="sec-title">${icon("layers")}<span>Niveles de LPA</span><small>Cuántos niveles usa tu LPA</small></div><div id="cl-b"></div></section></div>`;
    findingClasses.render(root.querySelector("#cl-a"));
    lpaLevels.render(root.querySelector("#cl-b"));
    setHead({
      title: "Clasificaciones y niveles", subtitle: "Define los plazos en días hábiles de cada clasificación y los niveles que usa tu LPA.",
      actions: db.can.manage ? `<button class="btn" data-action="lpalevels-new">${icon("plus")} Nuevo nivel</button><button class="btn primary" data-action="fclasses-new">${icon("plus")} Nueva clasificación</button>` : "",
    });
  },
};
