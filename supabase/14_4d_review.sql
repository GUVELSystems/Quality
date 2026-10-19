-- =====================================================================
-- GUVEL Quality · Flujo de revisión del 4D
-- Ejecutar DESPUÉS de 13_action_evidence.sql. Re-ejecutable (no borra datos).
--
-- Entre D4 (Acciones inmediatas) y Verificación se agrega una etapa de
-- Revisión: quien preparó el 4D elige a un revisor y lo envía a revisar;
-- ese revisor aprueba (pasa a Verificación) o rechaza (regresa a D4).
-- =====================================================================

-- Quién revisa el cierre de un 4D: columna propia (no se reutiliza owner_id, que solo un
-- administrador puede reasignar)
alter table public.findings add column if not exists reviewer_id uuid references public.profiles(id) on delete set null;

alter table public.findings drop constraint if exists findings_status_check;
alter table public.findings add constraint findings_status_check
  check (status in (
    'abierto','en_analisis','en_accion','descripcion','contencion','rca','verificacion','cerrado',
    'registro','detalles','solicitud','d1','d2','d3','d4','d4_revision','d5','d6','d7','d8'
  ));

create or replace function public.enforce_finding_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;

  if new.status is distinct from old.status then
    if not ((old.status, new.status) in (
         ('abierto','en_accion'), ('en_analisis','en_accion'), ('abierto','en_analisis'),
         ('en_accion','verificacion'), ('verificacion','cerrado'), ('verificacion','abierto'),
         ('abierto','descripcion'), ('descripcion','contencion'), ('contencion','rca'), ('rca','en_accion'),
         ('registro','detalles'), ('detalles','solicitud'), ('solicitud','d1'),
         ('d1','d2'), ('d2','d3'), ('d3','d4'),
         ('d4','d5'), ('d5','d6'), ('d6','d8'), ('d8','verificacion'),  -- 8D
         ('d4','d4_revision'), ('d4_revision','d4'), ('d4_revision','verificacion'),  -- 4D: D4 → Revisión → Verificación
         ('verificacion','cerrado'), ('verificacion','registro'))) then
      raise exception 'Cambio de etapa no permitido (% → %)', old.status, new.status;
    end if;
    if old.status = 'verificacion' and not public.is_admin() then
      raise exception 'Solo un administrador puede aceptar o rechazar la verificación';
    end if;
    if old.status in ('registro','detalles') and not public.is_admin() then
      raise exception 'Solo un administrador puede avanzar esta etapa';
    end if;
    -- La revisión del 4D la resuelve el revisor asignado (columna reviewer_id), no el responsable
    if old.status = 'd4_revision' and not (old.reviewer_id = uid or public.is_admin()) then
      raise exception 'Solo el revisor asignado o un administrador puede resolver la revisión';
    end if;
    if old.status in ('abierto','en_analisis','en_accion','descripcion','contencion','rca','solicitud','d1','d2','d3','d4','d5','d6','d8')
       and not (old.owner_id = uid or public.is_admin()) then
      raise exception 'Solo el responsable asignado o un administrador puede avanzar este hallazgo';
    end if;
  end if;

  -- Elegir o cambiar al revisor del 4D: lo puede hacer el propio responsable (no requiere ser admin)
  if new.reviewer_id is distinct from old.reviewer_id and not (old.owner_id = uid or public.is_admin()) then
    raise exception 'Solo el responsable asignado o un administrador puede elegir al revisor';
  end if;

  if new.transfer_count > old.transfer_count then
    if old.transfer_count >= 1 then raise exception 'Este hallazgo ya fue trasladado una vez'; end if;
    if not (old.owner_id = uid or public.is_admin()) then raise exception 'Solo el responsable asignado o un administrador puede trasladar el hallazgo'; end if;
  elsif new.owner_id is distinct from old.owner_id and not public.is_admin() then
    raise exception 'Solo un administrador puede reasignar el responsable';
  end if;

  return new;
end $$;

drop trigger if exists trg_findings_workflow on public.findings;
create trigger trg_findings_workflow before update on public.findings
  for each row execute function public.enforce_finding_workflow();

-- El número de control ahora es por FORMATO (8D-5 Porqués, 8D-Ishikawa, 4D), no por hallazgo
alter table public.findings drop column if exists control_number;
-- (los valores por defecto se siembran por empresa en 19_company_scoped_unique.sql)
