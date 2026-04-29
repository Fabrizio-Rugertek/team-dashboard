'use strict';
/**
 * SOP Encyclopedia Data — all process definitions for Torus.
 * Pre-computes card positions + SVG edge paths so views render with zero math.
 */

// ── Layout constants ──────────────────────────────────────────────────────────
const LANE_W = 120;
const COL_W  = 180;
const ROW_H  = 170;
const CARD_W = 148;
const CARD_H = 120;

function cardBounds(col, lane) {
  const padX = (COL_W - CARD_W) / 2;
  const padY = (ROW_H - CARD_H) / 2;
  const left = LANE_W + (col - 1) * COL_W + padX;
  const top  = lane * ROW_H + padY;
  return { left, top, right: left + CARD_W, bottom: top + CARD_H,
           cx: left + CARD_W / 2, cy: top + CARD_H / 2 };
}

function edgePath(from, to) {
  const x1 = from.bounds.right,  y1 = from.bounds.cy;
  const x2 = to.bounds.left,     y2 = to.bounds.cy;
  // Backward / loop edge — arc above the canvas
  if (x2 < x1 - 20) {
    const arcY = Math.min(from.bounds.top, to.bounds.top) - 72;
    return `M ${x1} ${y1} C ${x1+100} ${arcY} ${x2-100} ${arcY} ${x2} ${y2}`;
  }
  if (from.lane === to.lane) return `M ${x1} ${y1} L ${x2} ${y2}`;
  // Extended control points ensure horizontal entry/exit even for adjacent columns
  const hGap  = x2 - x1;
  const ctrl  = Math.max(Math.abs(hGap) * 0.45, 70);
  const cx1   = Math.round(x1 + ctrl);
  const cx2   = Math.round(x2 - ctrl);
  return `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`;
}

function buildCanvas(cols, lanes) {
  return {
    W: LANE_W + cols * COL_W,
    H: lanes * ROW_H,
    LANE_W, COL_W, ROW_H, CARD_W, CARD_H,
  };
}

