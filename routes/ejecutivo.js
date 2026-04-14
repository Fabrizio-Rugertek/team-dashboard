'use strict';

const express = require('express');
const router  = express.Router();

const {
  fetchFinancialData,
  fetchCXC,
  fetchExchangeRate,
  fetchPipeline,
  fetchPayroll,
} = require('../src/finanzas');
const { getDashboardCached } = require('../src/cache');

function pad(n) { return String(n).padStart(2, '0'); }

router.get('/', async (req, res) => {
  try {
    const today    = new Date();
    const year     = today.getFullYear();
    const curMonthKey = `${year}-${pad(today.getMonth() + 1)}`;

    // Parallel fetch — financial + team data
    const [fin, cxc, usdRate, pipeline, payroll, equipoRaw] = await Promise.all([
      fetchFinancialData(year),
      fetchCXC(),
      fetchExchangeRate(),
      fetchPipeline(),
      fetchPayroll(year),
      getDashboardCached({ range: 'mtd', status: 'all', tag: 'all', consultants: new Set() }),
    ]);

    // ── Utilization (MTD billable %) ────────────────────────────────────────
    const billableRange    = equipoRaw.summary?.billableRange    || 0;
    const nonBillableRange = equipoRaw.summary?.nonBillableRange || 0;
    const totalRange       = billableRange + nonBillableRange;
    const utilization      = equipoRaw.summary?.billableRangePct ?? (
      totalRange > 0 ? Math.round(billableRange / totalRange * 100) : 0
    );

    // ── CXC overdue ─────────────────────────────────────────────────────────
    const b              = cxc.buckets || {};
    const overdueAmount  = (b.d1_30 || 0) + (b.d31_60 || 0) + (b.d61_90 || 0) + (b.d90plus || 0);
    const overdueItems   = (cxc.items || [])
      .filter(i => i.daysOverdue > 0)
      .sort((a, b2) => b2.residual - a.residual)
      .slice(0, 8);

    // ── Project health (RAG) — use Plan 1 projectRows ───────────────────────
    // Only show properly tagged projects (skip "sin proyecto" catch-alls)
    const projectHealth = (fin.projectRows || [])
      .filter(r => r.totalRevenue > 0 && !r.untagged)
      .map(r => {
        const mp  = typeof r.marginPct === 'string' ? parseFloat(r.marginPct) : (r.marginPct || 0);
        const rag = mp >= 25 ? 'green' : mp >= 10 ? 'amber' : 'red';
        const curRev = (r.months || []).find(m => m.month === curMonthKey)?.revenue || 0;
        return { ...r, marginPctNum: mp, rag, activeThisMonth: curRev > 0, curMonthRevenue: curRev };
      });

    const projectsAtRisk = projectHealth.filter(p => p.rag === 'red').length;
    const projectsAmber  = projectHealth.filter(p => p.rag === 'amber').length;

    // ── P&L estimado ─────────────────────────────────────────────────────────
    // Revenue: from posted invoices (fin.totalRevenue)
    // Direct costs: from vendor bills in Odoo (fin.totalCost)
    // Payroll: from active hr.contract wages
    const vendorCosts   = fin.totalCost   || 0;
    const payrollTotal  = payroll.totalPayroll || 0;
    const resultadoAnteImp = (fin.totalRevenue || 0) - vendorCosts - payrollTotal;
    const resultadoPct  = fin.totalRevenue > 0
      ? Math.round(resultadoAnteImp / fin.totalRevenue * 100) : 0;
    // Service line breakdown for the secondary view
    const serviceRows = (fin.serviceRows || []).filter(r => !r.untagged).slice(0, 8);

    // ── Forecast de facturación ─────────────────────────────────────────────
    const daysInMonth = new Date(year, today.getMonth() + 1, 0).getDate();
    const daysElapsed = today.getDate();
    const revSoFar    = fin.curMonth?.revenue || 0;
    const forecast    = daysElapsed > 0 ? Math.round(revSoFar / daysElapsed * daysInMonth) : 0;
    const forecastPct = revSoFar > 0 && forecast > 0 ? Math.round(revSoFar / forecast * 100) : 0;

    // ── Current month margin % ──────────────────────────────────────────────
    const curRev    = fin.curMonth?.revenue || 0;
    const curMargin = fin.curMonth?.margin  || 0;
    const curMarginPct = curRev > 0 ? Math.round(curMargin / curRev * 100) : 0;

    // ── Revenue trend (last 6 months) ───────────────────────────────────────
    const trendMonths    = (fin.months || []).slice(-6);
    const revTrendLabels = trendMonths.map(m => m.label);
    const revTrendData   = trendMonths.map(m => m.revenue);
    const marginTrendData = trendMonths.map(m => m.margin);

    // ── Consultant weekly snapshot ──────────────────────────────────────────
    const consultantCount = (equipoRaw.consultants || []).length;

    res.render('dashboards/ejecutivo', {
      title: 'Vista Ejecutiva',
      user: req.user,
      year,
      curMonthKey,
      fin,
      curMonth:       fin.curMonth || {},
      curMarginPct,
      utilization,
      billableRange,
      totalRange,
      overdueAmount,
      overdueItems,
      cxcBuckets:     b,
      cxcTotal:       cxc.total || 0,
      projectsAtRisk,
      projectsAmber,
      projectHealth,
      serviceRows,
      // P&L
      vendorCosts,
      payrollTotal,
      resultadoAnteImp,
      resultadoPct,
      payroll,
      // Untagged warning
      untaggedRev: fin.untaggedProjectRev || 0,
      // Forecast
      forecast,
      forecastPct,
      daysElapsed,
      daysInMonth,
      revSoFar,
      pipeline,
      usdRate,
      revTrendLabels:  JSON.stringify(revTrendLabels),
      revTrendData:    JSON.stringify(revTrendData),
      marginTrendData: JSON.stringify(marginTrendData),
      consultantCount,
      lastUpdate: new Date().toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' }),
    });
  } catch (err) {
    console.error('[Ejecutivo] Error:', err);
    res.status(500).render('error', { error: err, user: req.user });
  }
});

module.exports = router;
