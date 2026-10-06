/* =====================================================================
   Capa de datos · misma API para Supabase (producción) y modo demo.
   Los datos se cargan una vez en memoria (state.data) y las mutaciones
   actualizan caché + base de datos.
   ===================================================================== */
import { CONFIG, isDemo } from "./config.js";
import { uuid, today } from "./utils.js";
import { buildSeed } from "./seed.js";

export const TABLES = [
  "profiles", "clients", "classifications", "forms", "form_items",
  "audit_plans", "audits", "audit_answers", "findings", "actions",
  "customer_notifications", "risks", "opportunities", "attachments",
];
const PREFIX = { clients: "CLI", audit_plans: "PLAN", audits: "AUD", findings: "HAL", actions: "ACC", customer_notifications: "NCL", risks: "RSK", opportunities: "OPP" };
const HAS_CREATED_BY = new Set(["audit_plans", "audits", "findings", "actions", "customer_notifications", "risks", "opportunities", "attachments"]);
const READONLY = new Set(["id", "created_at", "updated_at", "created_by"]);
const GENERATED = { risks: ["score"] }; // columnas calculadas por la base de datos
const CASCADE = {
  audit_plans: [["audits", "plan_id"]],
  audits: [["audit_answers", "audit_id"]],
  findings: [["actions", "finding_id"]],
  forms: [["form_items", "form_id"]],
  form_items: [["audit_answers", "item_id"]],
};

export const state = { session: null, profile: null, data: {}, demo: isDemo };
let sb = null;
const LS_DATA = "guvel_quality_demo_v1";
const LS_SESSION = "guvel_quality_demo_session";
let demo = null; // { tables, counters }

/* ------------------------------ Arranque ----------------------------- */
export async function init() {
  TABLES.forEach((t) => (state.data[t] = []));
  if (state.demo) return localStorage.getItem(LS_SESSION) === "1";
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  return !!data.session;
}

