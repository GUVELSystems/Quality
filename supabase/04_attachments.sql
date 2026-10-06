-- =====================================================================
-- GUVEL Quality · Evidencias y adjuntos (Supabase Storage)
-- Ejecutar DESPUÉS de 03_seed.sql. Re-ejecutable.
--
-- Qué crea:
--   · Tabla public.attachments (metadatos de cada archivo)
--   · Bucket PRIVADO "evidence" (límite 10 MB por archivo, tipos permitidos)
--   · Políticas RLS: leer = cualquier usuario autenticado,
--     subir/borrar = personal (admin, gerente, auditor)
--   · Limpieza de registros al eliminar hallazgos/auditorías/notificaciones
-- =====================================================================

create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null check (entity in ('finding','audit','notification')),
  entity_id   uuid not null,
  ref         text,                       -- p.ej. id de la pregunta del checklist
  file_name   text not null,
  file_path   text not null unique,       -- ruta dentro del bucket
  mime_type   text,
  size_bytes  bigint,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_attachments_entity on public.attachments(entity, entity_id);

alter table public.attachments enable row level security;
grant select, insert, update, delete on public.attachments to authenticated;

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated using (true);

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated with check (public.is_staff());

-- Borra un manager cualquiera; un auditor solo lo que él subió
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (public.is_manager() or (public.is_staff() and created_by = auth.uid()));

-- Al eliminar el registro padre se eliminan sus metadatos de adjuntos
create or replace function public.cleanup_attachments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.attachments where entity = tg_argv[0] and entity_id = old.id;
  return old;
end $$;

drop trigger if exists trg_findings_att on public.findings;
create trigger trg_findings_att after delete on public.findings
  for each row execute function public.cleanup_attachments('finding');
drop trigger if exists trg_audits_att on public.audits;
create trigger trg_audits_att after delete on public.audits
  for each row execute function public.cleanup_attachments('audit');
drop trigger if exists trg_notif_att on public.customer_notifications;
create trigger trg_notif_att after delete on public.customer_notifications
  for each row execute function public.cleanup_attachments('notification');

-- ---------------------------------------------------------------------
-- Storage: bucket privado + políticas
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence', 'evidence', false, 10485760,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'application/pdf','text/plain','text/csv',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists evidence_select on storage.objects;
create policy evidence_select on storage.objects
  for select to authenticated using (bucket_id = 'evidence');

drop policy if exists evidence_insert on storage.objects;
create policy evidence_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'evidence' and public.is_staff());

drop policy if exists evidence_delete on storage.objects;
create policy evidence_delete on storage.objects
  for delete to authenticated using (bucket_id = 'evidence' and public.is_staff());
