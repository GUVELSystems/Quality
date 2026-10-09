/* Catálogos fijos de la aplicación: [etiqueta, tono visual] */
export const SEVERITY = {
  critico: ["Crítico", "danger"],
  mayor: ["Mayor", "warn"],
  menor: ["Menor", "info"],
  observacion: ["Observación", "neutral"],
};
export const SEVERITY_COLOR = { critico: "var(--danger)", mayor: "var(--warn)", menor: "var(--g-cyan)", observacion: "var(--muted)" };
export const SEVERITY_SLA_DAYS = { critico: 7, mayor: 30, menor: 60, observacion: 90 };

export const SOURCE = {
  auditoria: ["Auditoría", "info"],
  cliente: ["Cliente", "warn"],
  proceso: ["Proceso", "neutral"],
  proveedor: ["Proveedor", "neutral"],
  interno: ["Interno", "neutral"],
};

export const FINDING_FLOW = ["abierto", "en_analisis", "en_accion", "verificacion", "cerrado"];
export const FINDING_STATUS = {
  abierto: ["Abierto", "danger"],
  en_analisis: ["En análisis", "warn"],
  en_accion: ["En acción", "info"],
  verificacion: ["Verificación", "info"],
  cerrado: ["Cerrado", "ok"],
};

export const ACTION_TYPE = { contencion: ["Contención", "danger"], correctiva: ["Correctiva", "info"], preventiva: ["Preventiva", "ok"] };
export const ACTION_FLOW = ["pendiente", "en_proceso", "completada", "verificada"];
export const ACTION_STATUS = {
  pendiente: ["Pendiente", "neutral"],
  en_proceso: ["En proceso", "warn"],
  completada: ["Completada", "info"],
  verificada: ["Verificada", "ok"],
};

export const NOTIF_TYPE = {
  queja: "Queja",
  devolucion: "Devolución",
  scar: "SCAR / Acción correctiva",
  alerta: "Alerta de calidad",
  auditoria_cliente: "Auditoría de cliente",
};
export const NOTIF_FLOW = ["recibida", "contencion", "analisis", "respuesta_enviada", "cerrada"];
export const NOTIF_STATUS = {
  recibida: ["Recibida", "danger"],
  contencion: ["Contención", "warn"],
  analisis: ["Análisis", "warn"],
  respuesta_enviada: ["Respuesta enviada", "info"],
  cerrada: ["Cerrada", "ok"],
};

export const AUDIT_TYPES = ["LPA", "Producto", "Proceso", "Sistema", "Interna"];
export const FREQUENCIES = ["Semanal", "Quincenal", "Mensual", "Custom"];
export const AUDIT_STATUS = {
  programada: ["Programada", "info"],
  en_proceso: ["En proceso", "warn"],
  completada: ["Completada", "ok"],
  vencida: ["Vencida", "danger"],
  cancelada: ["Cancelada", "neutral"],
};

export const RISK_STATUS = {
  identificado: ["Identificado", "warn"],
  mitigando: ["Mitigando", "info"],
  aceptado: ["Aceptado", "neutral"],
  cerrado: ["Cerrado", "ok"],
};
export const OPP_STATUS = {
  identificada: ["Identificada", "neutral"],
  evaluada: ["Evaluada", "info"],
  en_ejecucion: ["En ejecución", "warn"],
  implementada: ["Implementada", "ok"],
  descartada: ["Descartada", "neutral"],
};
export const EFFORT = { bajo: "Bajo", medio: "Medio", alto: "Alto" };

export const ROLES = {
  admin: "Administrador",
  quality_manager: "Gerente de Calidad",
  auditor: "Auditor",
  viewer: "Consulta",
};

export const CATALOG_KINDS = {
  categoria_hallazgo: "Categoría de hallazgo",
  causa_raiz: "Causa raíz",
  tipo_riesgo: "Tipo de riesgo",
};
