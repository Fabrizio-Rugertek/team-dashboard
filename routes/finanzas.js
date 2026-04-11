/**
 * /finanzas page + AJAX drill-down API.
 */
'use strict';
const express = require('express');
const router = express.Router();
const { fetchRevenueByMonth, fetchCostsByMonth, fetchAnalyticAccounts } = require('../src/finanzas');
const { callKw } = require('../src/odoo');

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Build EERR summary rows ────────────────────────────────────────────────
function buildEerrRows(revenueByProduct, costByAnalytic, year) {
  const byAnalytic = {};

  // Revenue
  for (const r of revenueByProduct) {
    const an = r.analytic;
    if (!byAnalytic[an]) byAnalytic[an] = { name: an, revenue: {}, cost: {}, totalRevenue: 0, totalCost: 0 };
    byAnalytic[an].revenue[r.month] = (byAnalytic[an].revenue[r.month] || 0) + r.total;
    byAnalytic[an].totalRevenue += r.total;
  }

  // Cost
  for (const c of costByAnalytic) {
    const an = c.analytic;
    if (!byAnalytic[an]) byAnalytic[an] = { name: an, revenue: {}, cost: {}, totalRevenue: 0, totalCost: 0 };
    byAnalytic[an].cost[c.month] = (byAnalytic[an].cost[c.month] || 0) + c.total;
    byAnalytic[an].totalCost += c.total;
  }

  // Build rows
  return Object.values(byAnalytic).sort((a, b) => b.totalRevenue - a.totalRevenue).map(row => {
    const months = {};
    let monthlyRevenue = 0;
    let monthlyCost = 0;
    for (let m = 1; m <= 12; m++) {
      const ms = `${year}-${String(m).padStart(2, '0')}`;
      months[ms] = {
        revenue: row.revenue[ms] || 0,
        cost: row.cost[ms] || 0,
      };
      monthlyRevenue += (row.revenue[ms] || 0);
      monthlyCost += (row.cost[ms] || 0);
    }
    return {
      name: row.name,
      totalRevenue: row.totalRevenue,
      totalCost: row.totalCost,
      margin: row.totalRevenue - row.totalCost,
      marginPct: row.totalRevenue > 0 ? ((row.totalRevenue - row.totalCost) / row.totalRevenue * 100) : 0,
      months,
    };
  });
}

// ── Totals row ─────────────────────────────────────────────────────────────
function buildTotals(revenueByProduct, costByAnalytic, year) {
  const byMonth = {};
  for (let m = 1; m <= 12; m++) {
    const ms = `${year}-${String(m).padStart(2,'0')}`;
    byMonth[ms] = { revenue: 0, cost: 0 };
  }
  let totalRevenue = 0, totalCost = 0;
  for (const r of revenueByProduct) {
    byMonth[r.month].revenue += r.total;
    totalRevenue += r.total;
  }
  for (const c of costByAnalytic) {
    byMonth[c.month].cost += c.total;
    totalCost += c.total;
  }
  return { byMonth, totalRevenue, totalCost, margin: totalRevenue - totalCost,
    marginPct: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0 };
}

// ── GET /finanzas ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const [revenueData, costData, analytics] = await Promise.all([
      fetchRevenueByMonth(year),
      fetchCostsByMonth(year),
      fetchAnalyticAccounts(),
    ]);

    const { byMonth: revByMonth, byProduct: revenueByProduct, detail: revDetail } = revenueData;
    const { byMonth: costByMonth, byAnalytic: costByAnalytic, detail: costDetail } = costData;

    const rows = buildEerrRows(revenueByProduct, costByAnalytic, year);
    const totals = buildTotals(revenueByProduct, costByAnalytic, year);

    // KPI cards
    const kpis = {
      totalRevenue: totals.totalRevenue,
      totalCost: totals.totalCost,
      margin: totals.margin,
      marginPct: totals.marginPct,
    };

    res.render('dashboards/finanzas', {
      title: 'Finanzas - Torus Dashboard',
      kpis,
      rows,
      totals,
      analytics,
      year,
      revByMonth,
      costByMonth,
      lastUpdate: new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
    });
  } catch (err) {
    console.error('Error loading finanzas:', err.message, err.stack);
    res.status(500).render('error', { message: 'Error cargando finanzas: ' + err.message });
  }
});

// ── GET /api/finanzas/detail  Query params: type=revenue|cost, analytic=..., month=YYYY-MM
router.get('/detail', async (req, res) => {
  try {
    const { type, analytic, month } = req.query;
    if (!type || !analytic || !month) {
      return res.status(400).json({ error: 'Faltan parametros: type, analytic, month' });
    }

    // Fetch all moves for that month + analytic type
    const dateFrom = month + '-01';
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const dateTo = `${y}-${String(m).padStart(2,'0')}-${lastDay}`;

    const moves = await callKw('account.move', 'search_read',
      [[
        type === 'revenue'
          ? ['move_type', '=', 'out_invoice']
          : ['move_type', '=', 'in_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', dateFrom],
        ['invoice_date', '<=', dateTo],
        ['company_id', '=', 1]
      ]],
      { fields: ['id', 'name', 'partner_id', 'invoice_date'], context: { bin_size: true } }
    );

    const SKIP_ACCOUNTS = new Set([3908, 3914, 3923]);
    const lines = [];

    for (const mv of moves) {
      const mvLines = await callKw('account.move.line', 'search_read',
        [[
          ['move_id', '=', mv.id],
          type === 'revenue' ? ['credit', '>', 0] : ['debit', '>', 0],
          ['account_id', 'not in', [...SKIP_ACCOUNTS]]
        ]],
        { fields: ['id', 'name', 'account_id', 'credit', 'debit', 'analytic_distribution'] }
      );

      for (const l of mvLines) {
        const desc = (l.name || '').slice(0, 80);
        if (!desc || desc.length < 3) continue;
        const analyticDist = l.analytic_distribution;
        let analyticName = 'SIN TAG';
        if (analyticDist) {
          const aid = Object.keys(analyticDist)[0];
          const a = await callKw('account.analytic.account', 'read', [[parseInt(aid)]], { fields: ['name'] });
          analyticName = a && a[0] ? a[0].name : 'SIN TAG';
        }
        if (analyticName !== analytic) continue;
        const amount = type === 'revenue' ? l.credit : l.debit;
        if (!amount || amount <= 0) continue;
        lines.push({
          line_id: l.id,
          move_id: mv.id,
          move_name: mv.name,
          date: mv.invoice_date,
          partner_id: mv.partner_id?.[0] || null,
          partner_name: mv.partner_id?.[1] || '?',
          desc,
          account_name: l.account_id?.[1] || '?',
          analytic: analyticName,
          amount,
        });
      }
    }

    res.json({ lines, count: lines.length });
  } catch (err) {
    console.error('Error in finanzas detail:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
