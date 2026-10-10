-- =====================================================================
-- GUVEL Quality · Clasificaciones por tipo de auditoría
-- Ejecutar DESPUÉS de 08_milestones_notifications.sql. Re-ejecutable.
--
-- Cada clasificación indica a qué se aplica: LPA, Producto, Proceso, Sistema,
-- Interna e Issues (notificaciones de clientes). Así, por ejemplo, las auditorías
-- internas pueden usar NCM / NCm en lugar de N1 / N2.
-- =====================================================================

alter table public.finding_classes
  add column if not exists scopes text[] not null
  default array['LPA','Producto','Proceso','Sistema','Interna','Issues']::text[];

-- El código ya no tiene que ser único (p. ej. "N1" puede existir con distintos plazos según el tipo)
alter table public.finding_classes drop constraint if exists finding_classes_code_key;

alter table public.finding_classes drop constraint if exists finding_classes_scopes_valid;
alter table public.finding_classes add constraint finding_classes_scopes_valid
  check (scopes <@ array['LPA','Producto','Proceso','Sistema','Interna','Issues']::text[] and cardinality(scopes) >= 1);

-- Ajustes por defecto: SOLO la primera vez (así no se pisa lo que configures después)
--   · N1–N3 creadas por defecto dejan de aplicar a Interna (si siguen sin modificar)
--   · se crean NCM / NCm de ejemplo para auditorías internas (editables en Configuración)
do $$
begin
  if not exists (select 1 from public.app_settings where key = 'class_scopes_migrated') then
    update public.finding_classes
       set scopes = array['LPA','Producto','Proceso','Sistema','Issues']::text[]
     where code in ('N1','N2','N3')
       and scopes = array['LPA','Producto','Proceso','Sistema','Interna','Issues']::text[]
       and name like 'Clasificación N%';

    insert into public.finding_classes (code, name, days, scopes)
    select 'NCM', 'No conformidad mayor', 5, array['Interna']::text[]
     where not exists (select 1 from public.finding_classes where code = 'NCM');
    insert into public.finding_classes (code, name, days, scopes)
    select 'NCm', 'No conformidad menor', 10, array['Interna']::text[]
     where not exists (select 1 from public.finding_classes where code = 'NCm');

    insert into public.app_settings (key, value) values ('class_scopes_migrated', 'true'::jsonb);
  end if;
end $$;
