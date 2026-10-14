/* =====================================================================
   GUVEL Quality · Configuración
   Pega aquí la URL y la clave ANON (pública) de tu proyecto Supabase:
   Supabase → Project Settings → API.
   La clave anon es pública por diseño; la seguridad la dan las políticas
   RLS de supabase/02_policies.sql. NUNCA pongas la service_role key.

   Si los valores están vacíos, la app arranca en MODO DEMO
   (datos de ejemplo guardados en el navegador).

   Todas las empresas comparten esta misma base de datos: lo que separa los
   datos de cada una es `company_id` y las reglas de seguridad (RLS), no el
   dominio desde el que se entra. El subdominio de cada empresa apunta a
   este mismo portal.
   ===================================================================== */
export const CONFIG = {
  SUPABASE_URL: "https://vaalezcebtxdoluwayde.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3u3b2fs12hMg4GW95qcgyA_V7gdu-wx",
  APP_NAME: "GUVEL Quality",
};

export const isDemo = !(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
