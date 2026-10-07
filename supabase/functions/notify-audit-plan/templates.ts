// Plantillas de correo de GUVEL Quality (HTML con tablas + estilos en línea,
// compatibles con Outlook/Gmail). Funciones puras: sin dependencias de Deno.

export interface PlanInfo { id: string; code: string; name: string | null; audit_type: string; frequency: string; start_date: string; end_date: string; notes?: string | null }
export interface AuditInfo { id: string; code: string; scheduled_date: string; due_at: string | null; level: number | null; form_name: string | null; notes?: string | null }

const NAVY = "#0F1B2D", CYAN = "#0CC0DF", ICE = "#EAF2F8", INK = "#0F1B2D", MUTED = "#52647A", LINE = "#DDE6EE";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const TZ = "America/Monterrey";
const dateLong = (d: string): string => new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
const dateShort = (d: string): string => new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z")).replace(/\./g, "");
const dateTime = (iso: string | null): string => (iso ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso)).replace(/\./g, "") : "—");
const range = (p: PlanInfo): string => `${dateShort(p.start_date)} al ${dateShort(p.end_date)}`;
export const planTitle = (p: PlanInfo): string => p.name || `${p.audit_type} · ${range(p)}`;
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
export function planEmail(o: { person: string; plan: PlanInfo; audits: AuditInfo[]; siteUrl: string }): { subject: string; html: string; text: string } {
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
export function auditEmail(o: { person: string; plan: PlanInfo; audit: AuditInfo; siteUrl: string }): { subject: string; html: string; text: string; url: string } {
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
export function icsFile(o: { uid: string; summary: string; date: string; description: string; url: string }): string {
  const d = o.date.replace(/-/g, "");
  const next = new Date(o.date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const t = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GUVEL//Quality//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${o.uid}@guvel-quality`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${t(o.summary)}`, `DESCRIPTION:${t(o.description + "\n" + o.url)}`, `URL:${o.url}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
