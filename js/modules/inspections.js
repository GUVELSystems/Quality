/* =====================================================================
   Quality Control · Inspecciones
   Formatos (plantillas "Dimensional Inspection Report" por número de
   parte, con sus características/balloons y tolerancias) · Solicitudes
   (desde el Kiosk o capturadas por el equipo) · Registros (cuando una
   solicitud se atiende, con sus mediciones reales).
   ===================================================================== */
import * as db from "../db.js";
import { esc, uuid, today, fmtDate, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { setHead, navigate, rerender } from "../router.js";
import { on, onChange, onInput, badge, userCell, empty, openForm, confirmDialog, toast } from "../ui.js";
import { attachmentsSection, hooks } from "./attachments.js";
import { exportInspectionResult } from "../pdf-inspection.js";
import { userOpts } from "./shared.js";

hooks.inspection_format = () => rerender();   // al adjuntar el dibujo/imagen del formato, refresca la pantalla
hooks.inspection_record = () => rerender();
const TOL_TYPES = { bilateral: "Bilateral", limits: "Límites (USL/LSL directos)", unilateral_pos: "Unilateral positivo", unilateral_neg: "Unilateral negativo" };
const SERVICE_TYPES = ["Primera pieza", "Dimensional completo", "Recurrente", "Layout", "Otro"];

/** De la tolerancia capturada, calcula USL/LSL — "limits" los toma directos, el resto los deriva */
const round = (n) => Math.round(n * 1e6) / 1e6;   // evita residuos de punto flotante (25.4 - 0.05 = 25.35, no 25.349999999999998)
export function computeLimits(type, nominal, tolPlus, tolMinus, uslRaw, lslRaw) {
  const n = Number(nominal) || 0, tp = Number(tolPlus) || 0;
  const tm = tolMinus === "" || tolMinus == null ? tp : Number(tolMinus);   // bilateral: un solo campo "±" alimenta ambos lados
  if (type === "limits") return { usl: uslRaw === "" || uslRaw == null ? null : Number(uslRaw), lsl: lslRaw === "" || lslRaw == null ? null : Number(lslRaw) };
  if (type === "unilateral_pos") return { usl: round(n + tp), lsl: null };
  if (type === "unilateral_neg") return { usl: null, lsl: round(n - tm) };
  return { usl: round(n + tp), lsl: round(n - tm) };   // bilateral
}

/* ============================= FORMATOS ============================= */
const formatRows = () => db.rows("inspection_formats").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const itemsOf = (formatId) => db.rows("inspection_format_items").filter((i) => i.format_id === formatId).sort((a, b) => a.position - b.position);

function newFormatForm() {
  openForm({
    eyebrow: "Formatos", title: "Nuevo formato de inspección", submitLabel: "Crear y continuar",
    fields: [
      { name: "part_number", label: "Número de parte", required: true },
      { name: "part_name", label: "Nombre de la parte", required: true },
      { name: "revision", label: "Revisión / Level" },
      { name: "description", label: "Descripción", type: "textarea", span2: true },
    ],
    onSubmit: async (v) => {
      const r = await db.insert("inspection_formats", { ...v, active: true });
      toast(`Formato ${r.code} creado · agrega las características`, "ok");
      navigate(`inspecciones/formato/${r.id}`);
    },
  });
}
function editFormatMeta(f) {
  openForm({
    eyebrow: f.code, title: "Editar formato", submitLabel: "Guardar",
    fields: [
      { name: "part_number", label: "Número de parte", required: true },
      { name: "part_name", label: "Nombre de la parte", required: true },
      { name: "revision", label: "Revisión / Level" },
      { name: "description", label: "Descripción", type: "textarea", span2: true },
      { name: "active", label: "Activo (disponible para Solicitudes)", type: "select", options: [["true", "Sí"], ["false", "No"]] },
    ],
    values: { ...f, active: String(f.active) },
    onSubmit: async (v) => { await db.update("inspection_formats", f.id, { ...v, active: v.active === "true" }); toast("Formato actualizado", "ok"); await rerender(); },
    onDelete: db.can.manage ? async () => { await db.remove("inspection_formats", f.id); navigate("inspecciones/formatos"); } : null,
  });
}

function renderFormatosList(root) {
  const list = formatRows();
  root.innerHTML = `<div class="panel">
    <div class="toolbar"><span class="count">${list.length} formato(s)</span>${db.can.manage ? `<button class="btn primary" data-action="insp-fmt-new">${icon("plus")} Nuevo formato</button>` : ""}</div>
    ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Código</th><th>Número de parte</th><th>Nombre</th><th>Revisión</th><th>Características</th><th>Estado</th></tr></thead><tbody>
      ${list.map((f) => `<tr data-action="insp-fmt-open" data-id="${f.id}"><td class="code">${esc(f.code)}</td><td class="mono">${esc(f.part_number)}</td><td>${esc(f.part_name)}</td><td>${esc(f.revision || "—")}</td><td>${itemsOf(f.id).length}</td><td><span class="badge" data-tone="${f.active ? "ok" : "neutral"}">${f.active ? "Activo" : "Inactivo"}</span></td></tr>`).join("")}
      </tbody></table></div>` : empty("Sin formatos", "Crea el primer Dimensional Inspection Report.", "form")}
  </div>`;
}

const ITEM_TYPES = { variable: "Variable", atributo: "Atributo" };
function itemRow(f, it, i, editable) {
  const dk = (k) => `insf:${it.id}:${k}`;
  const itemType = db.state.drafts?.[dk("item_type")] ?? it.item_type ?? "variable";
  const type = db.state.drafts?.[dk("tolerance_type")] ?? it.tolerance_type ?? "bilateral";
  const get = (k, d = "") => db.state.drafts?.[dk(k)] ?? it[k] ?? d;
  const dis = editable ? "" : "disabled";
  const typeSel = `<select class="select sm" data-change="insf-pick" data-key="${dk("item_type")}" data-item="${it.id}" ${dis}>${Object.entries(ITEM_TYPES).map(([k, l]) => `<option value="${k}" ${k === itemType ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const head = `<td><input class="input sm" data-input="insf" data-key="${dk("balloon_no")}" value="${esc(get("balloon_no"))}" ${dis} style="width:55px"></td>
    <td><input class="input sm" data-input="insf" data-key="${dk("description")}" value="${esc(get("description"))}" ${dis} style="min-width:150px"></td>
    <td><input class="input sm" data-input="insf" data-key="${dk("specification")}" value="${esc(get("specification"))}" ${dis} style="min-width:100px"></td>
    <td>${typeSel}</td>`;
  const del = editable ? `<td><button type="button" class="btn sm ghost icon danger" data-action="insf-item-del" data-id="${it.id}">${icon("close")}</button></td>` : "";

  if (itemType === "atributo") {
    return `<tr data-item="${it.id}">${head}<td colspan="7" class="muted" style="font-size:12.5px">Se evalúa OK / NOK al capturar la medición — sin tolerancia numérica.</td>${del}</tr>`;
  }
  const lim = computeLimits(type, get("nominal"), get("tol_plus"), get("tol_minus"), get("usl"), get("lsl"));
  const tolSel = `<select class="select sm" data-change="insf-pick" data-key="${dk("tolerance_type")}" data-item="${it.id}" ${dis}>${Object.entries(TOL_TYPES).map(([k, l]) => `<option value="${k}" ${k === type ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const num = (k, placeholder, w = 72) => `<input class="input sm" type="number" step="any" placeholder="${esc(placeholder)}" data-input="insf" data-key="${dk(k)}" value="${esc(get(k))}" ${dis} style="width:${w}px">`;
  let tolCell;
  if (type === "limits") tolCell = `<td colspan="2">${num("usl", "USL")} ${num("lsl", "LSL")}</td>`;
  else if (type === "unilateral_pos") tolCell = `<td colspan="2">${num("tol_plus", "Tol. +")}</td>`;
  else if (type === "unilateral_neg") tolCell = `<td colspan="2">${num("tol_minus", "Tol. −")}</td>`;
  else tolCell = `<td colspan="2">${num("tol_plus", "Tolerancia ±")}</td>`;   // bilateral: un solo campo ± (se aplica a ambos lados)
  return `<tr data-item="${it.id}">${head}
    <td>${tolSel}</td>
    <td>${type === "limits" ? "—" : num("nominal", "Nominal", 70)}</td>
    ${tolCell}
    <td><b class="mono">${lim.usl ?? "—"}</b></td>
    <td><b class="mono">${lim.lsl ?? "—"}</b></td>
    <td><input class="input sm" data-input="insf" data-key="${dk("unit")}" value="${esc(get("unit"))}" ${dis} style="width:50px" placeholder="mm"></td>
    ${del}
  </tr>`;
}

function renderFormatoDetail(root, id) {
  const f = db.get("inspection_formats", id);
  if (!f) { root.innerHTML = empty("No encontrado", "Este formato no existe.", "form"); return; }
  const editable = db.can.manage;
  const items = itemsOf(f.id);
  setHead({ eyebrow: `Formatos · ${esc(f.code)}`, title: f.part_number, subtitle: f.part_name,
    actions: `<a class="btn" href="#/inspecciones/formatos">${icon("chevL")} Formatos</a>${editable ? `<button class="btn" data-action="insp-fmt-edit" data-id="${f.id}">${icon("edit")} Editar</button>` : ""}` });
  root.innerHTML = `<div class="stack">
    <div class="panel" style="padding:16px">
      <div class="form-grid">
        <div class="field"><span>Número de parte</span><div class="done-text mono">${esc(f.part_number)}</div></div>
        <div class="field"><span>Descripción</span><div class="done-text">${esc(f.part_name)}${f.description ? " — " + esc(f.description) : ""}</div></div>
        <div class="field"><span>Revisión / Level</span><div class="done-text">${esc(f.revision || "—")}</div></div>
        <div class="field"><span>Estado</span><div class="done-text">${f.active ? "Activo" : "Inactivo"}</div></div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field span-2"><span>Dibujo baloneado (PDF)</span>${attachmentsSection("inspection_format", f.id, { ref: "drawing", title: "", canEdit: editable, compact: true, uploadLabel: "Adjuntar dibujo", showCamera: false })}</div>
        <div class="field span-2"><span>Vista isométrica (imagen)</span>${attachmentsSection("inspection_format", f.id, { ref: "iso", title: "", canEdit: editable, compact: true, uploadLabel: "Adjuntar imagen" })}</div>
      </div>
    </div>
    <div class="panel" style="padding:16px">
      <h3 style="margin-bottom:10px">Características (balloons)</h3>
      <div class="table-wrap"><table class="table insf-grid"><thead><tr>
        <th>No.</th><th>Descripción</th><th>Especificación</th><th>Tipo</th><th>Tolerancia</th><th>Nominal</th><th colspan="2">Valor</th><th>USL</th><th>LSL</th><th>Unidad</th>${editable ? "<th></th>" : ""}
      </tr></thead><tbody>${items.map((it, i) => itemRow(f, it, i, editable)).join("") || `<tr><td colspan="11" class="muted" style="padding:14px">Sin características todavía.</td></tr>`}</tbody></table></div>
      ${editable ? `<div class="toolbar" style="margin-top:10px">
        <button type="button" class="btn sm" data-action="insf-item-add" data-id="${f.id}">${icon("plus")} Agregar característica</button>
        <button type="button" class="btn sm primary" data-action="insf-save" data-id="${f.id}">${icon("check2")} Guardar características</button>
      </div>` : ""}
    </div>
  </div>`;
}

/* ============================ SOLICITUDES ============================ */
const activeFormats = () => formatRows().filter((f) => f.active !== false);
const pendingRequests = () => db.rows("inspection_requests").filter((r) => r.status === "pendiente").sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

function newRequestForm() {
  const opts = activeFormats().map((f) => [f.id, `${f.part_number} · ${f.part_name}`]);
  openForm({
    eyebrow: "Solicitudes", title: "Nueva solicitud de inspección", size: "wide", submitLabel: "Registrar",
    fields: [
      { name: "requester_name", label: "Solicitante — nombre", required: true },
      { name: "requester_email", label: "Solicitante — correo", type: "email", required: true },
      { name: "shift", label: "Turno" },
      { name: "quantity", label: "Cantidad", type: "number", min: 0 },
      { name: "lot_number", label: "No. de lote" },
      { name: "purchase_order", label: "Orden de compra" },
      { name: "format_id", label: "Número de parte", type: "select", required: true, options: opts.length ? opts : [["", "Sin formatos activos — crea uno en Formatos"]] },
      { name: "operation_no", label: "No. de operación" },
      { name: "service_type", label: "Servicio de inspección", type: "select", options: SERVICE_TYPES.map((s) => [s, s]) },
      { name: "comments", label: "Comentarios / Indicaciones", type: "textarea", span2: true },
    ],
    values: { shift: "", quantity: 1 },
    onSubmit: async (v) => {
      const fmt = db.get("inspection_formats", v.format_id);
      if (!fmt) { toast("Elige un número de parte con formato activo.", "danger"); throw new Error("sin formato"); }
      const r = await db.insert("inspection_requests", { ...v, part_number: fmt.part_number, part_name: fmt.part_name, status: "pendiente" });
      toast(`Solicitud ${r.code} registrada`, "ok"); await rerender();
    },
  });
}

function renderSolicitudes(root) {
  const list = pendingRequests();
  root.innerHTML = `<div class="panel">
    <div class="toolbar"><span class="count">${list.length} solicitud(es) pendiente(s)</span><button class="btn primary" data-action="insp-req-new">${icon("plus")} Nueva solicitud</button></div>
    ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Solicitante</th><th>Número de parte</th><th>Lote</th><th>Cantidad</th><th>Servicio</th><th>Recibida</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr><td class="code">${esc(r.code)}</td><td>${esc(r.requester_name)}<span class="sub">${esc(r.requester_email)}</span></td><td class="mono">${esc(r.part_number)}<span class="sub">${esc(r.part_name)}</span></td><td>${esc(r.lot_number || "—")}</td><td>${r.quantity ?? "—"}</td><td>${esc(r.service_type || "—")}</td><td>${fmtDateTime(r.created_at)}</td><td><button class="btn sm primary" data-action="insp-req-attend" data-id="${r.id}">${icon("check2")} Atender</button></td></tr>`).join("")}
      </tbody></table></div>` : empty("Sin solicitudes pendientes", "Las solicitudes nuevas del Kiosk o capturadas aquí aparecerán en esta lista.", "inspection")}
  </div>`;
}

/* ============================= REGISTROS ============================= */
function renderRegistros(root) {
  const list = db.rows("inspection_records").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  root.innerHTML = `<div class="panel">
    <div class="toolbar"><span class="count">${list.length} registro(s)</span></div>
    ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Folio</th><th>Número de parte</th><th>Lote</th><th>Inspector</th><th>Resultado</th><th>Fecha</th></tr></thead><tbody>
      ${list.map((r) => `<tr data-action="insp-rec-open" data-id="${r.id}"><td class="code">${esc(r.code)}</td><td class="mono">${esc(r.part_number)}<span class="sub">${esc(r.part_name)}</span></td><td>${esc(r.lot_number || "—")}</td><td>${userCell(db.get("profiles", r.inspector_id))}</td><td>${r.overall_result ? `<span class="badge" data-tone="${r.overall_result === "cumple" ? "ok" : "danger"}">${r.overall_result === "cumple" ? "Cumple" : "No cumple"}</span>` : '<span class="muted">Pendiente</span>'}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join("")}
      </tbody></table></div>` : empty("Sin registros", "Al atender una solicitud, su registro dimensional aparecerá aquí.", "list")}
  </div>`;
}

/** Mediciones por pieza: measurements[item_id] es un arreglo, uno por cada pieza solicitada */
function pieceCount(r) { return Math.max(1, Number(r.quantity) || 1); }
function measAt(r, itemId, piece) { return r.measurements?.[itemId]?.[piece] || {}; }
function resultsSummary(r, items) {
  let ok = 0, nok = 0;
  for (const it of items) for (let p = 0; p < pieceCount(r); p++) { const m = measAt(r, it.id, p); if (m.value == null) continue; m.result === "cumple" ? ok++ : nok++; }
  return { ok, nok, total: ok + nok, pct: ok + nok ? Math.round((ok / (ok + nok)) * 1000) / 10 : null };
}
function donutSVG(ok, nok) {
  const total = ok + nok || 1, okFrac = ok / total, circ = 2 * Math.PI * 42;
  return `<svg viewBox="0 0 110 110" width="110" height="110">
    <circle cx="55" cy="55" r="42" fill="none" stroke="var(--stop)" stroke-width="14"/>
    <circle cx="55" cy="55" r="42" fill="none" stroke="var(--flow)" stroke-width="14" stroke-dasharray="${circ * okFrac} ${circ}" transform="rotate(-90 55 55)"/>
    <text x="55" y="51" text-anchor="middle" font-size="18" font-weight="700" fill="var(--ink)">${ok + nok ? Math.round(okFrac * 100) : 0}%</text>
    <text x="55" y="66" text-anchor="middle" font-size="10" fill="var(--text-2)">OK</text>
  </svg>`;
}
function filePreview(entity, id, ref, emptyLabel) {
  const list = db.rows("attachments").filter((a) => a.entity === entity && a.entity_id === id && (a.ref || null) === ref);
  if (!list.length) return `<p class="muted" style="margin:0;font-size:13px">${esc(emptyLabel)}</p>`;
  const a = list[list.length - 1];
  if ((a.mime_type || "").startsWith("image/")) return `<a data-att="${a.id}" target="_blank" rel="noopener"><img src="" alt="${esc(a.file_name)}" style="max-width:100%;max-height:200px;display:block;margin:0 auto"></a>`;
  if (a.mime_type === "application/pdf") return `<div class="insp-pdf-viewer"><iframe data-att="${a.id}" title="${esc(a.file_name)}"></iframe></div><a class="btn sm" data-att="${a.id}" target="_blank" rel="noopener" style="margin-top:8px">${icon("form")} Abrir en otra pestaña</a>`;
  return `<a class="btn sm" data-att="${a.id}" target="_blank" rel="noopener" download="${esc(a.file_name)}">${icon("form")} ${esc(a.file_name)}</a>`;
}
function renderRegistroDetail(root, id) {
  const r = db.get("inspection_records", id);
  if (!r) { root.innerHTML = empty("No encontrado", "", "list"); return; }
  const fmt = db.get("inspection_formats", r.format_id), items = itemsOf(r.format_id), req = r.request_id ? db.get("inspection_requests", r.request_id) : null;
  const pieces = pieceCount(r), sent = r.status === "enviado", sum = resultsSummary(r, items);
  setHead({ eyebrow: `Registros · ${esc(r.code)}`, title: r.part_number, subtitle: r.part_name,
    actions: `<a class="btn" href="#/inspecciones/registros">${icon("chevL")} Salir</a>${sent ? `<span class="badge" data-tone="ok">Enviado ${fmtDateTime(r.sent_at)}</span>` : ""}` });
  const dl = (k, v) => `<div class="insp-dl-item"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  root.innerHTML = `<div class="insp-rec-grid">
    <div class="insp-rec-col-main">
      <div class="panel" style="padding:14px 16px">
        <h3 class="insp-h3">Detalles de la solicitud</h3>
        <dl class="insp-dl">
          ${dl("Solicitante", `${esc(req?.requester_name || "—")} <span class="muted">${esc(req?.requester_email || "")}</span>`)}
          ${dl("Turno", esc(req?.shift || "—"))}
          ${dl("Lote", esc(r.lot_number || "—"))}
          ${dl("Orden de compra", esc(req?.purchase_order || "—"))}
          ${dl("No. de operación", esc(req?.operation_no || "—"))}
          ${dl("Servicio de inspección", esc(req?.service_type || "—"))}
          ${req?.comments ? dl("Comentarios", esc(req.comments)) : ""}
        </dl>
      </div>
      <div class="panel insp-rec-meas" style="padding:14px 16px">
        <h3 class="insp-h3">Mediciones${pieces > 1 ? ` <small class="muted">(${pieces} piezas solicitadas)</small>` : ""}</h3>
        <div class="table-wrap"><table class="table"><thead><tr><th>No.</th><th>Descripción</th><th>LSL</th><th>Nominal</th><th>USL</th>${Array.from({ length: pieces }, (_, p) => `<th>Pieza ${p + 1}</th>`).join("")}</tr></thead><tbody>
        ${items.map((it) => {
          const isAttr = it.item_type === "atributo";
          const lim = isAttr ? {} : computeLimits(it.tolerance_type, it.nominal, it.tol_plus, it.tol_minus, it.usl, it.lsl);
          return `<tr><td>${esc(it.balloon_no)}</td><td>${esc(it.description)}</td><td class="mono">${isAttr ? "—" : lim.lsl ?? "—"}</td><td class="mono">${isAttr ? "—" : it.nominal ?? "—"}</td><td class="mono">${isAttr ? "—" : lim.usl ?? "—"}</td>
            ${Array.from({ length: pieces }, (_, p) => {
              const m = measAt(r, it.id, p);
              if (isAttr) {
                const tone = m.value == null ? "" : m.value === "ok" ? "insp-cell-ok" : "insp-cell-bad";
                return `<td class="${tone}"><select class="select sm" data-change="insr-attr" data-key="meas:${it.id}:${p}" ${sent ? "disabled" : ""} style="width:76px"><option value="">—</option><option value="ok" ${m.value === "ok" ? "selected" : ""}>OK</option><option value="nok" ${m.value === "nok" ? "selected" : ""}>NOK</option></select></td>`;
              }
              const tone = m.value == null ? "" : m.result === "cumple" ? "insp-cell-ok" : "insp-cell-bad";
              return `<td class="${tone}"><input class="input sm" type="number" step="any" data-input="insr" data-key="meas:${it.id}:${p}" value="${esc(m.value ?? "")}" ${sent ? "disabled" : ""} style="width:76px"></td>`;
            }).join("")}
          </tr>`; }).join("")}
        </tbody></table></div>
        ${!sent ? `<div class="toolbar" style="margin-top:12px">
          <button type="button" class="btn" data-action="insp-rec-save" data-id="${r.id}">${icon("check2")} Guardar mediciones</button>
          <button type="button" class="btn primary" data-action="insp-rec-confirm" data-id="${r.id}">${icon("send")} Confirmar y enviar</button>
        </div>` : ""}
      </div>
    </div>
    <div class="insp-rec-col-side">
      <div class="panel insp-rec-top2">
        <div><h4 class="insp-h4">Número de parte</h4><p class="mono" style="font-size:16px;margin:4px 0 0;font-weight:700">${esc(r.part_number)}</p><p class="muted" style="margin:2px 0 0;font-size:13px">${esc(r.part_name)}</p></div>
        <div><h4 class="insp-h4">Imagen vista isométrica</h4>${filePreview("inspection_format", r.format_id, "iso", "Sin imagen.")}</div>
      </div>
      <div class="panel insp-rec-drawing" style="padding:14px 16px"><h4 class="insp-h4">Dibujo baloneado</h4>${filePreview("inspection_format", r.format_id, "drawing", "Sin dibujo en el formato.")}</div>
      <div class="panel" style="padding:14px 16px"><h4 class="insp-h4">Resultados</h4>
        ${sum.total ? `<div class="insp-donut">${donutSVG(sum.ok, sum.nok)}<div class="insp-donut-legend"><div><span class="dot" data-tone="info"></span>OK <b>${sum.ok}</b></div><div><span class="dot" data-tone="danger"></span>NOK <b>${sum.nok}</b></div></div></div><button type="button" class="btn sm" style="margin-top:10px;width:100%" data-action="insp-rec-pdf" data-id="${r.id}">${icon("download")} Descargar PDF</button>` : '<p class="muted" style="margin:0;font-size:13px">Captura mediciones para ver el resultado.</p>'}
      </div>
    </div>
  </div>`;
}

/* ============================ Workspace export ============================ */
export default {
  id: "inspecciones",
  renderDashboard(root) {
    const pend = pendingRequests().length, formats = formatRows().filter((f) => f.active).length, recs = db.rows("inspection_records").length;
    setHead({ title: "Quality Control", subtitle: "Inspecciones dimensionales: solicitudes, registros y formatos." });
    root.innerHTML = `<div class="kpi-strip">
      <a class="kpi" href="#/inspecciones/solicitudes" data-tone="${pend ? "warn" : "ok"}"><label>Solicitudes pendientes</label><strong>${pend}</strong><small>Por atender</small></a>
      <a class="kpi" href="#/inspecciones/registros" data-tone="info"><label>Registros</label><strong>${recs}</strong><small>Inspecciones realizadas</small></a>
      <a class="kpi" href="#/inspecciones/formatos" data-tone="info"><label>Formatos activos</label><strong>${formats}</strong><small>Números de parte con plantilla</small></a>
    </div>`;
  },
  renderInspecciones(root, params) {
    const sub = params?.[0] || "solicitudes";
    const isDetail = (sub === "formato" || sub === "registro") && params[1];
    if (!isDetail) {
      setHead({ title: "Inspecciones", subtitle: "Solicitudes, registros y formatos de inspección dimensional.", actions: "" });
      root.innerHTML = `<div class="type-tabs" role="tablist">
        ${[["solicitudes", "Solicitudes"], ["registros", "Registros"], ["formatos", "Formatos"]].map(([id, l]) => `<a href="#/inspecciones/${id}" class="type-tab ${sub === id ? "active" : ""}">${esc(l)}</a>`).join("")}
      </div><div id="insp-sub" style="margin-top:14px"></div>`;
    } else {
      root.innerHTML = `<div id="insp-sub"></div>`;   // en el detalle no hay pestañas: solo el "Salir" que pone el propio detalle
    }
    const sec = document.getElementById("insp-sub");
    if (sub === "solicitudes") renderSolicitudes(sec);
    else if (sub === "registros") renderRegistros(sec);
    else if (sub === "formatos") renderFormatosList(sec);
    else if (sub === "formato" && params[1]) renderFormatoDetail(sec, params[1]);
    else if (sub === "registro" && params[1]) renderRegistroDetail(sec, params[1]);
    else renderSolicitudes(sec);
  },
};

/* ------------------------------- Acciones -------------------------------- */
on("insp-fmt-new", () => newFormatForm());
on("insp-fmt-open", (el) => navigate(`inspecciones/formato/${el.dataset.id}`));
on("insp-fmt-edit", (el) => editFormatMeta(db.get("inspection_formats", el.dataset.id)));

db.state.drafts ??= {};
onInput("insf", (el) => { db.state.drafts[el.dataset.key] = el.value; });
onChange("insf-pick", (el) => { db.state.drafts[el.dataset.key] = el.value; rerender(); });
on("insf-item-add", async (el) => {
  try {
    await db.insert("inspection_format_items", { format_id: el.dataset.id, position: itemsOf(el.dataset.id).length + 1, balloon_no: String(itemsOf(el.dataset.id).length + 1), description: "", tolerance_type: "bilateral" });
    await rerender();
  } catch (e) { toast(e.message || "No se pudo agregar la característica.", "danger"); }
});
on("insf-item-del", async (el) => {
  if (!(await confirmDialog({ title: "Quitar característica", message: "¿Quitar esta característica del formato?", confirmLabel: "Quitar", danger: true }))) return;
  await db.remove("inspection_format_items", el.dataset.id); toast("Característica quitada", "ok"); await rerender();
});
on("insf-save", async (el) => {
  const items = itemsOf(el.dataset.id);
  for (const it of items) {
    const dk = (k) => db.state.drafts[`insf:${it.id}:${k}`];
    const itemType = dk("item_type") ?? it.item_type ?? "variable";
    const patch = { balloon_no: dk("balloon_no") ?? it.balloon_no, description: dk("description") ?? it.description, specification: dk("specification") ?? it.specification, item_type: itemType };
    if (itemType === "atributo") {
      patch.tolerance_type = null; patch.nominal = null; patch.tol_plus = null; patch.tol_minus = null; patch.usl = null; patch.lsl = null; patch.unit = null;
    } else {
      const type = dk("tolerance_type") ?? it.tolerance_type ?? "bilateral";
      patch.tolerance_type = type; patch.nominal = dk("nominal") ?? it.nominal;
      patch.tol_plus = dk("tol_plus") ?? it.tol_plus;
      patch.tol_minus = type === "bilateral" ? patch.tol_plus : (dk("tol_minus") ?? it.tol_minus);   // bilateral: el mismo valor "±" para ambos lados
      const lim = computeLimits(type, patch.nominal, patch.tol_plus, patch.tol_minus, dk("usl") ?? it.usl, dk("lsl") ?? it.lsl);
      patch.usl = lim.usl; patch.lsl = lim.lsl; patch.unit = dk("unit") ?? it.unit;
    }
    await db.update("inspection_format_items", it.id, patch);
  }
  for (const k of Object.keys(db.state.drafts)) if (k.startsWith("insf:")) delete db.state.drafts[k];
  toast("Características guardadas", "ok"); await rerender();
});

on("insp-req-new", () => newRequestForm());
on("insp-req-attend", async (el) => {
  const r = db.get("inspection_requests", el.dataset.id);
  const rec = await db.insert("inspection_records", { request_id: r.id, format_id: r.format_id, part_number: r.part_number, part_name: r.part_name, lot_number: r.lot_number, quantity: r.quantity, inspector_id: db.state.profile.id });
  await db.update("inspection_requests", r.id, { status: "atendida", record_id: rec.id });
  toast(`Solicitud atendida · registro ${rec.code} creado`, "ok");
  navigate(`inspecciones/registro/${rec.id}`);
});
on("insp-rec-open", (el) => navigate(`inspecciones/registro/${el.dataset.id}`));
/** Mientras se escribe, colorea la celda de una vez (antes de Guardar/Confirmar) — sin esperar nada */
function paintLiveCell(el) {
  const td = el.closest("td"); if (!td) return;
  td.classList.remove("insp-cell-ok", "insp-cell-bad");
  const [, itemId] = el.dataset.key.split(":"), v = el.value;
  if (v === "") return;
  const it = db.get("inspection_format_items", itemId); if (!it) return;
  const lim = computeLimits(it.tolerance_type, it.nominal, it.tol_plus, it.tol_minus, it.usl, it.lsl);
  const n = Number(v), ok = (lim.lsl == null || n >= lim.lsl) && (lim.usl == null || n <= lim.usl);
  td.classList.add(ok ? "insp-cell-ok" : "insp-cell-bad");
}
onInput("insr", (el) => { db.state.drafts[el.dataset.key] = el.value; paintLiveCell(el); });
onChange("insr-attr", (el) => { db.state.drafts[el.dataset.key] = el.value; rerender(); });
/** Junta lo capturado en pantalla (meas:item:pieza) en measurements[item][pieza] = {value, result} */
function collectMeasurements(r) {
  const items = itemsOf(r.format_id), measurements = JSON.parse(JSON.stringify(r.measurements || {}));
  let allOk = true, any = false;
  for (const it of items) {
    const isAttr = it.item_type === "atributo";
    for (let p = 0; p < pieceCount(r); p++) {
      const raw = db.state.drafts[`meas:${it.id}:${p}`]; if (raw === undefined) continue;
      measurements[it.id] ??= [];
      if (raw === "") { measurements[it.id][p] = undefined; continue; }
      any = true;
      if (isAttr) {
        const ok = raw === "ok"; if (!ok) allOk = false;
        measurements[it.id][p] = { value: raw, result: ok ? "cumple" : "no_cumple" };
        continue;
      }
      const v = Number(raw), lim = computeLimits(it.tolerance_type, it.nominal, it.tol_plus, it.tol_minus, it.usl, it.lsl);
      const ok = (lim.lsl == null || v >= lim.lsl) && (lim.usl == null || v <= lim.usl);
      if (!ok) allOk = false;
      measurements[it.id][p] = { value: v, result: ok ? "cumple" : "no_cumple" };
    }
  }
  return { measurements, allOk, any };
}
on("insp-rec-save", async (el) => {
  const r = db.get("inspection_records", el.dataset.id), { measurements, allOk, any } = collectMeasurements(r);
  await db.update("inspection_records", r.id, { measurements, overall_result: any ? (allOk ? "cumple" : "no_cumple") : r.overall_result });
  toast("Mediciones guardadas", "ok"); await rerender();
});
on("insp-rec-pdf", async (el) => {
  const r = db.get("inspection_records", el.dataset.id), fmt = db.get("inspection_formats", r.format_id), req = r.request_id ? db.get("inspection_requests", r.request_id) : null;
  try { await exportInspectionResult(r, { formatCode: fmt?.code, request: req, items: itemsOf(r.format_id), pieces: pieceCount(r), measAt, computeLimits }); }
  catch (e) { toast(e.message || "No se pudo generar el PDF.", "danger"); }
});
on("insp-rec-confirm", (el) => {
  const r = db.get("inspection_records", el.dataset.id);
  openForm({
    eyebrow: r.code, title: "Añadir destinatario", submitLabel: "Confirmar y enviar", size: "wide",
    fields: [{ name: "cc", label: "Destinatarios adicionales (separados por coma)", span2: true, placeholder: "calidad@empresa.com, supervisor@empresa.com" }],
    intro: `<div class="note" style="margin-bottom:14px">Se enviará un solo correo con el resultado a <b>${esc(db.get("inspection_requests", r.request_id)?.requester_email || "el solicitante")}</b>, junto con los destinatarios que agregues aquí.</div>`,
    onSubmit: async (v) => {
      const cc = (v.cc || "").split(",").map((s) => s.trim()).filter(Boolean);
      const { measurements, allOk, any } = collectMeasurements(r);
      await db.update("inspection_records", r.id, { measurements, overall_result: any ? (allOk ? "cumple" : "no_cumple") : r.overall_result, status: "enviado", sent_at: new Date().toISOString(), sent_by: db.state.profile.id, cc_emails: cc });
      try { await db.sendInspectionResult(r.id, cc); } catch (e) { toast("El registro se cerró, pero el correo no se pudo enviar: " + e.message, "danger"); await rerender(); return; }
      toast("Registro confirmado y enviado", "ok"); await rerender();
    },
  });
});
