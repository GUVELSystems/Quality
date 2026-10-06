/* Opciones de selects reutilizables */
import * as db from "../db.js";

export const userOpts = () => db.activeProfiles().map((p) => [p.id, p.full_name]);
export const catOpts = (kind) => db.rows("classifications").filter((c) => c.kind === kind && c.active).sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name]);
export const catNameOpts = (kind) => catOpts(kind).map(([, n]) => [n, n]);
export const clientOpts = () => db.rows("clients").filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name]);
export const mapOpts = (map, pick = (v) => (Array.isArray(v) ? v[0] : v)) => Object.entries(map).map(([k, v]) => [k, pick(v)]);
export const catName = (id) => db.get("classifications", id)?.name || "—";
export const clientName = (id) => db.get("clients", id)?.name || "—";
