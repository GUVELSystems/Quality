-- =====================================================================
-- GUVEL Quality · Flujo de hallazgos, clasificaciones, niveles LPA y áreas
-- Ejecutar DESPUÉS de 06_modules.sql. Re-ejecutable (no duplica ni borra datos).
--
-- Agrega:
--   · lpa_levels          Niveles de LPA configurables
--   · finding_classes     Clasificaciones (N1, N2…) con días HÁBILES para cerrar
--   · areas / area_level_owners   Áreas, su dueño y responsables por nivel LPA
--   · app_settings        Parámetros (p. ej. días de verificación)
--   · Columnas del flujo del hallazgo (aceptar/trasladar, análisis, acción, verificación)
--   · Reglas que hace cumplir la base de datos (quién puede aceptar, trasladar, verificar)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Requisito: función de acceso "miembro activo" (usada por las políticas RLS).
-- Se crea aquí por si tu base aún tiene una versión anterior de 01_schema.sql.
-- ---------------------------------------------------------------------
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() is not null
$$;

-- ---------------------------------------------------------------------
-- Niveles LPA
-- ---------------------------------------------------------------------
create table if not exists public.lpa_levels (
  id         uuid primary key default gen_random_uuid(),
  level      integer not null unique check (level between 1 and 20),
  name       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.lpa_levels (level, name)
select n, 'Nivel ' || n from generate_series(1, 5) n
on conflict (level) do nothing;

-- El nivel de una auditoría ya no se limita a 1–5
alter table public.audits drop constraint if exists audits_level_check;
alter table public.audits add constraint audits_level_check check (level is null or level between 1 and 20);

-- ---------------------------------------------------------------------
-- Clasificaciones de hallazgo (reemplazan a la "severidad")
-- ---------------------------------------------------------------------
create table if not exists public.finding_classes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                       -- N1, N2…
  name       text,
  days       integer not null check (days >= 0),          -- días HÁBILES para cerrar las acciones
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.finding_classes (code, name, days)
select v.code, v.name, v.days
  from (values ('N1', 'Clasificación N1', 3), ('N2', 'Clasificación N2', 6), ('N3', 'Clasificación N3', 10)) as v(code, name, days)
 where not exists (select 1 from public.finding_classes c where c.code = v.code);

-- ---------------------------------------------------------------------
-- Áreas y responsables por nivel
-- ---------------------------------------------------------------------
create table if not exists public.areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  owner_id   uuid references public.profiles(id) on delete set null,   -- dueño del área
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.area_level_owners (
  id       uuid primary key default gen_random_uuid(),
  area_id  uuid not null references public.areas(id) on delete cascade,
  level    integer not null check (level between 1 and 20),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  unique (area_id, level)
);

-- Migración: las áreas que ya existían como catálogo y las secciones de los checklists
insert into public.areas (name)
select c.name from public.classifications c where c.kind = 'area' and c.active
on conflict (name) do nothing;

alter table public.form_items add column if not exists area_id uuid references public.areas(id) on delete set null;

insert into public.areas (name)
select distinct btrim(fi.section) from public.form_items fi where fi.section is not null and btrim(fi.section) <> ''
on conflict (name) do nothing;

update public.form_items fi set area_id = a.id
  from public.areas a where fi.area_id is null and fi.section is not null and a.name = btrim(fi.section);

-- ---------------------------------------------------------------------
-- Parámetros
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('verification_days', '15'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Respuestas del checklist: clasificación elegida al marcar "No cumple"
-- ---------------------------------------------------------------------
alter table public.audit_answers add column if not exists class_id uuid references public.finding_classes(id) on delete set null;

-- ---------------------------------------------------------------------
-- Hallazgos: flujo de trabajo y milestones
-- ---------------------------------------------------------------------
alter table public.findings add column if not exists class_id         uuid references public.finding_classes(id) on delete set null;
alter table public.findings add column if not exists area_id          uuid references public.areas(id) on delete set null;
alter table public.findings add column if not exists start_date       date;             -- desde aquí corre el milestone de cierre
alter table public.findings add column if not exists accepted_at      timestamptz;
alter table public.findings add column if not exists accepted_by      uuid references public.profiles(id) on delete set null;
alter table public.findings add column if not exists transfer_count   integer not null default 0 check (transfer_count between 0 and 1);
alter table public.findings add column if not exists transferred_from uuid references public.profiles(id) on delete set null;
alter table public.findings add column if not exists transferred_at   timestamptz;
alter table public.findings add column if not exists transfer_reason  text;
alter table public.findings add column if not exists analysis_text    text;             -- ¿Por qué se presentó?
alter table public.findings add column if not exists analysis_at      timestamptz;
alter table public.findings add column if not exists action_plan      text;             -- ¿Qué se hará para corregirlo?
alter table public.findings add column if not exists actions_closed_on date;            -- fin del milestone de cierre
alter table public.findings add column if not exists verify_due       date;             -- límite de la verificación
alter table public.findings add column if not exists verified_at      timestamptz;
alter table public.findings add column if not exists verified_by      uuid references public.profiles(id) on delete set null;
alter table public.findings add column if not exists verified_on      date;             -- fin del milestone de verificación
alter table public.findings add column if not exists verification_notes text;

update public.findings set start_date = created_at::date where start_date is null;

-- Datos previos: el texto de las acciones existentes pasa a "plan de acción"
update public.findings f set action_plan = x.txt
  from (select finding_id, string_agg(description, E'\n') as txt from public.actions group by finding_id) x
 where x.finding_id = f.id and f.action_plan is null;

create index if not exists idx_findings_owner on public.findings(owner_id, status);

-- ---------------------------------------------------------------------
-- Reglas del flujo (las hace cumplir la base de datos, no solo el portal)
--   · Avanzar un hallazgo (aceptar, análisis, acción): solo su responsable o un admin
--   · Trasladar: solo el responsable o un admin, y UNA sola vez
--   · Reasignar por otra vía: solo un admin
--   · Verificar y cerrar: solo un admin
-- ---------------------------------------------------------------------
create or replace function public.enforce_finding_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;            -- backend / SQL Editor

  if old.status in ('abierto','en_analisis','en_accion')
     and new.status is distinct from old.status
     and new.status <> 'cerrado'
     and not (old.owner_id = uid or public.is_admin()) then
    raise exception 'Solo el responsable asignado o un administrador puede avanzar este hallazgo';
  end if;

  if new.status = 'cerrado' and old.status is distinct from 'cerrado' and not public.is_admin() then
    raise exception 'Solo un administrador puede verificar y cerrar el hallazgo';
  end if;

  if new.transfer_count > old.transfer_count then
    if old.transfer_count >= 1 then
      raise exception 'Este hallazgo ya fue trasladado una vez';
    end if;
    if not (old.owner_id = uid or public.is_admin()) then
      raise exception 'Solo el responsable asignado o un administrador puede trasladar el hallazgo';
    end if;
  elsif new.owner_id is distinct from old.owner_id and not public.is_admin() then
    raise exception 'Solo un administrador puede reasignar el responsable';
  end if;

  return new;
end $$;

drop trigger if exists trg_findings_workflow on public.findings;
create trigger trg_findings_workflow before update on public.findings
  for each row execute function public.enforce_finding_workflow();

-- ---------------------------------------------------------------------
-- Seguridad (RLS) de las tablas nuevas: lectura para miembros, escritura para managers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['lpa_levels','finding_classes','areas','area_level_owners','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member())', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;
