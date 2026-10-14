// Edge Function: create-company
// Solo un Super Admin de GUVEL puede darla de alta. Crea la empresa, crea su
// primer usuario (Administrador) con la contraseña que el Super Admin define
// aquí mismo (no se manda invitación por correo), y lo deja activo.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from("profiles").select("platform_role, active").eq("id", user.id).maybeSingle();
    if (!me?.active || me.platform_role !== "super_admin") return json({ error: "Solo un Super Admin puede dar de alta empresas." }, 403);

    const b = await req.json().catch(() => ({}));
    const companyName = String(b.company_name ?? "").trim();
    let slug = String(b.slug ?? "").trim().toLowerCase();
    const email = String(b.email ?? "").trim().toLowerCase();
    const full_name = String(b.full_name ?? "").trim();
    const password = String(b.password ?? "");
    if (!companyName) return json({ error: "Escribe el nombre de la empresa." }, 400);
    if (!slug) slug = companyName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!SLUG.test(slug)) return json({ error: "El subdominio debe tener solo letras minúsculas, números y guiones (3 a 63 caracteres)." }, 400);
    if (!EMAIL.test(email)) return json({ error: "Correo inválido para el primer administrador." }, 400);
    if (!full_name) return json({ error: "Escribe el nombre completo del primer administrador." }, 400);
    if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);

    const { data: company, error: cErr } = await admin.from("companies")
      .insert({ name: companyName, slug, status: "active", created_by: user.id }).select().single();
    if (cErr) {
      if (/duplicate|unique/i.test(cErr.message)) return json({ error: `El subdominio "${slug}" ya está en uso por otra empresa.` }, 409);
      return json({ error: cErr.message }, 400);
    }

    const { data: created, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
    if (uErr) {
      await admin.from("companies").delete().eq("id", company.id); // no dejar una empresa huérfana sin su primer usuario
      if (/already|registered|exists/i.test(uErr.message)) return json({ error: "Ese correo ya tiene una cuenta en el sistema." }, 409);
      return json({ error: uErr.message }, 400);
    }
    // El trigger handle_new_user crea el perfil (inactivo, sin empresa); aquí se activa como Administrador de la nueva empresa.
    const { error: upErr } = await admin.from("profiles")
      .update({ full_name, role: "admin", company_id: company.id, platform_role: null, active: true })
      .eq("id", created.user.id);
    if (upErr) return json({ error: "La empresa y el usuario se crearon, pero no se pudo terminar de configurar el perfil: " + upErr.message }, 500);

    return json({ ok: true, company, user_id: created.user.id });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
