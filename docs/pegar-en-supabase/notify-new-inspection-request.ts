// GUVEL Quality · notify-new-inspection-request (archivo único para pegar en el editor de Supabase)
// El Kiosk (sin sesión) llama esta función justo después de registrar una solicitud, para avisarle
// por correo SOLO a quienes tienen el rol Supervisor en esa empresa. Manager/Admin la ven dentro del
// portal, en Notificaciones → Solicitudes pendientes (no reciben este correo).
// Secretos: RESEND_API_KEY, FROM_EMAIL, SITE_URL.
import { createClient } from "npm:@supabase/supabase-js@2";

const NAVY = "#0F1B2D", CYAN = "#0CC0DF", ICE = "#EAF2F8", INK = "#0F1B2D", MUTED = "#52647A", LINE = "#DDE6EE";
const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FROM_EMAIL");
    if (!resendKey || !from) return json({ error: "Falta configurar los secretos RESEND_API_KEY y FROM_EMAIL de la función." }, 500);
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.request_id ?? "");
    if (!UUID.test(requestId)) return json({ error: "request_id inválido" }, 400);
    const siteUrl = (Deno.env.get("SITE_URL") || String(body.site_url || "")).replace(/\/$/, "");

    // Esta solicitud debe existir de verdad (el Kiosk no puede inventar una) — así nadie puede usar esta
    // función para mandar correos arbitrarios
    const { data: reqRow } = await admin.from("inspection_requests").select("*").eq("id", requestId).maybeSingle();
    if (!reqRow) return json({ error: "Solicitud no encontrada" }, 404);

    const { data: supervisors } = await admin.from("profiles").select("full_name, email").eq("company_id", reqRow.company_id).eq("role", "supervisor").eq("active", true);
    const to = (supervisors ?? []).map((p: Record<string, unknown>) => p.email).filter(Boolean) as string[];
    if (!to.length) return json({ ok: true, skipped: "sin supervisores activos en esta empresa" });

    const link = siteUrl ? `${siteUrl}/#/inspecciones/solicitudes` : null;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${ICE}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ICE};padding:24px 12px"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff">
        <tr><td style="background:${NAVY};padding:18px 28px;font:800 20px Arial,Helvetica,sans-serif;color:#fff">GUVEL <span style="color:${CYAN};font-weight:700;font-size:11px;letter-spacing:2px">QUALITY</span></td></tr>
        <tr><td style="padding:28px;font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK}">
          <h1 style="margin:0 0 14px;font:700 19px Arial,Helvetica,sans-serif">Nueva solicitud de inspección</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-collapse:collapse">
            <tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED};width:40%">Folio</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:700 14px Arial,Helvetica,sans-serif;color:#067A8E">${esc(reqRow.code)}</td></tr>
            <tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED}">Número de parte</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:14px Arial,Helvetica,sans-serif">${esc(reqRow.part_number)} — ${esc(reqRow.part_name)}</td></tr>
            <tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED}">Solicitante</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:14px Arial,Helvetica,sans-serif">${esc(reqRow.requester_name)} · ${esc(reqRow.requester_email)}</td></tr>
            <tr><td style="padding:9px 12px;font:600 12.5px Arial,Helvetica,sans-serif;color:${MUTED}">Lote / Cantidad</td><td style="padding:9px 12px;font:14px Arial,Helvetica,sans-serif">${esc(reqRow.lot_number || "—")} · ${esc(reqRow.quantity ?? "—")}</td></tr>
          </table>
          ${link ? `<p style="margin:20px 0 0"><a href="${link}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;padding:10px 18px;font:700 13px Arial,Helvetica,sans-serif">Ver solicitud</a></p>` : ""}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F4F8FB;border-top:1px solid ${LINE};font:12px Arial,Helvetica,sans-serif;color:${MUTED}">GUVEL Quality · Inspecciones</td></tr>
      </table></td></tr></table></body></html>`;
    const text = `Nueva solicitud ${reqRow.code} · ${reqRow.part_number}\nSolicitante: ${reqRow.requester_name} (${reqRow.requester_email})\n`;

    const id = await sendMail(resendKey, { from, to, subject: `Nueva solicitud de inspección · ${reqRow.part_number}`, html, text });
    return json({ ok: true, provider_id: id, to });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
