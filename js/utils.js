/* Utilidades puras (sin dependencias de UI) */
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const pad = (n) => String(n).padStart(2, "0");

/** Fecha local → "YYYY-MM-DD" (evita el desfase de toISOString/UTC) */
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const parseDate = (s) => (s ? new Date(String(s).slice(0, 10) + "T12:00:00") : null);
export const addDays = (s, n) => { const d = parseDate(s) || new Date(); d.setDate(d.getDate() + n); return isoDate(d); };
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MONTHS_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const fmtDate = (s) => {
  const d = parseDate(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "—";
};
export const fmtDateTime = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** ISO/timestamptz → valor para <input type="datetime-local"> */
export const toLocalInput = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

/** "hace 3 h", "ayer", ... */
export const timeAgo = (s) => {
  const t = new Date(s).getTime();
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 6e4);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
};

export const initials = (name = "") =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "··";

/** Texto relativo a una fecha límite: "Vence en 3 d" / "Vencida hace 2 d" */
export const dueText = (date) => {
  if (!date) return { text: "—", overdue: false };
  const n = daysBetween(today(), date);
  if (n < 0) return { text: `${fmtDate(date)} · hace ${-n} d`, overdue: true };
  if (n === 0) return { text: `${fmtDate(date)} · hoy`, overdue: false };
  return { text: `${fmtDate(date)} · en ${n} d`, overdue: false };
};

export function downloadCSV(filename, columns, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [columns.map((c) => q(c.label)).join(","), ...rows.map((r) => columns.map((c) => q(c.value(r))).join(","))].join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const uuid = () =>
  crypto?.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });
