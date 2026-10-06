-- =====================================================================
-- GUVEL Quality · Datos iniciales (catálogos y formatos base)
-- Ejecutar DESPUÉS de 02_policies.sql. Se puede re-ejecutar sin duplicar.
-- =====================================================================

-- Clasificaciones ------------------------------------------------------
insert into public.classifications (kind, name, description) values
  ('categoria_hallazgo','Seguridad',          'Condiciones o actos inseguros'),
  ('categoria_hallazgo','Calidad de producto','Defectos o no conformidades de producto'),
  ('categoria_hallazgo','Proceso',            'Desviaciones del proceso estándar'),
  ('categoria_hallazgo','Documentación',      'Registros, instrucciones o documentos'),
  ('categoria_hallazgo','Ambiental',          'Condiciones ambientales y 5S'),
  ('categoria_hallazgo','Mantenimiento',      'Equipos, herramentales y calibración'),
  ('area','Producción',  null),
  ('area','Calidad',     null),
  ('area','Logística',   null),
  ('area','Mantenimiento', null),
  ('area','Ingeniería',  null),
  ('area','Almacén',     null),
  ('causa_raiz','Método',          '6M'),
  ('causa_raiz','Máquina',         '6M'),
  ('causa_raiz','Material',        '6M'),
  ('causa_raiz','Mano de obra',    '6M'),
  ('causa_raiz','Medición',        '6M'),
  ('causa_raiz','Medio ambiente',  '6M'),
  ('tipo_riesgo','Operativo',      null),
  ('tipo_riesgo','Cliente',        null),
  ('tipo_riesgo','Proveedor',      null),
  ('tipo_riesgo','Seguridad',      null),
  ('tipo_riesgo','Regulatorio',    null)
on conflict (kind, name) do nothing;

-- Formatos base --------------------------------------------------------
insert into public.forms (code, name, audit_type, version) values
  ('FOR-LPA-001','Auditoría en capas (LPA) · Línea de producción','LPA','1.0'),
  ('FOR-PRO-001','Auditoría de producto terminado','Producto','1.0'),
  ('FOR-PRC-001','Auditoría de proceso','Proceso','1.0')
on conflict (code) do nothing;

-- Preguntas (solo si el formato aún no tiene preguntas)
insert into public.form_items (form_id, position, section, question, critical)
select f.id, v.position, v.section, v.question, v.critical
from public.forms f
join (values
  ('FOR-LPA-001',1,'Estación','¿La instrucción de trabajo vigente está disponible en la estación?',false),
  ('FOR-LPA-001',2,'Estación','¿El operador sigue la secuencia definida en la instrucción?',true),
  ('FOR-LPA-001',3,'Estación','¿Los instrumentos de medición están calibrados y en buen estado?',true),
  ('FOR-LPA-001',4,'Material','¿El material está identificado y con trazabilidad?',false),
  ('FOR-LPA-001',5,'Material','¿El producto no conforme está segregado y etiquetado?',true),
  ('FOR-LPA-001',6,'Orden y limpieza','¿El área cumple con el estándar 5S?',false),
  ('FOR-PRO-001',1,'Inspección','¿Las dimensiones críticas cumplen con el plano?',true),
  ('FOR-PRO-001',2,'Inspección','¿El aspecto visual cumple con el criterio de aceptación?',false),
  ('FOR-PRO-001',3,'Empaque','¿El empaque e identificación cumplen con el requisito del cliente?',true),
  ('FOR-PRO-001',4,'Registros','¿Los registros de inspección están completos y firmados?',false),
  ('FOR-PRC-001',1,'Proceso','¿Los parámetros del proceso coinciden con la hoja de proceso?',true),
  ('FOR-PRC-001',2,'Proceso','¿Se realizó la verificación de arranque (set-up)?',true),
  ('FOR-PRC-001',3,'Control','¿El plan de control está disponible y vigente?',false),
  ('FOR-PRC-001',4,'Control','¿Las reacciones ante desviaciones están documentadas?',false)
) as v(code, position, section, question, critical) on v.code = f.code
where not exists (select 1 from public.form_items fi where fi.form_id = f.id);
