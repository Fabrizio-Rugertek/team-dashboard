'use strict';
/**
 * /sop — Interactive SOP (Standard Operating Procedures) viewer.
 * Renders swimlane process flows with animated edges and drill-down panels.
 *
 * Routes:
 *   GET /sop            → redirects to /sop/ventas
 *   GET /sop/:processId → renders the interactive flow for that process
 */

const express  = require('express');
const router   = express.Router();
const sopData  = require('../src/sop-data');

const VALID_PROCESSES = ['ventas'];

router.get('/', (req, res) => res.redirect('/sop/ventas'));

router.get('/:processId', (req, res) => {
  const { processId } = req.params;
  if (!VALID_PROCESSES.includes(processId)) {
    return res.status(404).render('platform/404');
  }

  const process = sopData[processId];

  res.render('sop/index', {
    title:     'SOP — Torus Dashboard',
    user:      req.user || null,
    processId,
    processName: processId === 'ventas' ? 'Proceso de Ventas' : processId,
    steps:     process.steps,
    edges:     process.edges,
    lanes:     process.lanes,
    canvas:    process.canvas,
    stepsJSON: JSON.stringify(process.steps),
    edgesJSON: JSON.stringify(process.edges),
    lanesJSON: JSON.stringify(process.lanes),
    validProcesses: VALID_PROCESSES,
  });
});

module.exports = router;
