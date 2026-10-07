// GUVEL Quality · notify-audit-plan (archivo único para pegar en el editor de Supabase)
// Contiene las plantillas de correo + la función. Secretos: RESEND_API_KEY, FROM_EMAIL, SITE_URL.
import { createClient } from "npm:@supabase/supabase-js@2";

// ───────────── Plantillas de correo ─────────────
// Plantillas de correo de GUVEL Quality (HTML con tablas + estilos en línea,
// compatibles con Outlook/Gmail). Funciones puras: sin dependencias de Deno.

interface PlanInfo { id: string; code: string; name: string | null; audit_type: string; frequency: string; start_date: string; end_date: string; notes?: string | null }
interface AuditInfo { id: string; code: string; scheduled_date: string; due_at: string | null; level: number | null; form_name: string | null; notes?: string | null }

const NAVY = "#0F1B2D", CYAN = "#0CC0DF", ICE = "#EAF2F8", INK = "#0F1B2D", MUTED = "#52647A", LINE = "#DDE6EE";

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const TZ = "America/Monterrey";
const dateLong = (d: string): string => new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
const dateShort = (d: string): string => new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z")).replace(/\./g, "");
const dateTime = (iso: string | null): string => (iso ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso)).replace(/\./g, "") : "—");
const range = (p: PlanInfo): string => `${dateShort(p.start_date)} al ${dateShort(p.end_date)}`;
const planTitle = (p: PlanInfo): string => p.name || `${p.audit_type} · ${range(p)}`;
const freq = (f: string): string => (f === "Custom" ? "Personalizado" : f);

