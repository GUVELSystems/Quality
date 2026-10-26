// GUVEL Quality · notify-inspection (archivo único para pegar en el editor de Supabase)
// Envía UN solo correo (al solicitante + los destinatarios que se agreguen, todos en el
// mismo mensaje) con el resultado de una inspección dimensional ya confirmada.
// Secretos: RESEND_API_KEY, FROM_EMAIL, SITE_URL.
import { createClient } from "npm:@supabase/supabase-js@2";

const NAVY = "#0F1B2D", CYAN = "#0CC0DF", ICE = "#EAF2F8", INK = "#0F1B2D", MUTED = "#52647A", LINE = "#DDE6EE";
const OK = "#1B9E77", STOP = "#E83B3B";
const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const dateTime = (iso: string | null): string => (iso ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Monterrey" }).format(new Date(iso)).replace(/\./g, "") : "—");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ["admin", "manager", "auditor"];

async function sendMail(key: string, payload: Record<string, unknown>): Promise<string> {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Resend respondió ${r.status}`);
  return j.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FROM_EMAIL");
    if (!resendKey || !from) return json({ error: "Falta configurar los secretos RESEND_API_KEY y FROM_EMAIL de la función." }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from("profiles").select("id, full_name, role, active").eq("id", user.id).maybeSingle();
    if (!me?.active || !STAFF.includes(me.role)) return json({ error: "No tienes permisos para enviar este correo." }, 403);

    const body = await req.json().catch(() => ({}));
    const recordId = String(body.record_id ?? "");
    if (!UUID.test(recordId)) return json({ error: "record_id inválido" }, 400);
    const ccEmails: string[] = Array.isArray(body.cc_emails) ? body.cc_emails.filter((e: unknown) => typeof e === "string" && e.includes("@")) : [];
    const siteUrl = (Deno.env.get("SITE_URL") || String(body.site_url || "")).replace(/\/$/, "");

    const { data: rec } = await admin.from("inspection_records").select("*").eq("id", recordId).maybeSingle();
    if (!rec) return json({ error: "Registro no encontrado" }, 404);
    const { data: req1 } = rec.request_id ? await admin.from("inspection_requests").select("requester_name, requester_email").eq("id", rec.request_id).maybeSingle() : { data: null };
    const { data: items } = await admin.from("inspection_format_items").select("*").eq("format_id", rec.format_id).order("position");

    const to = [req1?.requester_email, ...ccEmails].filter(Boolean) as string[];
    if (!to.length) return json({ error: "No hay ningún correo al cual enviar (ni solicitante ni destinatarios)." }, 400);

    const pieces = Math.max(1, Number(rec.quantity) || 1);
    let ok = 0, nok = 0;
    const rows = (items ?? []).map((it: Record<string, unknown>) => {
      const measArr = (rec.measurements?.[it.id as string] ?? []) as { value: number; result: string }[];
      return Array.from({ length: pieces }, (_, p) => measArr[p]).map((m) => {
        if (m?.value != null) { m.result === "cumple" ? ok++ : nok++; }
        return `<tr><td style="padding:8px 10px;border-bottom:1px solid ${LINE};font:13px Arial,Helvetica,sans-serif">${esc(it.balloon_no)}</td><td style="padding:8px 10px;border-bottom:1px solid ${LINE};font:13px Arial,Helvetica,sans-serif">${esc(it.description)}</td><td style="padding:8px 10px;border-bottom:1px solid ${LINE};font:13px Arial,Helvetica,sans-serif;text-align:center">${m?.value ?? "—"}</td><td style="padding:8px 10px;border-bottom:1px solid ${LINE};font:700 12px Arial,Helvetica,sans-serif;text-align:center;color:${m?.result === "cumple" ? OK : m?.result === "no_cumple" ? STOP : MUTED}">${m?.result === "cumple" ? "OK" : m?.result === "no_cumple" ? "NOK" : "—"}</td></tr>`;
      }).join("");
    }).join("");
    const pct = ok + nok ? Math.round((ok / (ok + nok)) * 1000) / 10 : null;
    const overallColor = rec.overall_result === "cumple" ? OK : rec.overall_result === "no_cumple" ? STOP : MUTED;
    const overallLabel = rec.overall_result === "cumple" ? "CUMPLE" : rec.overall_result === "no_cumple" ? "NO CUMPLE" : "SIN RESULTADO";

    const recordUrl = siteUrl ? `${siteUrl}/#/inspecciones/registro/${recordId}` : null;
    const body2 = `<p style="margin:0 0 14px">Resultado de la inspección dimensional de la pieza <b>${esc(rec.part_number)}</b> (${esc(rec.part_name)}).</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED};width:38%">Folio</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:700 14px Arial,Helvetica,sans-serif;color:#067A8E">${esc(rec.code)}</td></tr>
        <tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED}">Lote</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:14px Arial,Helvetica,sans-serif">${esc(rec.lot_number || "—")}</td></tr>
        <tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED}">Resultado general</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:800 14px Arial,Helvetica,sans-serif;color:${overallColor}">${overallLabel}${pct != null ? ` · ${pct}% OK (${ok} OK / ${nok} NOK)` : ""}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-collapse:collapse">
        <tr style="background:#F4F8FB"><th align="left" style="padding:8px 10px;font:700 11px Arial,Helvetica,sans-serif;color:${MUTED}">NO.</th><th align="left" style="padding:8px 10px;font:700 11px Arial,Helvetica,sans-serif;color:${MUTED}">DESCRIPCIÓN</th><th style="padding:8px 10px;font:700 11px Arial,Helvetica,sans-serif;color:${MUTED}">MEDICIÓN</th><th style="padding:8px 10px;font:700 11px Arial,Helvetica,sans-serif;color:${MUTED}">RESULTADO</th></tr>
        ${rows}
      </table>
      <p style="margin:16px 0 0;color:${MUTED};font-size:12.5px">Confirmado ${dateTime(rec.sent_at || new Date().toISOString())}.</p>`;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${ICE}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ICE};padding:24px 12px"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="background:${NAVY};padding:18px 28px;font:800 20px Arial,Helvetica,sans-serif;color:#fff">GUVEL <span style="color:${CYAN};font-weight:700;font-size:11px;letter-spacing:2px">QUALITY</span></td></tr>
        <tr><td style="padding:28px;font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK}"><h1 style="margin:0 0 16px;font:700 20px Arial,Helvetica,sans-serif">Inspección dimensional · ${esc(rec.part_number)}</h1>${body2}</td></tr>
        <tr><td style="padding:16px 28px;background:#F4F8FB;border-top:1px solid ${LINE};font:12px Arial,Helvetica,sans-serif;color:${MUTED}">GUVEL Quality · Inspecciones</td></tr>
      </table></td></tr></table></body></html>`;
    const text = `Inspección ${rec.code} · ${rec.part_number} (${rec.part_name})\nResultado: ${overallLabel}${pct != null ? ` (${pct}% OK)` : ""}\n`;

    const id = await sendMail(resendKey, { from, to, subject: `Resultado de inspección ${rec.code} · ${rec.part_number}`, html, text });
    await admin.from("inspection_records").update({ sent_at: rec.sent_at || new Date().toISOString() }).eq("id", recordId);
    return json({ ok: true, provider_id: id, to });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
