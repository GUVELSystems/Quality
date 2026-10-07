/* Fábrica de módulos CRUD (tabla + filtros + formulario modal) */
import * as db from "../db.js";
import { esc, downloadCSV } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, rerender } from "../router.js";
import { on, onChange, onInput, empty, openForm, toast } from "../ui.js";

/**
 * cfg: { id,label,icon,title,subtitle,eyebrow,table,newLabel,
 *        columns:[{label,cell(row),cls}], fields(editing)=>[], defaults(),
 *        search:(row)=>string, filters:[{key,label,options:[[v,l]],test(row,val)}],
 *        sort(a,b), canWrite()=>bool, canDelete()=>bool, canCreate?:bool, top?(rows)=>html, intro?:html,
 *        beforeSave?(values,row) }
 */
export function makeCrud(cfg) {
  const S = { q: "", f: {} };
  const canWrite = cfg.canWrite || (() => db.can.write);
  const canDelete = cfg.canDelete || (() => db.can.manage);
  const canCreate = () => cfg.canCreate !== false && canWrite();

  const filtered = () => {
    const q = S.q.toLowerCase();
    return db.rows(cfg.table)
      .filter((r) => (!q || cfg.search(r).toLowerCase().includes(q)) && (cfg.filters || []).every((f) => !S.f[f.key] || f.test(r, S.f[f.key])))
      .sort(cfg.sort || ((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))));
  };

  const openEditor = (row) => {
    openForm({
      eyebrow: row ? row.code || cfg.label : cfg.eyebrow || "Nuevo registro",
      title: row ? `Editar ${cfg.singular || "registro"}` : cfg.newLabel,
      size: cfg.dialogSize || "", fields: cfg.fields(!!row), values: row || (cfg.defaults ? cfg.defaults() : {}), intro: row && cfg.editIntro ? cfg.editIntro(row) : "",
      submitLabel: row ? "Guardar" : "Crear",
      onSubmit: async (v) => {
        if (cfg.beforeSave) v = cfg.beforeSave(v, row) || v;
        if (row) await db.update(cfg.table, row.id, v); else await db.insert(cfg.table, v);
        toast(row ? "Cambios guardados" : "Registro creado", "ok");
        await rerender();
      },
      onDelete: row && canDelete() && cfg.canRemove !== false ? async () => { await db.remove(cfg.table, row.id); toast("Registro eliminado"); await rerender(); } : null,
    });
  };

  on(`${cfg.id}-new`, () => (cfg.onCreate ? cfg.onCreate() : openEditor(null)));
  on(`${cfg.id}-edit`, (el) => canWrite() && openEditor(db.get(cfg.table, el.dataset.id)));
  on(`${cfg.id}-export`, () => cfg.exportCols && downloadCSV(`${cfg.id}.csv`, cfg.exportCols, filtered()));
  onChange(`${cfg.id}-filter`, (el) => { S.f[el.dataset.key] = el.value; rerender(); });
  onInput(`${cfg.id}-q`, (el) => { S.q = el.value; const p = el.selectionStart; rerender().then(() => { const i = document.getElementById(`${cfg.id}-q`); i?.focus(); i?.setSelectionRange(p, p); }); });

  return {
    id: cfg.id, label: cfg.label, icon: cfg.icon,
    render(root) {
      setHead({
        title: cfg.title || cfg.label, subtitle: cfg.subtitle,
        actions: `${cfg.exportCols ? `<button class="btn" data-action="${cfg.id}-export">${icon("download")} Exportar CSV</button>` : ""}${canCreate() ? `<button class="btn primary" data-action="${cfg.id}-new">${icon("plus")} ${esc(cfg.newLabel)}</button>` : ""}`,
      });
      const list = filtered();
      root.innerHTML = `<div class="stack">${cfg.intro || ""}${cfg.top ? cfg.top(db.rows(cfg.table)) : ""}
        <div class="panel"><div class="toolbar">
          <input class="input grow" id="${cfg.id}-q" type="search" placeholder="Buscar…" value="${esc(S.q)}" data-input="${cfg.id}-q">
          ${(cfg.filters || []).map((f) => `<select class="select" data-change="${cfg.id}-filter" data-key="${f.key}"><option value="">${esc(f.label)}</option>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${S.f[f.key] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`).join("")}
          <span class="count">${list.length} registro(s)</span></div>
        ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
          ${list.map((r) => `<tr ${canWrite() ? `data-action="${cfg.id}-edit" data-id="${r.id}"` : ""}>${cfg.columns.map((c) => `<td class="${c.cls || ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
          : empty(`Sin ${cfg.label.toLowerCase()}`, "No hay registros con los filtros actuales.", cfg.icon)}
        </div></div>`;
    },
  };
}
