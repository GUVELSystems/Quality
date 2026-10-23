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
import { attachmentsSection } from "./attachments.js";
import { userOpts } from "./shared.js";

const TOL_TYPES = { bilateral: "Bilateral", limits: "Límites (USL/LSL directos)", unilateral_pos: "Unilateral positivo", unilateral_neg: "Unilateral negativo" };
const SERVICE_TYPES = ["Primera pieza", "Dimensional completo", "Recurrente", "Layout", "Otro"];

/** De la tolerancia capturada, calcula USL/LSL — "limits" los toma directos, el resto los deriva */
const round = (n) => Math.round(n * 1e6) / 1e6;   // evita residuos de punto flotante (25.4 - 0.05 = 25.35, no 25.349999999999998)
export function computeLimits(type, nominal, tolPlus, tolMinus, uslRaw, lslRaw) {
  const n = Number(nominal) || 0, tp = Number(tolPlus) || 0, tm = Number(tolMinus) || 0;
  if (type === "limits") return { usl: uslRaw === "" || uslRaw == null ? null : Number(uslRaw), lsl: lslRaw === "" || lslRaw == null ? null : Number(lslRaw) };
  if (type === "unilateral_pos") return { usl: round(n + tp), lsl: n };
  if (type === "unilateral_neg") return { usl: n, lsl: round(n - tm) };
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
      navigate(`calidad/inspecciones/formato/${r.id}`);
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
    onDelete: db.can.manage ? async () => { await db.remove("inspection_formats", f.id); navigate("calidad/inspecciones/formatos"); } : null,
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

function itemRow(f, it, i, editable) {
  const dk = (k) => `insf:${it.id}:${k}`;
  const type = db.state.drafts?.[dk("tolerance_type")] ?? it.tolerance_type ?? "bilateral";
  const get = (k, d = "") => db.state.drafts?.[dk(k)] ?? it[k] ?? d;
  const lim = computeLimits(type, get("nominal"), get("tol_plus"), get("tol_minus"), get("usl"), get("lsl"));
  return `<tr data-item="${it.id}">
    <td><input class="input sm" data-input="insf" data-key="${dk("balloon_no")}" value="${esc(get("balloon_no"))}" ${editable ? "" : "disabled"} style="width:60px"></td>
    <td><input class="input sm" data-input="insf" data-key="${dk("description")}" value="${esc(get("description"))}" ${editable ? "" : "disabled"} style="min-width:160px"></td>
    <td><input class="input sm" data-input="insf" data-key="${dk("specification")}" value="${esc(get("specification"))}" ${editable ? "" : "disabled"} style="min-width:110px"></td>
    <td><select class="select sm" data-change="insf-tol" data-key="${dk("tolerance_type")}" data-item="${it.id}" ${editable ? "" : "disabled"}>${Object.entries(TOL_TYPES).map(([k, l]) => `<option value="${k}" ${k === type ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    ${type === "limits"
      ? `<td colspan="3"><input class="input sm" type="number" step="any" placeholder="Nominal (opcional)" data-input="insf" data-key="${dk("nominal")}" value="${esc(get("nominal"))}" ${editable ? "" : "disabled"} style="width:90px"></td>`
      : `<td><input class="input sm" type="number" step="any" data-input="insf" data-key="${dk("nominal")}" value="${esc(get("nominal"))}" ${editable ? "" : "disabled"} style="width:80px"></td>
         <td>${type !== "unilateral_neg" ? `<input class="input sm" type="number" step="any" placeholder="Tol. +" data-input="insf" data-key="${dk("tol_plus")}" value="${esc(get("tol_plus"))}" ${editable ? "" : "disabled"} style="width:70px">` : '<span class="muted">—</span>'}</td>
         <td>${type !== "unilateral_pos" ? `<input class="input sm" type="number" step="any" placeholder="Tol. −" data-input="insf" data-key="${dk("tol_minus")}" value="${esc(get("tol_minus"))}" ${editable ? "" : "disabled"} style="width:70px">` : '<span class="muted">—</span>'}</td>`}
    <td>${type === "limits" ? `<input class="input sm" type="number" step="any" placeholder="USL" data-input="insf" data-key="${dk("usl")}" value="${esc(get("usl"))}" ${editable ? "" : "disabled"} style="width:75px">` : `<b class="mono">${lim.usl ?? "—"}</b>`}</td>
    <td>${type === "limits" ? `<input class="input sm" type="number" step="any" placeholder="LSL" data-input="insf" data-key="${dk("lsl")}" value="${esc(get("lsl"))}" ${editable ? "" : "disabled"} style="width:75px">` : `<b class="mono">${lim.lsl ?? "—"}</b>`}</td>
    <td><input class="input sm" data-input="insf" data-key="${dk("unit")}" value="${esc(get("unit"))}" ${editable ? "" : "disabled"} style="width:55px" placeholder="mm"></td>
    ${editable ? `<td><button type="button" class="btn sm ghost icon danger" data-action="insf-item-del" data-id="${it.id}">${icon("close")}</button></td>` : ""}
  </tr>`;
}

function renderFormatoDetail(root, id) {
  const f = db.get("inspection_formats", id);
  if (!f) { root.innerHTML = empty("No encontrado", "Este formato no existe.", "form"); return; }
  const editable = db.can.manage;
  const items = itemsOf(f.id);
  setHead({ eyebrow: `Formatos · ${esc(f.code)}`, title: f.part_number, subtitle: f.part_name,
    actions: `<a class="btn" href="#/calidad/inspecciones/formatos">${icon("chevL")} Formatos</a>${editable ? `<button class="btn" data-action="insp-fmt-edit" data-id="${f.id}">${icon("edit")} Editar</button>` : ""}` });
  root.innerHTML = `<div class="stack">
    <div class="panel" style="padding:16px">
      <div class="form-grid">
        <div class="field"><span>Número de parte</span><div class="done-text mono">${esc(f.part_number)}</div></div>
        <div class="field"><span>Descripción</span><div class="done-text">${esc(f.part_name)}${f.description ? " — " + esc(f.description) : ""}</div></div>
        <div class="field"><span>Revisión / Level</span><div class="done-text">${esc(f.revision || "—")}</div></div>
        <div class="field"><span>Estado</span><div class="done-text">${f.active ? "Activo" : "Inactivo"}</div></div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field span-2"><span>Dibujo baloneado (PDF)</span>${attachmentsSection("inspection_format", f.id, { ref: "drawing", title: "", canEdit: editable, compact: true })}</div>
        <div class="field span-2"><span>Vista isométrica (imagen)</span>${attachmentsSection("inspection_format", f.id, { ref: "iso", title: "", canEdit: editable, compact: true })}</div>
      </div>
    </div>
    <div class="panel" style="padding:16px">
      <h3 style="margin-bottom:10px">Características (balloons)</h3>
      <div class="table-wrap"><table class="table insf-grid"><thead><tr>
        <th>No.</th><th>Descripción</th><th>Especificación</th><th>Tolerancia</th><th>Nominal</th><th>Tol. +</th><th>Tol. −</th><th>USL</th><th>LSL</th><th>Unidad</th>${editable ? "<th></th>" : ""}
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

function renderRegistroDetail(root, id) {
  const r = db.get("inspection_records", id);
  if (!r) { root.innerHTML = empty("No encontrado", "", "list"); return; }
  const fmt = db.get("inspection_formats", r.format_id), items = itemsOf(r.format_id);
  setHead({ eyebrow: `Registros · ${esc(r.code)}`, title: r.part_number, subtitle: r.part_name,
    actions: `<a class="btn" href="#/calidad/inspecciones/registros">${icon("chevL")} Registros</a>` });
  root.innerHTML = `<div class="stack">
    <div class="panel" style="padding:16px"><div class="form-grid">
      <div class="field"><span>Formato</span><div class="done-text">${fmt ? esc(fmt.code) : "—"}</div></div>
      <div class="field"><span>Lote</span><div class="done-text">${esc(r.lot_number || "—")}</div></div>
      <div class="field"><span>Cantidad</span><div class="done-text">${r.quantity ?? "—"}</div></div>
      <div class="field"><span>Inspector</span><div class="done-text">${userCell(db.get("profiles", r.inspector_id))}</div></div>
    </div></div>
    <div class="panel" style="padding:16px"><h3 style="margin-bottom:10px">Mediciones</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>No.</th><th>Descripción</th><th>LSL</th><th>Nominal</th><th>USL</th><th>Medición</th><th>Resultado</th></tr></thead><tbody>
      ${items.map((it) => { const m = r.measurements?.[it.id] || {}; const lim = computeLimits(it.tolerance_type, it.nominal, it.tol_plus, it.tol_minus, it.usl, it.lsl);
        return `<tr><td>${esc(it.balloon_no)}</td><td>${esc(it.description)}</td><td class="mono">${lim.lsl ?? "—"}</td><td class="mono">${it.nominal ?? "—"}</td><td class="mono">${lim.usl ?? "—"}</td><td><input class="input sm" type="number" step="any" data-input="insr" data-key="meas:${it.id}" value="${esc(m.value ?? "")}" style="width:90px"></td><td>${m.value != null ? `<span class="badge" data-tone="${m.result === "cumple" ? "ok" : "danger"}">${m.result === "cumple" ? "Cumple" : "No cumple"}</span>` : "—"}</td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="toolbar" style="margin-top:10px"><button type="button" class="btn primary" data-action="insp-rec-save" data-id="${r.id}">${icon("check2")} Guardar mediciones</button></div>
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
      <a class="kpi" href="#/calidad/inspecciones/solicitudes" data-tone="${pend ? "warn" : "ok"}"><label>Solicitudes pendientes</label><strong>${pend}</strong><small>Por atender</small></a>
      <a class="kpi" href="#/calidad/inspecciones/registros" data-tone="info"><label>Registros</label><strong>${recs}</strong><small>Inspecciones realizadas</small></a>
      <a class="kpi" href="#/calidad/inspecciones/formatos" data-tone="info"><label>Formatos activos</label><strong>${formats}</strong><small>Números de parte con plantilla</small></a>
    </div>`;
  },
  renderInspecciones(root, params) {
    const sub = params?.[0] || "solicitudes";
    setHead({ title: "Inspecciones", subtitle: "Solicitudes, registros y formatos de inspección dimensional.",
      actions: "" });
    root.innerHTML = `<div class="type-tabs" role="tablist">
      ${[["solicitudes", "Solicitudes"], ["registros", "Registros"], ["formatos", "Formatos"]].map(([id, l]) => `<a href="#/calidad/inspecciones/${id}" class="type-tab ${sub === id ? "active" : ""}">${esc(l)}</a>`).join("")}
    </div><div id="insp-sub" style="margin-top:14px"></div>`;
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
on("insp-fmt-open", (el) => navigate(`calidad/inspecciones/formato/${el.dataset.id}`));
on("insp-fmt-edit", (el) => editFormatMeta(db.get("inspection_formats", el.dataset.id)));

db.state.drafts ??= {};
onInput("insf", (el) => { db.state.drafts[el.dataset.key] = el.value; });
onChange("insf-tol", (el) => { db.state.drafts[el.dataset.key] = el.value; rerender(); });
on("insf-item-add", (el) => { db.state.drafts[`__newitem:${el.dataset.id}:${uuid()}`] = true; const tmpId = uuid(); db.insert("inspection_format_items", { format_id: el.dataset.id, position: itemsOf(el.dataset.id).length + 1, balloon_no: String(itemsOf(el.dataset.id).length + 1), description: "", tolerance_type: "bilateral" }).then(() => rerender()); });
on("insf-item-del", async (el) => {
  if (!(await confirmDialog({ title: "Quitar característica", message: "¿Quitar esta característica del formato?", confirmLabel: "Quitar", danger: true }))) return;
  await db.remove("inspection_format_items", el.dataset.id); toast("Característica quitada", "ok"); await rerender();
});
on("insf-save", async (el) => {
  const items = itemsOf(el.dataset.id);
  for (const it of items) {
    const dk = (k) => db.state.drafts[`insf:${it.id}:${k}`];
    const type = dk("tolerance_type") ?? it.tolerance_type;
    const patch = {
      balloon_no: dk("balloon_no") ?? it.balloon_no, description: dk("description") ?? it.description, specification: dk("specification") ?? it.specification,
      tolerance_type: type, nominal: dk("nominal") ?? it.nominal, tol_plus: dk("tol_plus") ?? it.tol_plus, tol_minus: dk("tol_minus") ?? it.tol_minus,
    };
    const lim = computeLimits(type, patch.nominal, patch.tol_plus, patch.tol_minus, dk("usl") ?? it.usl, dk("lsl") ?? it.lsl);
    patch.usl = lim.usl; patch.lsl = lim.lsl; patch.unit = dk("unit") ?? it.unit;
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
  navigate(`calidad/inspecciones/registro/${rec.id}`);
});
on("insp-rec-open", (el) => navigate(`calidad/inspecciones/registro/${el.dataset.id}`));
onInput("insr", (el) => { db.state.drafts[el.dataset.key] = el.value; });
on("insp-rec-save", async (el) => {
  const r = db.get("inspection_records", el.dataset.id), items = itemsOf(r.format_id);
  const measurements = { ...r.measurements }; let allOk = true, any = false;
  for (const it of items) {
    const raw = db.state.drafts[`meas:${it.id}`]; if (raw === undefined || raw === "") continue;
    any = true; const v = Number(raw), lim = computeLimits(it.tolerance_type, it.nominal, it.tol_plus, it.tol_minus, it.usl, it.lsl);
    const ok = (lim.lsl == null || v >= lim.lsl) && (lim.usl == null || v <= lim.usl);
    if (!ok) allOk = false;
    measurements[it.id] = { value: v, result: ok ? "cumple" : "no_cumple" };
  }
  await db.update("inspection_records", r.id, { measurements, overall_result: any ? (allOk ? "cumple" : "no_cumple") : r.overall_result });
  toast("Mediciones guardadas", "ok"); await rerender();
});
