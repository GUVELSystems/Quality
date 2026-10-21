-- =====================================================================
-- GUVEL Quality · Folios con año: ID-AÑO-0001
--
-- Cambia el formato de los folios operativos (Planes, Auditorías,
-- Hallazgos, Acciones, Notificaciones, Riesgos, Oportunidades) de
-- AUD-0001 a AUD-2026-0001 — y RENOMBRA todos los folios que ya existen
-- para que sigan este mismo formato, numerados desde 0001 cada año, por
-- empresa.
--
-- Los códigos de Configuración (Clientes, Formatos, Procesos) NO
-- cambian — se quedan exactamente como están (CLI-001, FOR-LPA-001,
-- PI-01…), tal como se pidió.
--
-- MUY IMPORTANTE: esto renombra folios que puede que ya hayas compartido
-- o impreso (en PDFs, correos, etc.) — los anteriores dejan de existir
-- con ese nombre. Haz un respaldo antes de correrlo si te preocupa.
--
-- Ejecutar DESPUÉS de 24_findings_source_fix.sql. Es re-ejecutable (no
-- vuelve a renombrar lo que ya quedó renombrado), pero el renombrado en
-- sí solo tiene sentido correrlo una vez.
-- =====================================================================

-- El contador ahora también puede llevar año — pero SOLO para los folios operativos. Los que no
-- llevan año (Clientes, Procesos) siguen exactamente igual que antes, con year en blanco.
-- Dos reglas de "único" en paralelo, una para cada caso, para no romper lo que ya funcionaba.
alter table public.code_counters drop constraint if exists code_counters_company_prefix_year_pkey;
alter table public.code_counters add column if not exists year int;
drop index if exists code_counters_no_year_uq;
create unique index code_counters_no_year_uq on public.code_counters(company_id, prefix) where year is null;
drop index if exists code_counters_year_uq;
create unique index code_counters_year_uq on public.code_counters(company_id, prefix, year) where year is not null;

-- La vieja PK (company_id, prefix) deja de existir como tal — queda reemplazada por el índice parcial
-- de arriba (year is null), que cubre exactamente lo mismo para Clientes y Procesos
alter table public.code_counters drop constraint if exists code_counters_company_prefix_pkey;

-- set_code() (Clientes) y set_code_process() (Procesos) ahora apuntan al índice parcial "sin año"
create or replace function public.set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare p_prefix text := tg_argv[0]; p_company uuid := coalesce(new.company_id, public.my_company()); n integer;
begin
  if new.code is null or new.code = '' then
    insert into public.code_counters as c (company_id, prefix, year, last_value) values (p_company, p_prefix, null, 1)
      on conflict (company_id, prefix) where year is null do update set last_value = c.last_value + 1
      returning c.last_value into n;
    new.code := p_prefix || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;
create or replace function public.set_code_process()
returns trigger language plpgsql security definer set search_path = public as $$
declare p_company uuid := coalesce(new.company_id, public.my_company()); n integer;
begin
  if new.code is null or new.code = '' then
    insert into public.code_counters as c (company_id, prefix, year, last_value) values (p_company, 'PI', null, 1)
      on conflict (company_id, prefix) where year is null do update set last_value = c.last_value + 1
      returning c.last_value into n;
    new.code := 'PI-' || lpad(n::text, 2, '0');
  end if;
  return new;
end $$;

-- Folio con año para lo operativo (Planes, Auditorías, Acciones, Notificaciones, Riesgos, Oportunidades)
create or replace function public.set_code_yr()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p_prefix text := tg_argv[0];
  p_company uuid := coalesce(new.company_id, public.my_company());
  p_year int := extract(year from coalesce(new.created_at, now()))::int;
  n integer;
begin
  if new.code is null or new.code = '' then
    insert into public.code_counters as c (company_id, prefix, year, last_value)
    values (p_company, p_prefix, p_year, 1)
    on conflict (company_id, prefix, year) where year is not null do update set last_value = c.last_value + 1
    returning c.last_value into n;
    new.code := p_prefix || '-' || p_year || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

-- Hallazgos: folio propio (HAL o IF según el módulo), con año
create or replace function public.set_code_finding()
returns trigger language plpgsql security definer set search_path = public as $$
declare p_prefix text; p_company uuid := coalesce(new.company_id, public.my_company()); p_year int := extract(year from coalesce(new.created_at, now()))::int; n integer;
begin
  if new.code is null or new.code = '' then
    p_prefix := case when new.module = 'internas' then 'IF' else 'HAL' end;
    insert into public.code_counters as c (company_id, prefix, year, last_value) values (p_company, p_prefix, p_year, 1)
      on conflict (company_id, prefix, year) where year is not null do update set last_value = c.last_value + 1
      returning c.last_value into n;
    new.code := p_prefix || '-' || p_year || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

