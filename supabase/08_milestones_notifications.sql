-- =====================================================================
-- GUVEL Quality · Milestones con hora, verificación aceptar/rechazar,
-- bandeja de notificaciones y aviso al asignar un hallazgo.
-- Ejecutar DESPUÉS de 07_workflow.sql. Re-ejecutable (no borra datos).
--
--   · Flujo del hallazgo: Abierto → En acción → Verificación → Cerrado
--     (se elimina la etapa "En análisis")
--   · Verificación: 5 días hábiles; el administrador acepta o rechaza.
--     Si rechaza, el hallazgo se reabre y el milestone de cierre continúa
--     con el tiempo que le quedaba.
--   · Relojes con hora exacta (días / horas / minutos)
--   · Bandeja de notificaciones por usuario
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hallazgos: instantes exactos de los milestones y rechazos
-- ---------------------------------------------------------------------
alter table public.findings add column if not exists due_at            timestamptz;  -- límite del milestone de cierre (se corre al rechazar)
alter table public.findings add column if not exists actions_closed_at timestamptz;  -- cuándo se cerraron las acciones
alter table public.findings add column if not exists verify_due_at     timestamptz;  -- límite del milestone de verificación
alter table public.findings add column if not exists reject_count      integer not null default 0;
alter table public.findings add column if not exists rejected_at       timestamptz;
alter table public.findings add column if not exists rejection_reason  text;

-- Datos previos: rellenar los instantes a partir de las fechas
update public.findings set due_at = (due_date::timestamp + interval '1 day' - interval '1 millisecond') where due_at is null and due_date is not null;
update public.findings set actions_closed_at = (actions_closed_on::timestamp + interval '12 hours') where actions_closed_at is null and actions_closed_on is not null;
update public.findings set verify_due_at = (verify_due::timestamp + interval '1 day' - interval '1 millisecond') where verify_due_at is null and verify_due is not null;

-- Hallazgos que ya estaban en verificación: plazo de 5 días hábiles ≈ 7 días naturales desde el cierre de acciones
update public.findings set verify_due_at = actions_closed_at + interval '7 days', verify_due = (actions_closed_at + interval '7 days')::date
 where status = 'verificacion' and verify_due_at is null and actions_closed_at is not null;

-- La etapa "En análisis" desaparece: esos hallazgos pasan a "En acción"
update public.findings set status = 'en_accion' where status = 'en_analisis';

-- Verificación: 5 días hábiles (solo si seguía en el valor anterior de 15)
update public.app_settings set value = '5'::jsonb, updated_at = now() where key = 'verification_days' and value = '15'::jsonb;
insert into public.app_settings (key, value) values ('verification_days', '5'::jsonb) on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Historial de eventos del hallazgo (trazabilidad de rechazos y cierres)
-- ---------------------------------------------------------------------
create table if not exists public.finding_events (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  kind       text not null,          -- accepted | transferred | actions_closed | rejected | verified
  detail     text,
  actor      uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_finding_events on public.finding_events(finding_id, created_at);

-- ---------------------------------------------------------------------
-- Bandeja de notificaciones por usuario
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  module     text not null default 'auditorias',    -- auditorias | internas | issues | riesgos | oportunidades
  kind       text not null,                          -- finding_assigned | finding_transferred | finding_rejected | finding_verify …
  title      text not null,
  body       text,
  href       text,                                   -- ruta del portal, p. ej. auditorias/hallazgos/<id>
  ref_id     uuid,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists idx_notifications_user on public.notifications(user_id, read_at, created_at desc);

-- Bitácora de correos: ahora también registra avisos de hallazgos
alter table public.notification_log add column if not exists finding_id uuid references public.findings(id) on delete set null;
alter table public.notification_log add column if not exists detail text;   -- tipo de aviso: assigned | transferred | rejected | verify
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (kind in ('plan','audit','finding'));

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
-- ---------------------------------------------------------------------
alter table public.finding_events enable row level security;
grant select, insert, update, delete on public.finding_events to authenticated;
drop policy if exists finding_events_select on public.finding_events;
create policy finding_events_select on public.finding_events for select to authenticated using (public.is_member());
drop policy if exists finding_events_insert on public.finding_events;
create policy finding_events_insert on public.finding_events for insert to authenticated with check (public.is_staff());

alter table public.notifications enable row level security;
grant select, insert, update, delete on public.notifications to authenticated;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated with check (public.is_staff());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Reglas del flujo (reemplaza la versión de 07: sin "En análisis" y con rechazo)
--   Abierto → En acción → Verificación → Cerrado   (o Verificación → Abierto si se rechaza)
--   · Avanzar (aceptar, cerrar acciones): el responsable o un admin
--   · Aceptar o rechazar la verificación: solo un admin
--   · Trasladar: el responsable o un admin, y UNA sola vez
--   · Reasignar por otra vía: solo un admin
-- ---------------------------------------------------------------------
create or replace function public.enforce_finding_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;            -- backend / SQL Editor

  if new.status is distinct from old.status then
    if not ((old.status, new.status) in (
         ('abierto','en_accion'), ('en_analisis','en_accion'), ('abierto','en_analisis'),
         ('en_accion','verificacion'), ('verificacion','cerrado'), ('verificacion','abierto'))) then
      raise exception 'Cambio de etapa no permitido (% → %)', old.status, new.status;
    end if;
    if old.status = 'verificacion' and not public.is_admin() then
      raise exception 'Solo un administrador puede aceptar o rechazar la verificación';
    end if;
    if old.status in ('abierto','en_analisis','en_accion') and not (old.owner_id = uid or public.is_admin()) then
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
