-- =====================================================================
-- GUVEL Quality · Folios por empresa (cada una empieza desde 0001)
--
-- Hasta ahora, el contador de folios (AUD-0001, HAL-0001, IF-0001…) era
-- UNO SOLO PARA TODAS LAS EMPRESAS: si GUVEL ya iba en AUD-0042, la
-- primera auditoría de una empresa nueva salía como AUD-0043 en vez de
-- AUD-0001. Esto corrige eso: cada empresa tiene su propio contador por
-- cada tipo de folio.
--
-- Ejecutar DESPUÉS de 19_company_scoped_unique.sql. Re-ejecutable (no
-- borra datos ni renumera lo que ya existe — todo lo ya generado se queda
-- exactamente igual; el cambio aplica solo a los folios nuevos).
-- =====================================================================

-- El contador pasa de ser "uno por prefijo" a "uno por empresa y prefijo"
alter table public.code_counters add column if not exists company_id uuid references public.companies(id);
alter table public.code_counters drop constraint if exists code_counters_pkey;
update public.code_counters set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
alter table public.code_counters alter column company_id set not null;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'code_counters' and constraint_name = 'code_counters_company_prefix_pkey') then
    alter table public.code_counters add constraint code_counters_company_prefix_pkey primary key (company_id, prefix);
  end if;
end $$;

create or replace function public.set_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p_prefix text := tg_argv[0];
  p_company uuid := coalesce(new.company_id, public.my_company());
  n        integer;
begin
  if new.code is null or new.code = '' then
    insert into public.code_counters as c (company_id, prefix, last_value)
    values (p_company, p_prefix, 1)
    on conflict (company_id, prefix) do update set last_value = c.last_value + 1
    returning c.last_value into n;
    new.code := p_prefix || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

-- El folio en sí (HAL-0001, AUD-0001…) también debe ser único SOLO dentro de cada empresa: si no, dos
-- empresas jamás podrían tener ambas un "HAL-0001" aunque cada una lo haya numerado desde su propio cero.
do $$
declare t text;
begin
  foreach t in array array['forms','audit_plans','audits','findings','actions','customer_notifications','risks','opportunities'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_code_key');
    if not exists (select 1 from information_schema.table_constraints where table_name = t and constraint_name = t || '_company_code_unique') then
      execute format('alter table public.%I add constraint %I unique (company_id, code)', t, t || '_company_code_unique');
    end if;
  end loop;
end $$;

create or replace function public.set_code_finding()
returns trigger language plpgsql security definer set search_path = public as $$
declare p_prefix text; p_company uuid := coalesce(new.company_id, public.my_company()); n integer;
begin
  if new.code is null or new.code = '' then
    p_prefix := case when new.module = 'internas' then 'IF' else 'HAL' end;
    insert into public.code_counters as c (company_id, prefix, last_value) values (p_company, p_prefix, 1)
      on conflict (company_id, prefix) do update set last_value = c.last_value + 1
      returning c.last_value into n;
    new.code := p_prefix || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;
