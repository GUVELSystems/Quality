/* =====================================================================
   Exportación del plan de auditoría a PDF (jsPDF + autotable, vendorizados)
   Estructura: portada con datos clave → calendario semanal → detalle por
   fecha → resumen por auditor. Fines de semana sin asignar en naranja tenue.
   ===================================================================== */
import * as db from "./db.js";
import { fmtDate, mondayOf, addDays, eachDay, isWeekend, parseDate, DOW_SHORT, DOW_LONG, fmtDateTime } from "./utils.js";
const rangeText = (a, b) => `${fmtDate(a)} al ${fmtDate(b)}`; // la fuente del PDF no incluye flechas
import { AUDIT_STATUS } from "./constants.js";

const C = {
  navy: [15, 27, 45], cyan: [12, 192, 223], ink: [15, 27, 45], t2: [82, 100, 122], t3: [122, 138, 156],
  line: [221, 230, 238], panel: [244, 248, 251], head: [228, 236, 243],
  wk: [253, 236, 208], wkLine: [236, 196, 138], wkInk: [138, 90, 0],
  ok: [27, 158, 119], stop: [232, 59, 59], watch: [233, 162, 31], white: [255, 255, 255], out: [238, 242, 246],
};
const PW = 842, PH = 595, M = 36;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("No se pudo cargar " + src));
    document.head.append(s);
  });
}
async function lib() {
  if (!window.jspdf) {
    await loadScript("js/vendor/jspdf.umd.min.js");
    await loadScript("js/vendor/jspdf.plugin.autotable.min.js");
  }
  return window.jspdf;
}
let logoCache = null;
async function logo() {
  if (logoCache) return logoCache;
  try {
    const blob = await (await fetch("assets/guvel-logo.png")).blob();
    logoCache = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  } catch { logoCache = ""; }
  return logoCache;
}

const shortDate = (s) => { const d = parseDate(s); return `${DOW_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${fmtDate(s).split(" ")[1]}`; };
const shortName = (p) => { const [a, b] = (p?.full_name || "Sin asignar").split(" "); return b ? `${a} ${b[0]}.` : a; };
const statusColor = (a, st) => (st === "completada" ? C.ok : st === "vencida" ? C.stop : st === "en_proceso" || !a.assigned_to ? C.watch : C.cyan);
const effStatus = (a) => {
  if (["programada", "en_proceso"].includes(a.status)) {
    const lim = a.due_at ? new Date(a.due_at) : new Date(a.scheduled_date + "T23:59:59");
    if (lim < new Date()) return "vencida";
  }
  return a.status;
};

