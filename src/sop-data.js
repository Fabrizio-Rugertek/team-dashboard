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
  if (from.lane === to.lane) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mx = Math.round((x1 + x2) / 2);
  return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
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
  { id: 'hunter',  label: 'Hunter',         color: '#3B82F6', bg: '#EFF6FF', row: 0 },
  { id: 'closer',  label: 'Closer',         color: '#D97706', bg: '#FFFBEB', row: 1 },
  { id: 'pm',      label: 'PM',             color: '#8B5CF6', bg: '#F5F3FF', row: 2 },
  { id: 'support', label: 'Soporte',        color: '#10B981', bg: '#ECFDF5', row: 3 },
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
  { from: 's1',  to: 's2',  type: 'normal'  },
  { from: 's2',  to: 's3',  type: 'normal'  },
  { from: 's3',  to: 's4',  type: 'handoff' },
  { from: 's4',  to: 's5',  type: 'normal'  },
  { from: 's5',  to: 's6',  type: 'normal'  },
  { from: 's6',  to: 's7',  type: 'handoff' },
  { from: 's7',  to: 's8',  type: 'normal'  },
  { from: 's8',  to: 's9',  type: 'normal'  },
  { from: 's9',  to: 's10', type: 'handoff' },
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
  { from: 'i1', to: 'i4', type: 'handoff' },
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
// COMPILE ALL PROCESSES
// ═══════════════════════════════════════════════════════════════════════════════
const PROCESSES = {
  ventas:        compileProcess({ steps: VENTAS_STEPS,        edges: VENTAS_EDGES,        lanes: LANES_VENTAS }),
  facturacion:   compileProcess({ steps: FACTURACION_STEPS,   edges: FACTURACION_EDGES,   lanes: LANES_FACTURACION }),
  implementacion:compileProcess({ steps: IMPLEMENTACION_STEPS,edges: IMPLEMENTACION_EDGES,lanes: LANES_IMPLEMENTACION }),
  soporte:       compileProcess({ steps: SOPORTE_STEPS,       edges: SOPORTE_EDGES,       lanes: LANES_SOPORTE }),
  desarrollo:    compileProcess({ steps: DESARROLLO_STEPS,    edges: DESARROLLO_EDGES,    lanes: LANES_DESARROLLO }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENCYCLOPEDIA STRUCTURE (for the hub page)
// ═══════════════════════════════════════════════════════════════════════════════
const ENCYCLOPEDIA = {
  sections: [
    {
      id: 'comercial', name: 'Procesos Comerciales', color: '#D97706', bg: '#FFFBEB',
      description: 'Captación, calificación, propuesta, cierre y ciclo de facturación',
      processes: [
        { id: 'ventas',      name: 'Proceso de Ventas',      description: '10 pasos desde lead hasta soporte post-venta. Roles: Hunter, Closer, PM, Soporte.', steps: 10, status: 'complete' },
        { id: 'facturacion', name: 'Facturación y Cobros',   description: '7 pasos: configuración, anticipo, plan de cuotas, cobro y cierre contable.', steps: 7, status: 'complete' },
      ],
    },
    {
      id: 'produccion', name: 'Procesos de Producción', color: '#8B5CF6', bg: '#F5F3FF',
      description: 'Implementación Odoo, soporte post-venta y desarrollo técnico',
      processes: [
        { id: 'implementacion', name: 'Implementación Odoo',     description: '8 pasos: análisis, configuración, módulos, capacitación, UAT y go-live.', steps: 8, status: 'complete' },
        { id: 'soporte',        name: 'Soporte y Mantenimiento', description: '6 pasos: desde la solicitud hasta la revisión mensual proactiva.', steps: 6, status: 'complete' },
        { id: 'desarrollo',     name: 'Desarrollo a Medida',     description: '5 pasos: especificación, desarrollo, staging, validación y producción.', steps: 5, status: 'complete' },
      ],
    },
    {
      id: 'organizacion', name: 'Estructura Organizacional', color: '#10B981', bg: '#ECFDF5',
      description: 'Organigrama, roles, responsabilidades y metodologías',
      processes: [
        { id: 'organigrama', name: 'Organigrama Torus',          description: 'Estructura de roles organizacionales y de proyecto. CEO, COO, CFO, CCO y equipo técnico.', steps: null, status: 'reference' },
        { id: 'roles',       name: 'Roles y Responsabilidades',  description: 'Definición detallada de cada rol: Hunter, Closer, PM, App Expert, Consultor, Desarrollador.', steps: null, status: 'wip' },
        { id: 'metodologia', name: 'Metodología de Proyectos',   description: 'Fases 0-8 de implementación Odoo, scrum interno, gestión de riesgos y SLA de soporte.', steps: null, status: 'wip' },
      ],
    },
    {
      id: 'productos', name: 'Catálogo de Productos', color: '#3B82F6', bg: '#EFF6FF',
      description: 'Líneas de servicio, condiciones comerciales y árbol de decisión',
      processes: [
        { id: 'catalogo-torus',     name: 'Productos Torus',     description: 'CORE, LOC, SALES, SCM, HR, PROJ, WEB, MAINT, HOURS — cuándo ofrecer cada uno.', steps: null, status: 'wip' },
        { id: 'catalogo-rugertek',  name: 'Productos RügerTek',  description: 'AUG, DEDICATED, CDEV, WEB, HOURLY, MAINT — árbol de decisión comercial.', steps: null, status: 'wip' },
      ],
    },
  ],
};

module.exports = {
  PROCESSES,
  ENCYCLOPEDIA,
  // legacy compat — single process access
  ventas:         PROCESSES.ventas,
  facturacion:    PROCESSES.facturacion,
  implementacion: PROCESSES.implementacion,
  soporte:        PROCESSES.soporte,
  desarrollo:     PROCESSES.desarrollo,
};
