-- =====================================================================
-- GUVEL Quality · Corrección: varias reglas de "único" eran GLOBALES
-- (de toda la base de datos) en vez de por empresa.
--
-- Esto causaba, por ejemplo: que una empresa nueva no pudiera crear su
-- propio "Nivel 1" de LPA, su propia área "Calidad", su propia norma
-- "IATF16949" o su propia clasificación "N1" porque GUVEL ya los tenía
-- — el sistema los veía como el MISMO registro para todas las empresas.
--
-- El caso más grave: app_settings (donde vive el logo del PDF, los días
-- de verificación y los números de control) tenía una sola fila POR
-- CLAVE EN TODA LA BASE DE DATOS, compartida entre todas las empresas.
-- Esto es lo que impedía a un administrador de otra empresa subir su
-- propio logo: al guardarlo, chocaba con la fila de GUVEL y la regla de
-- seguridad lo rechazaba (se veía como "sin permiso", pero el problema
-- real era que no existía una fila propia por empresa).
--
-- Ejecutar DESPUÉS de 18_activity_log.sql. Re-ejecutable (no borra datos).
-- =====================================================================

-- app_settings: una fila POR EMPRESA Y CLAVE, no una por clave en toda la base
alter table public.app_settings drop constraint if exists app_settings_pkey;
alter table public.app_settings add column if not exists id uuid default gen_random_uuid();
do $$
begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'app_settings' and constraint_name = 'app_settings_company_key_unique') then
    alter table public.app_settings add constraint app_settings_company_key_unique unique (company_id, key);
  end if;
end $$;

-- lpa_levels: "Nivel 1" de una empresa ya no choca con el "Nivel 1" de otra
alter table public.lpa_levels drop constraint if exists lpa_levels_level_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'lpa_levels' and constraint_name = 'lpa_levels_company_level_unique') then
    alter table public.lpa_levels add constraint lpa_levels_company_level_unique unique (company_id, level);
  end if;
end $$;

-- areas: cada empresa puede tener su propia área "Calidad", "Producción", etc.
alter table public.areas drop constraint if exists areas_name_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'areas' and constraint_name = 'areas_company_name_unique') then
    alter table public.areas add constraint areas_company_name_unique unique (company_id, name);
  end if;
end $$;

-- finding_classes: cada empresa puede tener su propia "N1", "N2"…
alter table public.finding_classes drop constraint if exists finding_classes_code_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'finding_classes' and constraint_name = 'finding_classes_company_code_unique') then
    alter table public.finding_classes add constraint finding_classes_company_code_unique unique (company_id, code);
  end if;
end $$;

-- standards: cada empresa puede tener su propia "IATF16949", "ISO9001"…
alter table public.standards drop constraint if exists standards_code_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'standards' and constraint_name = 'standards_company_code_unique') then
    alter table public.standards add constraint standards_company_code_unique unique (company_id, code);
  end if;
end $$;

-- capa_templates / rca_templates: mismo criterio (aunque ya no se usan desde el portal)
alter table public.capa_templates drop constraint if exists capa_templates_code_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'capa_templates' and constraint_name = 'capa_templates_company_code_unique') then
    alter table public.capa_templates add constraint capa_templates_company_code_unique unique (company_id, code);
  end if;
end $$;
alter table public.rca_templates drop constraint if exists rca_templates_code_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'rca_templates' and constraint_name = 'rca_templates_company_code_unique') then
    alter table public.rca_templates add constraint rca_templates_company_code_unique unique (company_id, code);
  end if;
end $$;

-- clients: "código" de cliente (si se usa) por empresa, no global
alter table public.clients drop constraint if exists clients_code_key;
do $$ begin
  if not exists (select 1 from information_schema.table_constraints where table_name = 'clients' and constraint_name = 'clients_company_code_unique') then
    alter table public.clients add constraint clients_company_code_unique unique (company_id, code);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Valores por defecto de app_settings, por empresa (ya con la llave correcta)
-- Antes vivían sueltos en scripts anteriores con "on conflict (key)", que
-- dejó de existir al quedar la llave como (empresa, clave); se siembran
-- aquí, una vez por empresa, para TODAS las empresas que falten tenerlos.
-- ---------------------------------------------------------------------
insert into public.app_settings (company_id, key, value)
select c.id, v.key, v.value
  from public.companies c
  cross join (values
    ('verification_days', '5'::jsonb),
    ('capa_logo', 'null'::jsonb),
    ('control_8D_5whys', '""'::jsonb),
    ('control_8D_ishikawa', '""'::jsonb),
    ('control_4D', '""'::jsonb)
  ) as v(key, value)
on conflict (company_id, key) do nothing;
