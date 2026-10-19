-- =====================================================================
-- GUVEL Quality · Tickets de soporte (al revés del flujo que ya existía)
--
-- Hasta ahora solo existía un camino: Soporte de GUVEL pide acceso a una
-- empresa, y el administrador de esa empresa lo aprueba. Faltaba el
-- camino contrario: que una empresa pida ayuda a GUVEL. Esto agrega
-- justo eso — un ticket simple, visible para cualquier administrador o
-- manager de la empresa, y para todo el equipo de soporte de GUVEL.
--
-- Ejecutar DESPUÉS de 20_company_scoped_codes.sql. Re-ejecutable (no
-- borra datos).
-- =====================================================================

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  subject     text not null,
  message     text not null,
  status      text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
alter table public.support_tickets enable row level security;
grant select, insert, update, delete on public.support_tickets to authenticated;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (public.is_super_admin() or public.is_support() or company_id = public.my_company());

drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets for insert to authenticated
  with check (public.is_member() and company_id = public.my_company() and created_by = auth.uid());

-- La empresa puede actualizar SU PROPIO ticket (p. ej. cerrarlo); Soporte/Super Admin puede
-- tomarlo, moverlo a "en proceso" o resolverlo, de cualquier empresa
drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets for update to authenticated
  using (public.is_super_admin() or public.is_support() or (public.is_manager() and company_id = public.my_company()))
  with check (public.is_super_admin() or public.is_support() or (public.is_manager() and company_id = public.my_company()));
