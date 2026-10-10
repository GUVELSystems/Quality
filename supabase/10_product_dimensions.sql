-- =====================================================================
-- GUVEL Quality · Dimensiones en auditorías de Producto
-- Ejecutar DESPUÉS de 09_class_scopes.sql. Re-ejecutable (no borra datos).
--
-- En los formatos de Producto cada punto pertenece a una sección:
--   · Inspección → se responde Cumple / No cumple (como siempre)
--   · Dimensión  → se captura el valor medido y se compara con
--                  nominal ± tolerancia; fuera de tolerancia = No cumple
-- =====================================================================

alter table public.form_items add column if not exists kind      text not null default 'inspeccion';
alter table public.form_items add column if not exists nominal   numeric;
alter table public.form_items add column if not exists tol_plus  numeric;     -- tolerancia positiva (+)
alter table public.form_items add column if not exists tol_minus numeric;     -- tolerancia negativa (−); vacío = igual a la positiva
alter table public.form_items add column if not exists unit      text;
alter table public.form_items add column if not exists decimals  smallint;     -- decimales con los que se escribió la especificación (12.000 → 3)

alter table public.form_items drop constraint if exists form_items_kind_check;
alter table public.form_items add constraint form_items_kind_check check (kind in ('inspeccion','dimension'));

alter table public.form_items drop constraint if exists form_items_decimals_check;
alter table public.form_items add constraint form_items_decimals_check check (decimals is null or decimals between 0 and 6);

alter table public.form_items drop constraint if exists form_items_dimension_spec;
alter table public.form_items add constraint form_items_dimension_spec check (
  kind <> 'dimension'
  or (nominal is not null and tol_plus is not null and tol_plus >= 0 and coalesce(tol_minus, tol_plus) >= 0)
);

-- Valor medido en la auditoría (solo para puntos de dimensión)
alter table public.audit_answers add column if not exists value numeric;

-- "Solo aplica para Producto": un punto de dimensión únicamente puede estar en un formato de Producto
create or replace function public.enforce_dimension_only_product()
returns trigger language plpgsql as $$
begin
  if new.kind = 'dimension'
     and coalesce((select audit_type from public.forms where id = new.form_id), '') <> 'Producto' then
    raise exception 'Los puntos de dimensión solo aplican a formatos de auditoría de Producto';
  end if;
  return new;
end $$;

drop trigger if exists trg_form_items_dimension on public.form_items;
create trigger trg_form_items_dimension before insert or update on public.form_items
  for each row execute function public.enforce_dimension_only_product();
