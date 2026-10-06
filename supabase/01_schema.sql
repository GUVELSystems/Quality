-- =====================================================================
-- GUVEL Quality · Esquema de base de datos (Supabase / PostgreSQL)
-- Ejecutar PRIMERO. Es re-ejecutable (idempotente) en la mayoría de casos.
-- Orden: 01_schema.sql → 02_policies.sql → 03_seed.sql
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Utilidades generales
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Contadores para códigos legibles (AUD-0001, HAL-0001, ...)
create table if not exists public.code_counters (
  prefix     text primary key,
  last_value integer not null default 0
);

create or replace function public.set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p_prefix text := tg_argv[0];
  n        integer;
begin
  if new.code is null or new.code = '' then
    insert into public.code_counters as c (prefix, last_value)
    values (p_prefix, 1)
    on conflict (prefix) do update set last_value = c.last_value + 1
    returning c.last_value into n;
    new.code := p_prefix || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Perfiles y roles
-- Roles: admin · quality_manager · auditor · viewer
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  role       text not null default 'viewer'
             check (role in ('admin','quality_manager','auditor','viewer')),
  area       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Funciones auxiliares de rol (usadas por RLS)
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin','quality_manager','auditor'), false)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin','quality_manager'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

-- Cualquier usuario activo (con perfil) puede leer; las políticas RLS lo usan.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() is not null
$$;

-- Al crearse un usuario en Auth se crea su perfil.
--   · El PRIMER usuario del sistema queda como admin activo.
--   · Los demás quedan como viewer INACTIVOS: no ven ningún dato hasta que un
--     admin los active (la función "invite-user" lo hace al invitar). Así,
--     aunque alguien se auto-registre, no obtiene acceso.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    case when first_user then 'admin' else 'viewer' end,
    first_user
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Evita que un usuario se auto-promueva de rol o se reactive
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() es NULL cuando escribe el backend (service role / SQL Editor):
  -- eso sí se permite. Un usuario autenticado solo puede si es admin.
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar rol o estado';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------

create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name          text not null,
  contact_name  text,
  contact_email text,
  plant         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_clients_code on public.clients;
create trigger trg_clients_code before insert on public.clients
  for each row execute function public.set_code('CLI');
drop trigger if exists trg_clients_touch on public.clients;
create trigger trg_clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- Catálogo genérico. kind: categoria_hallazgo | area | causa_raiz | tipo_riesgo
create table if not exists public.classifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (kind, name)
);

-- Formatos / checklists
create table if not exists public.forms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                 -- FOR-LPA-001
  name       text not null,
  audit_type text not null check (audit_type in ('LPA','Producto','Proceso','Sistema','Interna')),
  version    text not null default '1.0',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_forms_touch on public.forms;
create trigger trg_forms_touch before update on public.forms
  for each row execute function public.touch_updated_at();

create table if not exists public.form_items (
  id        uuid primary key default gen_random_uuid(),
  form_id   uuid not null references public.forms(id) on delete cascade,
  position  integer not null default 1,
  section   text,
  question  text not null,
  critical  boolean not null default false
);
create index if not exists idx_form_items_form on public.form_items(form_id, position);

-- ---------------------------------------------------------------------
-- Auditorías
-- ---------------------------------------------------------------------

