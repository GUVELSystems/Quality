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
const WS_LABEL_EN = { dashboard: "Dashboard", auditorias: "Audits", internas: "Internal Audits", issues: "Issues", riesgos: "Risks", oportunidades: "Opportunities", config: "Settings" };
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
  },
  en: {
    save: "Save", cancel: "Cancel", new: "New", edit: "Edit", delete: "Delete", close: "Close",
    search: "Search…", confirm: "Confirm", back: "Back", send: "Send", accept: "Accept", reject: "Reject",
    logout: "Log out", darkMode: "Dark mode", lightMode: "Light mode", notifications: "Notifications",
    language: "Language", loading: "Loading…",
    signIn: "Sign in", enter: "Enter", email: "Email", password: "Password", forgotPassword: "Forgot your password?",
    demoMode: "Demo mode.", demoModeDesc: "Supabase isn't configured yet; sample data is only saved in this browser.", enterDemo: "Enter demo mode",
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
