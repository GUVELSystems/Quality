-- =====================================================================
-- GUVEL Quality · Seguridad (Row Level Security)
-- Ejecutar DESPUÉS de 01_schema.sql
--
-- Modelo de permisos:
--   admin            → todo, incluida la gestión de usuarios
--   quality_manager  → todo lo operativo + catálogos + borrar registros
--   auditor          → crear/editar auditorías, hallazgos, acciones, etc.
--   viewer           → solo lectura
--   (usuario inactivo → sin acceso a ningún dato)
-- =====================================================================

-- Privilegios base (RLS decide qué filas se pueden ver / modificar)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.code_counters from authenticated, anon;

-- ---------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','clients','classifications','forms','form_items',
    'audit_plans','audits','audit_answers','findings','actions',
    'customer_notifications','risks','opportunities','activity_log','code_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_member());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Los perfiles se crean por trigger; el borrado solo lo hace un admin
drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Catálogos: lectura para todos, escritura solo managers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['clients','classifications','forms','form_items'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member())', t);

    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all to authenticated
         using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Tablas operativas: lectura para todos, alta/edición para staff,
-- borrado solo managers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'audit_plans','audits','audit_answers','findings','actions',
    'customer_notifications','risks','opportunities'
  ] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member())', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_staff())', t);

    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);

    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_manager())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Bitácora: lectura para usuarios autenticados (la escribe el trigger)
-- ---------------------------------------------------------------------
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log
  for select to authenticated using (public.is_member());
