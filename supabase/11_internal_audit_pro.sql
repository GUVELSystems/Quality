-- =====================================================================
-- GUVEL Quality · Auditorías Internas "a fondo"
-- Ejecutar DESPUÉS de 10_product_dimensions.sql. Re-ejecutable (no borra datos).
--
--   1) Proceso declarado a auditar en cada auditoría interna
--   2) Normas aplicables (IATF, ISO, VDA, cliente…) + proceso y cláusula en los formatos internos
--   3) Folio propio para hallazgos internos: IF-0001, IF-0002…
--   4) CAPA Files (8D, 4D, CAPA, A4, Alerta de calidad…) y Root Cause Files (5 Porqués, Ishikawa…)
--   5) Etapas ampliadas del hallazgo interno: Abierto · Descripción · Contención · Causa raíz · Acciones · Verificación · Cierre
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Proceso declarado a auditar (reutiliza el catálogo de Áreas)
-- ---------------------------------------------------------------------
alter table public.audits add column if not exists process_area_id uuid references public.areas(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2) Normas aplicables y datos del formato interno
-- ---------------------------------------------------------------------
create table if not exists public.standards (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,          -- IATF16949, ISO9001, VDA6.3, CLIENTE-XYZ…
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.standards (code, name)
select v.code, v.name from (values ('IATF16949','IATF 16949'), ('ISO9001','ISO 9001'), ('VDA6.3','VDA 6.3')) as v(code, name)
 where not exists (select 1 from public.standards s where s.code = v.code);

alter table public.forms add column if not exists process_area_id uuid references public.areas(id) on delete set null;
alter table public.forms add column if not exists standard_id     uuid references public.standards(id) on delete set null;
alter table public.form_items add column if not exists clause text;   -- cláusula de la norma (ej. "8.5.1")

-- ---------------------------------------------------------------------
-- 3) Folio propio para hallazgos internos (IF-0001…); el resto sigue con HAL-
-- ---------------------------------------------------------------------
create or replace function public.set_code_finding()
returns trigger language plpgsql security definer set search_path = public as $$
declare p_prefix text; n integer;
begin
  if new.code is null or new.code = '' then
    p_prefix := case when new.module = 'internas' then 'IF' else 'HAL' end;
    insert into public.code_counters as c (prefix, last_value) values (p_prefix, 1)
      on conflict (prefix) do update set last_value = c.last_value + 1
      returning c.last_value into n;
    new.code := p_prefix || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_findings_code on public.findings;
create trigger trg_findings_code before insert on public.findings
  for each row execute function public.set_code_finding();

-- ---------------------------------------------------------------------
-- 5) Etapas ampliadas del hallazgo interno
-- ---------------------------------------------------------------------
alter table public.findings drop constraint if exists findings_status_check;
alter table public.findings add constraint findings_status_check
  check (status in ('abierto','en_analisis','en_accion','descripcion','contencion','rca','verificacion','cerrado'));

alter table public.findings add column if not exists problem_desc     text;    -- Descripción del problema (5W2H)
alter table public.findings add column if not exists problem_at       timestamptz;
alter table public.findings add column if not exists containment_text text;    -- Acciones de contención
alter table public.findings add column if not exists containment_at   timestamptz;
-- El análisis de causa raíz reutiliza analysis_text / analysis_at (ya creadas en 07_workflow.sql)

create or replace function public.enforce_finding_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;            -- backend / SQL Editor

  if new.status is distinct from old.status then
    if not ((old.status, new.status) in (
         ('abierto','en_accion'), ('en_analisis','en_accion'), ('abierto','en_analisis'),
         ('en_accion','verificacion'), ('verificacion','cerrado'), ('verificacion','abierto'),
         -- Flujo ampliado de auditorías internas:
         ('abierto','descripcion'), ('descripcion','contencion'), ('contencion','rca'), ('rca','en_accion'))) then
      raise exception 'Cambio de etapa no permitido (% → %)', old.status, new.status;
    end if;
    if old.status = 'verificacion' and not public.is_admin() then
      raise exception 'Solo un administrador puede aceptar o rechazar la verificación';
    end if;
    if old.status in ('abierto','en_analisis','en_accion','descripcion','contencion','rca') and not (old.owner_id = uid or public.is_admin()) then
      raise exception 'Solo el responsable asignado o un administrador puede avanzar este hallazgo';
    end if;
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
-- 4) CAPA Files y Root Cause Files: plantillas personalizadas (8D, 4D, CAPA, A4,
--    Alerta de calidad, 5 Porqués, Ishikawa…) con secciones y campos configurables.
-- ---------------------------------------------------------------------
create table if not exists public.capa_templates (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  kind       text not null default 'Personalizado',    -- 8D · 4D · CAPA · A4 · Alerta de calidad · Personalizado
  schema     jsonb not null default '{"sections":[]}'::jsonb,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.rca_templates (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  kind       text not null default 'Personalizado',    -- 5 Porqués · Ishikawa · Personalizado
  schema     jsonb not null default '{"sections":[]}'::jsonb,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_capa_templates_touch on public.capa_templates;
create trigger trg_capa_templates_touch before update on public.capa_templates for each row execute function public.touch_updated_at();
drop trigger if exists trg_rca_templates_touch on public.rca_templates;
create trigger trg_rca_templates_touch before update on public.rca_templates for each row execute function public.touch_updated_at();

-- Plantilla llenada para un hallazgo (una de cada tipo por hallazgo)
create table if not exists public.finding_documents (
  id          uuid primary key default gen_random_uuid(),
  finding_id  uuid not null references public.findings(id) on delete cascade,
  kind        text not null check (kind in ('rca','capa')),
  template_id uuid,                                    -- referencia informativa; la plantilla pudo borrarse o cambiar
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  unique (finding_id, kind)
);

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['standards','capa_templates','rca_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member())', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;

alter table public.finding_documents enable row level security;
grant select, insert, update, delete on public.finding_documents to authenticated;
drop policy if exists finding_documents_select on public.finding_documents;
create policy finding_documents_select on public.finding_documents for select to authenticated using (public.is_member());
drop policy if exists finding_documents_write on public.finding_documents;
create policy finding_documents_write on public.finding_documents for all to authenticated using (public.is_staff()) with check (public.is_staff());
