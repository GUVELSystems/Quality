/* =====================================================================
   GUVEL Quality · Idioma (ES/EN) — Fase 1

   Cómo funciona: los mapas de etiquetas (ROLES, FINDING_STATUS, WS_LABEL…)
   son objetos que YA se usan en todo el código tal cual (p.ej. ROLES[v]).
   Al cambiar de idioma, en vez de tocar cada archivo que los usa, aquí se
   MUTAN esos mismos objetos en su lugar (misma referencia, mismas claves,
   solo cambia el texto) — así todo el portal que ya existía se traduce sin
   tener que reescribir cada pantalla. Esta primera fase cubre la
   navegación, los estados/roles/catálogos (lo que se repite en todas
   partes como badges y menús desplegables) y el texto común de botones y
   diálogos. El contenido más específico de cada módulo (textos largos de
   formularios, avisos puntuales…) se irá traduciendo en las próximas
   rondas.
   ===================================================================== */
import * as C from "./constants.js";
import { WS_LABEL } from "./scope.js";

const LS_LANG = "gq-lang";
export const state = { lang: localStorage.getItem(LS_LANG) || "es" };

/* ---------------------- Mapas fijos de la aplicación ------------------ */
// Cada entrada: clave igual que en constants.js/scope.js → [ES, EN] (o solo texto si no lleva tono)
const MAPS = {
  SEVERITY: { critico: ["Crítico", "Critical"], mayor: ["Mayor", "Major"], menor: ["Menor", "Minor"], observacion: ["Observación", "Observation"] },
  SOURCE: { auditoria: ["Auditoría", "Audit"], cliente: ["Cliente", "Customer"], proceso: ["Proceso", "Process"], proveedor: ["Proveedor", "Supplier"], interno: ["Interno", "Internal"] },
  FINDING_STATUS: { abierto: ["Abierto", "Open"], en_analisis: ["En acción", "In action"], en_accion: ["En acción", "In action"], verificacion: ["Verificación", "Verification"], cerrado: ["Cerrado", "Closed"] },
  ACTION_TYPE: { contencion: ["Contención", "Containment"], correctiva: ["Correctiva", "Corrective"], preventiva: ["Preventiva", "Preventive"] },
  ACTION_STATUS: { pendiente: ["Pendiente", "Pending"], en_proceso: ["En proceso", "In progress"], completada: ["Completada", "Completed"], verificada: ["Verificada", "Verified"] },
  NOTIF_TYPE: { queja: ["Queja", "Complaint"], devolucion: ["Devolución", "Return"], scar: ["SCAR / Acción correctiva", "SCAR / Corrective Action"], alerta: ["Alerta de calidad", "Quality alert"], auditoria_cliente: ["Auditoría de cliente", "Customer audit"] },
  NOTIF_STATUS: { recibida: ["Recibida", "Received"], contencion: ["Contención", "Containment"], analisis: ["Análisis", "Analysis"], respuesta_enviada: ["Respuesta enviada", "Response sent"], cerrada: ["Cerrada", "Closed"] },
  AUDIT_STATUS: { programada: ["Programada", "Scheduled"], en_proceso: ["En proceso", "In progress"], completada: ["Completada", "Completed"], vencida: ["Vencida", "Overdue"], cancelada: ["Cancelada", "Cancelled"] },
  RISK_STATUS: { identificado: ["Identificado", "Identified"], mitigando: ["Mitigando", "Mitigating"], aceptado: ["Aceptado", "Accepted"], cerrado: ["Cerrado", "Closed"] },
  OPP_STATUS: { identificada: ["Identificada", "Identified"], evaluada: ["Evaluada", "Evaluated"], en_ejecucion: ["En ejecución", "In progress"], implementada: ["Implementada", "Implemented"], descartada: ["Descartada", "Discarded"] },
  EFFORT: { bajo: ["Bajo", "Low"], medio: ["Medio", "Medium"], alto: ["Alto", "High"] },
  ROLES: { admin: ["Administrador", "Administrator"], manager: ["Manager", "Manager"], auditor: ["Auditor", "Auditor"], viewer: ["Consulta", "Viewer"] },
  CATALOG_KINDS: { categoria_hallazgo: ["Categoría de hallazgo", "Finding category"], causa_raiz: ["Causa raíz", "Root cause"], tipo_riesgo: ["Tipo de riesgo", "Risk type"], origen_issues: ["Origen de Issues", "Issue origin"] },
};
const WS_LABEL_EN = { dashboard: "Dashboard", auditorias: "Audits", internas: "Internal Audits", issues: "Findings", riesgos: "Risks", oportunidades: "Opportunities", config: "Settings" };
const WS_LABEL_ES = { ...WS_LABEL };