-- Las 6 tablas operativas (sin contar findings, que ya tiene su propio trigger) pasan a usar set_code_yr
do $$
declare t text; pfx text;
begin
  foreach t in array array['audit_plans','audits','actions','customer_notifications','risks','opportunities'] loop
    pfx := case t
      when 'audit_plans' then 'PLAN' when 'audits' then 'AUD' when 'actions' then 'ACC'
      when 'customer_notifications' then 'NCL' when 'risks' then 'RSK' when 'opportunities' then 'OPP' end;
    execute format('drop trigger if exists trg_%1$s_code on public.%1$s', t);
    execute format('create trigger trg_%1$s_code before insert on public.%1$s for each row execute function public.set_code_yr(%2$L)', t, pfx);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Renombrar los folios que ya existen (una sola vez: si ya tiene el
-- formato AAAA-NNNN no se vuelve a tocar)
-- ---------------------------------------------------------------------
do $$
declare t text; pfx text;
begin
  foreach t in array array['audit_plans','audits','actions','customer_notifications','risks','opportunities'] loop
    pfx := case t
      when 'audit_plans' then 'PLAN' when 'audits' then 'AUD' when 'actions' then 'ACC'
      when 'customer_notifications' then 'NCL' when 'risks' then 'RSK' when 'opportunities' then 'OPP' end;
    execute format($f$
      with ranked as (
        select id, extract(year from created_at)::int as yr,
               row_number() over (partition by company_id, extract(year from created_at) order by created_at, id) as rn
        from public.%1$I
        where code !~ '^%2$s-[0-9]{4}-[0-9]{4}$'
      )
      update public.%1$I x set code = %2$L || '-' || r.yr || '-' || lpad(r.rn::text, 4, '0')
      from ranked r where r.id = x.id
    $f$, t, pfx);
  end loop;
end $$;

-- Hallazgos: HAL para todo lo que no sea "internas", IF para lo que sí es
with ranked as (
  select id, case when module = 'internas' then 'IF' else 'HAL' end as pfx, extract(year from created_at)::int as yr,
         row_number() over (partition by company_id, (case when module = 'internas' then 'IF' else 'HAL' end), extract(year from created_at) order by created_at, id) as rn
  from public.findings
  where code !~ '^(HAL|IF)-[0-9]{4}-[0-9]{4}$'
)
update public.findings x set code = r.pfx || '-' || r.yr || '-' || lpad(r.rn::text, 4, '0')
from ranked r where r.id = x.id;

-- Deja el contador de cada (empresa, prefijo, año) en el último número ya usado, para que el
-- siguiente folio nuevo continúe justo después, sin repetir ni saltar
do $$
declare t text; pfx text; rec record;
begin
  foreach t in array array['audit_plans','audits','actions','customer_notifications','risks','opportunities'] loop
    pfx := case t
      when 'audit_plans' then 'PLAN' when 'audits' then 'AUD' when 'actions' then 'ACC'
      when 'customer_notifications' then 'NCL' when 'risks' then 'RSK' when 'opportunities' then 'OPP' end;
    for rec in execute format($f$
      select company_id, substring(code from '%2$s-([0-9]{4})-')::int as yr, max(substring(code from '%2$s-[0-9]{4}-([0-9]{4})')::int) as mx
      from public.%1$I where code ~ '^%2$s-[0-9]{4}-[0-9]{4}$' group by company_id, yr
    $f$, t, pfx)
    loop
      insert into public.code_counters as c (company_id, prefix, year, last_value) values (rec.company_id, pfx, rec.yr, rec.mx)
      on conflict (company_id, prefix, year) where year is not null do update set last_value = greatest(c.last_value, excluded.last_value);
    end loop;
  end loop;
  for rec in
    select company_id, (case when module = 'internas' then 'IF' else 'HAL' end) as pfx,
           substring(code from '-([0-9]{4})-')::int as yr, max(substring(code from '-[0-9]{4}-([0-9]{4})')::int) as mx
    from public.findings where code ~ '^(HAL|IF)-[0-9]{4}-[0-9]{4}$' group by company_id, pfx, yr
  loop
    insert into public.code_counters as c (company_id, prefix, year, last_value) values (rec.company_id, rec.pfx, rec.yr, rec.mx)
    on conflict (company_id, prefix, year) where year is not null do update set last_value = greatest(c.last_value, excluded.last_value);
  end loop;
end $$;