export async function signIn(email, password) {
  if (state.demo) { localStorage.setItem(LS_SESSION, "1"); return; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(/invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : error.message);
  state.session = data.session;
}
export async function signOut() {
  if (state.demo) { localStorage.removeItem(LS_SESSION); return; }
  await sb.auth.signOut();
  state.session = null;
}
export function resetDemo() { localStorage.removeItem(LS_DATA); }

/* ------------------------------ Carga -------------------------------- */
async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function loadAll() {
  if (state.demo) {
    demo = JSON.parse(localStorage.getItem(LS_DATA) || "null");
    const fresh = !demo;
    if (fresh) demo = buildSeed();
    TABLES.forEach((t) => (state.data[t] = demo.tables[t] || []));
    if (fresh) persist();
    state.profile = state.data.profiles.find((p) => p.id === demo.currentUser);
    return;
  }
  const results = await Promise.all(TABLES.map(fetchAll));
  TABLES.forEach((t, i) => (state.data[t] = results[i]));
  state.profile = state.data.profiles.find((p) => p.id === state.session.user.id) || null;
  if (!state.profile) throw new Error("Tu usuario no tiene perfil. Ejecuta supabase/01_schema.sql completo.");
  if (!state.profile.active) throw new Error("Tu usuario está desactivado. Contacta al administrador.");
}

function persist() {
  if (!state.demo) return;
  demo.tables = state.data;
  try { localStorage.setItem(LS_DATA, JSON.stringify(demo)); }
  catch { throw new Error("Sin espacio en el modo demo (el navegador limita ~5 MB). Elimina adjuntos o usa Supabase."); }
}

/* ------------------------------ Lectura ------------------------------ */
export const rows = (t) => state.data[t] || [];
export const get = (t, id) => (id ? rows(t).find((r) => r.id === id) : undefined);
export const profileName = (id) => get("profiles", id)?.full_name || "—";
export const can = {
  get write() { return ["admin", "quality_manager", "auditor"].includes(state.profile?.role); },
  get manage() { return ["admin", "quality_manager"].includes(state.profile?.role); },
  get admin() { return state.profile?.role === "admin"; },
};

/* ----------------------------- Escritura ----------------------------- */
function clean(row, t) {
  const out = {};
  const generated = GENERATED[t] || [];
  for (const [k, v] of Object.entries(row)) {
    if (READONLY.has(k) || generated.includes(k) || v === undefined) continue;
    out[k] = v === "" ? null : v;
  }
  return out;
}

function derive(t, r, old) {
  const now = new Date().toISOString();
  r.updated_at = now;
  if (t === "risks") r.score = (r.probability || 1) * (r.impact || 1);
  if (t === "findings") r.closed_at = r.status === "cerrado" ? (old?.closed_at || now) : null;
  if (t === "customer_notifications") r.closed_at = r.status === "cerrada" ? (old?.closed_at || now) : null;
  if (t === "actions") r.completed_at = ["completada", "verificada"].includes(r.status) ? (old?.completed_at || now) : null;
  return r;
}

export async function insert(t, row) {
  const data = clean(row, t);
  if (state.demo) {
    const r = { id: uuid(), created_at: new Date().toISOString(), ...data };
    if (PREFIX[t] && !r.code) {
      demo.counters[PREFIX[t]] = (demo.counters[PREFIX[t]] || 0) + 1;
      r.code = `${PREFIX[t]}-${String(demo.counters[PREFIX[t]]).padStart(4, "0")}`;
    }
    if (HAS_CREATED_BY.has(t)) r.created_by = state.profile.id;
    derive(t, r);
    state.data[t].push(r);
    persist();
    return r;
  }
  if (HAS_CREATED_BY.has(t)) data.created_by = state.profile.id;
  const { data: res, error } = await sb.from(t).insert(data).select().single();
  if (error) throw new Error(friendly(error));
  state.data[t].push(res);
  return res;
}

export async function update(t, id, patch) {
  const data = clean(patch, t);
  if (state.demo) {
    const cur = get(t, id);
    const old = { ...cur };
    Object.assign(cur, data);
    derive(t, cur, old);
    persist();
    return cur;
  }
  const { data: res, error } = await sb.from(t).update(data).eq("id", id).select().single();
  if (error) throw new Error(friendly(error));
  const i = state.data[t].findIndex((r) => r.id === id);
  state.data[t][i] = res;
  return res;
}

/** Inserta o actualiza filas según columnas clave (p.ej. audit_answers) */
export async function upsertMany(t, list, keys) {
  if (!list.length) return;
  const match = (a, b) => keys.every((k) => a[k] === b[k]);
  if (state.demo) {
    for (const item of list) {
      const data = clean(item, t);
      const cur = state.data[t].find((r) => match(r, data));
      if (cur) Object.assign(cur, data);
      else state.data[t].push({ id: uuid(), created_at: new Date().toISOString(), ...data });
    }
    persist();
    return;
  }
  const { data, error } = await sb.from(t).upsert(list.map((r) => clean(r, t)), { onConflict: keys.join(",") }).select();
  if (error) throw new Error(friendly(error));
  for (const r of data) {
    const i = state.data[t].findIndex((x) => x.id === r.id || match(x, r));
    if (i >= 0) state.data[t][i] = r; else state.data[t].push(r);
  }
}

export async function remove(t, id) {
  if (!state.demo) {
    await purgeStorageFor(t, id);
    const { error } = await sb.from(t).delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  }
  purge(t, id);
  persist();
}
const ATT_ENTITY = { findings: "finding", audits: "audit", customer_notifications: "notification" };
function purge(t, id) {
  state.data[t] = state.data[t].filter((r) => r.id !== id);
  if (ATT_ENTITY[t]) state.data.attachments = state.data.attachments.filter((a) => !(a.entity === ATT_ENTITY[t] && a.entity_id === id));
  (CASCADE[t] || []).forEach(([child, fk]) => {
    state.data[child].filter((r) => r[fk] === id).forEach((r) => purge(child, r.id));
  });
  if (state.demo) demo.tables = state.data;
}

function friendly(e) {
  const m = e.message || String(e);
  if (/row-level security|permission denied/i.test(m)) return "No tienes permisos para realizar esta acción.";
  if (/duplicate key/i.test(m)) return "Ya existe un registro con ese valor.";
  if (/violates foreign key/i.test(m)) return "El registro está relacionado con otros datos y no se puede eliminar.";
  return m;
}

export const activeProfiles = () => rows("profiles").filter((p) => p.active).sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));

