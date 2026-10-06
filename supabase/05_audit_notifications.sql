-- =====================================================================
-- GUVEL Quality · Planes de auditoría: nombre, estado de envío y bitácora
-- de correos. Ejecutar DESPUÉS de 04_attachments.sql. Re-ejecutable.
-- =====================================================================

-- Planes: nombre legible y estado (borrador → enviado)
alter table public.audit_plans add column if not exists name    text;
alter table public.audit_plans add column if not exists status  text not null default 'borrador'
  check (status in ('borrador','enviado'));
alter table public.audit_plans add column if not exists sent_at timestamptz;
alter table public.audit_plans add column if not exists sent_by uuid references public.profiles(id) on delete set null;

-- Auditorías: a quién y cuándo se le notificó (permite enviar solo lo pendiente)
alter table public.audits add column if not exists notified_at timestamptz;
alter table public.audits add column if not exists notified_to uuid references public.profiles(id) on delete set null;

-- Bitácora de correos. La escribe únicamente la Edge Function (service role).
create table if not exists public.notification_log (
  id          bigserial primary key,
  plan_id     uuid references public.audit_plans(id) on delete cascade,
  audit_id    uuid references public.audits(id) on delete set null,
  user_id     uuid references public.profiles(id) on delete set null,
  email       text,
  kind        text not null check (kind in ('plan','audit')),
  status      text not null check (status in ('sent','failed')),
  error       text,
  provider_id text,
  sent_by     uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notif_log_plan on public.notification_log(plan_id, created_at desc);

alter table public.notification_log enable row level security;
grant select on public.notification_log to authenticated;
drop policy if exists notif_log_select on public.notification_log;
create policy notif_log_select on public.notification_log
  for select to authenticated using (public.is_staff());
