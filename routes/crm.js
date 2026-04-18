/**
 * /crm — dedicated CRM analytics dashboard.
 *
 * Query params:
 *   hunter   : Odoo user ID of the hunter  (x_hunter_id)
 *   closer   : Odoo user ID of the closer  (user_id)
 *   source   : Odoo source ID              (source_id)
 *   stage    : Odoo stage ID               (stage_id)
 *   from     : 'YYYY-MM-DD' filter start
 *   to       : 'YYYY-MM-DD' filter end
 *   dateType : 'created' | 'closed'
 *   tab      : active tab name
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { fetchCRMOpportunities } = require('../src/odoo');
const { extractFilterOptions, applyFilters, computeCRMStats } = require('../src/crm');

const VALID_DATE_TYPES = ['created', 'closed'];
const VALID_TABS       = ['resumen', 'funnel', 'hunters', 'tendencia', 'fuentes'];

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function isValidId(val) {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
}

router.get('/', async (req, res) => {
  try {
    // ── Parse filters ─────────────────────────────────────────────────────────
    const hunterId  = isValidId(req.query.hunter) ? parseInt(req.query.hunter) : null;
    const closerId  = isValidId(req.query.closer) ? parseInt(req.query.closer) : null;
    const sourceId  = isValidId(req.query.source) ? parseInt(req.query.source) : null;
    const stageId   = isValidId(req.query.stage)  ? parseInt(req.query.stage)  : null;
    const dateType  = VALID_DATE_TYPES.includes(req.query.dateType) ? req.query.dateType : 'created';
    const from      = isValidDate(req.query.from) ? req.query.from : null;
    const to        = isValidDate(req.query.to)   ? req.query.to   : null;
    const activeTab = VALID_TABS.includes(req.query.tab) ? req.query.tab : 'resumen';

    const filters = { hunterId, closerId, sourceId, stageId, from, to, dateType };

    // Count active filters for badge display
    const activeFilterCount = [hunterId, closerId, sourceId, stageId, from, to]
      .filter(Boolean).length;

    // ── Fetch all opps from Odoo ──────────────────────────────────────────────
    const allOpps = await fetchCRMOpportunities().catch(e => {
      console.error('[CRM route] Odoo fetch error:', e.message);
      return [];
    });

    // ── Extract dropdown options from ALL opps (unfiltered) ──────────────────
    const filterOptions = extractFilterOptions(allOpps);

    // ── Apply filters and compute stats ──────────────────────────────────────
    const filteredOpps = applyFilters(allOpps, filters);
    const crmStats     = computeCRMStats(filteredOpps);

    // ── Helper: build URL preserving current params + overrides ──────────────
    function buildQuery(overrides = {}) {
      const base = {
        hunter:   hunterId,
        closer:   closerId,
        source:   sourceId,
        stage:    stageId,
        dateType: dateType !== 'created' ? dateType : null,
        from,
        to,
        tab:      activeTab !== 'resumen' ? activeTab : null,
      };
      Object.assign(base, overrides);
      const params = new URLSearchParams();
      if (base.hunter)   params.set('hunter',   base.hunter);
      if (base.closer)   params.set('closer',   base.closer);
      if (base.source)   params.set('source',   base.source);
      if (base.stage)    params.set('stage',    base.stage);
      if (base.dateType) params.set('dateType', base.dateType);
      if (base.from)     params.set('from',     base.from);
      if (base.to)       params.set('to',       base.to);
      if (base.tab)      params.set('tab',      base.tab);
      const qs = params.toString();
      return qs ? '/crm?' + qs : '/crm';
    }

    res.render('dashboards/crm', {
      title:            'CRM — Torus Dashboard',
      user:             req.user || null,
      crmStats,
      crmJSON:          JSON.stringify(crmStats),
      filterOptions,
      activeFilters:    filters,
      activeFilterCount,
      activeTab,
      buildQuery,
      lastUpdate:       new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
    });

  } catch (err) {
    console.error('[CRM]', err.message, err.stack);
    res.status(500).render('error', { message: 'Error cargando CRM: ' + err.message });
  }
});

module.exports = router;
