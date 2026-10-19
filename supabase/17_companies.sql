-- =====================================================================
-- GUVEL Quality · Multi-empresa (Fase 1): compañías, roles y seguridad
--
-- Una sola base de datos sirve a todas las empresas clientes; cada fila de
-- cada tabla queda marcada con la empresa a la que pertenece (company_id),
-- y las reglas de seguridad garantizan que nadie vea datos de una empresa
-- que no es la suya, sin importar desde qué URL entre.
--
-- Roles nuevos:
--   Personal de GUVEL (sin empresa, profiles.company_id = NULL):
--     super_admin → administra la lista de empresas; NUNCA escribe datos
--                   de calidad de un cliente (solo lectura agregada, para
--                   soporte/estadísticas).
--     support     → acceso temporal a UNA empresa, solo con una concesión
--                   activa (support_grants), con motivo y expiración.
--   Dentro de cada empresa (profiles.role):
--     admin   → todo, incluida la gestión de usuarios/roles
--     manager → todo lo operativo, sin gestionar usuarios
--     auditor → solo sus propias asignaciones (nada de catálogos, áreas,
--               CAPA Files, ni listas generales)
--     viewer  → solo lectura de sus asignaciones (heredado, poco usado)
--
-- Ejecutar DESPUÉS de 16_super_admin.sql. Re-ejecutable (no borra datos).
-- Como todo lo construido hasta ahora es de una sola empresa (GUVEL), este
-- script crea esa empresa y le asigna TODOS los datos y usuarios actuales,
-- para que el portal de GUVEL siga funcionando exactamente igual que hoy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Empresas
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,                 -- quality.<slug>.guvelsystems.com
  status     text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.companies enable row level security;
grant select, insert, update, delete on public.companies to authenticated;

-- La empresa de GUVEL (todo lo que ya existe se vuelve suyo)
insert into public.companies (id, name, slug, status)
  values ('00000000-0000-0000-0000-000000000001', 'GUVEL', 'guvel', 'active')
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) Personal de GUVEL: profiles.company_id (NULL = sin empresa) y
--    profiles.platform_role (super_admin / support)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists company_id uuid references public.companies(id);
alter table public.profiles add column if not exists platform_role text
  check (platform_role is null or platform_role in ('super_admin', 'support'));

-- Todo usuario YA EXISTENTE pertenece a GUVEL (sigue funcionando igual que hoy)
update public.profiles set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;

-- "quality_manager" pasa a llamarse "manager" (mismo permiso, nuevo nombre)
update public.profiles set role = 'manager' where role = 'quality_manager';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'manager', 'auditor', 'viewer'));

-- El primer administrador de GUVEL también queda como Super Admin (ya lo hacía 16_super_admin.sql;
-- aquí solo se asegura que platform_role quede sincronizado con esa misma columna histórica)
update public.profiles set platform_role = 'super_admin' where super_admin = true and platform_role is null;

-- ---------------------------------------------------------------------
-- 3) company_id en todas las tablas de datos (NOT NULL; todo lo existente → GUVEL)
--    (public.my_company() se define más abajo; el DEFAULT se deja listo
--    desde ahora, Postgres solo exige que la función exista al usarla)
-- ---------------------------------------------------------------------
create or replace function public.my_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and active
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','classifications','forms','form_items',
    'audit_plans','audits','audit_answers','findings','actions',
    'customer_notifications','risks','opportunities','attachments',
    'lpa_levels','finding_classes','areas','area_level_owners','app_settings','notifications','finding_events',
    'standards','capa_templates','rca_templates','finding_documents'
  ] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id)', t);
    execute format('update public.%I set company_id = ''00000000-0000-0000-0000-000000000001'' where company_id is null', t);
    execute format('alter table public.%I alter column company_id set not null', t);
    -- Si se inserta sin una sesión de usuario (p. ej. corriendo este mismo script desde el SQL Editor
    -- de Supabase, o un seed de datos), cae a la empresa de GUVEL en vez de fallar
    execute format('alter table public.%I alter column company_id set default coalesce(public.my_company(), ''00000000-0000-0000-0000-000000000001'')', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4) Soporte GUVEL: concesiones de acceso temporal, con motivo y expiración
