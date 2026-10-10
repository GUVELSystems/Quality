/* Datos de ejemplo para el MODO DEMO (relativos a la fecha actual) */
import { uuid, isoDate, addDays, today, addBusinessDays, shiftBusiness, DAY_MS, dueDateOf } from "./utils.js";

export function buildSeed() {
  const T = today();
  const counters = {};
  const code = (p) => { counters[p] = (counters[p] || 0) + 1; return `${p}-${String(counters[p]).padStart(4, "0")}`; };
  const iso = (d) => new Date(d).toISOString();
  const daysAgoISO = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const bd = (n) => { let d = T; for (let i = 0; i < n; i++) { d = addDays(d, -1); while ([0, 6].includes(new Date(d + "T12:00:00").getDay())) d = addDays(d, -1); } return d; }; // n días hábiles atrás

  /* Usuarios */
  const mk = (id, full_name, email, role, area) => ({ id, full_name, email, role, area, active: true, created_at: daysAgoISO(90) });
  const profiles = [
    mk("u-carlos", "Carlos Gutiérrez", "carlos.gutierrez@guvel.com", "admin", "Calidad"),
    mk("u-maria", "María López", "maria.lopez@guvel.com", "quality_manager", "Calidad"),
    mk("u-juan", "Juan Pérez", "juan.perez@guvel.com", "auditor", "Producción"),
    mk("u-pedro", "Pedro Ramírez", "pedro.ramirez@guvel.com", "auditor", "Calidad"),
    mk("u-ana", "Ana Torres", "ana.torres@guvel.com", "viewer", "Logística"),
  ];

  /* Clientes */
  const clients = [
    ["Automotriz Norte", "Laura Medina", "Planta Monterrey"], ["Componentes Delta", "Ricardo Salas", "Planta Saltillo"],
    ["Industrias Aurora", "Patricia Vega", "Planta Querétaro"], ["Grupo Metalmex", "Héctor Ríos", "Planta Apodaca"],
  ].map(([name, contact_name, plant]) => ({ id: uuid(), code: code("CLI"), name, contact_name, contact_email: contact_name.toLowerCase().replace(/ /g, ".").normalize("NFD").replace(/[\u0300-\u036f]/g, "") + "@cliente.com", plant, active: true, created_at: daysAgoISO(80) }));

  /* Catálogos (categorías, causas raíz, tipos de riesgo) */
  const cls = [];
  const addCls = (kind, names) => names.forEach((name) => cls.push({ id: uuid(), kind, name, description: null, active: true, created_at: daysAgoISO(80) }));
  addCls("categoria_hallazgo", ["Seguridad", "Calidad de producto", "Proceso", "Documentación", "Ambiental", "Mantenimiento"]);
  addCls("causa_raiz", ["Método", "Máquina", "Material", "Mano de obra", "Medición", "Medio ambiente"]);
  addCls("tipo_riesgo", ["Operativo", "Cliente", "Proveedor", "Seguridad", "Regulatorio"]);
  const catId = (n) => cls.find((c) => c.name === n)?.id;

  /* Niveles LPA, clasificaciones (días hábiles) y parámetros */
  const lpa_levels = [1, 2, 3, 4, 5].map((level) => ({ id: uuid(), level, name: `Nivel ${level}`, active: true, created_at: daysAgoISO(80) }));
  const NORMAL = ["LPA", "Producto", "Proceso", "Sistema", "Issues"];
  const finding_classes = [["N1", "Clasificación N1", 3, NORMAL], ["N2", "Clasificación N2", 6, NORMAL], ["N3", "Clasificación N3", 10, NORMAL], ["NCM", "No conformidad mayor", 5, ["Interna"]], ["NCm", "No conformidad menor", 10, ["Interna"]]]
    .map(([c, name, days, scopes]) => ({ id: uuid(), code: c, name, days, scopes, active: true, created_at: daysAgoISO(80) }));
  const klass = (c) => finding_classes.find((x) => x.code === c);
  const app_settings = [{ key: "verification_days", value: 5, updated_at: daysAgoISO(80) }];

  /* Áreas, dueños y responsables por nivel */
  const areaList = [["Calidad", "u-maria"], ["Producción", "u-juan"], ["Almacén", "u-pedro"], ["Logística", "u-ana"], ["Mantenimiento", "u-juan"], ["Ingeniería", "u-carlos"]];
  const areas = areaList.map(([name, owner_id]) => ({ id: uuid(), name, owner_id, active: true, created_at: daysAgoISO(80) }));
  const area = (n) => areas.find((a) => a.name === n);
  const area_level_owners = [];
  [["Calidad", 1, "u-juan"], ["Calidad", 2, "u-carlos"], ["Calidad", 3, "u-pedro"], ["Producción", 1, "u-juan"], ["Producción", 2, "u-maria"], ["Almacén", 2, "u-pedro"]]
    .forEach(([a, level, owner_id]) => area_level_owners.push({ id: uuid(), area_id: area(a).id, level, owner_id }));
  const ownerFor = (areaName, level) => area_level_owners.find((r) => r.area_id === area(areaName).id && r.level === level)?.owner_id || area(areaName).owner_id;

  /* Formatos: cada pregunta pertenece a un Área */
  const forms = [], form_items = [];
  const addForm = (c, name, audit_type, items) => {
    const f = { id: uuid(), code: c, name, audit_type, version: "1.0", active: true, created_at: daysAgoISO(80), updated_at: daysAgoISO(80) };
    forms.push(f);
    items.forEach(([areaName, question, critical], i) => form_items.push({ id: uuid(), form_id: f.id, position: i + 1, section: areaName, area_id: area(areaName).id, question, critical }));
    return f;
  };
  const fLPA = addForm("FOR-LPA-001", "Auditoría en capas (LPA) · Línea de producción", "LPA", [
    ["Producción", "¿La instrucción de trabajo vigente está disponible en la estación?", false],
    ["Producción", "¿El operador sigue la secuencia definida en la instrucción?", true],
    ["Calidad", "¿Los instrumentos de medición están calibrados y en buen estado?", true],
    ["Almacén", "¿El material está identificado y con trazabilidad?", false],
    ["Calidad", "¿El producto no conforme está segregado y etiquetado?", true],
    ["Producción", "¿El área cumple con el estándar 5S?", false],
  ]);
  const fPRO = addForm("FOR-PRO-001", "Auditoría de producto terminado", "Producto", [
    ["Calidad", "¿Las dimensiones críticas cumplen con el plano?", true], ["Calidad", "¿El aspecto visual cumple con el criterio de aceptación?", false],
    ["Logística", "¿El empaque e identificación cumplen con el requisito del cliente?", true], ["Calidad", "¿Los registros de inspección están completos y firmados?", false],
  ]);
  const fINT = addForm("FOR-INT-001", "Auditoría interna del sistema de gestión", "Interna", [
    ["Calidad", "¿La documentación del sistema de gestión está vigente y controlada?", false], ["Calidad", "¿Los registros requeridos se conservan y son legibles?", false],
    ["Producción", "¿El personal evidencia la competencia y capacitación requeridas?", true], ["Calidad", "¿Las acciones correctivas previas se cerraron con evidencia de eficacia?", true],
    ["Ingeniería", "¿Se da seguimiento a los objetivos e indicadores de calidad?", false],
  ]);
  addForm("FOR-PRC-001", "Auditoría de proceso", "Proceso", [
    ["Producción", "¿Los parámetros del proceso coinciden con la hoja de proceso?", true], ["Producción", "¿Se realizó la verificación de arranque (set-up)?", true],
    ["Calidad", "¿El plan de control está disponible y vigente?", false], ["Calidad", "¿Las reacciones ante desviaciones están documentadas?", false],
  ]);

  /* Hallazgos (con todos los campos del flujo) */
  const findings = [];
  const mkFinding = (o) => {
    const f = {
      id: uuid(), code: code("HAL"), module: "auditorias", title: "", description: null, source: "auditoria", severity: "menor", status: "abierto",
      classification_id: null, class_id: null, area: null, area_id: null, owner_id: null, audit_id: null, client_id: null, root_cause: null,
      start_date: T, due_date: null, closed_at: null, accepted_at: null, accepted_by: null, transfer_count: 0, transferred_from: null, transferred_at: null, transfer_reason: null,
      analysis_text: null, analysis_at: null, action_plan: null, actions_closed_on: null, actions_closed_at: null, verify_due: null, verify_due_at: null, due_at: null, reject_count: 0, rejected_at: null, rejection_reason: null, verified_at: null, verified_by: null, verified_on: null, verification_notes: null,
      created_by: "u-maria", created_at: daysAgoISO(2), updated_at: daysAgoISO(1), ...o,
    };
    if (isoDate(new Date(f.created_at)) !== f.start_date) f.created_at = new Date(f.start_date + "T09:00:00").toISOString();
    if (f.class_id && !o.due_date) { const due = shiftBusiness(new Date(f.created_at), finding_classes.find((c) => c.id === f.class_id).days * DAY_MS); f.due_at = due.toISOString(); f.due_date = dueDateOf(due); }
    if (f.area_id && !f.area) f.area = areas.find((a) => a.id === f.area_id).name;
    findings.push(f); return f;
  };
  // Etapas ya recorridas (para que cada hallazgo de ejemplo sea coherente)
  const stage = (f, name) => {
    const ag = (n) => daysAgoISO(n);
    if (["en_accion", "verificacion", "cerrado"].includes(name)) { f.accepted_at = ag(2); f.accepted_by = f.owner_id; }
    if (["verificacion", "cerrado"].includes(name)) f.action_plan ||= "Actualizar el documento, retirar copias obsoletas y capacitar al personal del turno.";
    f.status = name; return f;
  };
  const closeAt = (f, instant) => { f.actions_closed_at = instant.toISOString(); f.actions_closed_on = isoDate(instant); const v = shiftBusiness(instant, 5 * DAY_MS); f.verify_due_at = v.toISOString(); f.verify_due = dueDateOf(v); return f; };

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
  const audits = [], audit_answers = [];
  const auditors = ["u-juan", "u-maria", "u-carlos"];
  const addAudits = (plan, form, step, who, levelCycle) => {
    for (let k = 0, d = plan.start_date; d <= plan.end_date; k++, d = addDays(d, step)) {
      const past = d < addDays(T, -1);
      let status = "programada";
      if (past && k % 5 !== 3) status = "completada";
      if (d === T) status = "en_proceso";
      const level = levelCycle ? (k % 3) + 1 : null;
      const a = { id: uuid(), code: code("AUD"), plan_id: plan.id, scheduled_date: d, assigned_to: who[k % who.length], level, form_id: form.id, due_at: iso(d + "T17:00:00"), status, score: null, notes: null, completed_at: null, created_by: "u-maria", created_at: daysAgoISO(30), updated_at: daysAgoISO(1), notified_at: plan.status === "enviado" ? daysAgoISO(4) : null, notified_to: plan.status === "enviado" ? who[k % who.length] : null };
      if (status === "completada") {
        const items = form_items.filter((i) => i.form_id === form.id);
        let ok = 0, nok = 0;
        items.forEach((it, idx) => {
          const bad = (k + idx) % 7 === 0;
          const klassN = plan.audit_type === "Interna" ? (it.critical ? klass("NCM") : klass("NCm")) : (it.critical ? klass("N2") : klass("N3"));
          const ans = { id: uuid(), audit_id: a.id, item_id: it.id, result: bad ? "nok" : "ok", comment: bad ? "Se detectó desviación durante el recorrido." : null, class_id: bad ? klassN.id : null, finding_id: null, created_at: iso(d + "T11:00:00") };
          if (bad) {
            nok++;
            const areaName = areas.find((x) => x.id === it.area_id).name;
            const f = mkFinding({ title: it.question.replace(/[¿?]/g, "").replace(/^./, (c) => c.toUpperCase()).slice(0, 90) + " · NO CUMPLE", description: ans.comment, module: plan.audit_type === "Interna" ? "internas" : "auditorias", class_id: klassN.id, area_id: it.area_id, owner_id: ownerFor(areaName, level), audit_id: a.id, start_date: d, created_at: iso(d + "T11:00:00") });
            stage(f, k % 2 ? "en_accion" : "abierto");
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
  const sat = (() => { for (let d = audit_plans[0].start_date; d <= audit_plans[0].end_date; d = addDays(d, 1)) if (d > T && new Date(d + "T12:00:00").getDay() === 6) return d; return null; })();
  if (sat) audits.push({ id: uuid(), code: code("AUD"), plan_id: audit_plans[0].id, scheduled_date: sat, assigned_to: "u-juan", level: 2, form_id: fLPA.id, due_at: iso(sat + "T17:00:00"), status: "programada", score: null, notes: "Turno especial en sábado", completed_at: null, created_by: "u-maria", created_at: daysAgoISO(30), updated_at: daysAgoISO(1), notified_at: null, notified_to: null });

  /* Hallazgos de ejemplo en cada etapa del flujo */
  const [cNorte, cDelta, cAurora, cMetal] = clients;
  const A = (n) => area(n).id;
  mkFinding({ title: "Producto no conforme sin segregar en línea 2", description: "Se encontraron 14 piezas con rebaba en contenedor de producto bueno.", class_id: klass("N1").id, area_id: A("Calidad"), owner_id: "u-carlos", classification_id: catId("Calidad de producto"), start_date: bd(1), created_at: daysAgoISO(1) });
  stage(mkFinding({ title: "Instrucción de trabajo obsoleta en estación de ensamble 3", source: "proceso", class_id: klass("N2").id, area_id: A("Producción"), owner_id: "u-juan", classification_id: catId("Documentación"), start_date: bd(2), created_at: daysAgoISO(3) }), "en_accion");
  const calib = mkFinding({ title: "Calibrador vernier sin etiqueta de calibración vigente", source: "interno", class_id: klass("N2").id, area_id: A("Calidad"), owner_id: "u-maria", classification_id: catId("Mantenimiento"), start_date: bd(10), created_at: daysAgoISO(14) });
  stage(calib, "en_accion"); calib.action_plan = "Enviar el vernier a calibración externa y etiquetar con la nueva fecha.";
  const fuga = mkFinding({ title: "Fuga de aceite en prensa hidráulica P-07", source: "interno", class_id: klass("N3").id, area_id: A("Mantenimiento"), owner_id: "u-juan", classification_id: catId("Ambiental"), start_date: bd(8), created_at: daysAgoISO(11) });
  stage(fuga, "verificacion"); closeAt(fuga, new Date(bd(3) + "T15:00:00")); fuga.action_plan = "Reemplazar el sello del cilindro principal y verificar presión.";
  const reg = mkFinding({ title: "Registros de inspección sin firma de supervisor", class_id: klass("N2").id, area_id: A("Calidad"), owner_id: "u-maria", classification_id: catId("Documentación"), start_date: bd(20), created_at: daysAgoISO(28) });
  stage(reg, "cerrado"); closeAt(reg, new Date(addBusinessDays(reg.start_date, 4) + "T15:00:00")); reg.verified_at = shiftBusiness(new Date(reg.actions_closed_at), 3 * DAY_MS).toISOString(); reg.verified_on = isoDate(new Date(reg.verified_at)); reg.verified_by = "u-carlos"; reg.verification_notes = "Se revisó una muestra de 20 registros: todos firmados."; reg.closed_at = reg.verified_at;
  const eti = mkFinding({ title: "Etiquetas ilegibles en estación de empaque", class_id: klass("N1").id, area_id: A("Logística"), owner_id: "u-pedro", classification_id: catId("Calidad de producto"), start_date: bd(30), created_at: daysAgoISO(43) });
  stage(eti, "cerrado"); closeAt(eti, new Date(addBusinessDays(eti.start_date, 8) + "T15:00:00")); eti.verified_at = shiftBusiness(new Date(eti.actions_closed_at), 3 * DAY_MS).toISOString(); eti.verified_on = isoDate(new Date(eti.verified_at)); eti.verified_by = "u-carlos"; eti.verification_notes = "Cierre fuera de tiempo; acciones efectivas."; eti.closed_at = eti.verified_at;
  mkFinding({ title: "Falta de trazabilidad de lote en material de proveedor", source: "proveedor", class_id: klass("N1").id, area_id: A("Almacén"), owner_id: "u-carlos", classification_id: catId("Calidad de producto"), start_date: bd(7), created_at: daysAgoISO(10), transfer_count: 1, transferred_from: "u-pedro", transferred_at: daysAgoISO(8), transfer_reason: "El proveedor lo gestiona Calidad, no Almacén." });
  mkFinding({ title: "Delimitaciones 5S deterioradas en almacén", source: "interno", class_id: klass("N3").id, area_id: A("Almacén"), owner_id: "u-pedro", classification_id: catId("Ambiental"), start_date: bd(1), created_at: daysAgoISO(1) });
  mkFinding({ module: "internas", title: "Falta evidencia de competencia del personal de turno B", source: "auditoria", class_id: klass("NCM").id, area_id: A("Producción"), owner_id: "u-maria", start_date: bd(2), created_at: daysAgoISO(3) });

  // Rechazado en la verificación: se reabrió y su milestone de cierre CONTINÚA (le quedaba tiempo)
  const rech = mkFinding({ title: "Contenedor de producto no conforme sin identificación en línea 3", class_id: klass("N2").id, area_id: A("Calidad"), owner_id: "u-juan", start_date: bd(3), classification_id: catId("Calidad de producto") });
  stage(rech, "abierto"); rech.accepted_at = daysAgoISO(2); rech.accepted_by = "u-juan"; rech.action_plan = "Identificar el contenedor con etiqueta roja.";
  rech.reject_count = 1; rech.rejected_at = daysAgoISO(1); rech.rejection_reason = "La evidencia no muestra el contenedor identificado; adjunta una foto clara.";
  rech.due_at = new Date(Date.now() + (1 * 24 + 6) * 3600000).toISOString(); rech.due_date = dueDateOf(new Date(rech.due_at));
  const finding_events = [
    { id: uuid(), finding_id: rech.id, kind: "accepted", detail: null, actor: "u-juan", created_at: daysAgoISO(3, 11) },
    { id: uuid(), finding_id: rech.id, kind: "actions_closed", detail: "Cerradas a tiempo", actor: "u-juan", created_at: daysAgoISO(2, 16) },
    { id: uuid(), finding_id: rech.id, kind: "rejected", detail: rech.rejection_reason, actor: "u-carlos", created_at: daysAgoISO(1, 9) },
  ];

  /* Notificaciones de cliente (Issues) */
  const notifs = [];
  const mkNotif = (o) => notifs.push({ id: uuid(), code: code("NCL"), description: null, part_number: null, quantity: null, severity: "mayor", received_at: T, response_due: null, status: "recibida", owner_id: "u-maria", finding_id: null, closed_at: null, created_by: "u-maria", created_at: daysAgoISO(3), updated_at: daysAgoISO(1), ...o });
  mkNotif({ client_id: cNorte.id, notification_type: "queja", subject: "Rebaba excesiva en pieza AN-4471", description: "El cliente reporta rebaba fuera de tolerancia en 120 piezas del embarque semanal.", part_number: "AN-4471", quantity: 120, severity: "mayor", received_at: addDays(T, -3), response_due: addDays(T, 2), status: "contencion" });
  mkNotif({ client_id: cDelta.id, notification_type: "devolucion", subject: "Devolución por dimensión fuera de especificación", part_number: "CD-2208", quantity: 480, severity: "critico", received_at: addDays(T, -10), response_due: addDays(T, -2), status: "analisis", owner_id: "u-carlos" });
  mkNotif({ client_id: cAurora.id, notification_type: "scar", subject: "SCAR-2291 · Falta de identificación en empaque", part_number: "IA-9012", quantity: 60, severity: "menor", received_at: addDays(T, -20), response_due: addDays(T, -8), status: "respuesta_enviada" });
  mkNotif({ client_id: cMetal.id, notification_type: "alerta", subject: "Alerta de calidad por variación de dureza", part_number: "GM-3310", severity: "mayor", received_at: addDays(T, -1), response_due: addDays(T, 4), status: "recibida" });
  mkNotif({ client_id: cNorte.id, notification_type: "auditoria_cliente", subject: "Auditoría de segunda parte · Resultados", severity: "observacion", received_at: addDays(T, -45), response_due: addDays(T, -30), status: "cerrada", closed_at: daysAgoISO(30) });
  const linked = mkFinding({ module: "issues", title: "Etiqueta de embarque con número de parte incorrecto", source: "cliente", class_id: klass("N2").id, client_id: cAurora.id, area_id: A("Logística"), owner_id: "u-maria", classification_id: catId("Calidad de producto"), start_date: bd(4), created_at: daysAgoISO(6) });
  stage(linked, "en_accion"); notifs[2].finding_id = linked.id;
  const rebaba = mkFinding({ module: "issues", title: "[Queja] Rebaba excesiva en pieza AN-4471", description: "El cliente reporta rebaba fuera de tolerancia.", source: "cliente", class_id: klass("N1").id, client_id: cNorte.id, area_id: A("Producción"), owner_id: "u-maria", start_date: bd(2), created_at: daysAgoISO(3) });
  stage(rebaba, "en_accion"); rebaba.action_plan = "Selección 100% del inventario en planta y en tránsito; ajustar el herramental de desbarbado."; notifs[0].finding_id = rebaba.id;

  /* Bandeja del usuario (avisos guardados) */
  const mine1 = findings.find((f) => f.owner_id === "u-carlos" && f.status === "abierto");
  const notifications = [
    mine1 && { id: uuid(), user_id: "u-carlos", module: mine1.module, kind: "finding_assigned", title: `Se te asignó el hallazgo ${mine1.code}`, body: `${mine1.title}. Acéptalo o trasládalo y registra la acción para cerrarlo a tiempo.`, href: `${mine1.module}/hallazgos/${mine1.id}`, ref_id: mine1.id, created_at: daysAgoISO(0, 8), read_at: null },
    { id: uuid(), user_id: "u-carlos", module: "auditorias", kind: "finding_verify", title: `Hallazgo ${fuga.code} listo para verificar`, body: "El responsable cerró las acciones; acepta o rechaza la verificación.", href: `auditorias/hallazgos/${fuga.id}`, ref_id: fuga.id, created_at: daysAgoISO(0, 7), read_at: null },
    { id: uuid(), user_id: "u-juan", module: "auditorias", kind: "finding_rejected", title: `Verificación rechazada: ${rech.code}`, body: rech.rejection_reason, href: `auditorias/hallazgos/${rech.id}`, ref_id: rech.id, created_at: daysAgoISO(1, 9), read_at: null },
  ].filter(Boolean);

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
    tables: { profiles, clients, classifications: cls, forms, form_items, audit_plans, audits, audit_answers, findings, actions: [], customer_notifications: notifs, risks, opportunities, attachments: [], lpa_levels, finding_classes, areas, area_level_owners, app_settings, notifications, finding_events },
  };
}
