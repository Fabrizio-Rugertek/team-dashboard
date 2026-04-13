/**
 * /equipo page route.
 * Query params:
 *   range       : '7d' | '30d' | 'mtd' | '60d' | '90d' | 'custom'
 *   from        : 'YYYY-MM-DD'  (only when range=custom)
 *   to          : 'YYYY-MM-DD'  (only when range=custom)
 *   consultants : comma-separated logins | 'all'
 *   status      : 'all' | 'active' | 'on_hold' | 'completed' | 'needs_attention'
 *   tag         : 'all' | 'sin_asignar' | 'backlog' | 'sobreestimado'
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { getDashboardCached } = require('../src/cache');
const config = require('../src/config');

const VALID_RANGES   = ['7d', '30d', 'mtd', '60d', '90d', 'custom'];
const VALID_STATUSES = ['all', 'active', 'on_hold', 'completed', 'needs_attention'];
const VALID_TAGS     = ['all', 'sin_asignar', 'backlog', 'sobreestimado'];

// ── Date helpers ──────────────────────────────────────────────────────────────
function isValidDate(str) { return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str)); }

function getRangeStart(range) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  switch (range) {
    case '7d':  { const d = new Date(today); d.setDate(d.getDate() - 7);  return d; }
    case 'mtd': return new Date(today.getFullYear(), today.getMonth(), 1);
    case '60d': { const d = new Date(today); d.setDate(d.getDate() - 60); return d; }
    case '90d': { const d = new Date(today); d.setDate(d.getDate() - 90); return d; }
    default:    { const d = new Date(today); d.setDate(d.getDate() - 30); return d; }
  }
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
}

function buildRangeLabel(range, from, to) {
  if (range === 'custom' && from && to) {
    return `Personalizado · ${formatShortDate(from)} – ${formatShortDate(to)}`;
  }
  const preset = config.DATE_RANGES.find(r => r.value === range);
  const label  = preset ? preset.label : '30 días';
  const start  = getRangeStart(range);
  const end    = new Date(); end.setHours(0, 0, 0, 0);
  return `${label} · ${formatShortDate(start.toISOString().slice(0, 10))} – ${formatShortDate(end.toISOString().slice(0, 10))}`;
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const range = VALID_RANGES.includes(req.query.range) ? req.query.range : '30d';

    // Custom date range
    const from = (range === 'custom' && isValidDate(req.query.from)) ? req.query.from : null;
    const to   = (range === 'custom' && isValidDate(req.query.to))   ? req.query.to   : null;

    // Multi-select consultants (comma-separated logins)
    const rawConsultants = (req.query.consultants || 'all').trim();
    const consultantSet  = rawConsultants === 'all'
      ? new Set()
      : new Set(rawConsultants.split(',').map(s => s.trim()).filter(Boolean));

    const filters = {
      range,
      from:        from || undefined,
      to:          to   || undefined,
      consultants: consultantSet,
      status:      VALID_STATUSES.includes(req.query.status) ? req.query.status : 'all',
      tag:         VALID_TAGS.includes(req.query.tag)        ? req.query.tag    : 'all',
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

    // Compute consultant filter label for display
    const technical  = consultantOptions.filter(c => c.jobType === 'technical');
    const functional = consultantOptions.filter(c => c.jobType === 'functional');
    let consultantLabel = 'Todos';
    if (consultantSet.size > 0) {
      const allTech = technical.every(c => consultantSet.has(c.login)) && functional.every(c => !consultantSet.has(c.login));
      const allFunc = functional.every(c => consultantSet.has(c.login)) && technical.every(c => !consultantSet.has(c.login));
      if (allTech) consultantLabel = 'Solo Técnicos';
      else if (allFunc) consultantLabel = 'Solo Funcionales';
      else consultantLabel = `${consultantSet.size} consultor${consultantSet.size !== 1 ? 'es' : ''}`;
    }

    // Helper: build URL preserving current params and overriding specific ones
    const buildQuery = (overrides) => {
      const base = {
        range: filters.range,
        from:  filters.from,
        to:    filters.to,
        consultants: consultantSet.size > 0 ? [...consultantSet].join(',') : 'all',
        status: filters.status,
        tag:    filters.tag,
      };
      Object.assign(base, overrides);
      // If overrides change consultant to a login string, convert to single-item
      if (typeof overrides.consultant === 'string') {
        base.consultants = overrides.consultant === 'all' ? 'all' : overrides.consultant;
        delete base.consultant;
      }
      const params = new URLSearchParams();
      if (base.range      && base.range      !== '30d')  params.set('range',       base.range);
      if (base.range === 'custom' && base.from)           params.set('from',        base.from);
      if (base.range === 'custom' && base.to)             params.set('to',          base.to);
      if (base.consultants && base.consultants !== 'all') params.set('consultants', base.consultants);
      if (base.status     && base.status     !== 'all')   params.set('status',      base.status);
      if (base.tag        && base.tag        !== 'all')   params.set('tag',         base.tag);
      const qs = params.toString();
      return qs ? '/equipo?' + qs : '/equipo';
    };

    res.render('dashboards/equipo', {
      title:            'Control de Equipo - Torus Dashboard',
      user:             req.user || null,
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
      selectedLogins:   consultantSet,
      consultantLabel,
      rangeLabel:       buildRangeLabel(range, from, to),
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