export async function buildPlanPDF(planId) {
  const plan = db.get("audit_plans", planId);
  if (!plan) throw new Error("Plan no encontrado");
  const { jsPDF } = await lib();
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const audits = db.rows("audits").filter((a) => a.plan_id === planId && a.status !== "cancelada").sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.code.localeCompare(b.code));
  const byDay = new Map();
  audits.forEach((a) => byDay.set(a.scheduled_date, [...(byDay.get(a.scheduled_date) || []), a]));
  const days = eachDay(plan.start_date, plan.end_date);
  const hab = days.filter((d) => !isWeekend(d)).length;
  const auditors = new Set(audits.map((a) => a.assigned_to).filter(Boolean));
  const creator = db.get("profiles", plan.created_by);
  const logoData = await logo();
  const fill = (c) => doc.setFillColor(...c), stroke = (c) => doc.setDrawColor(...c), ink = (c) => doc.setTextColor(...c);
  const title = plan.name || `${plan.audit_type} · ${rangeText(plan.start_date, plan.end_date)}`;

  /* ---------- Banda de marca ---------- */
  fill(C.navy); doc.rect(0, 0, PW, 70, "F");
  if (logoData) doc.addImage(logoData, "PNG", M, 17, 36, 36);
  doc.setFont("helvetica", "bold"); doc.setFontSize(21); ink(C.white); doc.text("GUVEL", M + 46, 38);
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.text("SMARTER INDUSTRIAL SYSTEMS", M + 46, 49);
  doc.setFontSize(9); ink(C.cyan); doc.setFont("helvetica", "bold"); doc.text("PLAN DE AUDITORÍA", PW - M, 31, { align: "right" });
  doc.setFontSize(17); ink(C.white); doc.text(plan.code, PW - M, 52, { align: "right" });

  /* ---------- Título ---------- */
  ink(C.ink); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text(title, M, 102);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); ink(C.t2);
  doc.text(`${plan.audit_type}  ·  ${plan.frequency === "Custom" ? "Personalizado" : plan.frequency}  ·  ${rangeText(plan.start_date, plan.end_date)}`, M, 118);
  if (plan.notes) { doc.setFontSize(9); ink(C.t3); doc.text(doc.splitTextToSize(plan.notes, PW - 2 * M)[0], M, 132); }

  /* ---------- Tarjetas de datos clave ---------- */
  const cards = [
    ["PERIODO", `${days.length} días`, `${hab} hábiles · ${days.length - hab} inhábiles`],
    ["AUDITORÍAS", String(audits.length), `${audits.filter((a) => !a.assigned_to).length} sin asignar`],
    ["AUDITORES", String(auditors.size), "personas asignadas"],
    ["ESTADO", plan.status === "enviado" ? "Enviado" : "Borrador", plan.sent_at ? fmtDateTime(plan.sent_at) : "Pendiente de envío"],
    ["ELABORÓ", shortName(creator), fmtDate((plan.created_at || "").slice(0, 10))],
  ];
  const cw = (PW - 2 * M - 4 * 10) / 5;
  cards.forEach(([l, v, s], i) => {
    const x = M + i * (cw + 10), y = 142;
    fill(C.panel); doc.rect(x, y, cw, 48, "F"); fill(C.cyan); doc.rect(x, y, 3, 48, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); ink(C.t2); doc.text(l, x + 12, y + 13);
    doc.setFontSize(14); ink(C.ink); doc.text(String(v), x + 12, y + 30);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); ink(C.t3); doc.text(s, x + 12, y + 42);
  });

  /* ---------- Calendario semanal ---------- */
  let y = 214;
  const colW = (PW - 2 * M) / 7;
  const sectionTitle = (t, yy) => { doc.setFont("helvetica", "bold"); doc.setFontSize(11); ink(C.ink); doc.text(t, M, yy); fill(C.cyan); doc.rect(M, yy + 4, 28, 2, "F"); };
  const dowHeader = (yy) => {
    DOW_LONG.slice(1).concat(DOW_LONG[0]).forEach((n, i) => {
      const x = M + i * colW;
      fill(C.head); stroke(C.line); doc.rect(x, yy, colW, 16, "FD");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); ink(i >= 5 ? C.wkInk : C.t2); doc.text(n.toUpperCase(), x + 6, yy + 11);
    });
  };
  sectionTitle("Calendario", y); y += 14; dowHeader(y); y += 16;

  const weeks = [];
  for (let m = mondayOf(plan.start_date); m <= plan.end_date; m = addDays(m, 7)) weeks.push(eachDay(m, addDays(m, 6)));
  for (const wk of weeks) {
    const maxN = Math.max(...wk.map((d) => (byDay.get(d) || []).length));
    const rows = Math.min(maxN, 4) + (maxN > 4 ? 1 : 0);
    const h = Math.max(46, 20 + rows * 17 + 4);
    if (y + h > PH - 56) { doc.addPage(); y = M; dowHeader(y); y += 16; }
    wk.forEach((d, i) => {
      const x = M + i * colW, inRange = d >= plan.start_date && d <= plan.end_date, list = byDay.get(d) || [];
      const off = isWeekend(d) && !list.length;
      fill(!inRange ? C.out : off ? C.wk : C.white); stroke(off ? C.wkLine : C.line); doc.setLineWidth(0.5); doc.rect(x, y, colW, h, "FD");
      if (!inRange) return;
      const dd = parseDate(d);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); ink(C.ink); doc.text(String(dd.getDate()), x + 6, y + 14);
      if (dd.getDate() === 1 || d === plan.start_date) { doc.setFontSize(6.5); ink(C.t3); doc.text(fmtDate(d).split(" ")[1].toUpperCase(), x + 22, y + 13); }
      if (off) { doc.setFontSize(6); ink(C.wkInk); doc.text("INHÁBIL", x + colW - 6, y + 12, { align: "right" }); }
      list.slice(0, 4).forEach((a, k) => {
        const cy = y + 20 + k * 17, p = db.get("profiles", a.assigned_to);
        fill(C.panel); doc.rect(x + 4, cy, colW - 8, 15, "F");
        fill(statusColor(a, effStatus(a))); doc.rect(x + 4, cy, 2.5, 15, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); ink(C.ink); doc.text(a.code, x + 10, cy + 6.3);
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); ink(C.t2);
        doc.text(`${shortName(p)}${a.level ? " · N" + a.level : ""}`, x + 10, cy + 12.6, { maxWidth: colW - 18 });
      });
      if (list.length > 4) { doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); ink(C.t2); doc.text(`+${list.length - 4} más`, x + 8, y + 20 + 4 * 17 + 8); }
    });
    y += h;
  }
  /* Leyenda */
  y += 12;
  if (y > PH - 50) { doc.addPage(); y = M + 8; }
  const leg = [[C.cyan, "Asignada"], [C.watch, "Sin asignar / en proceso"], [C.ok, "Completada"], [C.stop, "Vencida"], [C.wk, "Día inhábil sin asignación"], [C.out, "Fuera del periodo"]];
  let lx = M;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  leg.forEach(([c, t]) => { fill(c); stroke(C.line); doc.rect(lx, y - 7, 9, 9, "FD"); ink(C.t2); doc.text(t, lx + 13, y); lx += 22 + doc.getTextWidth(t) + 14; });

  /* ---------- Detalle por fecha ---------- */
  doc.addPage();
  sectionTitle("Detalle de auditorías", M + 8);
  const form = (id) => db.get("forms", id);
  doc.autoTable({
    startY: M + 22, margin: { left: M, right: M, bottom: 44 }, theme: "grid",
    head: [["Fecha", "Folio", "Auditor", "Tipo / Nivel", "Formato", "Límite de entrega", "Estado"]],
    body: audits.map((a) => [shortDate(a.scheduled_date), a.code, db.get("profiles", a.assigned_to)?.full_name || "Sin asignar", `${plan.audit_type}${a.level ? " · Nivel " + a.level : ""}`, form(a.form_id)?.code || "—", fmtDateTime(a.due_at), AUDIT_STATUS[effStatus(a)]?.[0] || a.status]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, lineColor: C.line, lineWidth: 0.4, textColor: C.ink },
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: C.panel },
    columnStyles: { 1: { fontStyle: "bold" } },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      const a = audits[d.row.index];
      if (d.column.index === 0 && isWeekend(a.scheduled_date)) { d.cell.styles.fillColor = C.wk; d.cell.styles.textColor = C.wkInk; d.cell.styles.fontStyle = "bold"; }
      if (d.column.index === 2 && !a.assigned_to) d.cell.styles.textColor = C.stop;
    },
  });

  /* ---------- Resumen por auditor ---------- */
  const per = new Map();
  audits.filter((a) => a.assigned_to).forEach((a) => per.set(a.assigned_to, [...(per.get(a.assigned_to) || []), a]));
  if (per.size) {
    let sy = doc.lastAutoTable.finalY + 26;
    if (sy > PH - 130) { doc.addPage(); sy = M + 8; }
    sectionTitle("Resumen por auditor", sy);
    doc.autoTable({
      startY: sy + 14, margin: { left: M, right: M, bottom: 44 }, theme: "grid",
      head: [["Auditor", "Correo", "Auditorías", "Fechas asignadas"]],
      body: [...per.entries()].map(([id, list]) => { const p = db.get("profiles", id); return [p?.full_name || "—", p?.email || "—", String(list.length), list.map((a) => shortDate(a.scheduled_date).slice(4)).join(" · ")]; }),
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, lineColor: C.line, lineWidth: 0.4, textColor: C.ink },
      headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: C.panel }, columnStyles: { 0: { fontStyle: "bold" }, 2: { halign: "center", cellWidth: 60 } },
    });
  }

  /* ---------- Pie de página ---------- */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); stroke(C.line); doc.line(M, PH - 30, PW - M, PH - 30);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); ink(C.t3);
    doc.text(`GUVEL Quality  ·  ${plan.code}  ·  Generado el ${fmtDateTime(new Date().toISOString())}`, M, PH - 18);
    doc.text(`Página ${i} de ${n}`, PW - M, PH - 18, { align: "right" });
  }
  const safe = (plan.name || plan.code).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_").slice(0, 50);
  return { doc, filename: `Plan_${plan.code}_${safe}.pdf` };
}

export async function downloadPlanPDF(planId) {
  const { doc, filename } = await buildPlanPDF(planId);
  doc.save(filename);
  return filename;
}
/** PDF en base64 (para adjuntarlo a los correos) */
export async function planPDFBase64(planId) {
  const { doc, filename } = await buildPlanPDF(planId);
  return { filename, base64: doc.output("datauristring").split(",")[1] };
}
