'use strict';
/**
 * SOP Process Data — pre-computed layout coordinates + process definitions.
 * All pixel values must match the CSS constants in views/sop/index.ejs.
 */

// ── Layout constants ──────────────────────────────────────────────────────────
const LANE_W = 120;   // left lane-label column width
const COL_W  = 180;   // width of each step column
const ROW_H  = 170;   // height of each lane row
const CARD_W = 148;   // card width
const CARD_H = 120;   // card height

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

// ── Lanes ─────────────────────────────────────────────────────────────────────
const LANES = [
  { id: 'hunter',  label: 'Hunter',  color: '#3B82F6', bg: '#EFF6FF', row: 0 },
  { id: 'closer',  label: 'Closer',  color: '#D97706', bg: '#FFFBEB', row: 1 },
  { id: 'pm',      label: 'PM',      color: '#8B5CF6', bg: '#F5F3FF', row: 2 },
  { id: 'support', label: 'Soporte', color: '#10B981', bg: '#ECFDF5', row: 3 },
];

// ── Steps (raw) ───────────────────────────────────────────────────────────────
const STEPS_RAW = [
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
    mistakes: ['Avanzar sin confirmar que hay presupuesto o autoridad de decisión'],
  },
  {
    id: 's3', col: 3, lane: 0, label: 'Calificación', sublabel: 'BANT + reunión técnica',
    time: '3-7 días', stage: 'Qualification',
    description: 'Reunión formal para entender en profundidad las necesidades. Aplicar BANT. El hunter puede involucrar al closer aquí para facilitar el handoff.',
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
    handoff:  'Closer',
  },
  {
    id: 's4', col: 4, lane: 1, label: 'Propuesta', sublabel: 'Cotización + documento de alcance',
    time: '3-7 días', stage: 'Proposition',
    description: 'El closer prepara y presenta la propuesta técnico-comercial con módulos Odoo, horas estimadas, precio total y condiciones de pago.',
    substeps: [
      'Recibir brief completo del hunter',
      'Definir modalidad: relevamiento previo vs. propuesta directa',
      'Armar cotización en Odoo Ventas (Sales Order)',
      'Preparar documento de alcance (funcionalidades, sin horas)',
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
    id: 's6', col: 6, lane: 1, label: 'Cierre', sublabel: 'Won + handoff formal',
    time: '1-2 días', stage: 'Won',
    description: 'El cliente aprueba. Se formaliza el cierre en Odoo CRM, se crea el proyecto vinculado, se cobra el anticipo y se hace el handoff al PM.',
    substeps: [
      'Confirmar aprobación del cliente (verbal + escrito)',
      'Marcar oportunidad como Won en Odoo CRM',
      'Crear proyecto en Odoo vinculado con la OV',
      'Emitir y cobrar anticipo (25-50% según condiciones)',
      'Asignar PM y hacer reunión de handoff',
      'Enviar email de bienvenida al cliente',
    ],
    inputs:   ['Aprobación del cliente', 'OV aprobada o firmada'],
    outputs:  ['Oportunidad Won en Odoo', 'Proyecto creado y vinculado', 'Anticipo cobrado', 'PM asignado'],
    tools:    ['Odoo CRM', 'Odoo Proyectos', 'Odoo Facturación'],
    tips:     ['NO cerrar sin OV vinculada al proyecto — es bloqueante', 'Checklist de cierre: opp→won, proyecto→creado, OV→vinculada, anticipo→cobrado'],
    mistakes: ['Cerrar sin cobrar anticipo', 'No hacer handoff formal documentado al PM'],
    handoff:  'PM',
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
    mistakes: ['Go-live viernes o víspera de feriado', 'No tener plan de rollback documentado', 'No firmar acta de cierre del proyecto'],
    handoff:  'Soporte',
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
  },
];

const EDGES_RAW = [
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

// ── Compute and export ────────────────────────────────────────────────────────
const stepMap = {};
const steps = STEPS_RAW.map(s => {
  const b = cardBounds(s.col, s.lane);
  const enriched = { ...s, bounds: b, laneColor: LANES[s.lane].color, laneBg: LANES[s.lane].bg };
  stepMap[s.id] = enriched;
  return enriched;
});

const edges = EDGES_RAW.map(e => ({
  ...e,
  id:   `ep-${e.from}-${e.to}`,
  path: edgePath(stepMap[e.from], stepMap[e.to]),
  dur:  e.type === 'handoff' ? '1.4s' : '1.8s',
}));

const CANVAS = {
  W:     LANE_W + 10 * COL_W,   // 1920
  H:     4  * ROW_H,             // 680
  LANE_W, COL_W, ROW_H, CARD_W, CARD_H,
};

module.exports = {
  LANES, CANVAS,
  ventas: { steps, edges, lanes: LANES, canvas: CANVAS },
};
