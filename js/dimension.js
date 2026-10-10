/* =====================================================================
   Dimensiones (solo auditorías de Producto)
   Un punto de tipo "Dimensión" no se responde con Cumple / No cumple: se captura el valor
   medido y el portal lo compara con la especificación  nominal ± tolerancia.
   Ej.: Diámetro 12.000 ± 0.021 mm  →  rango 11.979 – 12.021 (los límites SÍ cumplen).
   ===================================================================== */

export const KINDS = { dimension: "Dimensión", inspeccion: "Inspección" };
export const SECTION_ORDER = ["dimension", "inspeccion"];
export const isDimension = (it) => it?.kind === "dimension";

const blank = (v) => v === null || v === undefined || String(v).trim() === "";
/** Número a partir de texto del usuario (acepta coma decimal); null si no es un número válido */
export function parseValue(raw) {
  const t = String(raw ?? "").trim().replace(",", ".");
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}
const decimals = (v) => { const m = String(v ?? "").match(/\.(\d+)/); return m ? Math.min(6, m[1].length) : 0; };
/** Decimales escritos en los campos (así se conserva 12.000 aunque la base guarde 12) */
export const typedDecimals = (...vals) => Math.max(0, ...vals.map(decimals));
const K = 1e6, scaled = (n) => Math.round(n * K);   // compara en enteros para evitar errores de coma flotante

/** Especificación de un punto: límites y decimales con los que se muestra */
export function dimSpec(it) {
  const nominal = Number(it.nominal), plus = Number(it.tol_plus), minus = blank(it.tol_minus) ? plus : Number(it.tol_minus);
  const dec = Math.max(decimals(it.nominal), decimals(it.tol_plus), blank(it.tol_minus) ? 0 : decimals(it.tol_minus), Number.isInteger(it.decimals) ? it.decimals : 0);
  return { nominal, plus, minus, symmetric: plus === minus, lo: (scaled(nominal) - scaled(minus)) / K, hi: (scaled(nominal) + scaled(plus)) / K, dec, unit: (it.unit || "").trim() };
}
/** ¿El valor medido está dentro de la tolerancia? Devuelve también cuánto se desvía del límite */
export function dimEval(it, value) {
  const s = dimSpec(it), v = Number(value), ok = scaled(v) >= scaled(s.lo) && scaled(v) <= scaled(s.hi);
  const dev = ok ? 0 : scaled(v) > scaled(s.hi) ? (scaled(v) - scaled(s.hi)) / K : (scaled(v) - scaled(s.lo)) / K;   // + sobre el límite superior, − bajo el inferior
  return { ok, dev, ...s };
}
export const fmtNum = (n, dec) => Number(n).toFixed(dec);
/** "12.000 ± 0.021 mm"  /  "45.00 +0.10 / −0.05 mm" */
export function specText(it) {
  const s = dimSpec(it), u = s.unit ? " " + s.unit : "";
  return s.symmetric ? `${fmtNum(s.nominal, s.dec)} ± ${fmtNum(s.plus, s.dec)}${u}` : `${fmtNum(s.nominal, s.dec)} +${fmtNum(s.plus, s.dec)} / −${fmtNum(s.minus, s.dec)}${u}`;
}
export const rangeText = (it) => { const s = dimSpec(it), u = s.unit ? " " + s.unit : ""; return `${fmtNum(s.lo, s.dec)} – ${fmtNum(s.hi, s.dec)}${u}`; };
/** Mensaje de validación para el editor de formatos (null si está bien) */
export function validateDim(it) {
  if (blank(it.nominal) || parseValue(it.nominal) === null) return "indica el valor nominal (número).";
  if (blank(it.tol_plus) || parseValue(it.tol_plus) === null || parseValue(it.tol_plus) < 0) return "indica la tolerancia (número ≥ 0).";
  if (!blank(it.tol_minus) && (parseValue(it.tol_minus) === null || parseValue(it.tol_minus) < 0)) return "la tolerancia negativa debe ser un número ≥ 0 (o déjala vacía para usar la misma).";
  return null;
}
