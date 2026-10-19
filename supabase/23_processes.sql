-- =====================================================================
-- GUVEL Quality · Procesos a auditar (para LPA)
--
-- Agrega el catálogo de Procesos (Configuración → Áreas y Procesos →
-- Procesos): solo nombre, con un código automático PI-01, PI-02… — UNA
-- numeración propia por empresa (igual que ya hicimos con los folios y
-- con los demás catálogos): una empresa nueva empieza en PI-01 sin
-- chocar con los procesos de otra, y el nombre solo tiene que ser único
-- DENTRO de la misma empresa.
--
-- También agrega el proceso elegido a la auditoría (audits.process_id),
-- para que al agendar una LPA se pueda elegir qué proceso se va a
-- auditar, junto con el nivel y el formato.
--
-- Ejecutar DESPUÉS de 22_classifications_scoped.sql. Re-ejecutable (no
-- borra datos).
-- =====================================================================

create table if not exists public.processes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) default coalesce(public.my_company(), '00000000-0000-0000-0000-000000000001'),
  code       text,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
-- por si la tabla ya existía de una corrida anterior sin este valor por defecto
alter table public.processes alter column company_id set default coalesce(public.my_company(), '00000000-0000-0000-0000-000000000001');
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'processes' and constraint_name = 'processes_company_name_unique') then
    alter table public.processes add constraint processes_company_name_unique unique (company_id, name);
  end if;
end $$;
alter table public.processes enable row level security;
grant select, insert, update, delete on public.processes to authenticated;

drop policy if exists processes_select on public.processes;
create policy processes_select on public.processes for select to authenticated using (public.is_manager() and public.in_company(company_id));
drop policy if exists processes_write on public.processes;
create policy processes_write on public.processes for all to authenticated
  using (public.is_manager() and public.in_company_write(company_id)) with check (public.is_manager() and public.in_company_write(company_id));

-- Folio propio del proceso: PI-01, PI-02… por empresa (2 dígitos, no 4 — así se pidió)
create or replace function public.set_code_process()
returns trigger language plpgsql security definer set search_path = public as $$
declare p_company uuid := coalesce(new.company_id, public.my_company()); n integer;
begin
  if new.code is null or new.code = '' then
    insert into public.code_counters as c (company_id, prefix, last_value) values (p_company, 'PI', 1)
      on conflict (company_id, prefix) do update set last_value = c.last_value + 1
      returning c.last_value into n;
    new.code := 'PI-' || lpad(n::text, 2, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_processes_code on public.processes;
create trigger trg_processes_code before insert on public.processes for each row execute function public.set_code_process();

-- La auditoría puede llevar un proceso asignado (principalmente LPA)
alter table public.audits add column if not exists process_id uuid references public.processes(id) on delete set null;
