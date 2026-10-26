/* =====================================================================
   Quality Control · PDF de resultados de una inspección (Registro)
   ===================================================================== */
import { fmtDateTime } from "./utils.js";

const C = { navy: [15, 27, 45], cyan: [12, 192, 223], ink: [15, 27, 45], t2: [82, 100, 122], line: [221, 230, 238], ok: [27, 158, 119], stop: [232, 59, 59], white: [255, 255, 255] };
const PW = 595, PH = 842, M = 36;   // carta/A4 vertical, en puntos

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

export async function exportInspectionResult(record, { formatCode, request, items, pieces, measAt, computeLimits, sentByName, download = true }) {
  const { jsPDF } = await lib();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const ink = (c) => doc.setTextColor(...c); const fill = (c) => doc.setFillColor(...c);
  doc.setFont("helvetica", "bold"); fill(C.navy); doc.rect(0, 0, PW, 56, "F");
  ink(C.white); doc.setFontSize(14); doc.text("GUVEL QUALITY", M, 34);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(C.cyan); doc.text("Resultado de inspección dimensional", M, 48);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(record.code, PW - M, 34, { align: "right" });

  let y = 80;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); ink(C.ink); doc.text(`${record.part_number} — ${record.part_name}`, M, y); y += 20;

  const kv = (pairs) => {
    const w = (PW - 2 * M) / pairs.length;
    pairs.forEach(([k, v], i) => {
      const x = M + i * w;
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); ink(C.t2); doc.text(k, x, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(C.ink); doc.text(String(v || "—"), x, y + 12, { maxWidth: w - 8 });
    });
    y += 30;
  };
  const reqDate = request?.created_at ? new Date(request.created_at) : null;
  kv([["FECHA DE SOLICITUD", reqDate ? reqDate.toLocaleDateString("es-MX") : "—"], ["HORA DE SOLICITUD", reqDate ? reqDate.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"], ["REALIZÓ", sentByName || "—"]]);
  kv([["FORMATO", formatCode], ["LOTE", record.lot_number], ["CANTIDAD", record.quantity]]);
  kv([["SOLICITANTE", request?.requester_name], ["CORREO", request?.requester_email], ["SERVICIO", request?.service_type]]);
  kv([["TURNO", request?.shift], ["ORDEN DE COMPRA", request?.purchase_order], ["NO. DE OPERACIÓN", request?.operation_no]]);

  const head = ["No.", "Descripción", "LSL", "Nominal", "USL", ...Array.from({ length: pieces }, (_, p) => `Pieza ${p + 1}`)];
  const body = items.map((it) => {
    if (it.item_type === "atributo") return [it.balloon_no, it.description, "—", "—", "—", ...Array.from({ length: pieces }, (_, p) => { const m = measAt(record, it.id, p); return m.result === "cumple" ? "OK" : m.result === "no_cumple" ? "NOK" : "—"; })];
    const lim = computeLimits(it.tolerance_type, it.nominal, it.tol_plus, it.tol_minus, it.usl, it.lsl);
    return [it.balloon_no, it.description, lim.lsl ?? "—", it.nominal ?? "—", lim.usl ?? "—", ...Array.from({ length: pieces }, (_, p) => { const m = measAt(record, it.id, p); return m.value ?? "—"; })];
  });
  doc.autoTable({
    startY: y, head: [head], body, theme: "grid", margin: { left: M, right: M },
    headStyles: { fillColor: C.navy, textColor: C.white, fontSize: 8 }, styles: { fontSize: 8.5, cellPadding: 4 },
    didParseCell: (d) => {
      if (d.section !== "body" || d.column.index < 5) return;
      const it = items[d.row.index], p = d.column.index - 5, m = measAt(record, it.id, p);
      if (m.value == null) return;
      if (it.item_type === "atributo") { d.cell.styles.fillColor = m.result === "cumple" ? C.ok : C.stop; d.cell.styles.textColor = C.white; return; }
      d.cell.styles.fillColor = m.result === "cumple" ? [210, 240, 227] : [250, 210, 210];
    },
  });
  y = doc.lastAutoTable.finalY + 24;

  let ok = 0, nok = 0;
  for (const it of items) for (let p = 0; p < pieces; p++) { const m = measAt(record, it.id, p); if (m.value == null) continue; m.result === "cumple" ? ok++ : nok++; }
  const pct = ok + nok ? Math.round((ok / (ok + nok)) * 1000) / 10 : null;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); ink(C.ink); doc.text("Resultado general:", M, y);
  ink(nok === 0 ? C.ok : C.stop); doc.text(nok === 0 && ok > 0 ? "CUMPLE" : nok > 0 ? "NO CUMPLE" : "SIN RESULTADO", M + 120, y);
  if (pct != null) { ink(C.t2); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`${pct}% OK  ·  ${ok} OK / ${nok} NOK`, M + 220, y); }
  y += 24;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); ink(C.t2);
  doc.text(`Confirmado ${fmtDateTime(record.sent_at || new Date().toISOString())}`, M, y);

  if (download) { doc.save(`${record.code}_${record.part_number}.pdf`); return null; }
  return doc.output("datauristring").split(",")[1];   // base64 puro, sin el prefijo "data:application/pdf;..."
}
