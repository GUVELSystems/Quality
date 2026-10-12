-- =====================================================================
-- GUVEL Quality · Ajustes al flujo 8D/4D: D6+D7 en paralelo, cierre de
-- acciones por evidencia, folio de control del reporte.
-- Ejecutar DESPUÉS de 12_eightd_workflow.sql. Re-ejecutable (no borra datos).
-- =====================================================================

-- D6 (correctivas implementadas) y D7 (preventivas + Roll-Across) ahora se
-- trabajan en una sola pantalla: el portal salta de 'd6' directo a 'd8'.
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
         ('d4','d5'), ('d5','d6'), ('d6','d8'), ('d8','verificacion'),  -- 8D: D6 y D7 juntos, sin paso intermedio
         ('d4','verificacion'),                                         -- 4D: salta de D4 a Verificación
         ('verificacion','cerrado'), ('verificacion','registro'))) then
      raise exception 'Cambio de etapa no permitido (% → %)', old.status, new.status;
    end if;
    if old.status = 'verificacion' and not public.is_admin() then
      raise exception 'Solo un administrador puede aceptar o rechazar la verificación';
    end if;
    if old.status in ('registro','detalles') and not public.is_admin() then
      raise exception 'Solo un administrador puede avanzar esta etapa';
    end if;
    if old.status in ('abierto','en_analisis','en_accion','descripcion','contencion','rca','solicitud','d1','d2','d3','d4','d5','d6','d8')
       and old.status not in ('registro','detalles') and not (old.owner_id = uid or public.is_admin()) then
      raise exception 'Solo el responsable asignado o un administrador puede avanzar este hallazgo';
    end if;
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

-- Folio de control del reporte (aparece en el PDF, junto a "Generado por GUVEL Quality")
alter table public.findings add column if not exists control_number text;
