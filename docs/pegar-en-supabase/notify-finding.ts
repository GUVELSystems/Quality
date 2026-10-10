// Edge Function: notify-finding
// Envía por correo (Resend) el aviso de un hallazgo:
//   assigned    → al responsable: "se te asignó un hallazgo para que lo cierres"
//   transferred → al nuevo responsable
//   rejected    → al responsable: la verificación fue rechazada y el hallazgo se reabrió
//   verify      → a los administradores: hay un hallazgo listo para verificar
// Solo personal (admin / gerente / auditor) puede invocarla y solo sobre hallazgos recientes.
// Secretos: RESEND_API_KEY · FROM_EMAIL · SITE_URL (opcional: REPLY_TO)
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ["admin", "quality_manager", "auditor"];
const TZ = "America/Monterrey";

const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const dt = (iso: string | null): string => (iso ? new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso)).replace(/\./g, "") : "—");

const NAVY = "#0F1B2D", CYAN = "#0CC0DF", ICE = "#EAF2F8", INK = "#0F1B2D", MUTED = "#52647A", LINE = "#DDE6EE";
function layout(o: { siteUrl: string; preheader: string; title: string; body: string; button: { label: string; url: string } }): string {
  const logo = `${o.siteUrl.replace(/\/$/, "")}/assets/guvel-logo.png`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${ICE}"><span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ICE};padding:24px 12px"><tr><td align="center">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
  <tr><td style="background:${NAVY};padding:18px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:12px"><img src="${esc(logo)}" width="38" height="38" alt="GUVEL" style="display:block;border:0"></td>
    <td style="font:800 22px Arial,Helvetica,sans-serif;letter-spacing:2px;color:#ffffff">GUVEL<br><span style="font:700 10px Arial,Helvetica,sans-serif;letter-spacing:3px;color:${CYAN}">QUALITY</span></td></tr></table></td></tr>
  <tr><td style="height:4px;background:${CYAN};font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:30px 28px 26px;font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK}">
    <h1 style="margin:0 0 16px;font:700 22px/1.25 Arial,Helvetica,sans-serif;color:${INK}">${esc(o.title)}</h1>${o.body}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr><td style="background:${CYAN};border-radius:3px"><a href="${esc(o.button.url)}" style="display:inline-block;padding:13px 26px;font:700 15px Arial,Helvetica,sans-serif;color:${NAVY};text-decoration:none">${esc(o.button.label)}</a></td></tr></table>
    <p style="margin:0;font:12.5px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${esc(o.button.url)}" style="color:#067A8E;word-break:break-all">${esc(o.button.url)}</a></p></td></tr>
  <tr><td style="padding:16px 28px;background:#F4F8FB;border-top:1px solid ${LINE};font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Este mensaje es automático. Para entrar debes iniciar sesión con tu correo en GUVEL Quality.<br>GUVEL Quality</td></tr>
 </table></td></tr></table></body></html>`;
}

type Kind = "assigned" | "transferred" | "rejected" | "verify";
const COPY: Record<Kind, { subject1: (c: string) => string; subjectN: (n: number) => string; title: string; intro: (n: number) => string; preheader: string }> = {
  assigned: { subject1: (c) => `Se te asignó el hallazgo ${c}`, subjectN: (n) => `Se te asignaron ${n} hallazgos`, title: "Se te asignó un hallazgo", intro: (n) => `Se te ${n === 1 ? "asignó 1 hallazgo" : `asignaron ${n} hallazgos`} para que ${n === 1 ? "lo cierres" : "los cierres"} dentro del plazo. Entra al portal, acepta o traslada el hallazgo y registra la acción con su evidencia.`, preheader: "Tienes un hallazgo por atender" },
  transferred: { subject1: (c) => `Te trasladaron el hallazgo ${c}`, subjectN: (n) => `Te trasladaron ${n} hallazgos`, title: "Te trasladaron un hallazgo", intro: (n) => `Te ${n === 1 ? "trasladaron 1 hallazgo" : `trasladaron ${n} hallazgos`}. Acéptalo y registra la acción para cerrarlo a tiempo. Ya no se puede volver a trasladar.`, preheader: "Un hallazgo fue trasladado a ti" },
  rejected: { subject1: (c) => `Verificación rechazada: ${c}`, subjectN: (n) => `${n} verificaciones rechazadas`, title: "Verificación rechazada", intro: () => "Un administrador rechazó la verificación y el hallazgo se reabrió. Corrige y vuelve a cerrar las acciones: el milestone continúa con el tiempo que te quedaba.", preheader: "Un hallazgo se reabrió" },
  verify: { subject1: (c) => `Hallazgo ${c} listo para verificar`, subjectN: (n) => `${n} hallazgos listos para verificar`, title: "Hallazgo listo para verificar", intro: (n) => `${n === 1 ? "Se cerraron las acciones de 1 hallazgo" : `Se cerraron las acciones de ${n} hallazgos`}. Acepta o rechaza la verificación dentro del plazo.`, preheader: "Hay verificaciones pendientes" },
};

async function sendMail(key: string, payload: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from("profiles").select("id, role, active").eq("id", user.id).maybeSingle();
    if (!me?.active || !STAFF.includes(me.role)) return json({ error: "No tienes permisos para enviar avisos." }, 403);

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind ?? "") as Kind;
    const ids: string[] = Array.isArray(body.finding_ids) ? (body.finding_ids as unknown[]).map(String).filter((x: string) => UUID.test(x)).slice(0, 20) : [];
    if (!COPY[kind]) return json({ error: "Tipo de aviso inválido" }, 400);
    if (!ids.length) return json({ error: "finding_ids inválido" }, 400);
    const siteUrl = (Deno.env.get("SITE_URL") || String(body.site_url || "")).replace(/\/$/, "");
    if (!/^https?:\/\//.test(siteUrl)) return json({ error: "Falta SITE_URL (URL pública del portal)." }, 500);
    const replyTo = Deno.env.get("REPLY_TO") || undefined;

    /* Hallazgos válidos para ese aviso (recientes y en el estado esperado) */
    const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const { data: found } = await admin.from("findings").select("id, code, title, owner_id, class_id, due_at, due_date, status, transfer_count, reject_count, area, module, updated_at").in("id", ids);
    const valid = (found ?? []).filter((f) => f.updated_at >= since && (
      (kind === "assigned" && f.owner_id) || (kind === "transferred" && f.owner_id && f.transfer_count > 0) ||
      (kind === "rejected" && f.owner_id && f.reject_count > 0 && f.status === "abierto") || (kind === "verify" && f.status === "verificacion")));
    if (!valid.length) return json({ ok: true, sent: 0, skipped: [], failed: [], message: "Nada que avisar." });

    /* Destinatarios */
    const byUser = new Map<string, typeof valid>();
    if (kind === "verify") {
      const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").eq("active", true);
      for (const a of admins ?? []) byUser.set(a.id, valid);
    } else for (const f of valid) byUser.set(f.owner_id, [...(byUser.get(f.owner_id) ?? []), f]);
    byUser.delete(me.id);                                              // no se avisa a quien hizo la acción
    const userIds = [...byUser.keys()];
    if (!userIds.length) return json({ ok: true, sent: 0, skipped: [], failed: [], message: "Sin destinatarios." });

    const { data: people } = await admin.from("profiles").select("id, full_name, email, active").in("id", userIds);
    const classIds = [...new Set(valid.map((f) => f.class_id).filter(Boolean))] as string[];
    const { data: classes } = classIds.length ? await admin.from("finding_classes").select("id, code, days").in("id", classIds) : { data: [] };
    const cls = (id: string | null) => { const c = (classes ?? []).find((x) => x.id === id); return c ? `${c.code} · ${c.days} días hábiles` : "—"; };

    /* Evita duplicados: mismo aviso al mismo usuario en los últimos 10 minutos */
    const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: dupes } = await admin.from("notification_log").select("finding_id, user_id").eq("kind", "finding").eq("detail", kind).eq("status", "sent").in("finding_id", valid.map((f) => f.id)).gte("created_at", recent);
    const seen = new Set((dupes ?? []).map((d) => `${d.finding_id}:${d.user_id}`));

    const result = { ok: true, sent: 0, skipped: [] as { name: string; reason: string }[], failed: [] as { email: string; error: string }[] };
    const log: Record<string, unknown>[] = [];
    const copy = COPY[kind];
    let first = true;
    for (const uid of userIds) {
      const person = (people ?? []).find((p) => p.id === uid);
      const list = (byUser.get(uid) ?? []).filter((f) => !seen.has(`${f.id}:${uid}`));
      if (!list.length) continue;
      if (!person || !person.active || !person.email) { result.skipped.push({ name: person?.full_name ?? uid, reason: "Sin correo o usuario inactivo" }); continue; }
      const rows = list.map((f) => `<tr><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:600 13px Arial,Helvetica,sans-serif;color:#067A8E;white-space:nowrap">${esc(f.code)}</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:14px Arial,Helvetica,sans-serif">${esc(f.title)}<br><span style="color:${MUTED};font-size:12.5px">${esc(f.area || "")}</span></td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:13px Arial,Helvetica,sans-serif;white-space:nowrap">${esc(cls(f.class_id))}</td><td style="padding:9px 12px;border-bottom:1px solid ${LINE};font:13px Arial,Helvetica,sans-serif">${esc(dt(f.due_at))}</td></tr>`).join("");
      const html = layout({
        siteUrl, preheader: copy.preheader, title: copy.title,
        body: `<p style="margin:0 0 14px">Hola <b>${esc(person.full_name)}</b>,</p><p style="margin:0 0 18px">${esc(copy.intro(list.length))}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-collapse:collapse"><tr style="background:#F4F8FB"><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">FOLIO</th><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">HALLAZGO</th><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">CLASIFICACIÓN</th><th align="left" style="padding:9px 12px;font:700 11.5px Arial,Helvetica,sans-serif;color:${MUTED}">LÍMITE</th></tr>${rows}</table>`,
        button: list.length === 1 ? { label: "Abrir hallazgo", url: `${siteUrl}/#/findings/${list[0].id}` } : { label: "Ver mis pendientes", url: `${siteUrl}/#/dashboard` },
      });
      const text = `Hola ${person.full_name},\n\n${copy.intro(list.length)}\n\n${list.map((f) => `- ${f.code} · ${f.title} · ${cls(f.class_id)} · límite ${dt(f.due_at)}`).join("\n")}\n\n${list.length === 1 ? `${siteUrl}/#/findings/${list[0].id}` : `${siteUrl}/#/dashboard`}\n`;
      try {
        if (!first) await sleep(550); first = false;
        const id = await sendMail(resendKey, { from, to: [person.email], reply_to: replyTo, subject: list.length === 1 ? copy.subject1(list[0].code) : copy.subjectN(list.length), html, text });
        result.sent++; for (const f of list) log.push({ finding_id: f.id, user_id: uid, email: person.email, kind: "finding", detail: kind, status: "sent", provider_id: id, sent_by: me.id });
      } catch (e) {
        const error = (e as Error).message; result.failed.push({ email: person.email, error });
        for (const f of list) log.push({ finding_id: f.id, user_id: uid, email: person.email, kind: "finding", detail: kind, status: "failed", error, sent_by: me.id });
      }
    }
    if (log.length) await admin.from("notification_log").insert(log);
    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
