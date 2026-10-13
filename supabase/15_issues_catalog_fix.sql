-- =====================================================================
-- GUVEL Quality · Corrección del catálogo "Origen de Issues"
-- Ejecutar DESPUÉS de 14_4d_review.sql. Re-ejecutable (no borra datos).
--
-- La ronda anterior sembró el catálogo "Origen de Issues" con 6 valores
-- inventados (Reclamación de Cliente, Auditoría Externa, KPI, Alerta de
-- Calidad, Proceso, Devolución). Los valores correctos, que coinciden con
-- el campo "Tipo de notificación" que ya existía en Issues, son estos 5:
--   Queja, Devolución, SCAR / Acción correctiva, Alerta de calidad,
--   Auditoría de cliente
-- Este script reemplaza los 6 inventados por los 5 correctos (si existen),
-- y migra cualquier notificación de cliente real que ya tuvieras con las
-- claves cortas anteriores (queja, devolucion, scar, alerta,
-- auditoria_cliente) al nombre completo, para que las secciones por tipo
-- funcionen correctamente con datos existentes.
-- =====================================================================

delete from public.classifications
 where kind = 'origen_issues'
   and name in ('Reclamación de Cliente', 'Auditoría Externa', 'KPI', 'Proceso', 'Alerta de Calidad');

insert into public.classifications (kind, name)
select 'origen_issues', v.name from (values
  ('Queja'), ('Devolución'), ('SCAR / Acción correctiva'), ('Alerta de calidad'), ('Auditoría de cliente')
) as v(name)
where not exists (select 1 from public.classifications c where c.kind = 'origen_issues' and c.name = v.name);

-- "Tipo de notificación" ahora es un catálogo editable (Configuración → Catálogos), no una lista fija:
-- se quita la restricción para poder guardar el nombre completo del catálogo en vez de la clave corta.
alter table public.customer_notifications drop constraint if exists customer_notifications_notification_type_check;

update public.customer_notifications set notification_type = 'Queja'                     where notification_type = 'queja';
update public.customer_notifications set notification_type = 'Devolución'                where notification_type = 'devolucion';
update public.customer_notifications set notification_type = 'SCAR / Acción correctiva'   where notification_type = 'scar';
update public.customer_notifications set notification_type = 'Alerta de calidad'          where notification_type = 'alerta';
update public.customer_notifications set notification_type = 'Auditoría de cliente'       where notification_type = 'auditoria_cliente';
