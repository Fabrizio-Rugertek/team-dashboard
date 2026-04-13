/**
 * /equipo page route.
 * Query params:
 *   range      : '7d' | '30d' | 'mtd' | '60d' | '90d'
 *   consultant : login | 'all'
 *   status     : 'all' | 'active' | 'on_hold' | 'completed' | 'needs_attention'
 *   tag        : 'all' | 'sin_asignar' | 'backlog' | 'sobreestimado'
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { getDashboardCached } = require('../src/cache');
const config = require('../src/config');

const VALID_RANGES      = ['7d', '30d', 'mtd', '60d', '90d'];
const VALID_STATUSES    = ['all', 'active', 'on_hold', 'completed', 'needs_attention'];
const VALID_TAGS        = ['all', 'sin_asignar', 'backlog', 'sobreestimado'];

router.get('/', async (req, res) => {
  try {
    const filters = {
      range:      VALID_RANGES.includes(req.query.range)   ? req.query.range   : '30d',
      consultant: req.query.consultant || 'all',
      status:     VALID_STATUSES.includes(req.query.status) ? req.query.status : 'all',
      tag:        VALID_TAGS.includes(req.query.tag)        ? req.query.tag    : 'all',
    };

    const data = await getDashboardCached(filters);
    const {
      summary, consultants, consultantOptions, topProjectCols, methodology,
      projectStatuses, anomalies, weeklyData, loggingControl,
    } = data;

    const criticalCount = anomalies.filter(a => a.type === 'critical').length;
    const warningCount  = anomalies.filter(a => a.type === 'warning').length;
    const infoCount     = anomalies.filter(a => a.type === 'info').length;

    // Merge loggingControl.people with consultants (hours data) into consultant cards
    const consultantCards = loggingControl.people.map(person => {
      const c = consultants.find(c => c.login === person.login) || {};
      return {
        ...person,
        hoursInRange:    c.hoursInRange    || 0,
        hoursThisWeek:   c.hoursThisWeek   || 0,
        billableWeek:    c.billableWeek    || 0,
        nonBillableWeek: c.nonBillableWeek || 0,
        billablePct:     c.billablePct     || 0,
        projectCount:    c.projectCount    || 0,
      };
    });

    // Helper: build URL preserving current params and overriding specific ones
    const buildQuery = (overrides) => {
      const base = { range: filters.range, consultant: filters.consultant, status: filters.status, tag: filters.tag };
      Object.assign(base, overrides);
      const params = new URLSearchParams();
      if (base.range      && base.range      !== '30d')  params.set('range',      base.range);
      if (base.consultant && base.consultant !== 'all')   params.set('consultant', base.consultant);
      if (base.status     && base.status     !== 'all')   params.set('status',     base.status);
      if (base.tag        && base.tag        !== 'all')   params.set('tag',        base.tag);
      const qs = params.toString();
      return qs ? '/equipo?' + qs : '/equipo';
    };

    res.render('dashboards/equipo', {
      title:            'Control de Equipo - Torus Dashboard',
      summary,
      consultants,
      consultantCards,
      consultantOptions,
      topProjectCols,
      methodology,
      projectStatuses,
      anomalies,
      criticalCount,
      warningCount,
      infoCount,
      weeklyLabels:     weeklyData.map(w => w.label),
      weeklyHours:      weeklyData.map(w => w.hours),
      loggingControl,
      activeFilters:    filters,
      statusFilters:    config.PROJECT_STATUS_FILTERS,
      tagFilters:       config.PROJECT_TAG_FILTERS,
      dateRanges:       config.DATE_RANGES,
      buildQuery,
      lastUpdate:       new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
    });
  } catch (err) {
    console.error('Error loading equipo:', err.message);
    res.status(500).render('error', { message: 'Error cargando datos: ' + err.message });
  }
});

module.exports = router;
