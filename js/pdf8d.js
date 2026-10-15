/* =====================================================================
   Exportación a PDF del 8D (5 Porqués o Ishikawa) y el 4D de GUVEL.
   Sigue el orden y las secciones de las plantillas oficiales (GUVEL_8Ds.xlsx,
   GUVEL_8D_Ishikawa.xlsx, GUVEL_4D.xlsx): los campos "TEXTO" del documento se
   llenan con lo capturado en el portal.
   ===================================================================== */
import * as db from "./db.js";
import { fmtDate, fmtDateTime } from "./utils.js";
import { RCA_TYPES, controlKey, closure4DStatus } from "./workflow.js";

const C = { navy: [15, 27, 45], cyan: [12, 192, 223], ink: [15, 27, 45], t2: [82, 100, 122], t3: [122, 138, 156], line: [221, 230, 238], panel: [244, 248, 251], white: [255, 255, 255] };
const PW = 595, PH = 842, M = 32;   // carta vertical, como los formatos originales

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("No se pudo cargar " + src)); document.head.append(s);
  });
}
async function lib() {
  if (!window.jspdf) { await loadScript("js/vendor/jspdf.umd.min.js"); await loadScript("js/vendor/jspdf.plugin.autotable.min.js"); }
  return window.jspdf;
}
/** Dimensiones reales de una imagen (data URL), para no deformarla al encajarla en el encabezado */
function imageSize(dataUrl) {
  return new Promise((res) => { const img = new Image(); img.onload = () => res({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 }); img.onerror = () => res({ w: 1, h: 1 }); img.src = dataUrl; });
}
let logoCache;
async function logo() {
  if (logoCache !== undefined) return logoCache;
  const custom = db.setting("capa_logo", null);
  const url = custom || (await (async () => { try { const blob = await (await fetch("assets/guvel-logo.png")).blob(); return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); } catch { return ""; } })());
  logoCache = url ? { url, ...(await imageSize(url)) } : null;
  return logoCache;
}

const g = (obj, path, dflt = "") => path.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj) ?? dflt;
const yn = (v) => (Number(v) ? "Yes" : "No");
function loadImageEl(url) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("No se pudo cargar la imagen")); img.src = url; });
}
const MIME_FMT = { "image/png": "PNG", "image/jpeg": "JPEG", "image/jpg": "JPEG", "image/webp": "WEBP" };
async function photosFor(findingId, ref) {
  return db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === findingId && a.ref === ref && (a.mime_type || "").startsWith("image/"));
}
/** Cada acción cierra sola al adjuntar su primera evidencia; aquí se recupera esa fecha para el PDF. */
function actionRows(findingId, key, rows) {
  return (rows || []).map((r, i) => {
    const atts = db.rows("attachments").filter((a) => a.entity === "finding" && a.entity_id === findingId && a.ref === `${key}:${r.id}`).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return [i + 1, r.action || "—", r.responsible || "—", fmtDate(r.due), atts.length ? fmtDate(atts[0].created_at) : "Pending"];
  });
}

/** Objeto mínimo para previsualizar un formato en blanco (sin datos capturados) */
export const blankTemplate = (ps, rca) => ({ id: "preview", code: ps === "4D" ? "XX-0000" : "XX-0000", title: "Vista previa del formato", description: "", strategy_ps: ps, strategy_rca: rca, class_id: null, created_at: new Date().toISOString(), registered_at: new Date().toISOString(), d_data: {}, control_number: "" });

