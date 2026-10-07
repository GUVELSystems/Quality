/* =====================================================================
   Módulos ("portales dentro del portal") y reglas de separación de datos
   · auditorias → LPA, Producto, Proceso, Sistema
   · internas   → solo auditorías de tipo Interna
   · issues     → notificaciones de calidad de clientes
   Los hallazgos llevan la columna `module` y las acciones heredan la de su hallazgo.
   ===================================================================== */
import * as db from "./db.js";

export const WS_LABEL = {
  dashboard: "Dashboard", auditorias: "Auditorías", internas: "Auditorías Internas", issues: "Issues",
  riesgos: "Riesgos", oportunidades: "Oportunidades", config: "Configuración",
};
export const AUDIT_TYPES_BY_WS = { auditorias: ["LPA", "Producto", "Proceso", "Sistema"], internas: ["Interna"] };
export const isAuditWs = (ws) => ws in AUDIT_TYPES_BY_WS;
export const typesOf = (ws) => AUDIT_TYPES_BY_WS[ws] || [];

export const planWs = (plan) => (plan?.audit_type === "Interna" ? "internas" : "auditorias");
export const auditWs = (audit) => planWs(db.get("audit_plans", audit?.plan_id));
export const findingWs = (f) => f?.module || "auditorias";

export const plansOf = (ws) => db.rows("audit_plans").filter((p) => typesOf(ws).includes(p.audit_type));
export const auditsOf = (ws) => { const ids = new Set(plansOf(ws).map((p) => p.id)); return db.rows("audits").filter((a) => ids.has(a.plan_id)); };
export const findingsOf = (ws) => db.rows("findings").filter((f) => findingWs(f) === ws);
export const actionsOf = (ws) => { const ids = new Set(findingsOf(ws).map((f) => f.id)); return db.rows("actions").filter((a) => ids.has(a.finding_id)); };
export const formsOf = (ws) => db.rows("forms").filter((f) => typesOf(ws).includes(f.audit_type));

export const isDone = (a) => ["completada", "verificada"].includes(a.status);