-- ---------------------------------------------------------------------
create table if not exists public.support_grants (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,   -- quién de soporte lo pidió
  reason       text not null,
  permission   text not null default 'read' check (permission in ('read', 'write')),
  status       text not null default 'pending' check (status in ('pending', 'active', 'expired', 'revoked')),
  granted_by   uuid references public.profiles(id) on delete set null,          -- admin de la empresa o super admin que autorizó
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null
);
create table if not exists public.support_access_log (
  id         uuid primary key default gen_random_uuid(),
  grant_id   uuid not null references public.support_grants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor      uuid references public.profiles(id) on delete set null,
  action     text not null,          -- "entró al portal", "editó hallazgo IF-0006", …
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.support_grants enable row level security;
alter table public.support_access_log enable row level security;
grant select, insert, update, delete on public.support_grants to authenticated;
grant select, insert, update, delete on public.support_access_log to authenticated;

-- ---------------------------------------------------------------------
-- 5) Funciones de seguridad
-- ---------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select platform_role = 'super_admin' from public.profiles where id = auth.uid() and active), false)
$$;
create or replace function public.is_support()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select platform_role = 'support' from public.profiles where id = auth.uid() and active), false)
$$;
-- ¿Hay una concesión de soporte ACTIVA, vigente y con el permiso suficiente, para esta empresa?
create or replace function public.has_support_access(target_company uuid, need_write boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.support_grants g
    where g.company_id = target_company and g.requested_by = auth.uid() and g.status = 'active'
      and (g.expires_at is null or g.expires_at > now())
      and (not need_write or g.permission = 'write')
  )
$$;
-- Lectura del CONTENIDO de una empresa (catálogos, hallazgos, auditorías…): tu propia empresa, o una
-- concesión de soporte vigente. El Super Admin NO entra aquí a propósito: administra la lista de
-- empresas y ve estadísticas agregadas (vía funciones que solo devuelven conteos), nunca el contenido.
create or replace function public.in_company(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target_company = public.my_company() or public.has_support_access(target_company, false)
$$;
-- Escritura: tu propia empresa, o una concesión de soporte vigente de lectura/escritura (el Super Admin NO escribe datos de clientes)
create or replace function public.in_company_write(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target_company = public.my_company() or public.has_support_access(target_company, true)
$$;
-- Conteo agregado para el panel del Super Admin: nunca expone una fila de hallazgo, solo números
create or replace function public.company_finding_counts(target_company uuid)
returns table (total bigint, open bigint) language sql stable security definer set search_path = public as $$
  select count(*), count(*) filter (where status <> 'cerrado') from public.findings where company_id = target_company and public.is_super_admin()
$$;
grant execute on function public.company_finding_counts(uuid) to authenticated;

-- El auditor solo ve SUS propias asignaciones (no las de toda la empresa)
create or replace function public.is_own_assignment(owner uuid, assignee uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = owner or (assignee is not null and auth.uid() = assignee)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin', 'manager', 'auditor'), false)
$$;
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin', 'manager'), false)
$$;

-- ---------------------------------------------------------------------
-- 6) Reglas de seguridad: compañías
-- ---------------------------------------------------------------------
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.is_super_admin() or public.is_support() or id = public.my_company() or public.has_support_access(id, false));
drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists support_grants_select on public.support_grants;
create policy support_grants_select on public.support_grants for select to authenticated
  using (public.is_super_admin() or public.is_support() or company_id = public.my_company());
drop policy if exists support_grants_insert on public.support_grants;
create policy support_grants_insert on public.support_grants for insert to authenticated
  with check (public.is_support() and requested_by = auth.uid());
drop policy if exists support_grants_update on public.support_grants;
create policy support_grants_update on public.support_grants for update to authenticated
  using (public.is_super_admin() or company_id = public.my_company())
  with check (public.is_super_admin() or company_id = public.my_company());

drop policy if exists support_log_select on public.support_access_log;
create policy support_log_select on public.support_access_log for select to authenticated
  using (public.is_super_admin() or public.is_support() or company_id = public.my_company());
drop policy if exists support_log_insert on public.support_access_log;
create policy support_log_insert on public.support_access_log for insert to authenticated
  with check (public.has_support_access(company_id, false));

-- ---------------------------------------------------------------------
-- 7) Reglas de seguridad: perfiles (ahora con empresa)
-- ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin() or (public.is_member() and (company_id = public.my_company() or public.has_support_access(company_id, false))));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or (public.is_admin() and company_id = public.my_company()))
  with check (id = auth.uid() or (public.is_admin() and company_id = public.my_company()));

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (public.is_admin() and company_id = public.my_company());

