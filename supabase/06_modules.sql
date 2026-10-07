-- =====================================================================
-- GUVEL Quality · Módulos independientes
-- Ejecutar ANTES de publicar la nueva versión del portal. Re-ejecutable.
--
-- Separa los hallazgos por módulo:
--   auditorias → LPA, Producto, Proceso, Sistema
--   internas   → Auditorías internas
--   issues     → Notificaciones de calidad de clientes
-- Las acciones heredan el módulo de su hallazgo.
-- =====================================================================

alter table public.findings add column if not exists module text not null default 'auditorias'
  check (module in ('auditorias','internas','issues'));

-- Datos existentes: se clasifican según su origen (solo los que aún están en el valor por defecto)
update public.findings f set module = 'internas'
 where f.module = 'auditorias'
   and exists (select 1 from public.audits a join public.audit_plans p on p.id = a.plan_id
               where a.id = f.audit_id and p.audit_type = 'Interna');

update public.findings f set module = 'issues'
 where f.module = 'auditorias'
   and (f.source = 'cliente'
        or exists (select 1 from public.customer_notifications n where n.finding_id = f.id));

create index if not exists idx_findings_module on public.findings(module, status);