function compileProcess({ steps: rawSteps, edges: rawEdges, lanes }) {
  const stepMap = {};
  const steps = rawSteps.map(s => {
    const b = cardBounds(s.col, s.lane);
    const lane = lanes[s.lane];
    const enriched = { ...s, bounds: b, laneColor: lane.color, laneBg: lane.bg };
    stepMap[s.id] = enriched;
    return enriched;
  });
  const cols  = Math.max(...rawSteps.map(s => s.col));
  const nLanes = lanes.length;
  const edges = rawEdges.map(e => ({
    ...e,
    id:   `ep-${e.from}-${e.to}`,
    path: edgePath(stepMap[e.from], stepMap[e.to]),
    dur:  e.type === 'handoff' ? '1.4s' : '1.8s',
  }));
  const canvas = buildCanvas(cols, nLanes);
  return { steps, edges, lanes, canvas };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANES shared across commercial processes
// ═══════════════════════════════════════════════════════════════════════════════
const LANES_VENTAS = [
  { id: 'hunter',  label: 'Hunter',  color: '#3B82F6', bg: '#EFF6FF', row: 0 },
  { id: 'closer',  label: 'Closer',  color: '#D97706', bg: '#FFFBEB', row: 1 },
  { id: 'pm',      label: 'PM',      color: '#8B5CF6', bg: '#F5F3FF', row: 2 },
  { id: 'support', label: 'Soporte', color: '#10B981', bg: '#ECFDF5', row: 3 },
];

const LANES_FACTURACION = [
  { id: 'admin',   label: 'Administración', color: '#EC4899', bg: '#FDF2F8', row: 0 },
  { id: 'cfo',     label: 'CFO / Contable', color: '#8B5CF6', bg: '#F5F3FF', row: 1 },
];

const LANES_IMPLEMENTACION = [
  { id: 'pm',        label: 'PM',             color: '#8B5CF6', bg: '#F5F3FF', row: 0 },
  { id: 'funcional', label: 'Funcional',      color: '#3B82F6', bg: '#EFF6FF', row: 1 },
  { id: 'tecnico',   label: 'Técnico',        color: '#EC4899', bg: '#FDF2F8', row: 2 },
];

const LANES_SOPORTE = [
  { id: 'client',  label: 'Cliente',         color: '#64748B', bg: '#F8FAFC', row: 0 },
  { id: 'support', label: 'Soporte Nivel 1', color: '#10B981', bg: '#ECFDF5', row: 1 },
  { id: 'pm',      label: 'PM / Nivel 2',    color: '#8B5CF6', bg: '#F5F3FF', row: 2 },
];

const LANES_DESARROLLO = [
  { id: 'pm',      label: 'PM / Funcional',  color: '#8B5CF6', bg: '#F5F3FF', row: 0 },
  { id: 'dev',     label: 'Desarrollador',   color: '#EC4899', bg: '#FDF2F8', row: 1 },
  { id: 'qa',      label: 'QA / Validación', color: '#10B981', bg: '#ECFDF5', row: 2 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: VENTAS TORUS — 10 pasos + handoff a Facturación + a Implementación
// ═══════════════════════════════════════════════════════════════════════════════
const VENTAS_STEPS = [
  {
    id: 's1', col: 1, lane: 0, label: 'Captación', sublabel: 'Lead entra al pipeline',
    time: '1-2 días', stage: 'New',
    description: 'El hunter identifica un prospecto y hace el primer contacto. El lead puede venir de referidos, LinkedIn, eventos o inbound.',
    substeps: [
      'Identificar prospecto en LinkedIn, referidos o eventos',
      'Registrar como lead en Odoo CRM (etapa: New)',
      'Completar datos básicos: empresa, rubro, tamaño, contacto clave',
      'Enviar mensaje de primer contacto personalizado',
    ],
    inputs:   ['Referidos', 'LinkedIn Sales Nav', 'Eventos', 'Inbound web'],
    outputs:  ['Lead registrado en Odoo', 'Primer contacto realizado'],
    tools:    ['Odoo CRM', 'LinkedIn', 'Email'],
    tips:     ['No pasar a calificación sin primer contacto exitoso', 'Registrar en Odoo inmediatamente para tracking limpio'],
    mistakes: ['Agregar leads sin datos mínimos (empresa + contacto)', 'Olvidar registrar la interacción en CRM'],
  },
  {
    id: 's2', col: 2, lane: 0, label: 'Pre-Calificación', sublabel: 'Validar fit básico',
    time: '1-3 días', stage: 'Pre-qualification',
    description: 'Verificar que el prospecto tiene potencial real. Confirmar interés, empresa válida y un "dolor" concreto que Odoo puede resolver.',
    substeps: [
      'Llamada de descubrimiento rápida (15-20 min)',
      'Validar: ¿tienen ERP? ¿cuántos usuarios? ¿sector?',
      'Confirmar que existe un dolor operativo claro',
      'Mover oportunidad a etapa Pre-qualification en Odoo',
    ],
    inputs:   ['Lead contactado', 'Datos básicos de empresa'],
    outputs:  ['Oportunidad válida o descartada', 'Notas de descubrimiento en Odoo'],
    tools:    ['Odoo CRM', 'Zoom / Google Meet'],
    tips:     ['Si no hay dolor claro, descartar rápido — no perder tiempo', 'Anotar situación actual del cliente (ERP, procesos)'],
    mistakes: ['Avanzar sin confirmar autoridad de decisión o presupuesto'],
  },
  {
    id: 's3', col: 3, lane: 0, label: 'Calificación', sublabel: 'BANT + reunión técnica',
    time: '3-7 días', stage: 'Qualification',
    description: 'Reunión formal para entender las necesidades. Aplicar BANT. El hunter puede involucrar al closer para facilitar el handoff.',
    substeps: [
      'Agendar reunión de calificación formal (45-60 min)',
      'Aplicar BANT: Budget, Authority, Need, Timeline',
      'Identificar módulos necesarios y volumen de usuarios',
      'Definir si necesita relevamiento previo o propuesta directa',
      'Involucrar al Closer — presentación informal',
    ],
    inputs:   ['Oportunidad pre-calificada', 'Notas de descubrimiento'],
    outputs:  ['BANT documentado', 'Brief para propuesta', 'Closer asignado'],
    tools:    ['Odoo CRM', 'Zoom', 'Formulario BANT'],
    tips:     ['El brief al Closer debe incluir contexto completo — nunca pasar en blanco', 'Confirmar quién toma la decisión final de compra'],
    mistakes: ['Saltar calificación por urgencia del cliente', 'No documentar el BANT en Odoo'],
    handoffs: [{ role: 'Closer', linkedStep: 's4', description: 'Traspaso de la oportunidad calificada al Closer para preparar propuesta' }],
  },
  {
    id: 's4', col: 4, lane: 1, label: 'Propuesta', sublabel: 'Cotización + documento de alcance',
    time: '3-7 días', stage: 'Proposition',
    description: 'El closer prepara y presenta la propuesta técnico-comercial con módulos Odoo, horas estimadas, precio total y condiciones de pago.',
    substeps: [
      'Recibir brief completo del hunter',
      'Definir modalidad: relevamiento previo vs. propuesta directa',
      'Armar cotización en Odoo Ventas (Sales Order)',
      'Preparar documento de alcance (funcionalidades, sin horas visibles)',
      'Presentar propuesta en reunión con el cliente',
    ],
    inputs:   ['Brief de calificación', 'BANT completado', 'Contexto del cliente'],
    outputs:  ['Cotización enviada en Odoo', 'Documento de alcance', 'Follow-up agendado'],
    tools:    ['Odoo Ventas', 'Google Docs', 'Zoom'],
    tips:     ['Siempre presentar en reunión — nunca solo por email', 'Incluir bolsa de horas para imprevistos (~10% del proyecto)', 'Precio siempre en PYG'],
    mistakes: ['Enviar propuesta sin reunión de presentación', 'Tener más de 2 cotizaciones activas por oportunidad'],
  },
  {
    id: 's5', col: 5, lane: 1, label: 'Negociación', sublabel: 'Objeciones y ajustes',
    time: '3-14 días', stage: 'Negotiation',
    description: 'El cliente evalúa la propuesta. El closer maneja objeciones, ajusta el alcance si es necesario, y gestiona el proceso de decisión interna.',
    substeps: [
      'Enviar propuesta y confirmar recepción del cliente',
      'Follow-up a los 2-3 días hábiles',
      'Reunión de feedback: escuchar y manejar objeciones',
      'Ajustar propuesta si corresponde (sin bajar precio sin reducir alcance)',
      'Definir próximos pasos con fecha concreta',
    ],
    inputs:   ['Propuesta enviada', 'Feedback del cliente'],
    outputs:  ['Propuesta ajustada o decisión de cierre', 'Decision timeline clara'],
    tools:    ['Odoo CRM', 'Email', 'Zoom'],
    tips:     ['Regla clave: no bajar precio sin reducir alcance equivalente', 'Siempre cerrar con un próximo paso concreto y con fecha', 'Si no hay decisión en 14 días → mover a On Hold'],
    mistakes: ['Hacer descuentos sin reducir scope', 'Dejar más de 3 días hábiles sin follow-up'],
  },
  {
    id: 's6', col: 6, lane: 1, label: 'Cierre / Won', sublabel: 'Handoff a PM + Admin',
    time: '1-2 días', stage: 'Won',
    description: 'El cliente aprueba. Se formaliza el cierre en Odoo CRM, se crea el proyecto vinculado, se cobra el anticipo y se hace el handoff simultáneo al PM (implementación) y a Administración (facturación).',
    substeps: [
      'Confirmar aprobación del cliente (verbal + escrito)',
      'Marcar oportunidad como Won en Odoo CRM',
      'Crear proyecto en Odoo vinculado con la OV',
      'Emitir y cobrar anticipo (25-50% según condiciones)',
      'Asignar PM y hacer reunión de handoff de implementación',
      'Notificar a Administración para configurar el ciclo de facturación',
      'Enviar email de bienvenida al cliente (incluir contactos de PM y Admin)',
    ],
    inputs:   ['Aprobación del cliente', 'OV aprobada o firmada'],
    outputs:  ['Oportunidad Won en Odoo', 'Proyecto creado y vinculado', 'Anticipo cobrado', 'PM asignado', 'Admin notificada'],
    tools:    ['Odoo CRM', 'Odoo Proyectos', 'Odoo Facturación'],
    tips:     ['NO cerrar sin OV vinculada al proyecto — es bloqueante', 'Admin debe recibir: modalidad de pago, cuotas, fechas, contacto de facturación del cliente'],
    mistakes: ['Cerrar sin cobrar anticipo', 'No notificar a Admin sobre condiciones de facturación', 'No hacer handoff formal documentado al PM'],
    handoffs: [
      { role: 'PM',             linkedStep: 's7',        description: 'Inicia el proceso de implementación con kick-off formal', linkedProcess: null },
      { role: 'Administración', linkedProcess: 'facturacion', description: 'Configura el ciclo de facturación mensual / por hitos según condiciones acordadas', linkedStep: null },
    ],
  },
  {
    id: 's7', col: 7, lane: 2, label: 'Kick-off', sublabel: 'Acta firmada + cronograma',
    time: '1 semana', stage: 'Fase 0-1',
    description: 'El PM organiza la reunión de kick-off con el cliente. Se firma el acta, se confirma el SPoC del cliente y se establece el cronograma real.',
    substeps: [
      'Recibir handoff del Closer (contexto + documentos)',
      'Preparar acta de kick-off y cronograma detallado',
      'Reunión de kick-off con Sponsor + SPoC del cliente',
      'Firmar acta de kick-off',
      'Configurar Odoo Proyectos: fases, tareas, equipo asignado',
      'Kick-off interno con el equipo de consultores',
    ],
    inputs:   ['Contexto del Closer', 'OV + documento de alcance', 'PM asignado'],
    outputs:  ['Acta kick-off firmada por Sponsor + SPoC', 'Proyecto configurado en Odoo', 'Cronograma de implementación'],
    tools:    ['Odoo Proyectos', 'Google Meet', 'Google Docs'],
    tips:     ['Identificar y confirmar el SPoC del cliente en esta reunión — es bloqueante si no existe', 'El cronograma debe tener fechas reales, no estimaciones genéricas'],
    mistakes: ['Empezar a implementar antes de tener acta firmada', 'No tener SPoC definido del lado del cliente'],
    handoffs: [{ role: 'Implementación', linkedProcess: 'implementacion', description: 'El proceso de implementación Odoo comienza formalmente con el kick-off aprobado' }],
  },
  {
    id: 's8', col: 8, lane: 2, label: 'Implementación', sublabel: 'Sprints + validaciones',
    time: '4-16 semanas', stage: 'Fases 2-4',
    description: 'El equipo ejecuta sprints de implementación por módulo. El PM trackea horas, riesgos y validaciones semanalmente.',
    substeps: [
      'Sprints semanales: análisis → configuración → validación',
      'Capacitación por módulo al equipo del cliente',
      'Validación funcional con SPoC al terminar cada sprint',
      'Registro de horas en Odoo diariamente (obligatorio)',
      'Alerta interna al 80% del presupuesto consumido',
      'UAT (User Acceptance Testing) con usuarios clave del cliente',
    ],
    inputs:   ['Acta kick-off firmada', 'Alcance definido', 'Equipo técnico asignado'],
    outputs:  ['Módulos configurados y validados', 'Usuarios capacitados', 'Acta UAT firmada'],
    tools:    ['Odoo Proyectos', 'Odoo (staging)', 'Zoom', 'Git (si hay desarrollo)'],
    tips:     ['Regla 48hs: cualquier riesgo que no puedes resolver en 48h → Risk Log en Odoo', 'NO pasar a producción sin acta UAT firmada por el cliente'],
    mistakes: ['No registrar horas diariamente', 'Dejar todas las validaciones para el final', 'Superar presupuesto sin alertar al cliente'],
    handoffs: [{ role: 'Desarrollo', linkedProcess: 'desarrollo', description: 'Si hay customizaciones, el PM crea tickets de desarrollo que siguen el pipeline técnico' }],
  },
  {
    id: 's9', col: 9, lane: 2, label: 'Go-Live', sublabel: 'Cut-over + 30 días estabilización',
    time: '2-4 semanas', stage: 'Fases 5-7',
    description: 'Migración final, activación en producción y período de estabilización intensiva de 30 días. Cierre formal del proyecto y handoff a soporte.',
    substeps: [
      'Migración de datos final validada por cliente',
      'Cut-over: activar Odoo en producción para el cliente',
      'Firma de acta de Go-Live',
      '30 días de estabilización: soporte activo e intensivo',
      'Handoff formal documentado al equipo de soporte',
      'Firma de acta de cierre del proyecto',
    ],
    inputs:   ['Acta UAT firmada', 'Datos migrados y validados', 'Equipo del cliente capacitado'],
    outputs:  ['Odoo en producción', 'Acta go-live firmada', 'Acta de cierre del proyecto', 'Handoff a soporte'],
    tools:    ['Odoo (producción)', 'Scripts de migración', 'Google Docs'],
    tips:     ['Go-live siempre lunes o martes para tener equipo disponible toda la semana', 'Estabilización es soporte activo — no esperar que el cliente llame'],
    mistakes: ['Go-live viernes o víspera de feriado', 'No tener plan de rollback documentado', 'Sin acta de cierre del proyecto'],
    handoffs: [{ role: 'Soporte', linkedStep: 's10', description: 'El cliente pasa oficialmente a régimen de soporte post-venta', linkedProcess: 'soporte' }],
  },
  {
    id: 's10', col: 10, lane: 3, label: 'Soporte Post-venta', sublabel: 'MAINT o HOURS activo',
    time: 'Ongoing', stage: 'Post Go-Live',
    description: 'El equipo de soporte atiende tickets según SLA, gestiona la evolución del sistema e identifica oportunidades de expansión con el cliente.',
    substeps: [
      'Activar contrato MAINT o bolsa HOURS según acuerdo',
      'Configurar canales de atención (email, WhatsApp, helpdesk)',
      'SLA activo: Crítico 1h / Alto 4h / Moderado 24h / Bajo 48h',
      'Revisión mensual proactiva de salud del cliente',
      'Identificar y documentar oportunidades de upsell o expansión',
      'Reportes periódicos de consumo y estado al cliente',
    ],
    inputs:   ['Acta de cierre del proyecto', 'Sistema en producción', 'Contrato de soporte vigente'],
    outputs:  ['Tickets resueltos dentro de SLA', 'Cliente fidelizado', 'Expansión del contrato'],
    tools:    ['Odoo Helpdesk', 'Odoo Proyectos', 'Email', 'WhatsApp'],
    tips:     ['No esperar que el cliente llame — revisión proactiva mensual es clave', 'Cada mejora implementada es una oportunidad de documentar y proponer más'],
    mistakes: ['Soporte únicamente reactivo', 'No documentar bugs o mejoras recurrentes'],
    handoffs: [{ role: 'Soporte', linkedProcess: 'soporte', description: 'Ir al proceso detallado de gestión de soporte y tickets' }],
  },
];

const VENTAS_EDGES = [
  { from: 's1',  to: 's2',  type: 'normal'   },
  { from: 's2',  to: 's3',  type: 'normal'   },
  { from: 's3',  to: 's4',  type: 'handoff'  },  // Hunter → Closer
  { from: 's4',  to: 's5',  type: 'normal'   },
  { from: 's5',  to: 's6',  type: 'normal'   },
  { from: 's6',  to: 's7',  type: 'handoff'  },  // Closer → PM (implementación)
  { from: 's7',  to: 's8',  type: 'normal'   },
  { from: 's8',  to: 's9',  type: 'normal'   },
  { from: 's9',  to: 's10', type: 'handoff'  },  // PM → Soporte (post go-live)
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: FACTURACIÓN Y COBROS — 7 pasos
// ═══════════════════════════════════════════════════════════════════════════════
const FACTURACION_STEPS = [
  {
    id: 'f1', col: 1, lane: 0, label: 'Configuración', sublabel: 'Recibir condiciones del Closer',
    time: '1 día', stage: 'Setup',
    description: 'Admin recibe el brief de cierre del Closer con todas las condiciones de pago acordadas y configura el ciclo de facturación en Odoo.',
    substeps: [
      'Recibir brief de cierre: modalidad, cuotas, fechas, contacto de facturación del cliente',
      'Validar que la OV en Odoo refleja exactamente las condiciones acordadas',
      'Confirmar contacto de facturación del cliente (nombre, email, RUC)',
      'Configurar las líneas de facturación en Odoo según el plan de pagos',
    ],
    inputs:   ['Brief de cierre del Closer', 'OV confirmada en Odoo', 'Condiciones de pago acordadas'],
    outputs:  ['Ciclo de facturación configurado', 'Contacto de facturación confirmado'],
    tools:    ['Odoo Facturación', 'Odoo Ventas'],
    tips:     ['Nunca asumir condiciones — siempre confirmar por escrito con el Closer', 'Si la OV no coincide con lo acordado, corregir antes de facturar'],
    mistakes: ['Facturar sin validar la OV', 'No confirmar RUC del cliente para SIFEN'],
  },
  {
    id: 'f2', col: 2, lane: 0, label: 'Anticipo', sublabel: 'Primera factura',
    time: '1-2 días', stage: 'Facturación',
    description: 'Emitir y enviar la factura de anticipo al cliente. El proyecto no puede comenzar hasta que el anticipo esté confirmado.',
    substeps: [
      'Crear factura de anticipo en Odoo (25-50% del total)',
      'Enviar factura al contacto de facturación del cliente',
      'Registrar en Odoo como "Enviada"',
      'Hacer seguimiento hasta confirmación de pago',
      'Al cobrar: registrar pago en Odoo y notificar al PM para que inicie el proyecto',
    ],
    inputs:   ['OV confirmada', 'Contacto de facturación del cliente'],
    outputs:  ['Factura de anticipo enviada', 'Pago registrado en Odoo', 'PM notificado para comenzar'],
    tools:    ['Odoo Facturación', 'SIFEN', 'Email'],
    tips:     ['PM no debe comenzar el proyecto hasta que el anticipo esté cobrado', 'El timbrado SIFEN debe estar configurado antes de emitir la primera factura'],
    mistakes: ['Permitir que el proyecto empiece sin anticipo cobrado', 'No registrar el pago en Odoo inmediatamente'],
  },
  {
    id: 'f3', col: 3, lane: 0, label: 'Plan de Cuotas', sublabel: 'Calendario de cobros',
    time: '1 día', stage: 'Planificación',
    description: 'Crear y documentar el calendario de facturación completo según las condiciones acordadas. Incluir fechas de vencimiento y alertas.',
    substeps: [
      'Definir fechas exactas de cada cuota según el contrato',
      'Crear las facturas futuras en Odoo (o agendar recordatorios)',
      'Registrar en el calendario de Administration las fechas de cobro',
      'Comunicar el calendario al cliente (confirmar que están de acuerdo)',
    ],
    inputs:   ['Condiciones de pago acordadas', 'Anticipo cobrado'],
    outputs:  ['Calendario de facturación documentado', 'Cliente confirma el plan'],
    tools:    ['Odoo Facturación', 'Google Calendar'],
    tips:     ['Siempre documentar el calendario — evitar sorpresas al cliente', 'Para proyectos por hitos: coordinar con PM cuándo se alcanza cada hito'],
    mistakes: ['Facturar cuotas sin calendario definido', 'No alinear hitos de facturación con avance real del proyecto'],
  },
  {
    id: 'f4', col: 4, lane: 0, label: 'Facturación Recurrente', sublabel: 'Por hito o mensual',
    time: 'Según plan', stage: 'Ejecución',
    description: 'Emitir facturas según el plan acordado: por hitos de avance del proyecto o mensualmente. Siempre coordinar con PM antes de facturar por hito.',
    substeps: [
      'Confirmar con PM que el hito fue completado y validado por el cliente',
      'Emitir factura en Odoo y enviar al cliente',
      'Registrar como Enviada en Odoo',
      'Seguimiento de pago: primer recordatorio a los 5 días hábiles',
      'Segundo recordatorio a los 10 días hábiles (escalar a CFO si no hay respuesta)',
    ],
    inputs:   ['Confirmación del PM de hito completado', 'Plan de facturación'],
    outputs:  ['Factura emitida y enviada', 'Cobro registrado en Odoo'],
    tools:    ['Odoo Facturación', 'SIFEN', 'Email'],
    tips:     ['Nunca facturar un hito sin confirmar con el PM que fue validado por el cliente', 'Llevar control de vencimientos en el CXC semanalmente'],
    mistakes: ['Facturar hito antes de que el cliente lo valide', 'Olvidar hacer seguimiento de facturas vencidas'],
  },
  {
    id: 'f5', col: 5, lane: 0, label: 'Cobro y Conciliación', sublabel: 'Registrar pagos',
    time: 'Según vencimiento', stage: 'Cobro',
    description: 'Registrar cada pago recibido en Odoo y conciliar con las facturas emitidas. Mantener el CXC actualizado.',
    substeps: [
      'Confirmar recepción del pago (banco / transferencia)',
      'Registrar pago en Odoo contra la factura correspondiente',
      'Emitir recibo si el cliente lo solicita',
      'Actualizar estado del proyecto: hito pagado → siguiente hito desbloqueado',
      'Reportar al CFO cualquier pago parcial o discrepancia',
    ],
    inputs:   ['Comprobante de pago del cliente', 'Factura emitida en Odoo'],
    outputs:  ['Pago registrado en Odoo', 'CXC actualizado', 'Hito desbloqueado'],
    tools:    ['Odoo Facturación', 'Online Banking', 'Odoo CXC'],
    tips:     ['Registrar el pago en Odoo el mismo día que se recibe', 'Nunca aplicar un pago a la factura incorrecta'],
    mistakes: ['Registrar pagos con días de demora', 'Confundir pagos de distintos clientes'],
  },
  {
    id: 'f6', col: 6, lane: 1, label: 'Revisión CFO', sublabel: 'Control de revenue',
    time: 'Mensual', stage: 'Control',
    description: 'El CFO revisa mensualmente el estado del CXC, la conciliación de pagos y el revenue reconocido vs. facturado.',
    substeps: [
      'Revisar CXC: facturas pendientes por antigüedad (0-30, 31-60, 60+ días)',
      'Validar que todos los pagos recibidos están correctamente registrados',
      'Revisar revenue reconocido del mes vs. proyectado',
      'Escalar cuentas vencidas >30 días al Closer responsable',
      'Aprobar el cierre contable del mes',
    ],
    inputs:   ['CXC del mes', 'Pagos registrados por Admin', 'Revenue proyectado'],
    outputs:  ['Informe mensual de CXC', 'Cuentas vencidas gestionadas', 'Cierre contable aprobado'],
    tools:    ['Odoo Contabilidad', 'Dashboard Finanzas'],
    tips:     ['CXC vencido >30% del total es señal de alerta — revisar política de cobros', 'Coordinar con Closer para casos de morosidad — el Closer tiene la relación con el cliente'],
    mistakes: ['Esperar al fin de mes para revisar CXC', 'No escalar cuentas vencidas oportunamente'],
  },
  {
    id: 'f7', col: 7, lane: 1, label: 'Cierre Contable', sublabel: 'Reporting mensual',
    time: '1-2 días', stage: 'Cierre',
    description: 'Cerrar el período contable en Odoo, generar reportes de revenue y preparar información para el dashboard ejecutivo.',
    substeps: [
      'Verificar que todas las facturas del mes están emitidas y registradas',
      'Conciliar cuentas bancarias con Odoo',
      'Generar reporte de EERR (Estado de Resultados) del mes',
      'Actualizar dashboard de finanzas con datos del mes',
      'Compartir summary ejecutivo con CEO/COO',
    ],
    inputs:   ['Todos los pagos del mes registrados', 'CXC conciliado', 'Aprobación CFO'],
    outputs:  ['EERR del mes', 'Dashboard actualizado', 'Summary ejecutivo enviado'],
    tools:    ['Odoo Contabilidad', 'Dashboard Finanzas', 'Google Sheets'],
    tips:     ['El cierre debe hacerse en los primeros 3 días hábiles del mes siguiente', 'Guardar una copia del EERR mensual en Google Drive'],
    mistakes: ['Cerrar el mes sin verificar todas las facturas', 'No comunicar el resultado mensual al equipo directivo'],
  },
];

const FACTURACION_EDGES = [
  { from: 'f1', to: 'f2', type: 'normal'  },
  { from: 'f2', to: 'f3', type: 'normal'  },
  { from: 'f3', to: 'f4', type: 'normal'  },
  { from: 'f4', to: 'f5', type: 'normal'  },
  { from: 'f5', to: 'f6', type: 'handoff' },
  { from: 'f6', to: 'f7', type: 'normal'  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: IMPLEMENTACIÓN ODOO — 8 pasos
// ═══════════════════════════════════════════════════════════════════════════════
const IMPLEMENTACION_STEPS = [
  {
    id: 'i1', col: 1, lane: 0, label: 'Análisis', sublabel: 'Relevamiento de procesos',
    time: '1-2 semanas', stage: 'Fase 1',
    description: 'El PM y el consultor funcional realizan el relevamiento detallado de los procesos del cliente para mapear con las funcionalidades de Odoo.',
    substeps: [
      'Reunión de análisis con el SPoC y usuarios clave del cliente',
      'Documentar procesos AS-IS (cómo trabajan hoy)',
      'Mapear procesos TO-BE (cómo trabajarán con Odoo)',
      'Identificar GAPs y requerimientos de customización',
      'Firmar acta de análisis con el cliente',
    ],
    inputs:   ['Acta de kick-off', 'Documento de alcance', 'Acceso al sistema actual del cliente'],
    outputs:  ['Documento AS-IS / TO-BE', 'Lista de GAPs', 'Acta de análisis firmada'],
    tools:    ['Odoo (demo)', 'Google Docs', 'Zoom'],
    tips:     ['Involucrar a usuarios operativos, no solo al SPoC', 'Fotografiar o copiar formularios actuales del cliente'],
    mistakes: ['Asumir procesos sin entrevistar a los usuarios', 'No documentar los GAPs — son la base para los tickets de desarrollo'],
    handoffs: [{ role: 'Técnico', linkedProcess: 'desarrollo', description: 'Los GAPs identificados generan tickets de desarrollo customizado' }],
  },
  {
    id: 'i2', col: 2, lane: 1, label: 'Configuración Base', sublabel: 'CORE + LOC',
    time: '3-5 días', stage: 'Fase 2a',
    description: 'El consultor funcional configura los módulos base de Odoo: empresa, usuarios, localización Paraguay, cuentas contables y parámetros generales.',
    substeps: [
      'Crear empresa en Odoo (nombre, RUC, logo, dirección)',
      'Configurar localización Paraguay (SIFEN, impuestos, moneda)',
      'Crear usuarios y asignar permisos',
      'Configurar plan de cuentas contables',
      'Configurar métodos de pago y bancos',
    ],
    inputs:   ['Acta de análisis', 'Datos legales del cliente (RUC, razón social)', 'Lista de usuarios'],
    outputs:  ['Empresa configurada en Odoo', 'Usuarios con acceso', 'Base contable lista'],
    tools:    ['Odoo (staging)', 'SIFEN (timbrado)'],
    tips:     ['Hacer esto en staging primero — nunca configurar directo en producción', 'Validar el timbrado SIFEN antes de avanzar con módulos'],
    mistakes: ['Configurar en producción antes de validar en staging', 'Usuarios con permisos incorrectos'],
  },
  {
    id: 'i3', col: 3, lane: 1, label: 'Módulos Funcionales', sublabel: 'SALES, SCM, HR, etc.',
    time: '2-8 semanas', stage: 'Fase 2b',
    description: 'Configuración de los módulos funcionales del alcance: ventas, compras, inventario, RRHH, proyectos, web, etc. Un sprint por módulo.',
    substeps: [
      'Sprint por módulo: configurar → demo al cliente → ajustar → validar',
      'Cargar catálogos de productos, clientes, proveedores',
      'Configurar flujos de aprobación si aplica',
      'Configurar reportes y vistas personalizadas',
      'Firmar acta de validación al cerrar cada módulo',
    ],
    inputs:   ['Base configurada', 'Documento TO-BE por módulo', 'Catálogos del cliente'],
    outputs:  ['Módulos configurados y validados', 'Actas de validación por módulo'],
    tools:    ['Odoo (staging)', 'Zoom', 'Google Docs'],
    tips:     ['Nunca pasar al siguiente módulo sin acta firmada del anterior', 'Los ajustes post-validación deben tener orden de cambio documentada'],
    mistakes: ['Validar todo junto al final', 'Hacer ajustes sin orden de cambio'],
  },
  {
    id: 'i4', col: 4, lane: 2, label: 'Desarrollo Custom', sublabel: 'Tickets técnicos',
    time: 'Según alcance', stage: 'Fase 2c',
    description: 'El equipo técnico implementa las customizaciones identificadas en el análisis. Sigue el pipeline técnico estándar: DEV → DEPLOY staging → TEST → FIX → DEPLOY producción.',
    substeps: [
      'PM crea tickets de desarrollo en Odoo (tipo: BUG / MEJORA / DEV)',
      'Desarrollador implementa según especificación',
      'Deploy en staging para validación',
      'Consultor funcional valida con el cliente',
      'Si OK: deploy en producción. Si hay ajustes: ciclo FIX',
    ],
    inputs:   ['Lista de GAPs del análisis', 'Especificaciones técnicas', 'Staging configurado'],
    outputs:  ['Customizaciones implementadas y validadas', 'Módulo custom en staging'],
    tools:    ['Odoo (staging)', 'Git', 'GitHub', 'Odoo Proyectos'],
    tips:     ['Pipeline técnico estándar: DEV → DEPLOY stg → TEST → FIX → DEPLOY prod', 'Toda customización debe tener especificación antes de que el desarrollador empiece'],
    mistakes: ['Desarrollar sin especificación clara', 'Hacer deploy en producción sin validación funcional'],
    handoffs: [{ role: 'Funcional', linkedStep: 'i3', description: 'Una vez validadas las customizaciones, volver a validar integración con módulos funcionales' }],
  },
  {
    id: 'i5', col: 5, lane: 0, label: 'Capacitación', sublabel: 'Usuarios entrenados',
    time: '1-2 semanas', stage: 'Fase 3',
    description: 'Capacitación formal por módulo a los usuarios del cliente. El PM coordina el plan de capacitación con el SPoC.',
    substeps: [
      'Coordinar plan de capacitación con SPoC (fechas, grupos, módulos)',
      'Capacitación por módulo: demo → práctica supervisada → ejercicios',
      'Material de capacitación entregado (guía rápida por módulo)',
      'Firma de acta de capacitación por módulo',
      'Identificar usuarios "champions" que servirán de referentes internos',
    ],
    inputs:   ['Módulos configurados y validados', 'Plan de capacitación', 'Material de capacitación'],
    outputs:  ['Usuarios capacitados por módulo', 'Actas de capacitación firmadas', 'Champions identificados'],
    tools:    ['Odoo (staging)', 'Zoom / presencial', 'Google Docs'],
    tips:     ['Capacitar en grupos pequeños (max 8 personas) por módulo', 'Identificar usuarios "power users" que puedan ayudar a sus compañeros'],
    mistakes: ['Capacitación masiva de todos los módulos en una sola sesión', 'No dejar material escrito al cliente'],
  },
  {
    id: 'i6', col: 6, lane: 0, label: 'UAT', sublabel: 'Pruebas de aceptación',
    time: '1-2 semanas', stage: 'Fase 4',
    description: 'Los usuarios clave del cliente prueban el sistema con datos reales. El equipo de Torus acompaña y registra incidencias para corregir antes del go-live.',
    substeps: [
      'Preparar plan de pruebas UAT con el SPoC (casos de prueba)',
      'Usuarios clave ejecutan pruebas con datos reales en staging',
      'Equipo Torus registra incidencias encontradas',
      'Priorizar y corregir incidencias (Críticas → antes de go-live)',
      'Cliente firma acta UAT cuando todas las críticas están resueltas',
    ],
    inputs:   ['Sistema configurado con customizaciones', 'Usuarios capacitados', 'Plan de pruebas'],
    outputs:  ['Acta UAT firmada por el cliente', 'Incidencias críticas resueltas'],
    tools:    ['Odoo (staging)', 'Odoo Proyectos (tickets)', 'Zoom'],
    tips:     ['UAT debe durar al menos una semana completa de trabajo real', 'No pasar a go-live sin acta UAT firmada — es el principal bloqueante'],
    mistakes: ['Hacer UAT en producción', 'Pasar a go-live sin acta firmada'],
  },
  {
    id: 'i7', col: 7, lane: 1, label: 'Migración de Datos', sublabel: 'Datos históricos',
    time: '3-7 días', stage: 'Fase 5a',
    description: 'Migración de datos históricos del sistema anterior al Odoo del cliente. El funcional valida calidad de datos, el técnico ejecuta los scripts.',
    substeps: [
      'Cliente entrega datos a migrar (clientes, proveedores, saldos, inventario)',
      'Validar calidad y formato de los datos (limpieza)',
      'Desarrollar y probar scripts de migración en staging',
      'Ejecutar migración en staging y validar con cliente',
      'Cliente aprueba la migración con firma',
    ],
    inputs:   ['Acta UAT firmada', 'Datos del cliente en formato acordado'],
    outputs:  ['Datos migrados y validados en staging', 'Migración aprobada por cliente'],
    tools:    ['Python / scripts', 'Odoo (staging)', 'Excel'],
    tips:     ['Nunca migrar sin que el cliente revise y apruebe los datos migrados', 'Guardar los scripts de migración en el repositorio del proyecto'],
    mistakes: ['Migrar datos sin limpieza previa', 'No tener validación del cliente antes de migrar a producción'],
  },
  {
    id: 'i8', col: 8, lane: 0, label: 'Go-Live', sublabel: 'Cut-over a producción',
    time: '1-3 días', stage: 'Fase 5b',
    description: 'Activación del sistema en producción. El PM coordina el cut-over con el equipo y el cliente para minimizar interrupción operativa.',
    substeps: [
      'Confirmar que staging está congelado y en el estado final',
      'Ejecutar migración de datos a producción',
      'Activar usuarios en producción y comunicar al equipo del cliente',
      'PM disponible durante las primeras 48 horas para soporte inmediato',
      'Firma de acta de Go-Live',
      'Activar período de estabilización (30 días soporte activo)',
    ],
    inputs:   ['Staging congelado y aprobado', 'Datos migrados a producción', 'Equipo disponible'],
    outputs:  ['Odoo en producción activo', 'Acta de Go-Live firmada', 'Período de estabilización iniciado'],
    tools:    ['Odoo (producción)', 'Slack / WhatsApp (comunicación de emergencia)'],
    tips:     ['Go-live siempre lunes o martes para tener equipo full disponible', 'Tener plan de rollback documentado por si hay que volver al sistema anterior'],
    mistakes: ['Go-live viernes', 'No tener plan de rollback', 'PM no disponible las primeras 48 horas'],
  },
];

const IMPLEMENTACION_EDGES = [
  { from: 'i1', to: 'i2', type: 'handoff' },
  { from: 'i2', to: 'i3', type: 'normal'  },
  { from: 'i1', to: 'i4', type: 'parallel' }, // Técnico inicia DEV custom al mismo tiempo que Funcional configura base
  { from: 'i3', to: 'i5', type: 'normal'  },
  { from: 'i4', to: 'i5', type: 'handoff' },
  { from: 'i5', to: 'i6', type: 'normal'  },
  { from: 'i6', to: 'i7', type: 'handoff' },
  { from: 'i7', to: 'i8', type: 'normal'  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: SOPORTE Y MANTENIMIENTO — 6 pasos
// ═══════════════════════════════════════════════════════════════════════════════
const SOPORTE_STEPS = [
  {
    id: 'sp1', col: 1, lane: 0, label: 'Solicitud', sublabel: 'Cliente reporta incidencia',
    time: '< 1h', stage: 'Entrada',
    description: 'El cliente reporta una incidencia, pregunta o mejora a través del canal acordado. El primer nivel registra y clasifica.',
    substeps: [
      'Cliente envía solicitud por el canal acordado (email, WhatsApp, helpdesk)',
      'Nivel 1 recibe y registra ticket en Odoo Helpdesk',
      'Clasificar: BUG / CONSULTA / MEJORA / CONFIGURACIÓN',
      'Asignar severidad: Crítico / Alto / Moderado / Bajo',
      'Confirmar recepción al cliente con número de ticket',
    ],
    inputs:   ['Reporte del cliente (email/WhatsApp/helpdesk)', 'Contexto del error o consulta'],
    outputs:  ['Ticket creado en Odoo Helpdesk', 'Severidad asignada', 'Cliente notificado'],
    tools:    ['Odoo Helpdesk', 'Email', 'WhatsApp'],
    tips:     ['Confirmar recepción siempre en menos de 30 minutos hábiles', 'Pedir captura de pantalla o video si el cliente puede proveerlo'],
    mistakes: ['Dejar tickets sin clasificar', 'No confirmar recepción al cliente'],
  },
  {
    id: 'sp2', col: 2, lane: 1, label: 'Diagnóstico', sublabel: 'Nivel 1 analiza',
    time: 'Según SLA', stage: 'Análisis',
    description: 'El consultor de Nivel 1 analiza la incidencia. Si puede resolverla, lo hace. Si no, escala al Nivel 2.',
    substeps: [
      'Reproducir el error en staging si es posible',
      'Revisar si es un error de configuración, de uso, o un bug real',
      'Si es consulta de uso: responder directamente al cliente',
      'Si es configuración: corregir y confirmar al cliente',
      'Si es bug o desarrollo: escalar al Nivel 2 / PM',
    ],
    inputs:   ['Ticket clasificado', 'Acceso al sistema del cliente (si aplica)'],
    outputs:  ['Incidencia resuelta (si es Nivel 1)', 'Ticket escalado con diagnóstico (si no)'],
    tools:    ['Odoo (producción cliente)', 'Odoo Helpdesk', 'Zoom'],
    tips:     ['Si se puede resolver en <30 min, resolver ahora y documentar', 'Documentar el diagnóstico aunque se escale — el Nivel 2 no debe re-hacer el análisis'],
    mistakes: ['Escalar sin diagnóstico documentado', 'Resolver sin documentar la solución'],
  },
  {
    id: 'sp3', col: 3, lane: 2, label: 'Escalamiento N2', sublabel: 'PM / Técnico analiza',
    time: 'Según SLA', stage: 'Escalamiento',
    description: 'El PM o consultor senior recibe el escalamiento y determina si es un bug, una mejora, o requiere desarrollo. Coordina la solución.',
    substeps: [
      'Revisar diagnóstico del Nivel 1',
      'Determinar causa raíz (bug de Odoo, bug de customización, mala configuración)',
      'Si es bug de customización: crear ticket de desarrollo',
      'Si es mejora: evaluar si está en el alcance del contrato o requiere cotización',
      'Comunicar al cliente: causa, solución propuesta y ETA',
    ],
    inputs:   ['Ticket escalado con diagnóstico', 'Acceso completo al sistema'],
    outputs:  ['Plan de resolución', 'Ticket de desarrollo creado (si aplica)', 'ETA comunicado al cliente'],
    tools:    ['Odoo Proyectos', 'Git', 'Zoom', 'Odoo Helpdesk'],
    tips:     ['Comunicar ETA al cliente aunque no tengas la solución todavía — la incertidumbre es peor', 'Si la mejora requiere horas adicionales → cotizar antes de hacer'],
    mistakes: ['Hacer mejoras sin validar si están en el contrato', 'No comunicar ETA al cliente'],
    handoffs: [{ role: 'Desarrollo', linkedProcess: 'desarrollo', description: 'Si se detecta un bug de customización, se crea un ticket en el pipeline técnico' }],
  },
  {
    id: 'sp4', col: 4, lane: 2, label: 'Resolución', sublabel: 'Corrección + testing',
    time: 'Según SLA', stage: 'Resolución',
    description: 'Se implementa la corrección y se valida en staging antes de aplicar en producción del cliente.',
    substeps: [
      'Implementar corrección o configuración en staging',
      'Probar que la corrección resuelve el problema',
      'Validar que no rompió nada más (regression testing básico)',
      'Aplicar corrección en producción del cliente',
      'Verificar con el cliente que el problema fue resuelto',
    ],
    inputs:   ['Plan de resolución', 'Acceso a staging + producción'],
    outputs:  ['Corrección aplicada en producción', 'Cliente confirma resolución'],
    tools:    ['Odoo (staging y producción)', 'Git'],
    tips:     ['Siempre testear en staging primero — nunca corregir directo en producción', 'Pedir al cliente que confirme que está OK antes de cerrar el ticket'],
    mistakes: ['Corregir directo en producción sin staging', 'Cerrar el ticket sin confirmación del cliente'],
  },
  {
    id: 'sp5', col: 5, lane: 1, label: 'Cierre de Ticket', sublabel: 'Documentar y cerrar',
    time: '< 1h', stage: 'Cierre',
    description: 'El Nivel 1 documenta la solución, cierra el ticket en Odoo y actualiza la base de conocimiento si aplica.',
    substeps: [
      'Registrar la solución implementada en el ticket',
      'Actualizar la base de conocimiento si es un error recurrente',
      'Marcar ticket como Resuelto y enviar encuesta de satisfacción',
      'Informar al cliente el cierre con resumen de la solución',
    ],
    inputs:   ['Resolución confirmada por el cliente'],
    outputs:  ['Ticket cerrado en Odoo', 'Conocimiento documentado', 'Encuesta enviada'],
    tools:    ['Odoo Helpdesk', 'Email'],
    tips:     ['Si el mismo error ocurre 3 veces → proponer mejora estructural al PM', 'Documentar casos recurrentes reduce tiempo de resolución futura'],
    mistakes: ['Cerrar el ticket sin documentar la solución', 'No enviar confirmación al cliente'],
  },
  {
    id: 'sp6', col: 6, lane: 2, label: 'Revisión Mensual', sublabel: 'Health check proactivo',
    time: '1h / mes', stage: 'Proactivo',
    description: 'El PM hace una revisión mensual proactiva con el cliente para revisar el estado general, identificar mejoras y detectar oportunidades de expansión.',
    substeps: [
      'Preparar informe de tickets del mes (cantidad, severidad, tiempos)',
      'Reunión de health check con el SPoC del cliente',
      'Revisar uso del sistema: módulos subutilizados, errores frecuentes',
      'Proponer mejoras o nuevos módulos si corresponde',
      'Confirmar que el cliente está satisfecho con el soporte',
    ],
    inputs:   ['Resumen de tickets del mes', 'Historial del cliente en Odoo'],
    outputs:  ['Informe mensual entregado', 'Nuevas oportunidades identificadas', 'Relación fortalecida'],
    tools:    ['Odoo Helpdesk', 'Dashboard Equipo', 'Zoom'],
    tips:     ['No esperar que el cliente tenga problemas — el health check previene insatisfacción', 'Cada revisión mensual es una oportunidad de venta — llevar propuestas concretas'],
    mistakes: ['No hacer la revisión mensual por "falta de tiempo"', 'Revisión solo reactiva a tickets'],
  },
];

const SOPORTE_EDGES = [
  { from: 'sp1', to: 'sp2', type: 'normal'  },
  { from: 'sp2', to: 'sp3', type: 'handoff' },
  { from: 'sp3', to: 'sp4', type: 'normal'  },
  { from: 'sp4', to: 'sp5', type: 'handoff' },
  { from: 'sp5', to: 'sp6', type: 'normal'  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: DESARROLLO A MEDIDA — 5 pasos (pipeline técnico estándar)
// ═══════════════════════════════════════════════════════════════════════════════
const DESARROLLO_STEPS = [
  {
    id: 'd1', col: 1, lane: 0, label: 'Especificación', sublabel: 'Ticket + requerimiento',
    time: '1-2 días', stage: 'DEF',
    description: 'El PM o consultor funcional documenta el requerimiento técnico completo. Sin especificación aprobada, el desarrollador no comienza.',
    substeps: [
      'Crear ticket en Odoo Proyectos (tipo: BUG / MEJORA / DEV)',
      'Documentar: qué se necesita, por qué, qué debe hacer exactamente',
      'Incluir mockups, ejemplos o capturas si aplica',
      'Definir criterios de aceptación (cómo se sabe que está listo)',
      'Revisar y aprobar la especificación con el PM y el cliente',
    ],
    inputs:   ['Necesidad del cliente o bug identificado', 'Contexto del proceso'],
    outputs:  ['Ticket creado en Odoo', 'Especificación aprobada', 'Criterios de aceptación definidos'],
    tools:    ['Odoo Proyectos', 'Google Docs', 'Figma (si hay UI)'],
    tips:     ['El desarrollador tiene derecho a rechazar un ticket sin especificación clara', 'Criterios de aceptación claros = menos ciclos de revisión'],
    mistakes: ['Dar instrucciones verbales sin documentar', 'Especificación ambigua que el dev interpreta a su criterio'],
  },
  {
    id: 'd2', col: 2, lane: 1, label: 'Desarrollo', sublabel: 'Implementación técnica',
    time: 'Según estimación', stage: 'DEV',
    description: 'El desarrollador implementa la funcionalidad siguiendo los estándares de Odoo y las buenas prácticas del equipo. Hace commits frecuentes.',
    substeps: [
      'Crear branch de feature en Git',
      'Implementar siguiendo la especificación',
      'Probar localmente (unit test si aplica)',
      'Hacer commits descriptivos con referencia al ticket',
      'Abrir Pull Request para code review',
    ],
    inputs:   ['Especificación aprobada', 'Acceso al repositorio', 'Ambiente de desarrollo local'],
    outputs:  ['Código implementado en branch', 'PR abierta para review'],
    tools:    ['VS Code / PyCharm', 'Git / GitHub', 'Odoo (local)'],
    tips:     ['Commits pequeños y frecuentes — facilitan el review y el rollback', 'Si hay duda sobre la especificación, preguntar al PM antes de implementar'],
    mistakes: ['Trabajar en main/master directamente', 'Commits sin descripción', 'Implementar sin revisar la especificación completa'],
  },
  {
    id: 'd3', col: 3, lane: 1, label: 'Deploy Staging', sublabel: 'Ambiente de pruebas',
    time: '< 1 día', stage: 'DEPLOY stg',
    description: 'Deploy del desarrollo en el ambiente de staging del cliente para validación funcional.',
    substeps: [
      'Merge de PR aprobada a branch staging',
      'Deploy en Odoo staging del cliente',
      'Verificar que el módulo carga sin errores',
      'Documentar en el ticket: versión deployed, pasos para probar',
      'Notificar al consultor funcional para que inicie la validación',
    ],
    inputs:   ['PR aprobada', 'Acceso al staging del cliente'],
    outputs:  ['Código en staging', 'Consultor funcional notificado para validar'],
    tools:    ['Git / GitHub', 'Odoo (staging)', 'Odoo Proyectos (ticket)'],
    tips:     ['Siempre verificar que el módulo instala correctamente antes de notificar', 'Incluir instrucciones de prueba en el ticket'],
    mistakes: ['Deploy sin verificar instalación', 'No notificar al funcional para validar'],
  },
  {
    id: 'd4', col: 4, lane: 2, label: 'Validación', sublabel: 'QA + cliente',
    time: '1-3 días', stage: 'TEST',
    description: 'El consultor funcional valida que el desarrollo cumple exactamente los criterios de aceptación. Si hay ajustes, el ciclo vuelve al desarrollo.',
    substeps: [
      'Consultor funcional prueba el desarrollo con los criterios de aceptación',
      'Si hay bugs o ajustes: documentar en el ticket y regresar a DEV',
      'Si está OK: presentar al cliente para validación final',
      'Cliente aprueba el desarrollo',
      'Consultor firma off en el ticket: "Validado — listo para producción"',
    ],
    inputs:   ['Desarrollo en staging', 'Criterios de aceptación', 'Especificación original'],
    outputs:  ['Desarrollo validado por funcional y cliente', 'Sign-off en el ticket'],
    tools:    ['Odoo (staging)', 'Zoom (demo al cliente)', 'Odoo Proyectos'],
    tips:     ['Validar contra los criterios de aceptación, no contra lo que "parece correcto"', 'Si el cliente pide cambios nuevos durante la validación → nuevo ticket, no ampliar este'],
    mistakes: ['Validar sin criterios formales', 'Aceptar scope creep durante la validación'],
    handoffs: [{ role: 'Desarrollador', linkedStep: 'd2', description: 'Si hay ajustes, regresa al desarrollo con los comentarios específicos documentados' }],
  },
  {
    id: 'd5', col: 5, lane: 1, label: 'Deploy Producción', sublabel: 'Release final',
    time: '< 1 día', stage: 'DEPLOY prod',
    description: 'Deploy del desarrollo validado en el sistema productivo del cliente. Se verifica el funcionamiento y se cierra el ticket.',
    substeps: [
      'Merge de staging a main/production branch',
      'Deploy en Odoo producción del cliente',
      'Verificar funcionamiento en producción',
      'Notificar al cliente que la funcionalidad está disponible',
      'Cerrar el ticket en Odoo Proyectos',
    ],
    inputs:   ['Sign-off de validación', 'Acceso a producción del cliente'],
    outputs:  ['Funcionalidad en producción', 'Ticket cerrado', 'Cliente notificado'],
    tools:    ['Git / GitHub', 'Odoo (producción)', 'Email'],
    tips:     ['Deploy preferentemente en horario de baja actividad del cliente', 'Mantener el tag de la versión en Git para poder hacer rollback'],
    mistakes: ['Deploy en horario pico del cliente', 'No notificar al cliente que el feature está disponible'],
  },
];

const DESARROLLO_EDGES = [
  { from: 'd1', to: 'd2', type: 'handoff' },
  { from: 'd2', to: 'd3', type: 'normal'  },
  { from: 'd3', to: 'd4', type: 'handoff' },
  { from: 'd4', to: 'd5', type: 'normal'  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: SCRUM — Ciclo de Sprint
// ═══════════════════════════════════════════════════════════════════════════════
const LANES_SCRUM = [
  { id: 'sm',  label: 'Scrum Master / PM',      color: '#8B5CF6', bg: '#F5F3FF', row: 0 },
  { id: 'dev', label: 'Dev Team / Consultores',  color: '#3B82F6', bg: '#EFF6FF', row: 1 },
  { id: 'po',  label: 'Product Owner / Cliente', color: '#10B981', bg: '#ECFDF5', row: 2 },
];

const SCRUM_STEPS = [
  {
    id: 'sc1', col: 1, lane: 0, label: 'Refinamiento', sublabel: 'Backlog grooming pre-sprint',
    time: '1-2h / semana', stage: 'Pre-Sprint',
    description: 'El PM/Scrum Master trabaja con el Product Owner para preparar el backlog del próximo sprint. Se priorizan historias, se estiman story points y se definen criterios de aceptación antes de la planning.',
    substeps: [
      'Revisar el backlog en Odoo: historias sin story points o criterios incompletos',
      'Reunión de refinamiento: SM + PO + (opcionally) Dev Team (max 1-2h)',
      'Asignar story points usando escala Fibonacci: 1, 2, 3, 5, 8, 13',
      'Definir criterios de aceptación (Definition of Done) para cada historia',
      'Priorizar el backlog: las más importantes arriba, listas para la planning',
      'Identificar dependencias entre historias y bloqueos potenciales',
    ],
    inputs:   ['Backlog de Odoo sin refinar', 'Roadmap del producto', 'Feedback de sprints anteriores'],
    outputs:  ['Backlog priorizado y refinado', 'Story points asignados', 'Criterios de aceptación definidos'],
    tools:    ['Odoo Proyectos (Sprint Board)', 'Google Meet', 'Tablero físico o digital'],
    tips:     ['Refinar solo el backlog de las próximas 2-3 semanas — no más', 'Si una historia tarda más de 5 minutos en estimarse, dividirla en historias más pequeñas', 'La Definition of Done del equipo aplica a TODAS las historias'],
    mistakes: ['Refinar y estimar en la misma reunión que la Planning (congela el equipo)', 'Historias sin criterios de aceptación claros entran al sprint — siempre resulta en retrabajo'],
  },
  {
    id: 'sc2', col: 2, lane: 0, label: 'Sprint Planning', sublabel: 'Goal + commitment del equipo',
    time: '1-2h', stage: 'Inicio Sprint',
    description: 'El equipo selecciona las historias del backlog que puede completar en el sprint, define el sprint goal y se compromete. La capacidad del equipo es la guía — no las expectativas externas.',
    substeps: [
      'SM facilita: calcular capacity del equipo (días disponibles × horas/día)',
      'PO presenta las historias prioritarias del backlog refinado',
      'Dev team selecciona historias que caben en la capacity (sin sobrecargarse)',
      'Definir el Sprint Goal: una frase que resume el objetivo del sprint',
      'Crear las tareas de Odoo dentro de cada historia si no están creadas',
      'Confirmar asignación de responsables por historia o tarea',
    ],
    inputs:   ['Backlog refinado y priorizado', 'Capacity del equipo calculada', 'Sprint goal propuesto por PO'],
    outputs:  ['Sprint backlog comprometido', 'Sprint goal definido', 'Sprint creado en Odoo', 'Equipo alineado'],
    tools:    ['Odoo (Sprint Board)', 'Google Meet'],
    tips:     ['Capacity real = días hábiles × horas/día × 0.7 (descuenta reuniones, imprevistos)', 'El Sprint Goal debe ser alcanzable incluso si no se completan todas las historias', 'El Dev Team no acepta presión externa para sobrecargarse — el SM protege esto'],
    mistakes: ['Aceptar más historias de las que caben en la capacity por presión del PO/cliente', 'Sprint sin Sprint Goal claro — el equipo pierde el foco', 'Planning de más de 2 horas — señal de backlog sin refinar'],
  },
  {
    id: 'sc3', col: 3, lane: 1, label: 'Daily Standup', sublabel: '15 min, 3 preguntas',
    time: '15 min / día', stage: 'Durante Sprint',
    description: 'Reunión diaria del Dev Team para sincronizar avances e identificar bloqueos. El SM facilita, el PO puede escuchar pero no participar activamente. Foco en el Sprint Goal, no en reportar al jefe.',
    substeps: [
      'Misma hora y lugar cada día (ej: 9:15am, 15 min exactos)',
      'Cada miembro responde 3 preguntas: ¿Qué hice ayer? ¿Qué haré hoy? ¿Tengo bloqueos?',
      'SM anota bloqueos y se compromete a resolverlos después del standup',
      'Actualizar el sprint board en Odoo (mover tareas entre columnas)',
      'Si el sprint está en riesgo: SM avisa al PO inmediatamente después del daily',
    ],
    inputs:   ['Sprint board actualizado', 'Estado del Sprint Goal'],
    outputs:  ['Bloqueos identificados y en gestión', 'Sprint board actualizado', 'Equipo sincronizado'],
    tools:    ['Odoo Sprint Board', 'Google Meet (si remoto)', 'Tablero físico (si presencial)'],
    tips:     ['Daily es para el Dev Team, no para el SM ni el PO — ellos escuchan', 'Si una discusión técnica surge, cortarla: "Lo seguimos después del daily"', 'Registrar horas en Odoo diariamente — no esperar al viernes'],
    mistakes: ['Daily convertido en reunión de estado/reporte al manager', 'Más de 15 minutos — señal de que se está resolviendo en vez de solo identificar', 'No actualizar el sprint board — pierde sentido la ceremonia'],
  },
  {
    id: 'sc4', col: 4, lane: 1, label: 'Ejecución', sublabel: 'Work in progress',
    time: '1-2 semanas', stage: 'Durante Sprint',
    description: 'El Dev Team trabaja en las historias comprometidas. El SM remueve bloqueos activamente. El equipo no acepta trabajo nuevo a mitad de sprint sin el consentimiento del SM y evaluación de impacto.',
    substeps: [
      'Dev Team trabaja en las historias: una a la vez, sin multitasking entre historias',
      'Registrar horas en Odoo diariamente por tarea (obligatorio)',
      'WIP limit: máximo 2-3 tareas en "In Progress" por persona',
      'SM monitorea el burndown: ¿el equipo va a completar el Sprint Goal?',
      'Bloqueos escalan inmediatamente al SM — nunca esperar el daily',
      'Si hay scope creep (PO quiere agregar cosas): SM evalúa impacto y puede rechazar',
    ],
    inputs:   ['Sprint backlog comprometido', 'Capacity disponible del equipo'],
    outputs:  ['Historias completadas (Definition of Done cumplida)', 'Horas registradas en Odoo', 'Burndown actualizado'],
    tools:    ['Odoo Proyectos (Sprint Board)', 'Git / GitHub', 'VS Code'],
    tips:     ['Una historia está "hecha" cuando cumple la Definition of Done — no antes', 'Alerta 48hs: cualquier bloqueo que no puedas resolver en 48h → SM lo gestiona', 'No empezar nuevas historias si hay bloqueadas — resolver primero los bloqueos'],
    mistakes: ['Marcar historias como "Done" sin cumplir la DoD', 'Aceptar trabajo nuevo a mitad del sprint sin análisis de impacto', 'Dejar los bloqueos para el daily en lugar de escalar inmediatamente'],
    handoffs: [{ role: 'Desarrollo', linkedProcess: 'desarrollo', description: 'Las tareas técnicas dentro del sprint siguen el pipeline estándar: IMPLEMENTAR → DEPLOY stg → TEST → FIX → DEPLOY prod' }],
  },
  {
    id: 'sc5', col: 5, lane: 2, label: 'Sprint Review', sublabel: 'Demo + validación del PO',
    time: '1h', stage: 'Fin Sprint',
    description: 'El Dev Team demuestra el trabajo completado al Product Owner y stakeholders. El PO acepta o rechaza cada historia según los criterios de aceptación. No es una reunión de status — es una demo real del incremento.',
    substeps: [
      'Dev Team prepara demo del incremento (en producción o staging según acuerdo)',
      'SM facilita: presenta el Sprint Goal y si se alcanzó',
      'Dev Team demuestra cada historia completada con datos reales',
      'PO acepta o rechaza cada historia (sin términos medios)',
      'Historias rechazadas vuelven al backlog con feedback claro',
      'PO actualiza el backlog según lo aprendido en la review',
    ],
    inputs:   ['Incremento completado (historias que cumplen DoD)', 'Sprint Goal', 'Criterios de aceptación'],
    outputs:  ['Historias aceptadas / rechazadas', 'Feedback del PO incorporado al backlog', 'Velocity del sprint calculada'],
    tools:    ['Odoo (producción/staging)', 'Google Meet', 'Odoo Sprint Board'],
    tips:     ['Solo demostrar funcionalidades TERMINADAS — nunca demostrar trabajo en progreso', 'La review no es para ajustar expectativas — es para validar el incremento real', 'Calcular velocity del sprint: SP completados y aceptados (no los rechazados)'],
    mistakes: ['Demostrar work in progress o funcionalidades no terminadas', 'PO ausente en la review — sin validación no hay ciclo cerrado', 'Mezclar la review con la retrospectiva — son ceremonias distintas'],
  },
  {
    id: 'sc6', col: 6, lane: 0, label: 'Retrospectiva', sublabel: 'Mejora continua · ↺ vuelve a Refinamiento',
    time: '1h', stage: 'Fin Sprint',
    description: 'El Dev Team y SM reflexionan sobre el proceso del sprint para identificar mejoras concretas. Es una reunión del equipo — confidencial, sin presencia del PO ni management externo. Los action items se implementan en el próximo sprint.',
    substeps: [
      'SM facilita en ambiente seguro — lo que se dice en retro queda en retro',
      'Formato: Start / Stop / Continue (o Keep / Drop / Add)',
      'Cada persona comparte 1-2 puntos por categoría',
      'El equipo vota las mejoras más importantes',
      'Seleccionar 1-3 action items concretos y asignar responsable',
      'Action items entran como tareas al próximo sprint (no son opcionales)',
    ],
    inputs:   ['Sprint completado y revisado', 'Métricas del sprint (velocity, bloqueos, burndown)'],
    outputs:  ['Action items concretos para el próximo sprint', 'Proceso mejorado', 'Equipo más cohesionado'],
    tools:    ['Google Meet', 'FunRetro / Miro (opcional)', 'Odoo (para action items)'],
    tips:     ['La retro es del equipo y para el equipo — no una sesión de quejas al management', 'Máximo 3 action items por sprint — más es ruido que no se implementa', 'Revisar al inicio de la próxima retro si los action items se cumplieron'],
    mistakes: ['No hacer retro por "falta de tiempo" — es la ceremonia más importante para mejorar', 'Action items sin responsable ni fecha — no se implementan', 'Management presente en la retro — el equipo no habla con honestidad'],
  },
];

const SCRUM_EDGES = [
  { from: 'sc1', to: 'sc2', type: 'normal'   },
  { from: 'sc2', to: 'sc3', type: 'handoff'  },  // SM → Dev Team: sprint kicked off
  { from: 'sc3', to: 'sc4', type: 'parallel' },  // Daily runs every day DURING execution
  { from: 'sc4', to: 'sc5', type: 'handoff'  },  // Dev delivers increment → PO reviews
  { from: 'sc5', to: 'sc6', type: 'handoff'  },  // PO done → SM leads retro
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESO: GESTIÓN DE TAREAS EN ODOO — 6 pasos
// ═══════════════════════════════════════════════════════════════════════════════
const LANES_TAREAS = [
  { id: 'pm',     label: 'PM / Responsable',    color: '#8B5CF6', bg: '#F5F3FF', row: 0 },
  { id: 'consul', label: 'Consultor / Dev',      color: '#3B82F6', bg: '#EFF6FF', row: 1 },
  { id: 'qa',     label: 'QA / Validador',       color: '#10B981', bg: '#ECFDF5', row: 2 },
];

const TAREAS_STEPS = [
  {
    id: 'ta1', col: 1, lane: 0, label: 'Crear Tarea', sublabel: 'Campos obligatorios en Odoo',
    time: '5-10 min', stage: 'Creación',
    description: 'El PM o consultor crea la tarea en Odoo con todos los campos requeridos antes de comenzar a trabajar. Una tarea sin campos completos no puede comenzar. La calidad de la creación determina la calidad del trabajo.',
    substeps: [
      'Acceder al proyecto correcto en Odoo → Proyectos',
      'Crear tarea con nombre descriptivo: VERBO + QUÉ + para QUIÉN/PROYECTO (sin prefijos DEV/CONS — eso va en tags)',
      'Etiquetar con 2 tags: rol (cons o dev) + tipo (bug, mejora, feature, deploy, relevamiento, config, capacitacion, soporte, test)',
      'Completar campos obligatorios: Proyecto, Asignado, Horas planificadas',
      'Establecer Prioridad: Normal / Alta / Muy Alta (Muy Alta = sistema bloqueado)',
      'Agregar descripción: contexto, qué se necesita exactamente, links relevantes',
      'Para tareas técnicas (tag dev + feature/mejora): crear subtareas estándar (IMPLEMENTAR → DEPLOY stg → TEST → DEPLOY prod)',
    ],
    inputs:   ['Necesidad identificada (bug, mejora, solicitud de cliente)', 'Proyecto existente en Odoo'],
    outputs:  ['Tarea creada con todos los campos completos', 'Subtareas creadas si es técnica'],
    tools:    ['Odoo Proyectos', 'Google Docs (especificación si aplica)'],
    tips:     ['Nombre de tarea: "Configurar módulo de inventario para Motor Haus" — claro y accionable', 'Si la tarea va a tomar más de 8h, dividirla en subtareas o en varias tareas', 'Las tareas técnicas (tag dev + feature) siempre necesitan las 5 subtareas del pipeline'],
    mistakes: ['Tareas sin horas estimadas — imposible medir avance', 'Descripción vacía o "ver con Fulano" — no es accionable', 'Tags no asignadas (rol o tipo) — imposible categorizar el trabajo del equipo', 'Prefijos DEV/CONS en el nombre — eso va en tags ahora'],
  },
  {
    id: 'ta2', col: 2, lane: 0, label: 'Especificar', sublabel: 'Criterios de aceptación claros',
    time: '15-30 min', stage: 'Definición',
    description: 'Antes de asignar, el PM valida que la tarea tenga todo lo necesario para que quien la reciba pueda ejecutarla sin preguntas adicionales. El desarrollador/consultor tiene derecho a rechazar una tarea sin especificación.',
    substeps: [
      'Revisar: ¿La descripción responde a QUÉ, POR QUÉ y CÓMO se valida?',
      'Definir criterios de aceptación: "Listo cuando X hace Y y el resultado es Z"',
      'Agregar mockups, capturas de pantalla o ejemplos si aplica',
      'Para bugs: incluir pasos para reproducir + comportamiento esperado vs actual',
      'Para tareas con tag dev: incluir especificación técnica antes de que el desarrollador comience',
      'Estimar con el consultor si las horas planificadas son realistas',
    ],
    inputs:   ['Tarea creada', 'Contexto del cliente o proyecto'],
    outputs:  ['Especificación completa en la descripción', 'Criterios de aceptación definidos', 'Horas validadas'],
    tools:    ['Odoo Proyectos', 'Figma (si hay UI)', 'Loom (si necesita explicación en video)'],
    tips:     ['Una tarea bien especificada tarda 5 min en especificar y 0 min en preguntar durante la ejecución', 'El consultor que va a ejecutar puede y debe pedir clarificaciones antes de empezar', 'Criterios de aceptación concretos = menos ciclos de revisión'],
    mistakes: ['Pasar tarea a "En Proceso" sin criterios de aceptación', 'Especificación técnica verbal sin documentar — siempre se pierde información', 'Aceptar "lo mismo que antes" como especificación'],
  },
  {
    id: 'ta3', col: 3, lane: 1, label: 'Ejecutar', sublabel: 'Horas diarias + avance',
    time: 'Según estimación', stage: 'Ejecución',
    description: 'El consultor o desarrollador ejecuta la tarea. Registra horas diariamente en Odoo. Actualiza el estado y las notas de progreso. Si surge un bloqueo que no puede resolver en 48h, aplica el protocolo de alerta.',
    substeps: [
      'Mover la tarea a etapa "En Proceso" en Odoo',
      'Trabajar siguiendo la especificación — si hay dudas, preguntar ANTES de implementar',
      'Registrar horas en Odoo al final de cada día (no al final de la semana)',
      'Actualizar la descripción con notas de progreso si es una tarea larga',
      'Para tareas técnicas: seguir el pipeline IMPLEMENTAR → DEPLOY stg → TEST → FIX → DEPLOY prod',
      'Alerta 48hs: si hay bloqueo que no se puede resolver → notificar al PM inmediatamente',
    ],
    inputs:   ['Tarea especificada y asignada', 'Acceso a los sistemas necesarios'],
    outputs:  ['Avance documentado en Odoo', 'Horas registradas diariamente', 'Tarea completada según criterios'],
    tools:    ['Odoo Proyectos', 'Git / GitHub (si tiene tag dev)', 'Odoo (staging/producción)'],
    tips:     ['Regla de oro: horas del día = registradas hoy, nunca mañana', 'Si vas a exceder las horas estimadas en más del 20%, avisar al PM antes de continuar', 'Una tarea "En Proceso" no debe quedarse ahí más de X días sin actualización (X = estimación)'],
    mistakes: ['Registrar horas en lote al final de la semana — pierde trazabilidad', 'Superar el 100% de las horas estimadas sin avisar al PM', 'Cambiar el alcance de la tarea durante la ejecución sin actualizar la especificación'],
  },
  {
    id: 'ta4', col: 4, lane: 1, label: 'Alerta 48hs', sublabel: '⚠ Solo si hay bloqueo',
    time: '< 48h de detectado', stage: 'Escalamiento',
    description: 'Si una situación no puede resolverse por decisión propia del consultor en menos de 48 horas, se registra en el Risk Log de Odoo y se notifica al PM. No esperar a que sea crisis. Es un protocolo de protección, no de penalización.',
    substeps: [
      'Identificar: ¿El bloqueo puede resolverse solo en menos de 48h? → Si no, escalar',
      'Registrar alerta en Odoo: módulo project_alert o nota interna en la tarea',
      'Categorizar: Riesgo futuro / Problema activo / Cambio de alcance / Bloqueo/Dependencia',
      'Notificar al PM con: descripción del bloqueo, impacto en entrega, opciones propuestas',
      'PM responde con plan de acción: resolver, escalar, posponer, o cambiar alcance',
      'Comunicar al cliente si el bloqueo impacta la fecha de entrega (PM decide el mensaje)',
    ],
    inputs:   ['Bloqueo identificado en la ejecución', 'Tarea en riesgo de no cumplir deadline'],
    outputs:  ['Alerta registrada en Odoo', 'PM notificado', 'Plan de resolución acordado'],
    tools:    ['Odoo (Risk Log / project_alert)', 'WhatsApp / Google Chat (notificación urgente)'],
    tips:     ['La alerta es un protocolo de equipo — no es un fracaso personal', 'Mejor avisar 1 día antes que pedir disculpas 1 semana después', 'Si el bloqueo es del cliente (no entrega información, no valida), documentarlo siempre'],
    mistakes: ['Esperar a que el bloqueo sea crisis para escalar', 'Resolver el bloqueo solo tomando decisiones fuera de alcance', 'No documentar el bloqueo en Odoo — queda sin trazabilidad'],
  },
  {
    id: 'ta5', col: 5, lane: 2, label: 'Validar', sublabel: 'QA funcional o cliente',
    time: '1-4h', stage: 'Validación',
    description: 'El QA funcional (consultor senior o PM) valida que la tarea cumple los criterios de aceptación antes de presentarla al cliente. Si el cliente valida directamente, el consultor acompaña la sesión.',
    substeps: [
      'QA revisa la tarea contra los criterios de aceptación definidos al inicio',
      'Probar en staging con datos reales si es posible',
      'Si hay ajustes: documentarlos en el ticket y regresar a Ejecutar (no cerrar el ciclo)',
      'Si está OK: presentar al cliente o al PM para validación final',
      'El cliente o PM firma off en el ticket: "Validado — OK para cerrar"',
      'Para tareas técnicas: validar en producción tras deploy final',
    ],
    inputs:   ['Tarea ejecutada', 'Criterios de aceptación originales', 'Acceso a staging/producción'],
    outputs:  ['Tarea validada con sign-off', 'Ajustes documentados (si los hay)', 'Listo para cierre'],
    tools:    ['Odoo (staging/producción)', 'Odoo Proyectos (ticket)', 'Zoom (demo al cliente)'],
    tips:     ['Validar siempre contra los criterios de aceptación del inicio — no contra lo que "parece bien"', 'Si el cliente pide cambios durante la validación → nuevo ticket, no ampliar este', 'Regresión básica: verificar que la tarea no rompió nada más'],
    mistakes: ['Dar por validado sin que el cliente o PM firme off explícitamente', 'Aceptar scope creep durante la validación', 'Validar en producción sin haber probado en staging'],
  },
  {
    id: 'ta6', col: 6, lane: 0, label: 'Cerrar Tarea', sublabel: 'Campos de cierre en Odoo',
    time: '5-10 min', stage: 'Cierre',
    description: 'El PM o el consultor responsable cierra formalmente la tarea en Odoo completando todos los campos de cierre. Una tarea cerrada sin los campos completos no es válida para el registro histórico del proyecto.',
    substeps: [
      'Verificar que las horas efectivas están registradas correctamente',
      'Comparar horas efectivas vs horas planificadas — anotar diferencia si >20%',
      'Agregar nota de resolución: qué se hizo, cómo quedó, links o archivos relevantes',
      'Mover la tarea a la etapa final (Done / Cerrado) en Odoo',
      'Si es bug: documentar causa raíz para evitar recurrencia',
      'Si las horas excedieron mucho el estimado: actualizar template de estimación para el futuro',
    ],
    inputs:   ['Tarea validada con sign-off', 'Horas registradas durante la ejecución'],
    outputs:  ['Tarea cerrada en Odoo', 'Nota de resolución documentada', 'Horas finales registradas', 'Historial del proyecto actualizado'],
    tools:    ['Odoo Proyectos'],
    tips:     ['La nota de resolución es para el siguiente consultor que encuentre el mismo problema', 'Si cerrar la tarea activa una factura (hito), notificar a Administración antes de cerrar', 'Tareas con horas muy desviadas del estimado = retroalimentación para el proceso de estimación'],
    mistakes: ['Cerrar la tarea sin nota de resolución', 'Dejar horas sin registrar al cerrar', 'Cerrar sin verificar que el cliente o PM firmó off'],
  },
];

const TAREAS_EDGES = [
  { from: 'ta1', to: 'ta2', type: 'normal'   },
  { from: 'ta2', to: 'ta3', type: 'handoff'  },  // PM → Consultor: tarea especificada y asignada
  { from: 'ta3', to: 'ta4', type: 'parallel' },  // Excepción: solo si hay bloqueo >48h
  { from: 'ta3', to: 'ta5', type: 'handoff'  },  // Camino principal: Consultor → QA
  { from: 'ta4', to: 'ta5', type: 'handoff'  },  // Escalamiento resuelto → QA valida
  { from: 'ta5', to: 'ta6', type: 'handoff'  },  // QA aprueba → PM cierra
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPILE ALL PROCESSES
// ═══════════════════════════════════════════════════════════════════════════════
const PROCESSES = {
  ventas:        compileProcess({ steps: VENTAS_STEPS, edges: VENTAS_EDGES, lanes: LANES_VENTAS }),
  facturacion:   compileProcess({ steps: FACTURACION_STEPS,   edges: FACTURACION_EDGES,   lanes: LANES_FACTURACION }),
  implementacion:compileProcess({ steps: IMPLEMENTACION_STEPS,edges: IMPLEMENTACION_EDGES,lanes: LANES_IMPLEMENTACION }),
  soporte:       compileProcess({ steps: SOPORTE_STEPS,       edges: SOPORTE_EDGES,       lanes: LANES_SOPORTE }),
  desarrollo:    compileProcess({ steps: DESARROLLO_STEPS,    edges: DESARROLLO_EDGES,    lanes: LANES_DESARROLLO }),
  scrum:         compileProcess({ steps: SCRUM_STEPS,         edges: SCRUM_EDGES,         lanes: LANES_SCRUM }),
  tareas:        compileProcess({ steps: TAREAS_STEPS,        edges: TAREAS_EDGES,        lanes: LANES_TAREAS }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// REFERENCE PAGE DATA (rich non-swimlane pages)
// ═══════════════════════════════════════════════════════════════════════════════
const REFERENCE_PAGES = {
  organigrama: {
    title: 'Organigrama Torus',
    icon: '🏢',
    color: '#10B981',
    sections: [
      {
        title: 'Dirección',
        nodes: [
          { name: 'Gabriel Diaz de Bedoya', role: 'Presidente Directorio', color: '#1E293B' },
          { name: 'Rodrigo Campos',         role: 'CEO',                   color: '#1E293B' },
          { name: 'Fabrizio Salomón',       role: 'COO',                   color: '#1E293B' },
          { name: 'Mercedes Morales',       role: 'CFO',                   color: '#1E293B' },
        ],
      },
      {
        title: 'Producción (COO)',
        nodes: [
          { name: 'Gonzalo García',    role: 'Consultor Funcional / PM', color: '#8B5CF6' },
          { name: 'Diego Benitez',     role: 'Consultor Funcional / PM', color: '#8B5CF6' },
          { name: 'Diego Escobar',     role: 'Consultor Funcional',      color: '#8B5CF6' },
          { name: 'Alix Brizuela',     role: 'Consultor Contable',       color: '#8B5CF6' },
          { name: 'Alexis Florentín',  role: 'Consultor Contable / Funcional', color: '#8B5CF6' },
          { name: 'José Sotelo',       role: 'Technical Consultant',     color: '#3B82F6' },
          { name: 'Silvana Enciso',    role: 'Technical Consultant',     color: '#3B82F6' },
          { name: 'Miguel Fernández',  role: 'Technical Consultant',     color: '#3B82F6' },
          { name: 'Marcelo Centurión', role: 'Technical Consultant',     color: '#3B82F6' },
        ],
      },
    ],
    roleTypes: [
      { label: 'Roles Organizacionales', description: 'Permanentes. Definen la cadena de reporte diaria.' },
      { label: 'Roles en Proyecto', description: 'Dinámicos. Se asignan por proyecto. Un consultor puede tener múltiples roles simultáneamente.' },
    ],
    projectRoles: [
      { role: 'Project Leader (PL)', resp: 'Lidera el proyecto con el cliente, gestiona cronograma y riesgos. Punto de contacto principal de Torus.' },
      { role: 'App Expert', resp: 'Referente técnico/funcional de un módulo específico de Odoo.' },
      { role: 'Consultor de Soporte', resp: 'Atiende tickets post go-live dentro del SLA.' },
      { role: 'Desarrollador de Proyecto', resp: 'Implementa customizaciones y desarrollos técnicos.' },
      { role: 'SPoC (cliente)', resp: 'Contacto principal del cliente. Responsable de empujar internamente y tomar decisiones.' },
    ],
  },

  roles: {
    title: 'Roles y Responsabilidades',
    icon: '👥',
    color: '#3B82F6',
    roles: [
      {
        name: 'Hunter', color: '#3B82F6', emoji: '🎯',
        tagline: 'Genera oportunidades. Abre puertas.',
        responsibilities: [
          'Prospección y primer contacto con leads (LinkedIn, referidos, eventos)',
          'Pre-calificación y calificación BANT',
          'Cierre del brief antes del handoff al Closer',
          'Mantener el pipeline CRM actualizado en Odoo',
        ],
        kpis: ['Leads generados / mes', 'Tasa de conversión Lead → Oportunidad calificada', 'Tiempo promedio de calificación'],
        tools: ['Odoo CRM', 'LinkedIn Sales Navigator', 'Google Meet'],
        doNot: ['Armar propuestas (eso es del Closer)', 'Pasar leads sin calificación al Closer'],
      },
      {
        name: 'Closer', color: '#D97706', emoji: '🤝',
        tagline: 'Convierte oportunidades en contratos.',
        responsibilities: [
          'Recibir brief completo del Hunter y entender el contexto del cliente',
          'Elaborar y presentar propuestas técnico-comerciales en Odoo Ventas',
          'Manejar objeciones y negociación (sin bajar precio sin reducir scope)',
          'Coordinar el cierre: OV, anticipo, handoff a PM y Administración',
        ],
        kpis: ['Tasa de cierre (Propuesta → Won)', 'Ticket promedio', 'Tiempo promedio de ciclo de venta'],
        tools: ['Odoo Ventas (SO)', 'Odoo CRM', 'Google Docs', 'Zoom'],
        doNot: ['Cerrar sin OV vinculada al proyecto', 'Prometer alcances no validados con producción'],
      },
      {
        name: 'Project Manager (PM)', color: '#8B5CF6', emoji: '📋',
        tagline: 'Entrega proyectos a tiempo, en alcance y con calidad.',
        responsibilities: [
          'Planificar y gestionar el cronograma del proyecto en Odoo',
          'Primer punto de contacto del cliente durante implementación',
          'Trackear horas, riesgos y presupuesto semanalmente',
          'Coordinar al equipo de consultores y desarrolladores',
          'Escalar bloqueos y gestionar cambios de alcance',
        ],
        kpis: ['% de proyectos entregados en plazo', 'Desviación presupuestaria (horas)', 'CSAT del cliente post go-live'],
        tools: ['Odoo Proyectos', 'Dashboard Torus', 'Google Meet', 'Google Docs'],
        doNot: ['Aceptar scope creep sin orden de cambio', 'Dejar tickets sin asignar más de 24h'],
      },
      {
        name: 'Consultor Funcional', color: '#10B981', emoji: '⚙️',
        tagline: 'Configura Odoo para que el cliente opere.',
        responsibilities: [
          'Relevar procesos del cliente (AS-IS / TO-BE)',
          'Configurar módulos funcionales en staging y producción',
          'Capacitar usuarios del cliente por módulo',
          'Validar desarrollos técnicos contra la especificación funcional',
          'Registrar horas diariamente en Odoo',
        ],
        kpis: ['Satisfacción del cliente en capacitaciones', 'Bugs post go-live atribuibles a configuración', 'Horas dentro del estimado'],
        tools: ['Odoo (staging y producción)', 'Google Meet', 'Google Docs'],
        doNot: ['Configurar en producción sin validar en staging', 'Aceptar cambios de alcance sin aviso al PM'],
      },
      {
        name: 'Technical Consultant (Dev)', color: '#EC4899', emoji: '💻',
        tagline: 'Extiende Odoo donde el estándar no llega.',
        responsibilities: [
          'Implementar customizaciones siguiendo la especificación funcional',
          'Pipeline técnico: DEV → DEPLOY stg → TEST → FIX → DEPLOY prod',
          'Code review de PRs del equipo técnico',
          'Mantener repositorios Git ordenados con commits descriptivos',
          'Documentar en Odoo cada ticket con la solución implementada',
        ],
        kpis: ['Bugs detectados post-producción', 'Tiempo de resolución de bugs', 'Adherencia a estimaciones técnicas'],
        tools: ['VS Code / PyCharm', 'Git / GitHub', 'Odoo (local, staging, prod)'],
        doNot: ['Trabajar en main/master directamente', 'Implementar sin especificación aprobada'],
      },
      {
        name: 'Soporte N1', color: '#64748B', emoji: '🎧',
        tagline: 'Primera línea. Responde rápido, resuelve o escala.',
        responsibilities: [
          'Registrar y clasificar todos los tickets entrantes en Odoo Helpdesk',
          'Resolver tickets de nivel 1 (consultas, configuraciones simples)',
          'Escalar al Nivel 2 con diagnóstico documentado',
          'Confirmar recepción al cliente en menos de 30 minutos hábiles',
          'Documentar soluciones en la base de conocimiento',
        ],
        kpis: ['Tiempo de primera respuesta', '% tickets resueltos en N1 (sin escalar)', 'CSAT post-ticket'],
        tools: ['Odoo Helpdesk', 'Email', 'WhatsApp'],
        doNot: ['Escalar sin diagnóstico documentado', 'Cerrar tickets sin confirmación del cliente'],
      },
    ],
  },

  metodologia: {
    title: 'Metodología de Proyectos',
    icon: '🗺️',
    color: '#8B5CF6',
    phases: [
      { num: 0, name: 'Kick-off',        gate: 'Acta firmada por Sponsor + SPoC',         duration: '1 semana',     color: '#6366F1' },
      { num: 1, name: 'Análisis',        gate: 'Acta de Análisis firmada',                duration: '1-2 semanas',  color: '#8B5CF6' },
      { num: 2, name: 'Implementación',  gate: 'Actas de validación por sprint',           duration: '4-16 semanas', color: '#A78BFA' },
      { num: 3, name: 'Capacitación',    gate: 'Actas firmadas por asistentes',            duration: '1-2 semanas',  color: '#3B82F6' },
      { num: 4, name: 'UAT',             gate: 'Acta UAT firmada → autoriza cut-over',     duration: '1-2 semanas',  color: '#06B6D4' },
      { num: 5, name: 'Cut-over',        gate: 'Acta firmada',                             duration: '1-3 días',     color: '#10B981' },
      { num: 6, name: 'Go-Live',         gate: 'Acta firmada → inicia garantía',           duration: '1 día',        color: '#22C55E' },
      { num: 7, name: 'Estabilización',  gate: 'Acta de cierre firmada',                   duration: '30 días',      color: '#84CC16' },
    ],
    slaSupport: [
      { level: 'Crítico',  response: '1h',  resolution: 'Prioritaria continua', description: 'Sistema completamente bloqueado, no pueden operar' },
      { level: 'Alto',     response: '4h',  resolution: '24h',                  description: 'Funcionalidad crítica con workaround posible' },
      { level: 'Moderado', response: '24h', resolution: '48h',                  description: 'Módulo con errores, pero operación continúa' },
      { level: 'Bajo',     response: '48h', resolution: '72h',                  description: 'Consultas, mejoras menores, ajustes cosméticos' },
    ],
    scrum: {
      ceremonies: [
        { name: 'Sprint Planning', freq: 'Inicio de sprint', duration: '1-2h',    purpose: 'Comprometer el sprint backlog y definir el Sprint Goal' },
        { name: 'Daily Standup',   freq: 'Cada día hábil',   duration: '15 min',  purpose: '3 preguntas: ayer / hoy / bloqueos. Sincronización del equipo' },
        { name: 'Sprint Review',   freq: 'Fin de sprint',    duration: '1h',      purpose: 'Demo al PO/cliente. Validación del incremento. Feedback al backlog' },
        { name: 'Retrospectiva',   freq: 'Fin de sprint',    duration: '1h',      purpose: 'Keep/Stop/Start. Action items concretos para el próximo sprint' },
        { name: 'Refinamiento',    freq: 'Media semana',     duration: '1-2h',    purpose: 'Preparar el backlog para la próxima sprint planning. Story points y criterios' },
      ],
      storyPoints: [
        { sp: 1,  label: 'Trivial',   desc: 'Cambio de config o texto. < 1 hora real' },
        { sp: 2,  label: 'Pequeño',   desc: 'Tarea conocida y clara. 1-3 horas' },
        { sp: 3,  label: 'Mediano',   desc: 'Algo de complejidad o dependencias. 3-6 horas' },
        { sp: 5,  label: 'Grande',    desc: 'Requiere análisis y coordinación. 6-12 horas' },
        { sp: 8,  label: 'Complejo',  desc: 'Alta incertidumbre o múltiples partes. 12-24 horas' },
        { sp: 13, label: 'Épica',     desc: 'Demasiado grande — dividir antes de planificar' },
      ],
      dod: [
        'Código revisado por par (code review)',
        'Pruebas funcionales pasadas en staging',
        'Funcional validó con criterios de aceptación',
        'Horas registradas en Odoo',
        'Documentación actualizada si aplica',
        'Deploy en staging (DEV) o producción (PROD) según corresponda',
      ],
    },
  },

  'catalogo-torus': {
    title: 'Catálogo de Productos Torus',
    icon: '📦',
    color: '#3B82F6',
    intro: 'Torus es Partner Oficial Odoo en Paraguay (Silver Partner). Estos son los productos y servicios que ofrecemos.',
    products: [
      {
        category: 'Relevamiento',
        color: '#F59E0B',
        items: [
          { code: 'DISC', name: 'Análisis y Descubrimiento', when: 'Cliente todavía define alcance, procesos, gaps y roadmap. Proyecto >80h o >3 módulos.', billing: 'Fee fijo por sprint o fase', crossSell: ['CORE', 'LOC', 'CDEV'] },
        ],
      },
      {
        category: 'Implementación Odoo',
        color: '#8B5CF6',
        items: [
          { code: 'CORE', name: 'Core Administrativo',    when: 'Siempre. Base operativa: contabilidad, facturación, compras, ventas, inventario.',      billing: 'Monto fijo', crossSell: ['LOC', 'SUPP'] },
          { code: 'LOC',  name: 'Localización Paraguay',  when: 'Siempre que el cliente opere en PY. Impuestos, SIFEN, documentos fiscales locales.',    billing: 'Incluido en CORE o separado', crossSell: ['CORE'] },
          { code: 'CDEV', name: 'Desarrollo a Medida',    when: 'El estándar Odoo no cubre el req. o se necesitan integraciones/automatizaciones.',       billing: 'Monto fijo por desarrollo', crossSell: ['SUPP', 'HOURS'] },
          { code: 'SALES',name: 'Ventas & CRM',           when: 'Alcance incluye frente comercial.',                                                        billing: 'Incluido en implementación', crossSell: ['PROJ', 'SUPP'] },
          { code: 'SCM',  name: 'Supply Chain',           when: 'Alcance incluye operación, abastecimiento o logística.',                                   billing: 'Incluido en implementación', crossSell: ['CORE', 'SUPP'] },
          { code: 'HR',   name: 'Recursos Humanos',       when: 'Alcance incluye procesos de personas.',                                                    billing: 'Incluido en implementación', crossSell: ['CORE', 'SUPP'] },
          { code: 'PROJ', name: 'Proyectos & Servicios',  when: 'Alcance incluye delivery o servicios postventa.',                                          billing: 'Incluido en implementación', crossSell: ['SUPP', 'HOURS'] },
          { code: 'WEB',  name: 'Web & eCommerce',        when: 'Alcance incluye presencia digital o canal online.',                                        billing: 'Monto fijo por implementación', crossSell: ['SUPP'] },
        ],
      },
      {
        category: 'Soporte y Mantenimiento',
        color: '#10B981',
        items: [
          { code: 'SUPP',  name: 'Soporte y Mantenimiento', when: 'Post go-live o clientes con continuidad operativa.',                                   billing: 'Mensual fijo, tope de horas', crossSell: ['HOURS', 'CDEV'] },
          { code: 'HOURS', name: 'Bolsa de Horas',           when: 'Soporte puntual, ajustes, demanda variable. Saldo arrastrable 2 meses.',              billing: 'Pack prepago mensual', crossSell: ['SUPP'] },
          { code: 'HOURLY',name: 'Servicio por Hora',        when: 'Por horas efectivamente trabajadas, sin pack cerrado.',                               billing: 'Mensual variable por consumo', crossSell: ['SUPP', 'HOURS'] },
        ],
      },
      {
        category: 'Infraestructura y Licencias',
        color: '#6366F1',
        items: [
          { code: 'INFRA',    name: 'Odoo.sh Hosting',       when: 'Cliente quiere hosting gestionado separado del servicio.',                           billing: 'Mensual según plan', crossSell: ['CORE'] },
          { code: 'LIC',      name: 'Licencia Odoo Enterprise', when: 'Cuando se comercializa o separa el costo de licencias.',                         billing: 'Anual por usuario', crossSell: ['CORE'] },
          { code: 'LIC-AMIBA',name: 'Licencia Amiba',         when: 'Cuando el proyecto incluye Amiba como componente de AI.',                           billing: 'Mensual SaaS', crossSell: ['CORE', 'CDEV'] },
        ],
      },
    ],
    decisionTree: [
      { q: '¿El cliente todavía define qué quiere?', a: 'DISC — Relevamiento primero', next: null },
      { q: '¿Necesita la base administrativa de Odoo?', a: 'CORE + LOC (siempre si está en PY)', next: null },
      { q: '¿El estándar no alcanza?', a: 'CDEV — Desarrollo a medida', next: null },
      { q: '¿Proyecto ya en producción?', a: 'SUPP - Soporte mensual', next: null },
      { q: '¿Capacidad flexible de horas?', a: 'HOURS o HOURLY', next: null },
    ],
    conditions: {
      maxInstallments: 12,
      downPayment: '25%',
      currency: 'PYG',
      trialExtension: 'M241203194687082',
    },
    soRules: {
      title: 'Reglas de Presupuestos (SO)',
      alert: 'Cada linea con producto en el SO crea un proyecto en Odoo. Maximo una linea por codigo de producto.',
      rules: [
        { icon: '⛔', label: 'Codigos validos',               text: 'Usar solo codigos del catalogo: [DISC], [CORE], [LOC], [SALES], [SCM], [HR], [PROJ], [WEB], [CDEV], [SUPP], [HOURS], [HOURLY], [INFRA], [LIC], [LIC-AMIBA]. NO usar [MOD] legacy ni inventar codigos nuevos.' },
        { icon: '📝', label: 'Una linea por producto',      text: 'Consolidar horas en una sola linea por codigo. [SALES] cubre CRM + Ventas: 1 linea con el total.' },
        { icon: '🚫', label: 'Sin precios en descripcion',  text: 'La nota/descripcion del SO nunca lleva precios ni estimaciones de horas. Esos datos van en las lineas de venta.' },
        { icon: '💳', label: 'Financiamiento en terminos',  text: 'Cuotas y anticipo van en el campo Terminos de Pago del SO, no en el texto de la descripcion.' },
        { icon: '✏️', label: 'Titulos proporcionales',    text: 'Tamano de titulos acorde al estilo nativo de Odoo. No usar H1/H2 grandes que rompan el equilibrio visual.' },
        { icon: '🔤', label: 'Sin emdash',                  text: 'No usar el caracter emdash (\u2014). Usar guion simple (-) o reformular la frase.' },
        { icon: '📝', label: 'Fases con texto sin producto', text: 'Lineas sin producto (qty=0) como encabezados de seccion. No crean proyecto.' },
        { icon: '💰', label: 'Precio via API',              text: 'Al cambiar product_id via XML-RPC: incluir price_unit en el mismo write() o Odoo lo pisa con el list_price.' },
      ],
      checklist: [
        'Sin filas duplicadas con el mismo producto',
        'Precio USD 35/h en lineas de implementacion',
        '[HOURS] antes del [SUPP]',
        'Condiciones de pago en Terminos de Pago, no en descripcion',
        'Titulos del mismo tamano que el SO nativo de Odoo',
        'Sin emdash (\u2014) en ningun campo de texto',
      ],
    },
    analyticRules: {
      title: 'Cuentas Analiticas en Facturas',
      alert: 'Toda linea de producto en facturas de cliente debe tener exactamente 2 cuentas analiticas: Plan 1 (proyecto) + plan de producto.',
      plans: [
        { plan: 'Plan 1 - Proyecto',           desc: 'Una cuenta por proyecto cliente. Se crea automaticamente con el proyecto. Nombre estandar: SXXXXX - [TIPO] - CLIENTE (con corchetes en el codigo de producto).' },
        { plan: 'Plan 12 - Implementacion',    desc: 'CORE (187), LOC (189), CDEV (188), SALES (192), SCM (193), HR (190), PROJ (191).' },
        { plan: 'Plan 13 - Soporte',           desc: 'SUPP (195).' },
        { plan: 'Plan 14 - Team-as-a-Service', desc: 'HOURS (198), HOURLY (199).' },
        { plan: 'Plan 15 - Infra/Licencias',   desc: 'INFRA (200), LIC (201).' },
        { plan: 'Plan 11 - DISC',              desc: 'DISC (186).' },
      ],
      matchLogic: 'Prioridad: (1) sale_line_ids de la factura vinculada a proyecto con account_id. (2) busqueda por partner + codigo de producto entre proyectos activos. (3) resolucion manual si hay ambiguedad.',
      howPlan1Works: 'El proyecto debe tener sale_line_id apuntando a la linea de OV correcta para que la analitica se propague automaticamente. Sin ese vinculo hay que asignar Plan 1 a mano.',
    },
    projectStandards: {
      title: 'Estandares de Proyectos en Odoo',
      alert: 'Politica unica para todos los proyectos cliente. NO crear excepciones por cliente o por consultor.',
      naming: {
        title: 'Naming de Proyectos',
        format: 'SXXXXX - [TIPO] - CLIENTE',
        examples: [
          'S00089 - [CORE] - DYD Arquitectura y Construccion SRL',
          'S00047 - [SCM F1] - PALKE S.A. (MotorHaus)',
          'S00075 - [HOURS] - DDS SOCIEDAD DE RESPONSABILIDAD LIMITADA',
        ],
        rules: [
          'Codigo del producto SIEMPRE entre corchetes [CORE], [SALES], etc.',
          'Nombre completo del cliente, sin abreviar (razon social como esta en Odoo)',
          'Si hay sub-fases (F1, F2) van dentro del corchete: [SCM F1]',
          'Renombrar proyecto en AMBOS idiomas (en_US + es_PY) — el campo name es translatable',
        ],
      },
      stages: {
        title: 'Stages Estandar (compartidos)',
        alert: 'TODOS los proyectos cliente comparten LAS MISMAS instancias de stages. NO se crean stages nuevos por proyecto.',
        list: [
          { seq: 1, name: '1. Lista de Tareas', fold: false, desc: 'Tareas pendientes de ser tomadas — backlog visible del proyecto' },
          { seq: 2, name: '2. En Cola',         fold: false, desc: 'Asignadas pero aun no comenzadas (proxima a ejecutar)' },
          { seq: 3, name: '3. En Progreso',     fold: false, desc: 'Trabajo activo. Consultor logueando horas diariamente' },
          { seq: 4, name: '4. En Pausa',        fold: false, desc: 'Detenida por bloqueo, dependencia o entregable pendiente del cliente' },
          { seq: 5, name: '5. En Revisión',     fold: false, desc: 'En validacion funcional / QA / aprobacion del cliente' },
          { seq: 6, name: '6. Hecho',           fold: true,  desc: 'Cerrada y validada. Stage terminal' },
        ],
        rules: [
          'NO crear stages "Hecho", "Done", "Cerrado", "En curso", "En proceso" o variantes — usar exactamente los 6 del estandar',
          'NO crear stages especiales por proyecto — si hace falta un workflow distinto, usar tags/etiquetas',
          'Stages personales (Bandeja de entrada, Hoy, Esta semana, etc.) son privados de cada usuario y NO se aplican a proyectos cliente',
          'Al crear tareas via API: setear stage_id explicito (8 = "1. Lista de Tareas") para evitar que caigan en "En Pausa" por default',
        ],
      },
      assignees: {
        title: 'Responsables de Tareas',
        alert: 'Las tareas creadas desde template NO llevan responsable por defecto. Se asigna tarea por tarea cuando el PM las distribuye.',
        rules: [
          'NO bulk-assignar todas las tareas a una persona post-creacion del proyecto',
          'NO usar el creator del proyecto (RuBot, PM, Diego, etc.) como default assignee',
          'PM distribuye al equipo segun area: contabilidad → contable, tecnico → dev, etc.',
        ],
      },
      templates: {
        title: 'Project Templates Disponibles',
        alert: 'Solo duplicar templates oficiales. NO crear proyectos cliente desde cero.',
        list: [
          { code: '[CORE]',  tasks: 102, hours: 399, notes: 'Implementacion administrativa base. Siempre se vende.' },
          { code: '[DISC]',  tasks: 32,  hours: 93,  notes: 'Solo analisis. Termina en propuesta comercial.' },
          { code: '[CDEV]',  tasks: 33,  hours: 99,  notes: 'Pipeline IMPLEMENTAR → TEST → UAT → PROD para customizaciones.' },
          { code: '[SALES]', tasks: 58,  hours: 178, notes: 'CRM + Ventas + POS.' },
          { code: '[SCM]',   tasks: 57,  hours: 176, notes: 'Inventario + Compras + Logistica.' },
          { code: '[HR]',    tasks: 52,  hours: 156, notes: 'Empleados + Ausencias + Nomina.' },
          { code: '[PROJ]',  tasks: 49,  hours: 151, notes: 'Proyectos + Hojas de Tiempo + Facturacion de servicios.' },
          { code: '[WEB]',   tasks: 51,  hours: 157, notes: 'Sitio Web + eCommerce + Blog.' },
          { code: '[SUPP]',  tasks: 20,  hours: 0,   notes: 'Recurrente. Hrs por contrato, no totales.' },
          { code: '[HOURS]', tasks: 0,   hours: 0,   notes: 'Bolsa prepaga. Template SIN tareas — el cliente decide que hacer con las horas.' },
          { code: '[HOURLY]',tasks: 0,   hours: 0,   notes: 'Servicio por hora. Template SIN tareas — facturacion mensual por consumo.' },
        ],
        notes: '[LOC], [INFRA], [LIC], [LIC-AMIBA] son productos vendibles que NO requieren proyecto Odoo (solo facturacion). [LOC] esta embebido como seccion dentro de [CORE].',
      },
      tags: {
        title: 'Etiquetado de Tareas',
        alert: 'Toda tarea lleva exactamente 2 tags: 1 de rol + 1 de tipo. NO poner DEV/CONS en el nombre de la tarea.',
        rol: {
          title: 'Rol — quien hace el trabajo (1 tag obligatoria)',
          list: [
            { tag: 'cons', color: 'azul',  desc: 'Trabajo de consultor (funcional, contable, localizacion). Toca config, Studio, GAPs, capacita, releva, valida.' },
            { tag: 'dev',  color: 'cyan',  desc: 'Trabajo de developer (Technical Consultant / Customizacion). Toca codigo Python, XML, JS, modulos custom.' },
          ],
        },
        tipo: {
          title: 'Tipo — que clase de trabajo es (1 tag obligatoria)',
          list: [
            { tag: 'bug',           color: 'rojo',         desc: 'Algo que funcionaba se rompio',                          example: 'El recibo no calcula el IVA en NC' },
            { tag: 'mejora',        color: 'amarillo',     desc: 'Existe, hay que ajustarlo',                              example: 'Agregar filtro de fecha al reporte de ventas' },
            { tag: 'feature',       color: 'verde',        desc: 'Desarrollo nuevo desde cero',                            example: 'Crear modulo de gestion de garantias' },
            { tag: 'deploy',        color: 'violeta',      desc: 'Pasaje a staging o produccion',                          example: 'Deploy de fix de cuotero a prod' },
            { tag: 'relevamiento',  color: 'marron',       desc: 'Analisis, GAP, blueprint, descubrimiento',               example: 'Relevar area de inventario' },
            { tag: 'config',        color: 'verde claro',  desc: 'Configuracion estandar o Studio sin codigo',             example: 'Configurar Diarios Contables' },
            { tag: 'capacitacion',  color: 'naranja',      desc: 'Entrenamiento al cliente',                               example: 'Capacitacion modulo Ventas a Cliente X' },
            { tag: 'soporte',       color: 'rosa',         desc: 'Incidencia operativa post go-live',                      example: 'Cliente reporta error en libro IVA' },
            { tag: 'test',          color: 'verde oscuro', desc: 'QA / UAT / validacion funcional',                        example: 'Validacion final de circuito de facturacion' },
          ],
        },
        rules: [
          'Una tarea = un rol + un tipo. No mezclar dos roles ni dos tipos en la misma tarea',
          'NO poner DEV/CONS/BUG en el nombre de la tarea — toda esa info va en los tags',
          'NO crear tags nuevas sin avisar al COO. El set de 11 es cerrado',
          'Si un trabajo necesita rol distinto, partir en 2 tareas (ej. cons relevamiento + dev feature)',
          'Tareas internas del equipo (no cliente) pueden quedar sin tag de rol pero igual llevan tipo',
        ],
        decisionTree: [
          { q: '¿Es trabajo de codigo Python/XML/JS?', y: 'rol=dev', n: 'rol=cons' },
          { q: '¿Algo se rompio?',                    y: 'tipo=bug',    n: null },
          { q: '¿Algo existe y hay que ajustarlo?',   y: 'tipo=mejora', n: null },
          { q: '¿Es desde cero?',                     y: 'tipo=feature',n: null },
          { q: '¿Pasaje a staging/prod?',             y: 'tipo=deploy', n: null },
          { q: '¿Analisis previo?',                   y: 'tipo=relevamiento', n: null },
          { q: '¿Configuracion sin codigo?',          y: 'tipo=config', n: null },
          { q: '¿Entrenamiento al cliente?',          y: 'tipo=capacitacion', n: null },
          { q: '¿Validacion / QA / UAT?',             y: 'tipo=test',   n: null },
          { q: '¿Soporte post go-live?',              y: 'tipo=soporte',n: null },
        ],
        pipelineNote: 'Pipeline tecnico de desarrollo (subtareas dentro de un padre con tipo=feature o mejora): IMPLEMENTAR → DEPLOY staging → TEST → FIX → DEPLOY produccion. Las subtareas NO se etiquetan con dev/feature — viven dentro del padre que ya tiene esos tags.',
        migration: 'Migracion 2026-04-29: 38 tags legacy archivadas, 1957 tareas re-etiquetadas. SOP completo en companies/torus/sops/etiquetado-tareas.md.',
      },
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENCYCLOPEDIA STRUCTURE (for the hub page)
// ═══════════════════════════════════════════════════════════════════════════════
const ENCYCLOPEDIA = {
  sections: [
    {
      id: 'comercial', name: 'Procesos Comerciales', color: '#D97706', bg: '#FFFBEB',
      icon: '💼',
      description: 'Captación, calificación, propuesta, cierre y ciclo de facturación',
      processes: [
        { id: 'ventas',      name: 'Proceso de Ventas',    description: '10 pasos desde lead hasta soporte post-venta. Roles: Hunter, Closer, PM, Soporte.', steps: 10, status: 'complete' },
        { id: 'facturacion', name: 'Facturación y Cobros', description: '7 pasos: configuración, anticipo, plan de cuotas, cobro y cierre contable.', steps: 7, status: 'complete' },
      ],
    },
    {
      id: 'produccion', name: 'Procesos de Producción', color: '#8B5CF6', bg: '#F5F3FF',
      icon: '⚙️',
      description: 'Implementación Odoo, soporte post-venta, desarrollo técnico y gestión de tareas',
      processes: [
        { id: 'implementacion', name: 'Implementación Odoo',     description: '9 pasos: análisis, configuración, módulos, capacitación, UAT, migración, go-live y estabilización.', steps: 9, status: 'complete' },
        { id: 'soporte',        name: 'Soporte y Mantenimiento', description: '6 pasos: desde la solicitud hasta la revisión mensual proactiva.', steps: 6, status: 'complete' },
        { id: 'desarrollo',     name: 'Desarrollo a Medida',     description: '5 pasos: especificación, desarrollo, staging, validación y producción.', steps: 5, status: 'complete' },
        { id: 'scrum',          name: 'Scrum Sprint Cycle',      description: '6 ceremonias: refinamiento, planning, daily, ejecución, review y retrospectiva.', steps: 6, status: 'complete' },
        { id: 'tareas',         name: 'Gestión de Tareas Odoo',  description: '6 pasos: crear, especificar, ejecutar, alerta 48hs, validar y cerrar. Con protocolo de campos obligatorios.', steps: 6, status: 'complete' },
      ],
    },
    {
      id: 'organizacion', name: 'Estructura Organizacional', color: '#10B981', bg: '#ECFDF5',
      icon: '🏢',
      description: 'Organigrama, roles, responsabilidades y metodologías de trabajo',
      processes: [
        { id: 'organigrama', name: 'Organigrama Torus',         description: 'Árbol organizacional interactivo. Dirección, Producción, Contable, Técnico y Finanzas.', steps: null, status: 'complete' },
        { id: 'roles',       name: 'Roles y Responsabilidades', description: 'Definición detallada de cada rol: Hunter, Closer, PM, App Expert, Consultor, Desarrollador.', steps: null, status: 'reference' },
        { id: 'metodologia', name: 'Metodología de Proyectos',  description: 'Fases 0-8 de implementación, ceremonias SCRUM, story points, DoD y SLA de soporte.', steps: null, status: 'reference' },
      ],
    },
    {
      id: 'productos', name: 'Catálogo de Productos', color: '#3B82F6', bg: '#EFF6FF',
      icon: '📦',
      description: 'Líneas de servicio, condiciones comerciales y árbol de decisión',
      processes: [
        { id: 'catalogo-torus',    name: 'Productos Torus',    description: 'CORE, LOC, SALES, SCM, HR, PROJ, WEB, SUPP, HOURS — cuándo ofrecer cada uno y condiciones.', steps: null, status: 'reference' },
        { id: 'catalogo-rugertek', name: 'Productos RügerTek', description: 'AUG, DEDICATED, CDEV, WEB, HOURLY, MAINT — árbol de decisión comercial y tarifas.', steps: null, status: 'planned' },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ORG CHART DATA
// ═══════════════════════════════════════════════════════════════════════════════
const ORG_DATA = {
  id: 'gabriel', name: 'Gabriel Díaz de Bedoya', role: 'Presidente del Directorio',
  color: '#1E293B', dept: 'directorio',
  children: [{
    id: 'rodrigo', name: 'Rodrigo Campos', role: 'CEO', color: '#1E293B', dept: 'direccion',
    children: [
      { id: 'fabrizio', name: 'Fabrizio Salomón', role: 'COO', color: '#8B5CF6', dept: 'produccion',
        children: [
          { id: 'gonzalo',  name: 'Gonzalo García',     role: 'Consultor Funcional / PM', color: '#8B5CF6', dept: 'funcional',  children: [] },
          { id: 'diego_b',  name: 'Diego Benítez',      role: 'Consultor Funcional / PM', color: '#8B5CF6', dept: 'funcional',  children: [] },
          { id: 'diego_e',  name: 'Diego Escobar',      role: 'Consultor Funcional',      color: '#8B5CF6', dept: 'funcional',  children: [] },
          { id: 'alix',     name: 'Alix Brizuela',      role: 'Consultor Contable',        color: '#10B981', dept: 'contable',   children: [] },
          { id: 'alexis',   name: 'Alexis Florentín',   role: 'Consultor Contable / Func.', color: '#10B981', dept: 'contable', children: [] },
          { id: 'jose',     name: 'José Sotelo',        role: 'Technical Consultant',     color: '#3B82F6', dept: 'tecnico',    children: [] },
          { id: 'silvana',  name: 'Silvana Enciso',     role: 'Technical Consultant',     color: '#3B82F6', dept: 'tecnico',    children: [] },
          { id: 'miguel',   name: 'Miguel Fernández',   role: 'Technical Consultant',     color: '#3B82F6', dept: 'tecnico',    children: [] },
          { id: 'marcelo',  name: 'Marcelo Centurión',  role: 'Technical Consultant',     color: '#3B82F6', dept: 'tecnico',    children: [] },
        ]
      },
      { id: 'mercedes', name: 'Mercedes Morales', role: 'CFO', color: '#EC4899', dept: 'finanzas', children: [] },
    ]
  }]
};

module.exports = {
  PROCESSES,
  ENCYCLOPEDIA,
  REFERENCE_PAGES,
  ORG_DATA,
  // legacy compat — single process access
  ventas:         PROCESSES.ventas,
  facturacion:    PROCESSES.facturacion,
  implementacion: PROCESSES.implementacion,
  soporte:        PROCESSES.soporte,
  desarrollo:     PROCESSES.desarrollo,
  scrum:          PROCESSES.scrum,
  tareas:         PROCESSES.tareas,
};
