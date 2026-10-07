// Edge Function: notify-audit-plan
// Envía, por correo (Resend), el plan de auditoría y una notificación individual
// por cada auditoría a las personas asignadas. Solo personal (admin / gerente /
// auditor) puede invocarla. Registra cada envío en public.notification_log.
//
// Secretos requeridos:  RESEND_API_KEY · FROM_EMAIL ("GUVEL Quality <calidad@tudominio.com>")
// Opcionales:           SITE_URL (URL pública del portal) · REPLY_TO
import { createClient } from "npm:@supabase/supabase-js@2";
import { auditEmail, icsFile, planEmail, planTitle, type AuditInfo, type PlanInfo } from "./templates.ts";

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