/* ------------------------------ Adjuntos ----------------------------- */
const BUCKET = "evidence";
const MAX_BYTES = 10 * 1024 * 1024;
const DEMO_MAX_BYTES = 1.5 * 1024 * 1024;
export const ATTACH_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/(plain|csv)|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\..+))$/;
const urlCache = new Map();

/** Reduce fotos grandes (lado máx. y JPEG) para ahorrar espacio y datos móviles */
async function prepareFile(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const maxDim = state.demo ? 1100 : 1920, quality = state.demo ? 0.7 : 0.82;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.2 * 1024 * 1024 && !state.demo) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || (blob.size >= file.size && !state.demo)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}
const toDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const safeName = (n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);

export async function addAttachment({ entity, entity_id, ref = null, file }) {
  const typeOk = file.type ? ALLOWED.test(file.type) : /\.(docx?|xlsx?|pptx?|csv|txt|pdf)$/i.test(file.name); // algunos navegadores no informan el tipo
  if (!typeOk) throw new Error("Tipo de archivo no permitido (usa imágenes, PDF, Office, TXT o CSV).");
  const f = await prepareFile(file);
  if (f.size > (state.demo ? DEMO_MAX_BYTES : MAX_BYTES)) throw new Error(`El archivo supera el límite de ${state.demo ? "1.5 MB en modo demo" : "10 MB"}.`);
  const base = { entity, entity_id, ref, file_name: f.name, mime_type: f.type || "application/octet-stream", size_bytes: f.size };
  if (state.demo) {
    try { return await insert("attachments", { ...base, data_url: await toDataURL(f) }); }
    catch (e) {
      const last = state.data.attachments.at(-1); // insert() agrega a caché antes de persistir
      if (last && last.entity_id === entity_id && last.file_name === base.file_name) state.data.attachments.pop();
      throw e;
    }
  }
  const path = `${entity}/${entity_id}/${uuid()}-${safeName(f.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: base.mime_type, upsert: false });
  if (up.error) throw new Error(friendly(up.error));
  try { return await insert("attachments", { ...base, file_path: path }); }
  catch (e) { await sb.storage.from(BUCKET).remove([path]); throw e; }
}

/** URL utilizable en <img>/<a>: blob (demo) o URL firmada temporal (Supabase) */
export async function attachmentUrl(att) {
  const hit = urlCache.get(att.id);
  if (hit && hit.exp > Date.now()) return hit.url;
  let url;
  if (state.demo) url = URL.createObjectURL(await (await fetch(att.data_url)).blob());
  else {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(att.file_path, 3600);
    if (error) throw new Error(friendly(error));
    url = data.signedUrl;
  }
  urlCache.set(att.id, { url, exp: Date.now() + 50 * 60 * 1000 });
  return url;
}

export async function removeAttachment(att) {
  if (!state.demo) await sb.storage.from(BUCKET).remove([att.file_path]);
  await remove("attachments", att.id);
  urlCache.delete(att.id);
}

/** Antes de borrar un registro padre, elimina sus archivos de Storage (mejor esfuerzo) */
async function purgeStorageFor(t, id) {
  let pairs = [];
  if (ATT_ENTITY[t]) pairs = [[ATT_ENTITY[t], id]];
  if (t === "audit_plans") pairs = rows("audits").filter((a) => a.plan_id === id).map((a) => ["audit", a.id]);
  const paths = rows("attachments").filter((a) => pairs.some(([e, i]) => a.entity === e && a.entity_id === i)).map((a) => a.file_path).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
}
