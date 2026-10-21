-- =====================================================================
-- GUVEL Quality · Flujo 8D / 4D para Auditorías Internas
-- Ejecutar DESPUÉS de 11_internal_audit_pro.sql. Re-ejecutable (no borra datos).
--
-- Sustituye el flujo de 7 etapas de los hallazgos internos por el proceso real
-- de resolución de problemas, siguiendo los formatos 8D (5 Porqués o Ishikawa)
-- y 4D de GUVEL:
--   Registro → Detalles del problema → Solicitud → D1…D8 (8D) o D1→D4 (4D) → Verificación
-- El responsable YA NO se asigna automáticamente al generar el hallazgo: lo
-- define un administrador en la etapa "Registro".
-- =====================================================================

-- (el valor final y completo de esta regla —incluye d4_revision, del 4D— se deja en
-- 14_4d_review.sql, para no angostarla aquí a medio camino y que no truene al repetir el script
-- completo desde cero con hallazgos reales ya en esa etapa)

-- Estrategia de resolución, definida en "Detalles del problema"
alter table public.findings add column if not exists strategy_ps  text check (strategy_ps in ('8D','4D'));
alter table public.findings add column if not exists strategy_rca text check (strategy_rca in ('5whys','ishikawa'));
alter table public.findings add column if not exists corrective_mandatory boolean not null default true;
alter table public.findings add column if not exists preventive_mandatory boolean not null default true;
alter table public.findings add column if not exists clause text;                 -- cláusula / punto afectado (propio del hallazgo)

-- Firmas de cada etapa inicial
alter table public.findings add column if not exists registered_at timestamptz;
alter table public.findings add column if not exists registered_by uuid references public.profiles(id) on delete set null;
alter table public.findings add column if not exists strategy_at   timestamptz;
alter table public.findings add column if not exists strategy_by   uuid references public.profiles(id) on delete set null;

-- Todo el contenido de D1…D8 (equipo, 5W, contención, causa raíz, acciones, cierre…)
-- vive en un solo campo flexible: su forma cambia según sea 8D o 4D y según el
-- tipo de causa raíz, así que una sola columna jsonb evita decenas de columnas.
alter table public.findings add column if not exists d_data jsonb not null default '{}'::jsonb;

-- Nueva clasificación de esta auditoría: un hallazgo "Registrado" espera revisión del admin
create index if not exists idx_findings_status_internal on public.findings(status) where module = 'internas';

-- ---------------------------------------------------------------------
-- Reglas del flujo 8D/4D
--   · Registro y Detalles del problema: solo un administrador
--   · Solicitud (aceptar/trasladar) y D1…D8: el responsable asignado o un admin
--   · Verificación: solo un administrador
--   · D4 → Verificación directo cuando es 4D (sin D5–D8)
-- ---------------------------------------------------------------------
create or replace function public.enforce_finding_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); allowed boolean;
begin
  if uid is null then return new; end if;            -- backend / SQL Editor

  if new.status is distinct from old.status then
    allowed := (old.status, new.status) in (
         ('abierto','en_accion'), ('en_analisis','en_accion'), ('abierto','en_analisis'),
         ('en_accion','verificacion'), ('verificacion','cerrado'), ('verificacion','abierto'),
         ('abierto','descripcion'), ('descripcion','contencion'), ('contencion','rca'), ('rca','en_accion'),
         -- Flujo 8D / 4D:
         ('registro','detalles'), ('detalles','solicitud'), ('solicitud','d1'),
         ('d1','d2'), ('d2','d3'), ('d3','d4'),
         ('d4','d5'), ('d5','d6'), ('d6','d7'), ('d7','d8'), ('d8','verificacion'),  -- 8D completo
         ('d4','verificacion'),                                                      -- 4D: salta de D4 a Verificación
         ('verificacion','cerrado'), ('verificacion','registro')                     -- cierre o rechazo (vuelve a Registro)
    );
    if not allowed then raise exception 'Cambio de etapa no permitido (% → %)', old.status, new.status; end if;

    if old.status = 'verificacion' and not public.is_admin() then
      raise exception 'Solo un administrador puede aceptar o rechazar la verificación';
    end if;
    if old.status in ('registro','detalles') and not public.is_admin() then
      raise exception 'Solo un administrador puede avanzar esta etapa';
    end if;
    if old.status in ('abierto','en_analisis','en_accion','descripcion','contencion','rca','solicitud','d1','d2','d3','d4','d5','d6','d7','d8')
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

-- ---------------------------------------------------------------------
-- CAPA Files ahora es solo el logo que se imprime en el PDF del 8D/4D
-- ---------------------------------------------------------------------
-- (el valor por defecto se siembra por empresa en 19_company_scoped_unique.sql)
