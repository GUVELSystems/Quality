-- =====================================================================
-- GUVEL Quality · Corrección: Catálogos (Causa raíz, Categoría de
-- hallazgo, Tipo de riesgo, Origen de Issues) también eran únicos para
-- TODA la base de datos, no por empresa.
--
-- Esta tabla se quedó fuera por error en la corrección anterior
-- (19_company_scoped_unique.sql) — mismo problema, misma solución.
--
-- Ejecutar DESPUÉS de 21_support_tickets.sql. Re-ejecutable (no borra
-- datos).
-- =====================================================================

alter table public.classifications drop constraint if exists classifications_kind_name_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'classifications' and constraint_name = 'classifications_company_kind_name_unique') then
    alter table public.classifications add constraint classifications_company_kind_name_unique unique (company_id, kind, name);
  end if;
end $$;
