// Edge Function: invite-user
// Solo un administrador puede invitar. Envía la invitación de Supabase Auth
// (enlace para crear contraseña) y deja el perfil activo con el rol indicado.
//
// Opcional: SITE_URL (URL pública del portal; destino del enlace de la invitación)
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ROLES = ["admin", "quality_manager", "auditor", "viewer"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
    if (!me?.active || me.role !== "admin") return json({ error: "Solo un administrador puede invitar usuarios." }, 403);

    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase(), full_name = String(b.full_name ?? "").trim(), role = String(b.role ?? "viewer"), area = String(b.area ?? "").trim();
    if (!EMAIL.test(email)) return json({ error: "Correo inválido." }, 400);
    if (!full_name) return json({ error: "Escribe el nombre completo." }, 400);
    if (!ROLES.includes(role)) return json({ error: "Rol inválido." }, 400);
    const redirectTo = Deno.env.get("SITE_URL") || String(b.site_url ?? "");

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) return json({ error: "Ese correo ya tiene una cuenta. Abre su perfil y usa «Enviar enlace de acceso»." }, 409);
      return json({ error: error.message }, 400);
    }
    // El trigger handle_new_user crea el perfil inactivo; aquí se activa con su rol.
    const { error: upErr } = await admin.from("profiles").update({ full_name, role, area: area || null, active: true }).eq("id", data.user.id);
    if (upErr) return json({ error: "Invitación enviada, pero no se pudo asignar el rol: " + upErr.message }, 500);
    return json({ ok: true, user_id: data.user.id });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
