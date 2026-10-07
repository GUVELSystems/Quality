/* Datos de ejemplo para el MODO DEMO (relativos a la fecha actual) */
import { uuid, isoDate, addDays, today, daysBetween } from "./utils.js";

export function buildSeed() {
  const T = today();
  const counters = {};
  const code = (p) => { counters[p] = (counters[p] || 0) + 1; return `${p}-${String(counters[p]).padStart(4, "0")}`; };
  const iso = (d) => new Date(d).toISOString();
  const daysAgoISO = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };

  /* Usuarios */
  const mk = (id, full_name, email, role, area) => ({ id, full_name, email, role, area, active: true, created_at: daysAgoISO(90) });
  const profiles = [
    mk("u-carlos", "Carlos Gutiérrez", "carlos.gutierrez@guvel.com", "admin", "Calidad"),
    mk("u-maria", "María López", "maria.lopez@guvel.com", "quality_manager", "Calidad"),
    mk("u-juan", "Juan Pérez", "juan.perez@guvel.com", "auditor", "Producción"),
    mk("u-ana", "Ana Torres", "ana.torres@guvel.com", "viewer", "Logística"),
  ];

  /* Clientes */
  const clients = [
    ["Automotriz Norte", "Laura Medina", "Planta Monterrey"],
    ["Componentes Delta", "Ricardo Salas", "Planta Saltillo"],
    ["Industrias Aurora", "Patricia Vega", "Planta Querétaro"],
    ["Grupo Metalmex", "Héctor Ríos", "Planta Apodaca"],
  ].map(([name, contact_name, plant]) => ({ id: uuid(), code: code("CLI"), name, contact_name, contact_email: contact_name.toLowerCase().replace(/ /g, ".").normalize("NFD").replace(/[\u0300-\u036f]/g, "") + "@cliente.com", plant, active: true, created_at: daysAgoISO(80) }));

  /* Clasificaciones */
  const cls = [];
  const addCls = (kind, names) => names.forEach((name) => cls.push({ id: uuid(), kind, name, description: null, active: true, created_at: daysAgoISO(80) }));
  addCls("categoria_hallazgo", ["Seguridad", "Calidad de producto", "Proceso", "Documentación", "Ambiental", "Mantenimiento"]);
  addCls("area", ["Producción", "Calidad", "Logística", "Mantenimiento", "Ingeniería", "Almacén"]);
  addCls("causa_raiz", ["Método", "Máquina", "Material", "Mano de obra", "Medición", "Medio ambiente"]);
  addCls("tipo_riesgo", ["Operativo", "Cliente", "Proveedor", "Seguridad", "Regulatorio"]);
  const catId = (n) => cls.find((c) => c.name === n)?.id;

  /* Formatos */
  const forms = [], form_items = [];
  const addForm = (c, name, audit_type, items) => {
    const f = { id: uuid(), code: c, name, audit_type, version: "1.0", active: true, created_at: daysAgoISO(80), updated_at: daysAgoISO(80) };
    forms.push(f);
    items.forEach(([section, question, critical], i) => form_items.push({ id: uuid(), form_id: f.id, position: i + 1, section, question, critical }));
    return f;
  };
  const fLPA = addForm("FOR-LPA-001", "Auditoría en capas (LPA) · Línea de producción", "LPA", [
    ["Estación", "¿La instrucción de trabajo vigente está disponible en la estación?", false],
    ["Estación", "¿El operador sigue la secuencia definida en la instrucción?", true],
    ["Estación", "¿Los instrumentos de medición están calibrados y en buen estado?", true],
    ["Material", "¿El material está identificado y con trazabilidad?", false],
    ["Material", "¿El producto no conforme está segregado y etiquetado?", true],
    ["Orden y limpieza", "¿El área cumple con el estándar 5S?", false],
  ]);
  const fPRO = addForm("FOR-PRO-001", "Auditoría de producto terminado", "Producto", [
    ["Inspección", "¿Las dimensiones críticas cumplen con el plano?", true],
    ["Inspección", "¿El aspecto visual cumple con el criterio de aceptación?", false],
    ["Empaque", "¿El empaque e identificación cumplen con el requisito del cliente?", true],
    ["Registros", "¿Los registros de inspección están completos y firmados?", false],
  ]);
  const fINT = addForm("FOR-INT-001", "Auditoría interna del sistema de gestión", "Interna", [
    ["Documentación", "¿La documentación del sistema de gestión está vigente y controlada?", false],
    ["Registros", "¿Los registros requeridos se conservan y son legibles?", false],
    ["Competencia", "¿El personal evidencia la competencia y capacitación requeridas?", true],
    ["Acciones", "¿Las acciones correctivas previas se cerraron con evidencia de eficacia?", true],
    ["Mejora", "¿Se da seguimiento a los objetivos e indicadores de calidad?", false],
  ]);
  addForm("FOR-PRC-001", "Auditoría de proceso", "Proceso", [
    ["Proceso", "¿Los parámetros del proceso coinciden con la hoja de proceso?", true],
    ["Proceso", "¿Se realizó la verificación de arranque (set-up)?", true],
    ["Control", "¿El plan de control está disponible y vigente?", false],
    ["Control", "¿Las reacciones ante desviaciones están documentadas?", false],
  ]);

  /* Planes y auditorías */
  const now = new Date();
  const first = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const last = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][now.getMonth()];
  const audit_plans = [
    { id: uuid(), code: code("PLAN"), name: `LPA líneas de producción · ${MES}`, audit_type: "LPA", frequency: "Mensual", start_date: first, end_date: last, notes: "LPA en líneas de producción", status: "enviado", sent_at: daysAgoISO(4), sent_by: "u-maria", created_by: "u-maria", created_at: daysAgoISO(35) },
    { id: uuid(), code: code("PLAN"), name: "Producto terminado · quincena", audit_type: "Producto", frequency: "Quincenal", start_date: first, end_date: addDays(first, 14), notes: "Auditoría de producto terminado", status: "borrador", sent_at: null, sent_by: null, created_by: "u-maria", created_at: daysAgoISO(35) },
    { id: uuid(), code: code("PLAN"), name: `Auditoría interna ISO · ${MES}`, audit_type: "Interna", frequency: "Mensual", start_date: first, end_date: last, notes: "Programa anual de auditorías internas", status: "enviado", sent_at: daysAgoISO(6), sent_by: "u-maria", created_by: "u-maria", created_at: daysAgoISO(34) },
  ];
  const audits = [], audit_answers = [], findings = [], actions = [];
  const auditors = ["u-juan", "u-maria", "u-carlos"];
  const mkFinding = (o) => { const f = { id: uuid(), code: code("HAL"), module: "auditorias", description: null, source: "auditoria", severity: "menor", status: "abierto", classification_id: null, area: null, owner_id: null, audit_id: null, client_id: null, root_cause: null, due_date: null, closed_at: null, created_by: "u-maria", created_at: daysAgoISO(10), updated_at: daysAgoISO(2), ...o }; findings.push(f); return f; };

  const addAudits = (plan, form, step, who, levelCycle) => {
    for (let k = 0, d = plan.start_date; d <= plan.end_date; k++, d = addDays(d, step)) {
      const past = d < addDays(T, -1);
      let status = "programada";
      if (past && k % 5 !== 3) status = "completada";
      if (d === T) status = "en_proceso";
      const a = { id: uuid(), code: code("AUD"), plan_id: plan.id, scheduled_date: d, assigned_to: who[k % who.length], level: levelCycle ? (k % 3) + 1 : null, form_id: form.id, due_at: iso(d + "T17:00:00"), status, score: null, notes: null, completed_at: null, created_by: "u-maria", created_at: daysAgoISO(30), updated_at: daysAgoISO(1), notified_at: plan.status === "enviado" ? daysAgoISO(4) : null, notified_to: plan.status === "enviado" ? who[k % who.length] : null };
      if (status === "completada") {
        const items = form_items.filter((i) => i.form_id === form.id);
        let ok = 0, nok = 0;
        items.forEach((it, idx) => {
          const bad = (k + idx) % 7 === 0;
          const ans = { id: uuid(), audit_id: a.id, item_id: it.id, result: bad ? "nok" : "ok", comment: bad ? "Se detectó desviación durante el recorrido." : null, finding_id: null, created_at: iso(d + "T11:00:00") };
          if (bad) {
            nok++;
            const f = mkFinding({ title: it.question.replace(/[¿?]/g, "").replace(/^./, (c) => c.toUpperCase()).slice(0, 90) + " · NO CUMPLE", description: ans.comment, module: plan.audit_type === "Interna" ? "internas" : "auditorias", severity: it.critical ? "mayor" : "menor", status: k % 2 ? "en_accion" : "abierto", audit_id: a.id, owner_id: "u-juan", due_date: addDays(d, it.critical ? 30 : 60), area: "Producción", classification_id: catId("Proceso"), created_at: iso(d + "T11:00:00") });
            ans.finding_id = f.id;
          } else ok++;
          audit_answers.push(ans);
        });
        a.score = Math.round((ok / (ok + nok || 1)) * 10000) / 100;
        a.completed_at = iso(d + "T12:00:00");
      }
      audits.push(a);
    }
  };
  addAudits(audit_plans[0], fLPA, 7, auditors, true);
  addAudits(audit_plans[1], fPRO, 14, ["u-juan", "u-carlos"], false);
  addAudits(audit_plans[2], fINT, 9, ["u-maria", "u-carlos"], false);
  // Una auditoría en sábado (día inhábil habilitado por tener responsable)
  const sat = (() => { for (let d = audit_plans[0].start_date; d <= audit_plans[0].end_date; d = addDays(d, 1)) if (d > T && new Date(d + "T12:00:00").getDay() === 6) return d; return null; })();
  if (sat) audits.push({ id: uuid(), code: code("AUD"), plan_id: audit_plans[0].id, scheduled_date: sat, assigned_to: "u-juan", level: 2, form_id: fLPA.id, due_at: iso(sat + "T17:00:00"), status: "programada", score: null, notes: "Turno especial en sábado", completed_at: null, created_by: "u-maria", created_at: daysAgoISO(30), updated_at: daysAgoISO(1), notified_at: null, notified_to: null });

  /* Hallazgos manuales */
  const [cNorte, cDelta, cAurora, cMetal] = clients;
  const manual = [
    { title: "Instrucción de trabajo obsoleta en estación de ensamble 3", source: "proceso", severity: "mayor", status: "en_accion", area: "Producción", classification_id: catId("Documentación"), owner_id: "u-juan", due_date: addDays(T, 9), root_cause: "Método" },
    { title: "Calibrador vernier sin etiqueta de calibración vigente", source: "interno", severity: "mayor", status: "abierto", area: "Calidad", classification_id: catId("Mantenimiento"), owner_id: "u-maria", due_date: addDays(T, -3), root_cause: "Medición" },
    { title: "Producto no conforme sin segregar en línea 2", source: "auditoria", severity: "critico", status: "en_analisis", area: "Producción", classification_id: catId("Calidad de producto"), owner_id: "u-carlos", due_date: addDays(T, 4), description: "Se encontraron 14 piezas con rebaba en contenedor de producto bueno." },
    { title: "Fuga de aceite en prensa hidráulica P-07", source: "interno", severity: "menor", status: "verificacion", area: "Mantenimiento", classification_id: catId("Ambiental"), owner_id: "u-juan", due_date: addDays(T, 12), root_cause: "Máquina" },
    { title: "Registros de inspección sin firma de supervisor", source: "auditoria", severity: "menor", status: "cerrado", area: "Calidad", classification_id: catId("Documentación"), owner_id: "u-maria", due_date: addDays(T, -12), closed_at: daysAgoISO(5) },
    { title: "Falta de trazabilidad de lote en material de proveedor", source: "proveedor", severity: "mayor", status: "abierto", area: "Almacén", classification_id: catId("Calidad de producto"), owner_id: "u-carlos", due_date: addDays(T, -6), root_cause: "Material" },
    { title: "Delimitaciones 5S deterioradas en almacén", source: "interno", severity: "observacion", status: "abierto", area: "Almacén", classification_id: catId("Ambiental"), owner_id: "u-ana", due_date: addDays(T, 45) },
  ].map(mkFinding);
  const fCrit = manual[2], fLote = manual[5], fInst = manual[0], fFuga = manual[3];

  const mkAction = (o) => actions.push({ id: uuid(), code: code("ACC"), finding_id: null, action_type: "correctiva", description: "", owner_id: "u-juan", due_date: null, status: "pendiente", completed_at: null, effectiveness: null, created_by: "u-maria", created_at: daysAgoISO(8), updated_at: daysAgoISO(2), ...o });
  mkAction({ finding_id: fCrit.id, action_type: "contencion", description: "Inspección al 100% del lote y segregación de piezas sospechosas", status: "completada", due_date: addDays(T, -1), completed_at: daysAgoISO(1), owner_id: "u-carlos" });
  mkAction({ finding_id: fCrit.id, action_type: "correctiva", description: "Rediseñar estación de segregación con contenedor rojo identificado", due_date: addDays(T, 10), status: "en_proceso", owner_id: "u-carlos" });
  mkAction({ finding_id: fInst.id, description: "Actualizar IT-ENS-003 a revisión vigente y retirar copias obsoletas", due_date: addDays(T, 5), status: "en_proceso" });
  mkAction({ finding_id: fInst.id, action_type: "preventiva", description: "Auditoría semanal de control documental en estaciones", due_date: addDays(T, 20) });
  mkAction({ finding_id: fFuga.id, description: "Reemplazar sello del cilindro principal", due_date: addDays(T, -2), status: "completada", completed_at: daysAgoISO(3) });
  mkAction({ finding_id: fLote.id, description: "Solicitar al proveedor etiqueta de lote en cada empaque", due_date: addDays(T, -4), owner_id: "u-carlos" });
  mkAction({ finding_id: manual[1].id, description: "Enviar vernier a calibración externa y etiquetar", due_date: addDays(T, -1), owner_id: "u-maria", status: "en_proceso" });
  mkAction({ finding_id: manual[4].id, description: "Capacitar a supervisores en llenado de registros", status: "verificada", due_date: addDays(T, -15), completed_at: daysAgoISO(8) });

  /* Notificaciones de cliente */
  const notifs = [];
  const mkNotif = (o) => notifs.push({ id: uuid(), code: code("NCL"), description: null, part_number: null, quantity: null, severity: "mayor", received_at: T, response_due: null, status: "recibida", owner_id: "u-maria", finding_id: null, closed_at: null, created_by: "u-maria", created_at: daysAgoISO(3), updated_at: daysAgoISO(1), ...o });
  mkNotif({ client_id: cNorte.id, notification_type: "queja", subject: "Rebaba excesiva en pieza AN-4471", description: "El cliente reporta rebaba fuera de tolerancia en 120 piezas del embarque semanal.", part_number: "AN-4471", quantity: 120, severity: "mayor", received_at: addDays(T, -3), response_due: addDays(T, 2), status: "contencion" });
  mkNotif({ client_id: cDelta.id, notification_type: "devolucion", subject: "Devolución por dimensión fuera de especificación", part_number: "CD-2208", quantity: 480, severity: "critico", received_at: addDays(T, -10), response_due: addDays(T, -2), status: "analisis", owner_id: "u-carlos" });
  mkNotif({ client_id: cAurora.id, notification_type: "scar", subject: "SCAR-2291 · Falta de identificación en empaque", part_number: "IA-9012", quantity: 60, severity: "menor", received_at: addDays(T, -20), response_due: addDays(T, -8), status: "respuesta_enviada" });
  mkNotif({ client_id: cMetal.id, notification_type: "alerta", subject: "Alerta de calidad por variación de dureza", part_number: "GM-3310", severity: "mayor", received_at: addDays(T, -1), response_due: addDays(T, 4), status: "recibida" });
  mkNotif({ client_id: cNorte.id, notification_type: "auditoria_cliente", subject: "Auditoría de segunda parte · Resultados", severity: "observacion", received_at: addDays(T, -45), response_due: addDays(T, -30), status: "cerrada", closed_at: daysAgoISO(30) });
  const linked = mkFinding({ module: "issues", title: "Etiqueta de embarque con número de parte incorrecto", source: "cliente", severity: "mayor", status: "en_analisis", client_id: cAurora.id, area: "Logística", classification_id: catId("Calidad de producto"), owner_id: "u-maria", due_date: addDays(T, 8) });
  notifs[2].finding_id = linked.id;
  const rebaba = mkFinding({ module: "issues", title: "[Queja] Rebaba excesiva en pieza AN-4471", description: "El cliente reporta rebaba fuera de tolerancia.", source: "cliente", severity: "mayor", status: "en_accion", client_id: cNorte.id, area: "Producción", classification_id: catId("Calidad de producto"), owner_id: "u-maria", due_date: addDays(T, 2) });
  notifs[0].finding_id = rebaba.id;
  mkAction({ finding_id: rebaba.id, action_type: "contencion", description: "Selección 100% del inventario en planta y en tránsito", due_date: addDays(T, 1), status: "en_proceso", owner_id: "u-maria" });

  /* Riesgos y oportunidades */
  const rk = (title, category, probability, impact, status, owner_id, mitigation) => ({ id: uuid(), code: code("RSK"), title, description: null, category, probability, impact, score: probability * impact, owner_id, mitigation, status, review_date: addDays(T, 30), created_by: "u-maria", created_at: daysAgoISO(40), updated_at: daysAgoISO(5) });
  const risks = [
    rk("Dependencia de proveedor único para insertos críticos", "Proveedor", 4, 5, "mitigando", "u-carlos", "Calificar proveedor alterno y mantener stock de seguridad de 3 semanas."),
    rk("Rotación de personal en turno nocturno", "Operativo", 4, 3, "identificado", "u-maria", "Plan de capacitación cruzada y matriz de habilidades."),
    rk("Calibración vencida de equipos de medición", "Operativo", 3, 4, "mitigando", "u-maria", "Calendario de calibración con alertas a 30 días."),
    rk("Reclamo repetitivo del cliente Automotriz Norte", "Cliente", 3, 5, "identificado", "u-carlos", "Revisión de 8D y verificación de efectividad."),
    rk("Cambio regulatorio en sustancias restringidas", "Regulatorio", 2, 4, "aceptado", "u-maria", "Monitoreo trimestral de normativa."),
    rk("Accidente por falta de guardas en prensa", "Seguridad", 1, 5, "mitigando", "u-juan", "Instalación de guardas y paro de emergencia."),
  ];
  const op = (title, benefit, effort, status, due) => ({ id: uuid(), code: code("OPP"), title, description: null, benefit, effort, owner_id: "u-maria", status, due_date: addDays(T, due), created_by: "u-maria", created_at: daysAgoISO(30), updated_at: daysAgoISO(4) });
  const opportunities = [
    op("Digitalizar LPA con tabletas en línea", "Reducir 40% el tiempo de captura y consolidación", "medio", "en_ejecucion", 40),
    op("Poka-yoke de verificación de etiqueta", "Eliminar reclamos por identificación incorrecta", "bajo", "evaluada", 25),
    op("Tablero visual de calidad por célula", "Mayor visibilidad de defectos en tiempo real", "medio", "identificada", 60),
    op("Programa de auditores certificados internos", "Cobertura de auditorías sin depender de calidad", "alto", "identificada", 90),
  ];

  return {
    currentUser: "u-carlos",
    counters,
    tables: { profiles, clients, classifications: cls, forms, form_items, audit_plans, audits, audit_answers, findings, actions, customer_notifications: notifs, risks, opportunities, attachments: [] },
  };
}