create table if not exists public.audit_plans (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,
  audit_type text not null check (audit_type in ('LPA','Producto','Proceso','Sistema','Interna')),
  frequency  text not null check (frequency in ('Semanal','Quincenal','Mensual','Custom')),
  start_date date not null,
  end_date   date not null,
  notes      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
drop trigger if exists trg_plans_code on public.audit_plans;
create trigger trg_plans_code before insert on public.audit_plans
  for each row execute function public.set_code('PLAN');

create table if not exists public.audits (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  plan_id        uuid references public.audit_plans(id) on delete cascade,
  scheduled_date date not null,
  assigned_to    uuid references public.profiles(id) on delete set null,
  level          integer check (level between 1 and 5),   -- solo LPA
  form_id        uuid references public.forms(id) on delete set null,
  due_at         timestamptz,
  status         text not null default 'programada'
                 check (status in ('programada','en_proceso','completada','cancelada')),
  score          numeric(5,2),
  notes          text,
  completed_at   timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_audits_plan on public.audits(plan_id, scheduled_date);
create index if not exists idx_audits_assigned on public.audits(assigned_to);
drop trigger if exists trg_audits_code on public.audits;
create trigger trg_audits_code before insert on public.audits
  for each row execute function public.set_code('AUD');
drop trigger if exists trg_audits_touch on public.audits;
create trigger trg_audits_touch before update on public.audits
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Hallazgos y acciones
-- ---------------------------------------------------------------------

create table if not exists public.findings (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  title             text not null,
  description       text,
  source            text not null default 'auditoria'
                    check (source in ('auditoria','cliente','proceso','proveedor','interno')),
  severity          text not null default 'menor'
                    check (severity in ('critico','mayor','menor','observacion')),
  status            text not null default 'abierto'
                    check (status in ('abierto','en_analisis','en_accion','verificacion','cerrado')),
  classification_id uuid references public.classifications(id) on delete set null,
  area              text,
  owner_id          uuid references public.profiles(id) on delete set null,
  audit_id          uuid references public.audits(id) on delete set null,
  client_id         uuid references public.clients(id) on delete set null,
  root_cause        text,
  due_date          date,
  closed_at         timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_findings_status on public.findings(status, severity);
create index if not exists idx_findings_audit on public.findings(audit_id);
drop trigger if exists trg_findings_code on public.findings;
create trigger trg_findings_code before insert on public.findings
  for each row execute function public.set_code('HAL');
drop trigger if exists trg_findings_touch on public.findings;
create trigger trg_findings_touch before update on public.findings
  for each row execute function public.touch_updated_at();

create table if not exists public.actions (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  finding_id     uuid references public.findings(id) on delete cascade,
  action_type    text not null default 'correctiva'
                 check (action_type in ('contencion','correctiva','preventiva')),
  description    text not null,
  owner_id       uuid references public.profiles(id) on delete set null,
  due_date       date,
  status         text not null default 'pendiente'
                 check (status in ('pendiente','en_proceso','completada','verificada')),
  completed_at   timestamptz,
  effectiveness  text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_actions_finding on public.actions(finding_id);
drop trigger if exists trg_actions_code on public.actions;
create trigger trg_actions_code before insert on public.actions
  for each row execute function public.set_code('ACC');
drop trigger if exists trg_actions_touch on public.actions;
create trigger trg_actions_touch before update on public.actions
  for each row execute function public.touch_updated_at();

-- Respuestas del checklist de una auditoría
create table if not exists public.audit_answers (
  id         uuid primary key default gen_random_uuid(),
  audit_id   uuid not null references public.audits(id) on delete cascade,
  item_id    uuid not null references public.form_items(id) on delete cascade,
  result     text not null check (result in ('ok','nok','na')),
  comment    text,
  finding_id uuid references public.findings(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (audit_id, item_id)
);

-- ---------------------------------------------------------------------
-- Notificaciones de cliente (quejas, devoluciones, SCAR, alertas)
-- ---------------------------------------------------------------------

create table if not exists public.customer_notifications (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  client_id         uuid references public.clients(id) on delete set null,
  notification_type text not null default 'queja'
                    check (notification_type in ('queja','devolucion','scar','alerta','auditoria_cliente')),
  subject           text not null,
  description       text,
  part_number       text,
  quantity          integer,
  severity          text not null default 'mayor'
                    check (severity in ('critico','mayor','menor','observacion')),
  received_at       date not null default current_date,
  response_due      date,
  status            text not null default 'recibida'
                    check (status in ('recibida','contencion','analisis','respuesta_enviada','cerrada')),
  owner_id          uuid references public.profiles(id) on delete set null,
  finding_id        uuid references public.findings(id) on delete set null,
  closed_at         timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_notif_status on public.customer_notifications(status, response_due);
drop trigger if exists trg_notif_code on public.customer_notifications;
create trigger trg_notif_code before insert on public.customer_notifications
  for each row execute function public.set_code('NCL');
drop trigger if exists trg_notif_touch on public.customer_notifications;
create trigger trg_notif_touch before update on public.customer_notifications
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Riesgos y oportunidades
-- ---------------------------------------------------------------------

create table if not exists public.risks (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  title       text not null,
  description text,
  category    text,
  probability integer not null default 1 check (probability between 1 and 5),
  impact      integer not null default 1 check (impact between 1 and 5),
  score       integer generated always as (probability * impact) stored,
  owner_id    uuid references public.profiles(id) on delete set null,
  mitigation  text,
  status      text not null default 'identificado'
              check (status in ('identificado','mitigando','aceptado','cerrado')),
  review_date date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_risks_code on public.risks;
create trigger trg_risks_code before insert on public.risks
  for each row execute function public.set_code('RSK');
drop trigger if exists trg_risks_touch on public.risks;
create trigger trg_risks_touch before update on public.risks
  for each row execute function public.touch_updated_at();

create table if not exists public.opportunities (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  title       text not null,
  description text,
  benefit     text,
  effort      text not null default 'medio' check (effort in ('bajo','medio','alto')),
  owner_id    uuid references public.profiles(id) on delete set null,
  status      text not null default 'identificada'
              check (status in ('identificada','evaluada','en_ejecucion','implementada','descartada')),
  due_date    date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_opps_code on public.opportunities;
create trigger trg_opps_code before insert on public.opportunities
  for each row execute function public.set_code('OPP');
drop trigger if exists trg_opps_touch on public.opportunities;
create trigger trg_opps_touch before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Bitácora de actividad (trazabilidad)
-- ---------------------------------------------------------------------

create table if not exists public.activity_log (
  id         bigserial primary key,
  entity     text not null,
  entity_id  uuid,
  action     text not null,                 -- INSERT | UPDATE | DELETE
  summary    text,
  actor      uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_created on public.activity_log(created_at desc);

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.activity_log (entity, entity_id, action, summary, actor)
  values (
    tg_table_name,
    (r->>'id')::uuid,
    tg_op,
    coalesce(r->>'code', '') || ' · ' || coalesce(r->>'title', r->>'subject', r->>'status', ''),
    auth.uid()
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['audits','findings','actions','customer_notifications','risks','opportunities']
  loop
    execute format('drop trigger if exists trg_%1$s_log on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_log after insert or update or delete on public.%1$s
         for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Cierre automático: sellos de tiempo al cambiar estado
-- ---------------------------------------------------------------------

create or replace function public.stamp_closure()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'findings' then
    if new.status = 'cerrado' and old.status is distinct from 'cerrado' then new.closed_at = now(); end if;
    if new.status <> 'cerrado' then new.closed_at = null; end if;
  elsif tg_table_name = 'actions' then
    if new.status in ('completada','verificada') and new.completed_at is null then new.completed_at = now(); end if;
    if new.status in ('pendiente','en_proceso') then new.completed_at = null; end if;
  elsif tg_table_name = 'customer_notifications' then
    if new.status = 'cerrada' and old.status is distinct from 'cerrada' then new.closed_at = now(); end if;
    if new.status <> 'cerrada' then new.closed_at = null; end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['findings','actions','customer_notifications']
  loop
    execute format('drop trigger if exists trg_%1$s_stamp on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_stamp before update on public.%1$s
         for each row execute function public.stamp_closure()', t);
  end loop;
end $$;