-- ---------------------------------------------------------------------
-- 8) Catálogos y configuración: ni lectura ni escritura para auditor/viewer
--    (nada de catálogos, áreas, normas, CAPA/Root Cause Files, formatos…)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','classifications','forms','form_items','lpa_levels','finding_classes',
    'areas','area_level_owners','app_settings','standards','capa_templates','rca_templates'
  ] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_manager() and public.in_company(company_id))', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (public.is_manager() and public.in_company_write(company_id)) with check (public.is_manager() and public.in_company_write(company_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9) Tablas operativas: admin/manager ven todo lo de su empresa;
--    auditor/viewer solo SUS asignaciones (sin visibilidad general)
-- ---------------------------------------------------------------------
drop policy if exists audit_plans_select on public.audit_plans;
create policy audit_plans_select on public.audit_plans for select to authenticated
  using (public.in_company(company_id) and (public.is_manager() or exists (select 1 from public.audits a where a.plan_id = audit_plans.id and public.is_own_assignment(a.assigned_to))));

drop policy if exists audits_select on public.audits;
create policy audits_select on public.audits for select to authenticated
  using (public.in_company(company_id) and (public.is_manager() or public.is_own_assignment(assigned_to)));

drop policy if exists audit_answers_select on public.audit_answers;
create policy audit_answers_select on public.audit_answers for select to authenticated
  using (public.in_company(company_id) and (public.is_manager() or exists (select 1 from public.audits a where a.id = audit_answers.audit_id and public.is_own_assignment(a.assigned_to))));

drop policy if exists findings_select on public.findings;
create policy findings_select on public.findings for select to authenticated
  using (public.in_company(company_id) and (public.is_manager() or public.is_own_assignment(owner_id, reviewer_id)));

drop policy if exists actions_select on public.actions;
create policy actions_select on public.actions for select to authenticated
  using (public.in_company(company_id) and (public.is_manager() or exists (select 1 from public.findings f where f.id = actions.finding_id and public.is_own_assignment(f.owner_id))));

do $$
declare t text;
begin
  foreach t in array array['audit_plans','audits','audit_answers','findings','actions','customer_notifications','risks','opportunities'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_staff() and public.in_company_write(company_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_staff() and public.in_company_write(company_id)) with check (public.is_staff() and public.in_company_write(company_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_manager() and public.in_company_write(company_id))', t);
  end loop;
end $$;

-- Notificaciones de cliente y riesgos/oportunidades: sin la restricción de "solo mis asignaciones"
-- (no tienen ese concepto); con que sea de tu empresa y seas personal activo, basta.
do $$
declare t text;
begin
  foreach t in array array['customer_notifications','risks','opportunities'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.in_company(company_id) and public.is_member())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10) Resto de tablas de apoyo (adjuntos, bandeja, bitácora de hallazgos,
--     documentos de plantillas…): visibles para cualquiera de la empresa
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['attachments','notifications','finding_events','finding_documents'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.in_company(company_id))', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (public.is_staff() and public.in_company_write(company_id)) with check (public.is_staff() and public.in_company_write(company_id))', t);
  end loop;
end $$;
