-- =====================================================================
-- GUVEL Quality · Corrección: "new row ... violates check constraint
-- findings_source_check"
--
-- La columna findings.source tenía una lista fija de 5 valores
-- ('auditoria','cliente','proceso','proveedor','interno') desde el
-- diseño original, antes de que existiera Issues. Pero el campo "Origen"
-- de un hallazgo de Issues ahora viene del catálogo "Origen de Issues"
-- (Configuración → Catálogos), que es editable por cada empresa — puede
-- tener cualquier texto ("Queja", "Devolución"...), así que esa lista
-- fija rechazaba casi cualquier hallazgo nuevo creado desde Issues.
--
-- Esto es exactamente lo mismo que ya se corrigió para
-- customer_notifications.notification_type en 15_issues_catalog_fix.sql
-- — a "source" se le había quedado pendiente la misma corrección.
--
-- Ejecutar DESPUÉS de 23_processes.sql. Re-ejecutable (no borra datos).
-- =====================================================================

alter table public.findings drop constraint if exists findings_source_check;