export async function exportFinding8D4D(f, { preview = false } = {}) {
  if (!f?.strategy_ps) throw new Error("Este hallazgo aún no tiene una estrategia (8D/4D) definida.");
  const { jsPDF } = await lib();
  const doc = new jsPDF({ unit: "pt", format: [PW, PH] });
  const logoData = await logo();
  const d = f.d_data || {};
  const ink = (c) => doc.setTextColor(...c); const fill = (c) => doc.setFillColor(...c); const line = (c) => doc.setDrawColor(...c);
  let y = M;

  const HEAD_H = 76;
  const header = () => {
    fill(C.navy); doc.rect(0, 0, PW, HEAD_H, "F");
    if (logoData) {
      // Encaja el logo dentro de un recuadro grande SIN deformarlo (conserva su proporción real y su nitidez)
      const boxW = 120, boxH = 56, k = Math.min(boxW / logoData.w, boxH / logoData.h);
      const w = logoData.w * k, h = logoData.h * k;
      doc.addImage(logoData.url, M, (HEAD_H - h) / 2, w, h);
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); ink(C.white); doc.text(`${f.strategy_ps} - REPORT`, PW - M, HEAD_H / 2 - 6, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(C.cyan); doc.text(f.code, PW - M, HEAD_H / 2 + 10, { align: "right" });
    y = HEAD_H + 20;
  };
  const checkPage = (need = 60) => { if (y + need > PH - 40) { doc.addPage([PW, PH]); header(); } };
  const dBar = (label, title) => {
    checkPage(30); fill(C.navy); doc.rect(M, y, PW - 2 * M, 20, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); ink(C.white); doc.text(label, M + 8, y + 14);
    const labelW = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(title, M + 16 + labelW + 14, y + 14);
    y += 28;
  };
  const kv = (pairs) => {
    const w = (PW - 2 * M) / pairs.length;
    pairs.forEach(([k, v], i) => {
      const x = M + i * w;
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); ink(C.t2); doc.text(k, x, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(C.ink); doc.text(String(v || "—"), x, y + 12, { maxWidth: w - 6 });
    });
    y += 28;
  };
  const para = (label, text) => {
    checkPage(40);
    if (label) { doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); ink(C.t2); doc.text(label, M, y); y += 11; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(C.ink);
    const lines = doc.splitTextToSize(text || "—", PW - 2 * M);
    doc.text(lines, M, y); y += lines.length * 11 + 8;
  };
  const table = (head, rows, opts = {}) => {
    checkPage(50);
    doc.autoTable({ startY: y, margin: { left: M, right: M }, head: [head], body: rows.length ? rows : [head.map(() => "—")],
      theme: "grid", styles: { font: "helvetica", fontSize: 8, cellPadding: 4, lineColor: C.line, textColor: C.ink },
      headStyles: { fillColor: C.panel, textColor: C.t2, fontStyle: "bold", fontSize: 7.5 }, ...opts });
    y = doc.lastAutoTable.finalY + 10;
  };
  /** Fila de fotos (hasta 3, lado a lado) bajo una etiqueta, cada una respetando su proporción real */
  /** Hasta 2 fotos, lado a lado dentro de un ancho dado, cada una respetando su proporción real */
  const photosInBox = async (atts, x0, boxTotalW, boxH) => {
    const n = Math.min(atts.length, 2), gap = 8, boxW = n > 1 ? (boxTotalW - gap) / 2 : boxTotalW;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (boxW + gap);
      try {
        const url = await db.attachmentUrl(atts[i]), img = await loadImageEl(url);
        const k = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
        line(C.line); doc.rect(x, y, boxW, boxH);
        doc.addImage(img, MIME_FMT[atts[i].mime_type] || "JPEG", x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
      } catch { /* si no se pudo cargar, se deja el recuadro vacío */ }
    }
  };
  /** Dos columnas lado a lado (por ejemplo NOT OK / OK), para no gastar el doble de espacio vertical */
  const photoColumns = async (left, right) => {
    if (!left.atts.length && !right.atts.length) return;
    checkPage(120);
    const colW = (PW - 2 * M - 16) / 2, rightX = M + colW + 16, boxH = 110;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); ink(C.t2);
    doc.text(left.label, M, y); doc.text(right.label, rightX, y);
    y += 10;
    await photosInBox(left.atts, M, colW, boxH);
    await photosInBox(right.atts, rightX, colW, boxH);
    y += boxH + 12;
  };

  header();
  const audit = db.get("audits", f.audit_id), process = db.get("areas", audit?.process_area_id || f.area_id);
  kv([["Customer", db.get("companies", f.company_id)?.name || "—"], ["Part / Process Name", process?.name || f.area || "—"], ["Report No", f.code]]);
  kv([["Issue Date", fmtDate(f.created_at)], ["Start Date", fmtDate(f.registered_at || f.created_at)], ["Classification", `${f.class_id ? db.get("finding_classes", f.class_id)?.code : "—"}`]]);

  // D1 — Equipo
  dBar("D1", "Team");
  table(["No.", "Name", "Department", "Responsibility"], (d.team || []).map((r, i) => [i + 1, r[0], r[1], r[2]]));

  // D2 — Descripción del problema
  dBar("D2", "Problem Description");
  para("Failure Description:", d.failure_desc || f.description);
  const w5 = d.problem5w || {};
  table(["What?", "Where?", "When?", "Who?", "Why?", ...(f.strategy_ps === "4D" ? [] : ["How Much?", "Batch"])],
    [[w5.what, w5.where, w5.when, w5.who, w5.why, ...(f.strategy_ps === "4D" ? [] : [w5.how_much, w5.batch])]]);
  await photoColumns(
    { label: "NOT OK (condition found):", atts: await photosFor(f.id, "d2_nok") },
    { label: "OK (corrected condition):", atts: await photosFor(f.id, "d2_ok") },
  );

  if (f.strategy_ps === "4D") {
    // D3 — Root Cause (4D)
    dBar("D3", "Root Cause");
    const r = d.rootcause4d || {};
    table(["Problem", "Why?", "Why?", "Why?", "Why?", "Why? - Root Cause"], [[d.failure_desc || f.description, r.why1, r.why2, r.why3, r.why4, r.root_cause]]);
    // D4 — Immediate Actions + cierre
    dBar("D4", "Immediate Actions");
    table(["No.", "Action", "Responsible", "Due Date", "Completion Date"], actionRows(f.id, "immediate", d.immediate));
    const c4 = d.closure4d || {};
    kv([["Prepared By", db.profileName(c4.preparer_id || f.owner_id)], ["Date", fmtDate(c4.prepared_date)], ["Reviewed By", c4.reviewed_by_id ? db.profileName(c4.reviewed_by_id) : "—"]]);
    kv([["Date", fmtDate(c4.reviewed_date)], ["Status", closure4DStatus(f) || "—"], ["4D Completion Date", fmtDate(f.closed_at)]]);
  } else {
    // D3 — Containment (8D)
    dBar("D3", "Containment Action");
    table(["No.", "Action", "Responsible", "Due Date", "Completion Date"], actionRows(f.id, "containment", d.containment));
    // D4 — Root Cause (8D): 5 Porqués o Ishikawa
    dBar("D4", `Root Cause (${RCA_TYPES[f.strategy_rca] || "—"})`);
    if (f.strategy_rca === "ishikawa") {
      const ish = d.ishikawa || {};
      for (let i = 0; i < 3; i++) {
        checkPage(60);
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); ink(C.ink); doc.text(`Category ${i + 1}: ${ish[`cat${i}`] || "—"}`, M, y); y += 10;
        table(["Cause"], (ish[`causes${i}`] || []).map((r) => [r[0]]));
      }
      para("Problem:", ish.problem);
    } else {
      const chain = (key, label) => { const r = d[key] || {}; table([label, "Why?", "Why?", "Why?", "Why? - Root Cause"], [["", r.why1, r.why2, r.why3, r.root_cause]]); };
      para(null, "Why did the defect occur?"); chain("why_occur", "");
      para(null, "Why was it not detected?"); chain("why_detect", "");
      para(null, "Why was it not prevented?"); chain("why_prevent", "");
    }
    // D5-D8 (solo 8D)
    dBar("D5", "Planned Permanent Corrective Action(s)");
    table(["No.", "Action", "Responsible", "Due Date", "Completion Date"], actionRows(f.id, "corrective_plan", d.corrective_plan));
    dBar("D6", "Implemented Permanent Corrective Action(s)");
    table(["No.", "Action", "Responsible", "Due Date", "Completion Date"], actionRows(f.id, "corrective_done", d.corrective_done));
    dBar("D7", "Preventive Action(s)");
    table(["No.", "Action", "Responsible", "Due Date", "Completion Date"], actionRows(f.id, "preventive", d.preventive));
    const add = d.additional || {};
    table(["Additional Action", "Required", "Responsible", "Due Date", "Completion Date"], [
      ["Update FMEA?", yn(g(add, "fmea.flag")), g(add, "fmea.responsible"), fmtDate(g(add, "fmea.due")), fmtDate(g(add, "fmea.completion"))],
      ["Update Control Plan?", yn(g(add, "cp.flag")), g(add, "cp.responsible"), fmtDate(g(add, "cp.due")), fmtDate(g(add, "cp.completion"))],
      ["Roll-Across required?", yn(g(add, "rollacross.flag")), g(add, "rollacross.responsible"), fmtDate(g(add, "rollacross.due")), fmtDate(g(add, "rollacross.completion"))],
    ]);
    dBar("D8", "Congrats & 8D's Approved");
    para(null, "The team is recognized for their effort & collaboration in solving the problem.");
    const c8 = d.closure8d || {};
    kv([["Prepared By", c8.prepared_by], ["Reviewed By", c8.reviewed_by], ["Approved By", c8.approved_by]]);
    kv([["Closing Date", fmtDate(c8.closing_date)], ["8D Report Status", c8.status || "Open"], ["Report No", f.code]]);
  }

  // Verification
  dBar("Verification", "Result");
  para(null, f.verification_notes || "Pending.");

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); ink(C.t3);
  doc.text(`Generated by GUVEL Quality · ${fmtDateTime(new Date().toISOString())}`, M, PH - 20);
  const control = db.setting(controlKey(f.strategy_ps, f.strategy_rca), "");
  doc.text(`Control No: ${control || "—"}`, PW - M, PH - 20, { align: "right" });

  if (preview) { window.open(doc.output("bloburl"), "_blank"); return; }
  doc.save(`${f.code}_${f.strategy_ps}.pdf`);
}
