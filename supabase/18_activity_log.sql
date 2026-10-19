-- =====================================================================
-- GUVEL Quality · Historial (Configuración → Historial)
--
-- La bitácora de actividad (activity_log) ya existía desde el inicio, pero
-- no tenía company_id: antes de mostrarla en el portal, hace falta que
-- cada movimiento quede marcado con su empresa, para que nadie vea el
-- historial de otra.
--
-- Ejecutar DESPUÉS de 17_companies.sql. Re-ejecutable (no borra datos).
-- =====================================================================

alter table public.activity_log add column if not exists company_id uuid references public.companies(id);
update public.activity_log set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
-- (se deja NULLABLE a propósito: una fila huérfana no debe tronar nada, solo no se verá en Historial)

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.activity_log (entity, entity_id, action, summary, actor, company_id)
  values (
    tg_table_name,
    (r->>'id')::uuid,
    tg_op,
    coalesce(r->>'code', '') || ' · ' || coalesce(r->>'title', r->>'subject', r->>'status', ''),
    auth.uid(),
    (r->>'company_id')::uuid
  );
  return coalesce(new, old);
end $$;

drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated
  using (public.is_manager() and public.in_company(company_id));
