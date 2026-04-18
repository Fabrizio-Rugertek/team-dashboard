'use strict';
/**
 * /sop — Interactive SOP Encyclopedia.
 *
 * Routes:
 *   GET /sop                       → encyclopedia hub
 *   GET /sop/:processId            → swimlane flow for a specific process
 *   GET /sop/ref/:pageId           → rich reference pages (organigrama, roles, metodologia, catalogo-torus)
 */

const express  = require('express');
const router   = express.Router();
const { PROCESSES, ENCYCLOPEDIA, REFERENCE_PAGES } = require('../src/sop-data');

const FLOW_PROCESSES = [...Object.keys(PROCESSES), 'organigrama'];
const REF_PAGES      = Object.keys(REFERENCE_PAGES || {});

// Process metadata for display
const PROCESS_META = {
  ventas:         { name: 'Proceso de Ventas',       section: 'comercial',    color: '#D97706' },
  facturacion:    { name: 'Facturación y Cobros',     section: 'comercial',    color: '#EC4899' },
  implementacion: { name: 'Implementación Odoo',      section: 'produccion',   color: '#8B5CF6' },
  soporte:        { name: 'Soporte y Mantenimiento',  section: 'produccion',   color: '#10B981' },
  desarrollo:     { name: 'Desarrollo a Medida',       section: 'produccion',   color: '#EC4899' },
  scrum:          { name: 'Scrum Sprint Cycle',        section: 'produccion',   color: '#3B82F6' },
  tareas:         { name: 'Gestión de Tareas Odoo',   section: 'produccion',   color: '#8B5CF6' },
};

// Reference page metadata
const REF_META = {
  organigrama:      { name: 'Organigrama Torus',          section: 'organizacion', color: '#10B981' },
  roles:            { name: 'Roles y Responsabilidades',  section: 'organizacion', color: '#3B82F6' },
  metodologia:      { name: 'Metodología de Proyectos',   section: 'organizacion', color: '#8B5CF6' },
  'catalogo-torus': { name: 'Productos Torus',            section: 'productos',    color: '#3B82F6' },
};

// ── Hub ───────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('sop/hub', {
    title:         'SOPs — Torus Dashboard',
    user:          req.user || null,
    encyclopedia:  ENCYCLOPEDIA,
    flowProcesses: FLOW_PROCESSES,
  });
});

// ── Reference pages ───────────────────────────────────────────────────────────
router.get('/ref/:pageId', (req, res) => {
  const { pageId } = req.params;
  const pageData   = REFERENCE_PAGES?.[pageId];

  if (!pageData) {
    return res.status(404).render('platform/404');
  }

  const meta = REF_META[pageId] || { name: pageId, color: '#64748B' };
  const section = ENCYCLOPEDIA.sections.find(s =>
    s.processes.some(p => p.id === pageId)
  );

  res.render('sop/reference', {
    title:       `${pageData.title} — Torus SOPs`,
    user:        req.user || null,
    pageId,
    pageData,
    pageColor:   pageData.color || meta.color,
    sectionName: section ? section.name : '',
  });
});

// ── Organigrama ───────────────────────────────────────────────────────────────
router.get('/organigrama', (req, res) => {
  const sopData = require('../src/sop-data');
  const orgData = sopData.ORG_DATA || {};
  res.render('sop/organigrama', {
    title:       'Organigrama — Torus SOPs',
    user:        req.user || null,
    orgData,
    orgDataJSON: JSON.stringify(orgData),
  });
});

// ── Flow pages ────────────────────────────────────────────────────────────────
router.get('/:processId', (req, res) => {
  const { processId } = req.params;

  // Redirect reference-style IDs if they accidentally hit this route
  if (REF_PAGES.includes(processId)) {
    return res.redirect(`/sop/ref/${processId}`);
  }

  // organigrama has its own route above; redirect if somehow caught here
  if (processId === 'organigrama') {
    return res.redirect('/sop/organigrama');
  }

  if (!FLOW_PROCESSES.includes(processId) || !PROCESSES[processId]) {
    return res.status(404).render('platform/404');
  }

  const process = PROCESSES[processId];
  const meta    = PROCESS_META[processId] || { name: processId, color: '#64748b' };

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
