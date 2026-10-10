/* Evidencias: sección reutilizable (miniaturas + subir/eliminar) */
import * as db from "../db.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { on, onChange, toast, confirmDialog, openDialog } from "../ui.js";

/** Cada módulo anfitrión registra cómo refrescarse: hooks.finding = fn, … */
export const hooks = {};

const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
const canDelete = (a) => db.can.manage || (db.can.write && a.created_by === db.state.profile.id);

/**
 * entity: finding | audit | notification · ref: subclasificación opcional (id de pregunta)
 * compact: sin título (para usar dentro de una pregunta del checklist)
 */
export function attachmentsSection(entity, id, { ref = null, canEdit = true, title = "Evidencias", compact = false } = {}) {
  const list = db.rows("attachments")
    .filter((a) => a.entity === entity && a.entity_id === id && (a.ref || null) === ref)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const editable = canEdit && db.can.write;
  const data = `data-change="att-upload" data-entity="${entity}" data-id="${id}" data-ref="${esc(ref || "")}"`;
  const uploadBtn = editable
    ? `<span class="att-btns"><label class="btn sm att-upload">${icon("plus")} Adjuntar evidencia<input type="file" multiple hidden accept="${db.ATTACH_ACCEPT}" ${data}></label><button type="button" class="btn sm" data-action="att-camera" data-entity="${entity}" data-id="${id}" data-ref="${esc(ref || "")}">${icon("camera")} Tomar foto</button></span>`
    : "";
  if (compact && !list.length && !editable) return "";
  const items = list.map((a) => {
    const isImg = (a.mime_type || "").startsWith("image/");
    const del = editable && canDelete(a) ? `<button type="button" class="att-x" data-action="att-del" data-id="${a.id}" aria-label="Eliminar ${esc(a.file_name)}">${icon("close")}</button>` : "";
    return isImg
      ? `<div class="att-item"><a class="att-thumb" data-att="${a.id}" target="_blank" rel="noopener" title="${esc(a.file_name)}"><img alt="${esc(a.file_name)}"></a>${del}</div>`
      : `<div class="att-item file"><a data-att="${a.id}" target="_blank" rel="noopener" download="${esc(a.file_name)}">${icon("form")}<span><b>${esc(a.file_name)}</b><small>${fmtSize(a.size_bytes || 0)}</small></span></a>${del}</div>`;
  }).join("");
  return `<div class="att ${compact ? "compact" : ""}">
    ${compact ? "" : `<div class="section-title"><span>${esc(title)} (${list.length})</span>${uploadBtn}</div>`}
    ${list.length ? `<div class="att-grid">${items}${compact ? uploadBtn : ""}</div>` : compact ? uploadBtn : `<div class="muted">Sin evidencias. ${editable ? "Adjunta fotos o documentos." : ""}</div>`}
  </div>`;
}

/* Las URLs (blob o firmadas) se resuelven después del render */
let pending = false;
async function hydrate() {
  pending = false;
  for (const el of document.querySelectorAll("[data-att]:not([data-ready])")) {
    el.dataset.ready = "1";
    const att = db.get("attachments", el.dataset.att);
    if (!att) continue;
    try {
      const url = await db.attachmentUrl(att);
      el.href = url;
      const img = el.querySelector("img");
      if (img) img.src = url;
    } catch { el.classList.add("att-broken"); }
  }
}
new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(hydrate); } }).observe(document.body, { childList: true, subtree: true });

/** Sube archivos (del selector o de la cámara) y refresca la pantalla que los muestra */
async function uploadFiles(entity, id, ref, files) {
  if (!files.length) return;
  toast(files.length > 1 ? `Subiendo ${files.length} archivos…` : "Subiendo archivo…");
  let ok = 0;
  for (const file of files) {
    try { const att = await db.addAttachment({ entity, entity_id: id, ref: ref || null, file }); ok++; if ((att.mime_type || "").startsWith("image/")) toast(`Foto adjuntada · ${(att.size_bytes / 1048576).toFixed(2)} MB`); }
    catch (e) { toast(`${file.name}: ${e.message}`, "danger"); }
  }
  if (ok) { toast(`${ok} archivo(s) adjuntado(s)`, "ok"); await hooks[entity]?.(); }
}
onChange("att-upload", async (el) => {
  const { entity, id, ref } = el.dataset, files = [...el.files];
  el.value = "";
  await uploadFiles(entity, id, ref, files);
});