function applyMaps(lang) {
  const i = lang === "en" ? 1 : 0;
  for (const [name, dict] of Object.entries(MAPS)) {
    const target = C[name];
    if (!target) continue;
    for (const [key, val] of Object.entries(dict)) {
      const cur = target[key];
      if (Array.isArray(cur)) target[key] = [val[i], cur[1]];   // [etiqueta, tono] → conserva el tono
      else target[key] = val[i];                                 // solo etiqueta
    }
  }
  Object.assign(WS_LABEL, lang === "en" ? WS_LABEL_EN : WS_LABEL_ES);
}

/* ---------------------------- Texto común ------------------------------ */
const DICT = {
  es: {
    save: "Guardar", cancel: "Cancelar", new: "Nuevo", edit: "Editar", delete: "Eliminar", close: "Cerrar",
    search: "Buscar…", confirm: "Confirmar", back: "Volver", send: "Enviar", accept: "Aceptar", reject: "Rechazar",
    logout: "Cerrar sesión", darkMode: "Modo oscuro", lightMode: "Modo claro", notifications: "Notificaciones",
    language: "Idioma", loading: "Cargando…",
    signIn: "Iniciar sesión", enter: "Entrar", email: "Correo", password: "Contraseña", forgotPassword: "¿Olvidaste tu contraseña?",
    demoMode: "Modo demo.", demoModeDesc: "Aún no se ha configurado Supabase; los datos de ejemplo se guardan solo en este navegador.", enterDemo: "Entrar al modo demo",
    dashboardSubtitle: "Panorama general de todos los módulos. Entra a cada uno para trabajar en él.",
    myPendingAudits: "Mis auditorías pendientes", assignedToYou: "asignada(s) a ti", myPendingFindings: "Mis hallazgos pendientes", yourCharge: "a tu cargo",
    level: "Nivel", perform: "Realizar", open: "Abrir", openOf: "Abrir",
    acceptOrTransfer: "Aceptar o trasladar", describeProblem: "Describir el problema", registerContainment: "Registrar la contención", rootCauseAnalysis: "Análisis de causa raíz", registerActionEvidence: "Registrar acción y evidencia",
    deadline: "límite",
    openFindings: "Hallazgos abiertos", toAccept: "por aceptar · todos los módulos", overdueActions: "Acciones vencidas", overdueActionsDesc: "Plazo de cierre en días hábiles superado",
    overdueVerifications: "Verificaciones vencidas", overdueVerificationsDesc: "Pendientes de verificar fuera de plazo", auditCompliance: "Cumplimiento de auditorías", ofTheMonth: "del mes",
    avgScore: "Resultado promedio", auditsEvaluated: "auditoría(s) evaluadas", openIssues: "Issues abiertos", lateResponse: "con respuesta vencida",
    highRisks: "Riesgos altos", scoreAtLeast: "Puntaje ≥ 15", activeOpportunities: "Oportunidades activas", implemented: "implementada(s)",
    openLabel: "Abrir", livePlans: "Planes vigentes", monthCompliance: "Cumplimiento del mes", openFindingsShort: "Hallazgos abiertos",
    lpaProdProcSys: "LPA · Producto · Proceso · Sistema", mgmtSystem: "Sistema de gestión", customerQualityNotifs: "Notificaciones de calidad de clientes",
    active: "Activos", highGte15: "Altos (≥15)", mitigating: "En mitigación", fiveByFive: "Matriz 5×5",
    activeLabel: "Activas", inProgressLabel: "En ejecución", implementedLabel: "Implementadas", continuousImprovement: "Mejora continua",
    openFindingsByModule: "Hallazgos abiertos por módulo", total: "Total", classification: "Clasificación", unclassified: "Sin clasificar",
    newFindings: "Hallazgos nuevos", last6Months: "Últimos 6 meses", criticalDeadlines: "Vencimientos críticos", allUpToDate: "Todo al día", noOverdueItems: "No hay elementos vencidos.",
    upcomingAudits: "Próximas auditorías", noUpcomingAudits: "Sin auditorías próximas", createPlanHint: "Crea un plan en el módulo de Auditorías.",
    closureOfActions: "Cierre de acciones", verification: "Verificación", ofPrep: "de", overdueResponse: "Respuesta vencida",
    internalAuditPlans: "Planes de auditoría interna", plansOf: "Planes ·", planInternalSubtitle: "Planifica las auditorías internas por periodo, asigna a tu equipo y envía las notificaciones.",
    createAuditPlan: "Crear plan de auditoría", plan: "Plan", frequency: "Frecuencia", period: "Periodo", progress: "Avance", sentCol: "Envío",
    custom: "Personalizado", calendarBtn: "Calendario", exportPdf: "Exportar PDF", noPlansYet: "Aún no hay planes", internalWord: "internos", ofWord: "de",
    createFirstPlanHint: "Crea el primero: elige frecuencia y fecha de inicio; el calendario se genera solo.",
    internalAudits: "Auditorías internas", auditsOf: "Auditorías ·", allAuditsSubtitle: "Todas las auditorías programadas, en proceso y completadas. Entra a una para ejecutar su checklist.",
    searchByFolio: "Buscar por folio…", allStatuses: "Todos los estados", allAuditors: "Todos los auditores", onlyMyAudits: "Solo mis auditorías", auditsCount: "auditoría(s)",
    folio: "Folio", scheduledDate: "Fecha", assignedTo: "Asignado a", formatCol: "Formato", statusCol: "Estado", resultCol: "Resultado",
    noAudits: "Sin auditorías", noAuditsFilters: "No hay auditorías con los filtros actuales.",
    livePlans2: "Planes vigentes", total2: "en total", monthCompliance2: "Cumplimiento del mes", completedOf: "realizadas", openFindings2: "Hallazgos abiertos",
    toAccept2: "por aceptar", ofWord2: "de", overdueActions2: "Acciones vencidas", businessDaysExceeded: "Plazo en días hábiles superado",
  },
  en: {
    save: "Save", cancel: "Cancel", new: "New", edit: "Edit", delete: "Delete", close: "Close",
    search: "Search…", confirm: "Confirm", back: "Back", send: "Send", accept: "Accept", reject: "Reject",
    logout: "Log out", darkMode: "Dark mode", lightMode: "Light mode", notifications: "Notifications",
    language: "Language", loading: "Loading…",
    signIn: "Sign in", enter: "Enter", email: "Email", password: "Password", forgotPassword: "Forgot your password?",
    demoMode: "Demo mode.", demoModeDesc: "Supabase isn't configured yet; sample data is only saved in this browser.", enterDemo: "Enter demo mode",
    dashboardSubtitle: "Overview of every module. Enter each one to work on it.",
    myPendingAudits: "My pending audits", assignedToYou: "assigned to you", myPendingFindings: "My pending findings", yourCharge: "in your charge",
    level: "Level", perform: "Perform", open: "Open", openOf: "Open",
    acceptOrTransfer: "Accept or transfer", describeProblem: "Describe the problem", registerContainment: "Register the containment", rootCauseAnalysis: "Root cause analysis", registerActionEvidence: "Register action and evidence",
    deadline: "due",
    openFindings: "Open findings", toAccept: "to accept · all modules", overdueActions: "Overdue actions", overdueActionsDesc: "Closing deadline (business days) exceeded",
    overdueVerifications: "Overdue verifications", overdueVerificationsDesc: "Pending verification past due", auditCompliance: "Audit compliance", ofTheMonth: "this month",
    avgScore: "Average score", auditsEvaluated: "audit(s) evaluated", openIssues: "Open issues", lateResponse: "with overdue response",
    highRisks: "High risks", scoreAtLeast: "Score ≥ 15", activeOpportunities: "Active opportunities", implemented: "implemented",
    openLabel: "Open", livePlans: "Active plans", monthCompliance: "Compliance this month", openFindingsShort: "Open findings",
    lpaProdProcSys: "LPA · Product · Process · System", mgmtSystem: "Management system", customerQualityNotifs: "Customer quality notifications",
    active: "Active", highGte15: "High (≥15)", mitigating: "Mitigating", fiveByFive: "5×5 Matrix",
    activeLabel: "Active", inProgressLabel: "In progress", implementedLabel: "Implemented", continuousImprovement: "Continuous improvement",
    openFindingsByModule: "Open findings by module", total: "Total", classification: "Classification", unclassified: "Unclassified",
    newFindings: "New findings", last6Months: "Last 6 months", criticalDeadlines: "Critical deadlines", allUpToDate: "All up to date", noOverdueItems: "No overdue items.",
    upcomingAudits: "Upcoming audits", noUpcomingAudits: "No upcoming audits", createPlanHint: "Create a plan in the Audits module.",
    closureOfActions: "Closure of actions", verification: "Verification", ofPrep: "of", overdueResponse: "Overdue response",
    internalAuditPlans: "Internal audit plans", plansOf: "Plans ·", planInternalSubtitle: "Plan internal audits by period, assign your team, and send the notifications.",
    createAuditPlan: "Create audit plan", plan: "Plan", frequency: "Frequency", period: "Period", progress: "Progress", sentCol: "Sent",
    custom: "Custom", calendarBtn: "Calendar", exportPdf: "Export PDF", noPlansYet: "No plans yet", internalWord: "internal", ofWord: "of",
    createFirstPlanHint: "Create the first one: pick a frequency and start date; the calendar builds itself.",
    internalAudits: "Internal audits", auditsOf: "Audits ·", allAuditsSubtitle: "Every audit — scheduled, in progress and completed. Open one to run its checklist.",
    searchByFolio: "Search by folio…", allStatuses: "All statuses", allAuditors: "All auditors", onlyMyAudits: "Only my audits", auditsCount: "audit(s)",
    folio: "Folio", scheduledDate: "Date", assignedTo: "Assigned to", formatCol: "Format", statusCol: "Status", resultCol: "Result",
    noAudits: "No audits", noAuditsFilters: "No audits match the current filters.",
    livePlans2: "Active plans", total2: "total", monthCompliance2: "Compliance this month", completedOf: "completed", openFindings2: "Open findings",
    toAccept2: "to accept", ofWord2: "of", overdueActions2: "Overdue actions", businessDaysExceeded: "Business-day deadline exceeded",
  },
};
/** Texto común (botones, chrome de la interfaz). Si falta la clave, regresa la clave misma. */
export const t = (key) => DICT[state.lang]?.[key] ?? DICT.es[key] ?? key;

export function setLang(lang) {
  if (lang !== "es" && lang !== "en") return;
  state.lang = lang;
  localStorage.setItem(LS_LANG, lang);
  location.reload();   // la forma simple y confiable de que TODO el portal ya abierto quede en el idioma nuevo
}

applyMaps(state.lang);   // deja los mapas en el idioma guardado desde que arranca la app
