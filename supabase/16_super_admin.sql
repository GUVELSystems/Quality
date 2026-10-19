-- =====================================================================
-- GUVEL Quality · Super Admin (portal de control de empresas)
--
-- ¡OJO! Este script se corre SOLO en la base de datos "de casa" de GUVEL
-- (quality.guvelsystems.com). NO lo corras en la base de datos de un
-- cliente nuevo (como Metrics Works Saltillo): cada cliente tiene su
-- propia base de datos independiente y no necesita esta columna.
--
-- Agrega un nivel por encima de "admin": quien lo tenga ve, dentro de
-- Configuración, la pantalla "Portales" con la lista de empresas dadas de
-- alta en tenants.js y accesos directos para entrar a cada una.
-- Re-ejecutable (no borra datos).
-- =====================================================================

alter table public.profiles add column if not exists super_admin boolean not null default false;

-- Da el permiso al primer administrador de esta base (ajusta el correo si quieres dárselo a alguien más)
-- update public.profiles set super_admin = true where email = 'TU_CORREO@guvelsystems.com';
