/**
 * /equipo page route.
 * Reads Odoo-style filter params from the URL query string:
 *   ?status=all|active|on_hold|completed|needs_attention
 *   ?tag=all|sin_asignar|backlog|sobreestimado
 * Filter state is persisted in the URL so it survives page refresh / sharing.
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { getDashboardCached } = require('../src/cache');
const config = require('../src/config');

router.get('/', async (req, res) => {
  try {
    const filters = {
      status:  ['all', 'active', 'on_hold', 'completed', 'needs_attention']
                  .includes(req.query.status) ? req.query.status : 'all',
      tag:     ['all', 'sin_asignar', 'backlog', 'sobreestimado']
                  .includes(req.query.tag) ? req.query.tag : 'all',
    };

    const data = await getDashboardCached(filters);
    const { summary, consultants, topProjectCols, methodology, projectStatuses, anomalies, weeklyData, loggingControl } = data;

    const criticalCount = anomalies.filter(a => a.type === 'critical').length;
    const warningCount  = anomalies.filter(a => a.type === 'warning').length;
    const infoCount     = anomalies.filter(a => a.type === 'info').length;

    res.render('dashboards/equipo', {
      title:           'Control de Equipo - Torus Dashboard',
      summary,
      consultants,
      projectStatuses,
      anomalies,
      criticalCount,
      warningCount,
      infoCount,
      weeklyLabels:    weeklyData.map(w => w.label),
      weeklyHours:     weeklyData.map(w => w.hours),
      loggingControl,
      methodology,
      topProjectCols,
      lastUpdate:      new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
      // Pass active filters and options to the template
      activeFilters:   filters,
      statusFilters:   config.PROJECT_STATUS_FILTERS,
      tagFilters:      config.PROJECT_TAG_FILTERS,
    });
  } catch (err) {
    console.error('Error loading equipo:', err.message);
    res.status(500).render('error', { message: 'Error cargando datos: ' + err.message });
  }
});

module.exports = router;
