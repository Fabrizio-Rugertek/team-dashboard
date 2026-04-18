'use strict';
/**
 * /sop — Interactive SOP Encyclopedia.
 *
 * Routes:
 *   GET /sop                       → encyclopedia hub
 *   GET /sop/:processId            → swimlane flow for a specific process
 *   GET /sop/org/:pageId           → reference pages (organigrama, roles, metodologia)
 */

const express  = require('express');
const router   = express.Router();
const { PROCESSES, ENCYCLOPEDIA } = require('../src/sop-data');

const FLOW_PROCESSES = Object.keys(PROCESSES);   // have swimlane views

// Process metadata for display
const PROCESS_META = {
  ventas:         { name: 'Proceso de Ventas',       section: 'comercial',    color: '#D97706' },
  facturacion:    { name: 'Facturación y Cobros',     section: 'comercial',    color: '#EC4899' },
  implementacion: { name: 'Implementación Odoo',      section: 'produccion',   color: '#8B5CF6' },
  soporte:        { name: 'Soporte y Mantenimiento',  section: 'produccion',   color: '#10B981' },
  desarrollo:     { name: 'Desarrollo a Medida',       section: 'produccion',   color: '#EC4899' },
};

// ── Hub ───────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('sop/hub', {
    title:       'SOPs — Torus Dashboard',
    user:        req.user || null,
    encyclopedia: ENCYCLOPEDIA,
    flowProcesses: FLOW_PROCESSES,
  });
});

// ── Flow pages ────────────────────────────────────────────────────────────────
router.get('/:processId', (req, res) => {
  const { processId } = req.params;
  if (!FLOW_PROCESSES.includes(processId)) {
    return res.status(404).render('platform/404');
  }

  const process = PROCESSES[processId];
  const meta    = PROCESS_META[processId] || { name: processId, color: '#64748b' };

  // Find section for breadcrumb
  const section = ENCYCLOPEDIA.sections.find(s =>
    s.processes.some(p => p.id === processId)
  );

  res.render('sop/index', {
    title:          `${meta.name} — Torus SOPs`,
    user:           req.user || null,
    processId,
    processName:    meta.name,
    processColor:   meta.color,
    sectionName:    section ? section.name : '',
    steps:          process.steps,
    edges:          process.edges,
    lanes:          process.lanes,
    canvas:         process.canvas,
    stepsJSON:      JSON.stringify(process.steps),
    edgesJSON:      JSON.stringify(process.edges),
    lanesJSON:      JSON.stringify(process.lanes),
    flowProcesses:  FLOW_PROCESSES,
    processMeta:    PROCESS_META,
  });
});

module.exports = router;
