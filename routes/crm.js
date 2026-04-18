/**
 * /crm — dedicated CRM analytics dashboard.
 *
 * Query params:
 *   range    : '7d' | '30d' | 'mtd' | '60d' | '90d' | 'custom' | 'all'
 *   from     : 'YYYY-MM-DD'  (only when range=custom)
 *   to       : 'YYYY-MM-DD'  (only when range=custom)
 *   dateType : 'created' | 'closed'
 *   hunter   : Odoo user ID
 *   closer   : Odoo user ID
 *   source   : Odoo source ID
 *   stage    : Odoo stage ID
 *   tab      : active tab name
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { fetchCRMOpportunities } = require('../src/odoo');
const { extractFilterOptions, applyFilters, computeCRMStats } = require('../src/crm');

const VALID_RANGES     = ['7d', '30d', 'mtd', '60d', '90d', 'custom', 'all'];
const VALID_DATE_TYPES = ['created', 'closed'];
const VALID_TABS       = ['resumen', 'funnel', 'hunters', 'tendencia', 'fuentes'];

const CRM_DATE_RANGES = [
  { value: 'all', label: 'Todo el tiempo' },
  { value: '7d',  label: '7 días'         },
  { value: '30d', label: '30 días'        },
  { value: 'mtd', label: 'Mes actual'     },
  { value: '90d', label: '90 días'        },
  { value: '180d', label: '180 días'      },
];

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function isValidId(val) {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
}

function getRangeStart(range) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  switch (range) {
    case '7d':   { const d = new Date(today); d.setDate(d.getDate() - 7);   return d; }
    case 'mtd':  return new Date(today.getFullYear(), today.getMonth(), 1);
    case '60d':  { const d = new Date(today); d.setDate(d.getDate() - 60);  return d; }
    case '90d':  { const d = new Date(today); d.setDate(d.getDate() - 90);  return d; }
    case '180d': { const d = new Date(today); d.setDate(d.getDate() - 180); return d; }
    default:     { const d = new Date(today); d.setDate(d.getDate() - 30);  return d; }
  }
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
}

function buildRangeLabel(range, from, to) {
  if (range === 'all') return 'Todo el tiempo';
  if (range === 'custom' && from && to) {
    return `Personalizado · ${formatShortDate(from)} – ${formatShortDate(to)}`;
  }
  const preset = CRM_DATE_RANGES.find(r => r.value === range);
  const label  = preset ? preset.label : '30 días';
  const start  = getRangeStart(range);
  const end    = new Date(); end.setHours(0, 0, 0, 0);
  return `${label} · ${formatShortDate(start.toISOString().slice(0, 10))} – ${formatShortDate(end.toISOString().slice(0, 10))}`;
}

router.get('/', async (req, res) => {
  try {
    // ── Parse filters ─────────────────────────────────────────────────────────
    const range    = VALID_RANGES.includes(req.query.range) ? req.query.range : 'all';
    const dateType = VALID_DATE_TYPES.includes(req.query.dateType) ? req.query.dateType : 'created';
    const hunterId = isValidId(req.query.hunter) ? parseInt(req.query.hunter) : null;
    const closerId = isValidId(req.query.closer) ? parseInt(req.query.closer) : null;
    const sourceId = isValidId(req.query.source) ? parseInt(req.query.source) : null;
    const stageId  = isValidId(req.query.stage)  ? parseInt(req.query.stage)  : null;
    const activeTab = VALID_TABS.includes(req.query.tab) ? req.query.tab : 'resumen';

    // Resolve from/to
    let from = null;
    let to   = null;
    if (range === 'custom') {
      from = isValidDate(req.query.from) ? req.query.from : null;
      to   = isValidDate(req.query.to)   ? req.query.to   : null;
    } else if (range !== 'all') {
      from = getRangeStart(range).toISOString().slice(0, 10);
      to   = new Date().toISOString().slice(0, 10);
    }

    const filters = { hunterId, closerId, sourceId, stageId, from, to, dateType };
    const activeFilterCount = [hunterId, closerId, sourceId, stageId, range !== 'all' ? range : null]
      .filter(Boolean).length;

    // ── Fetch + compute ───────────────────────────────────────────────────────
    const allOpps = await fetchCRMOpportunities().catch(e => {
      console.error('[CRM route] Odoo fetch error:', e.message);
      return [];
    });

    const filterOptions = extractFilterOptions(allOpps);
    const filteredOpps  = applyFilters(allOpps, filters);
    const crmStats      = computeCRMStats(filteredOpps);

    res.render('dashboards/crm', {
      title:            'CRM — Torus Dashboard',
      user:             req.user || null,
      crmStats,
      crmJSON:          JSON.stringify(crmStats),
      filterOptions,
      activeFilters:    { range, from, to, dateType, hunterId, closerId, sourceId, stageId },
      activeFilterCount,
      activeTab,
      rangeLabel:       buildRangeLabel(range, from, to),
      dateRanges:       CRM_DATE_RANGES,
      lastUpdate:       new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
    });

  } catch (err) {
    console.error('[CRM]', err.message, err.stack);
    res.status(500).render('error', { message: 'Error cargando CRM: ' + err.message });
  }
});

module.exports = router;