function layout(o: { siteUrl: string; preheader: string; title: string; body: string; button?: { label: string; url: string } }): string {
  const logo = `${o.siteUrl.replace(/\/$/, "")}/assets/guvel-logo.png`;
  const btn = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr><td style="background:${CYAN};border-radius:3px"><a href="${esc(o.button.url)}" style="display:inline-block;padding:13px 26px;font:700 15px Arial,Helvetica,sans-serif;color:${NAVY};text-decoration:none">${esc(o.button.label)}</a></td></tr></table>
       <p style="margin:0;font:12.5px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${esc(o.button.url)}" style="color:#067A8E;word-break:break-all">${esc(o.button.url)}</a></p>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${ICE}"><span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ICE};padding:24px 12px"><tr><td align="center">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
  <tr><td style="background:${NAVY};padding:18px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:12px"><img src="${esc(logo)}" width="38" height="38" alt="GUVEL" style="display:block;border:0"></td>
    <td style="font:800 22px Arial,Helvetica,sans-serif;letter-spacing:2px;color:#ffffff">GUVEL<br><span style="font:700 10px Arial,Helvetica,sans-serif;letter-spacing:3px;color:${CYAN}">QUALITY</span></td></tr></table></td></tr>
  <tr><td style="padding:30px 28px 26px;font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK}">
    <h1 style="margin:0 0 16px;font:700 22px/1.25 Arial,Helvetica,sans-serif;color:${INK}">${esc(o.title)}</h1>${o.body}${btn}</td></tr>
  <tr><td style="padding:16px 28px;background:#F4F8FB;border-top:1px solid ${LINE};font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Este mensaje es automático. Para entrar debes iniciar sesión con tu correo en GUVEL Quality.<br>GUVEL Quality</td></tr>
 </table></td></tr></table></body></html>`;
}

const row = (k: string, v: string): string => `<tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED};width:38%">${esc(k)}</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:14.5px Arial,Helvetica,sans-serif;color:${INK}">${v}</td></tr>`;

/** Correo con el plan completo de una persona */
function planEmail(o: { person: string; plan: PlanInfo; audits: AuditInfo[]; siteUrl: string }): { subject: string; html: string; text: string } {
  const n = o.audits.length;
  const planUrl = `${o.siteUrl.replace(/\/$/, "")}/#/audits/plan/${o.plan.id}`;
  const lines = o.audits.map((a) => `<tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 14px Arial,Helvetica,sans-serif">${esc(dateShort(a.scheduled_date))}</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 13px Arial,Helvetica,sans-serif;color:#067A8E">${esc(a.code)}</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:14px Arial,Helvetica,sans-serif">${a.level ? "Nivel " + a.level : "—"}</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:13px Arial,Helvetica,sans-serif;color:${MUTED}">${esc(dateTime(a.due_at))}</td></tr>`).join("");
  const body = `<p style="margin:0 0 14px">Hola <b>${esc(o.person)}</b>,</p>
   <p style="margin:0 0 18px">Se te asignaron <b>${n} auditoría${n === 1 ? "" : "s"}</b> en el plan <b>${esc(planTitle(o.plan))}</b> (${esc(o.plan.audit_type)} · ${esc(freq(o.plan.frequency))}, ${esc(range(o.plan))}).</p>
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-collapse:collapse"><tr style="background:#F4F8FB"><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED};letter-spacing:.5px">FECHA</th><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">FOLIO</th><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">NIVEL</th><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">LÍMITE</th></tr>${lines}</table>
   <p style="margin:16px 0 0;color:${MUTED};font-size:13.5px">Recibirás un aviso individual por cada auditoría. Adjuntamos el plan completo en PDF.</p>${o.plan.notes ? `<p style="margin:12px 0 0;font-size:13.5px"><b>Notas:</b> ${esc(o.plan.notes)}</p>` : ""}`;
  const subject = `Plan de auditoría ${o.plan.code}: ${n} auditoría${n === 1 ? "" : "s"} asignada${n === 1 ? "" : "s"}`;
  const text = `Hola ${o.person},\n\nSe te asignaron ${n} auditoría(s) en el plan ${planTitle(o.plan)} (${o.plan.audit_type}, ${range(o.plan)}).\n\n${o.audits.map((a) => `- ${dateShort(a.scheduled_date)} · ${a.code}${a.level ? " · Nivel " + a.level : ""} · límite ${dateTime(a.due_at)}`).join("\n")}\n\nVer el plan: ${planUrl}\n`;
  return { subject, html: layout({ siteUrl: o.siteUrl, preheader: `${n} auditoría(s) asignadas en ${planTitle(o.plan)}`, title: "Plan de auditoría asignado", body, button: { label: "Ver mi plan", url: planUrl } }), text };
}

/** Notificación individual de UNA auditoría */
function auditEmail(o: { person: string; plan: PlanInfo; audit: AuditInfo; siteUrl: string }): { subject: string; html: string; text: string; url: string } {
  const a = o.audit, url = `${o.siteUrl.replace(/\/$/, "")}/#/audits/${a.id}`;
  const body = `<p style="margin:0 0 14px">Hola <b>${esc(o.person)}</b>,</p>
   <p style="margin:0 0 18px">Se te asignó la auditoría <b>${esc(a.code)}</b>. Entra con tu cuenta para realizar el checklist y registrar tus resultados.</p>
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-collapse:collapse">
     ${row("Folio", `<b style="color:#067A8E">${esc(a.code)}</b>`)}${row("Plan", esc(planTitle(o.plan)))}${row("Tipo", esc(o.plan.audit_type) + (a.level ? " · Nivel " + a.level : ""))}
     ${row("Fecha programada", `<b>${esc(dateLong(a.scheduled_date))}</b>`)}${row("Límite de entrega", esc(dateTime(a.due_at)))}${a.form_name ? row("Formato", esc(a.form_name)) : ""}${a.notes ? row("Notas", esc(a.notes)) : ""}
   </table>`;
  const subject = `Auditoría ${a.code} · ${dateShort(a.scheduled_date)} · ${o.plan.audit_type}${a.level ? " N" + a.level : ""}`;
  const text = `Hola ${o.person},\n\nSe te asignó la auditoría ${a.code} (${planTitle(o.plan)}).\nFecha: ${dateLong(a.scheduled_date)}\nLímite: ${dateTime(a.due_at)}\n${a.form_name ? "Formato: " + a.form_name + "\n" : ""}\nRealizar auditoría: ${url}\n`;
  return { subject, html: layout({ siteUrl: o.siteUrl, preheader: `${a.code} · ${dateLong(a.scheduled_date)}`, title: "Nueva auditoría asignada", body, button: { label: "Realizar auditoría", url } }), text, url };
}