/* ------------------------------- Cámara -------------------------------- */
/** Abre la cámara del dispositivo (pide permiso), permite ver la foto antes de usarla y la sube comprimida. */
async function openCamera({ entity, id, ref }) {
  const pickFile = () => {            // alternativa si no hay cámara o el permiso fue denegado
    const i = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    i.setAttribute("capture", "environment");
    i.onchange = () => uploadFiles(entity, id, ref, [...i.files]);
    i.click();
  };
  if (!navigator.mediaDevices?.getUserMedia || (!window.isSecureContext && location.hostname !== "localhost")) {
    toast("Este navegador no permite abrir la cámara aquí; se abrirá el selector de archivos.", "danger"); return pickFile();
  }
  let stream = null, facing = "environment", blob = null, dlg;
  const $ = (sel) => dlg.el.querySelector(sel);
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const setMsg = (html) => { $("#cam-msg").innerHTML = html; $("#cam-msg").classList.toggle("hidden", !html); };
  async function start() {
    stop(); setMsg("Solicitando acceso a la cámara…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = $("#cam-v"); v.srcObject = stream; await v.play().catch(() => {});
      setMsg(""); $("#cam-shot").disabled = false;
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      $("#cam-flip").classList.toggle("hidden", cams.length < 2);
    } catch (e) {
      $("#cam-shot").disabled = true;
      const denied = e.name === "NotAllowedError" || e.name === "SecurityError";
      setMsg(`<b>${denied ? "El navegador no tiene permiso para usar la cámara." : "No se encontró una cámara disponible."}</b><br>${denied ? "Pulsa el candado de la barra de direcciones → Cámara → Permitir, y vuelve a intentarlo." : "Conecta una cámara o usa un archivo."} <button type="button" class="btn sm" id="cam-file" style="margin-top:8px">Elegir un archivo en su lugar</button>`);
      $("#cam-file")?.addEventListener("click", () => { dlg.close(); pickFile(); });
    }
  }
  dlg = openDialog({
    eyebrow: "Evidencia", title: "Tomar foto", size: "wide", onClose: stop,
    body: `<div class="cam-box"><video id="cam-v" autoplay playsinline muted></video><img id="cam-img" class="hidden" alt="Foto tomada"><div id="cam-msg" class="cam-msg"></div></div>
           <p class="muted" style="margin-top:10px;font-size:13px">La foto se comprime automáticamente (≈ 1 MB o menos) antes de adjuntarse.</p>`,
    footer: `<button class="btn" data-close>Cancelar</button><button class="btn hidden" id="cam-flip" type="button">Cambiar cámara</button><button class="btn hidden" id="cam-retake" type="button">Repetir</button><button class="btn primary" id="cam-shot" type="button" disabled>${icon("camera")} Tomar foto</button><button class="btn primary hidden" id="cam-use" type="button">${icon("check2")} Usar esta foto</button>`,
  });
  $("#cam-flip").addEventListener("click", () => { facing = facing === "environment" ? "user" : "environment"; start(); });
  $("#cam-shot").addEventListener("click", async () => {
    const v = $("#cam-v"), w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) { toast("La cámara aún no está lista; espera un segundo.", "danger"); return; }
    const k = Math.min(1, 1600 / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    if (!blob) { toast("No se pudo capturar la foto.", "danger"); return; }
    $("#cam-img").src = URL.createObjectURL(blob); $("#cam-img").classList.remove("hidden"); v.classList.add("hidden");
    ["#cam-shot", "#cam-flip"].forEach((x) => $(x).classList.add("hidden")); ["#cam-retake", "#cam-use"].forEach((x) => $(x).classList.remove("hidden"));
  });
  $("#cam-retake").addEventListener("click", () => {
    blob = null; $("#cam-img").classList.add("hidden"); $("#cam-v").classList.remove("hidden");
    ["#cam-retake", "#cam-use"].forEach((x) => $(x).classList.add("hidden")); $("#cam-shot").classList.remove("hidden"); start();
  });
  $("#cam-use").addEventListener("click", async () => {
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const file = new File([blob], `foto_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`, { type: "image/jpeg" });
    dlg.close(); await uploadFiles(entity, id, ref, [file]);
  });
  start();
}
on("att-camera", (el) => openCamera({ entity: el.dataset.entity, id: el.dataset.id, ref: el.dataset.ref }));

on("att-del", async (el) => {
  const att = db.get("attachments", el.dataset.id);
  if (!att || !(await confirmDialog({ title: "¿Eliminar evidencia?", message: att.file_name, confirmLabel: "Eliminar", danger: true }))) return;
  try { await db.removeAttachment(att); toast("Evidencia eliminada"); await hooks[att.entity]?.(); } catch (e) { toast(e.message, "danger"); }
});