/** Evento de calendario (.ics) de día completo */
function icsFile(o: { uid: string; summary: string; date: string; description: string; url: string }): string {
  const d = o.date.replace(/-/g, "");
  const next = new Date(o.date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const t = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GUVEL//Quality//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${o.uid}@guvel-quality`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${t(o.summary)}`, `DESCRIPTION:${t(o.description + "\n" + o.url)}`, `URL:${o.url}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

// ───────────── Función ─────────────
// Edge Function: notify-audit-plan
// Envía, por correo (Resend), el plan de auditoría y una notificación individual
// por cada auditoría a las personas asignadas. Solo personal (admin / gerente /
// auditor) puede invocarla. Registra cada envío en public.notification_log.
//
// Secretos requeridos:  RESEND_API_KEY · FROM_EMAIL ("GUVEL Quality <calidad@tudominio.com>")
// Opcionales:           SITE_URL (URL pública del portal) · REPLY_TO

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ["admin", "quality_manager", "auditor"];

interface Attachment { filename: string; content: string }
async function sendMail(key: string, payload: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.status === 429) { await sleep(1200 * (attempt + 1)); continue; }   // Resend: ~2 envíos/seg
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Resend respondió ${r.status}`);
    return j.id as string;
  }
  throw new Error("Límite de envíos alcanzado; intenta de nuevo en un minuto.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FROM_EMAIL");
    if (!resendKey || !from) return json({ error: "Falta configurar los secretos RESEND_API_KEY y FROM_EMAIL de la función." }, 500);

    /* 1. Quién llama */
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from("profiles").select("id, full_name, role, active").eq("id", user.id).maybeSingle();
    if (!me?.active || !STAFF.includes(me.role)) return json({ error: "No tienes permisos para enviar planes." }, 403);

    /* 2. Entrada */
    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id ?? "");
    if (!UUID.test(planId)) return json({ error: "plan_id inválido" }, 400);
    const siteUrl = (Deno.env.get("SITE_URL") || String(body.site_url || "")).replace(/\/$/, "");
    if (!/^https?:\/\//.test(siteUrl)) return json({ error: "Falta SITE_URL (URL pública del portal)." }, 500);
    const pdf = typeof body.pdf_base64 === "string" && body.pdf_base64.length < 4_000_000 ? (body.pdf_base64 as string) : null;
    const resendAll = body.resend_all === true;
    const replyTo = Deno.env.get("REPLY_TO") || undefined;

    /* 3. Datos */
    const { data: plan } = await admin.from("audit_plans").select("id, code, name, audit_type, frequency, start_date, end_date, notes").eq("id", planId).maybeSingle();
    if (!plan) return json({ error: "Plan no encontrado" }, 404);
    const { data: audits } = await admin.from("audits").select("id, code, scheduled_date, due_at, level, form_id, notes, assigned_to, status, notified_at, notified_to").eq("plan_id", planId).neq("status", "cancelada").not("assigned_to", "is", null).order("scheduled_date");
    const pending = (audits ?? []).filter((a) => resendAll || !a.notified_at || a.notified_to !== a.assigned_to);
    if (!pending.length) return json({ ok: true, sent_plan: 0, sent_audits: 0, failed: [], skipped: [], message: "No hay auditorías pendientes de notificar." });

    const ids = [...new Set(pending.map((a) => a.assigned_to as string))];
    const { data: people } = await admin.from("profiles").select("id, full_name, email, active").in("id", ids);
    const formIds = [...new Set(pending.map((a) => a.form_id).filter(Boolean))] as string[];
    const { data: forms } = formIds.length ? await admin.from("forms").select("id, code, name").in("id", formIds) : { data: [] };
    const formName = (id: string | null) => { const f = (forms ?? []).find((x) => x.id === id); return f ? `${f.code} · ${f.name}` : null; };

    /* 4. Envío (plan + una notificación por auditoría) */
    const result = { ok: true, sent_plan: 0, sent_audits: 0, failed: [] as { email: string; kind: string; error: string }[], skipped: [] as { name: string; reason: string }[] };
    const log: Record<string, unknown>[] = [];
    const notified = new Map<string, string[]>(); // persona -> ids de auditorías notificadas
    const planInfo: PlanInfo = plan as PlanInfo;
    let first = true;
    const send = async (payload: Record<string, unknown>) => { if (!first) await sleep(550); first = false; return await sendMail(resendKey, payload); };

    for (const pid of ids) {
      const person = (people ?? []).find((p) => p.id === pid);
      const mine = pending.filter((a) => a.assigned_to === pid);
      if (!person || !person.active || !person.email) { result.skipped.push({ name: person?.full_name ?? pid, reason: "Sin correo o usuario inactivo" }); continue; }
      const infos: AuditInfo[] = mine.map((a) => ({ id: a.id, code: a.code, scheduled_date: a.scheduled_date, due_at: a.due_at, level: a.level, form_name: formName(a.form_id), notes: a.notes }));

      // Correo del plan
      const pm = planEmail({ person: person.full_name, plan: planInfo, audits: infos, siteUrl });
      try {
        const attachments: Attachment[] = pdf ? [{ filename: `Plan_${plan.code}.pdf`, content: pdf }] : [];
        const id = await send({ from, to: [person.email], reply_to: replyTo, subject: pm.subject, html: pm.html, text: pm.text, attachments });
        result.sent_plan++; log.push({ plan_id: planId, user_id: pid, email: person.email, kind: "plan", status: "sent", provider_id: id, sent_by: me.id });
      } catch (e) {
        const error = (e as Error).message; result.failed.push({ email: person.email, kind: "plan", error });
        log.push({ plan_id: planId, user_id: pid, email: person.email, kind: "plan", status: "failed", error, sent_by: me.id });
      }

      // Notificación individual por auditoría (con evento .ics)
      for (const info of infos) {
        const am = auditEmail({ person: person.full_name, plan: planInfo, audit: info, siteUrl });
        const ics = icsFile({ uid: info.id, summary: `Auditoría ${info.code} · ${plan.audit_type}`, date: info.scheduled_date, description: `${planTitle(planInfo)}${info.form_name ? "\n" + info.form_name : ""}`, url: am.url });
        try {
          const id = await send({ from, to: [person.email], reply_to: replyTo, subject: am.subject, html: am.html, text: am.text, attachments: [{ filename: `${info.code}.ics`, content: btoa(unescape(encodeURIComponent(ics))) }] });
          result.sent_audits++; notified.set(pid, [...(notified.get(pid) ?? []), info.id]);
          log.push({ plan_id: planId, audit_id: info.id, user_id: pid, email: person.email, kind: "audit", status: "sent", provider_id: id, sent_by: me.id });
        } catch (e) {
          const error = (e as Error).message; result.failed.push({ email: person.email, kind: info.code, error });
          log.push({ plan_id: planId, audit_id: info.id, user_id: pid, email: person.email, kind: "audit", status: "failed", error, sent_by: me.id });
        }
      }
    }

    /* 5. Registro y estado */
    if (log.length) await admin.from("notification_log").insert(log);
    const now = new Date().toISOString();
    for (const [pid, auditIds] of notified) await admin.from("audits").update({ notified_at: now, notified_to: pid }).in("id", auditIds);
    if (result.sent_plan + result.sent_audits > 0) await admin.from("audit_plans").update({ status: "enviado", sent_at: now, sent_by: me.id }).eq("id", planId);
    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
