'use strict';

const express = require('express');
const router  = express.Router();
const { fetchFinancialData, fetchCXC, fetchPipeline, fetchClosingRate } = require('../src/finanzas');

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    let { year: yearQ, from, to, period } = req.query;

    // Resolve quarter presets
    const baseYear = parseInt(yearQ) || now.getFullYear();
    if (period === 'q1') { from = `${baseYear}-01-01`; to = `${baseYear}-03-31`; }
    if (period === 'q2') { from = `${baseYear}-04-01`; to = `${baseYear}-06-30`; }
    if (period === 'q3') { from = `${baseYear}-07-01`; to = `${baseYear}-09-30`; }
    if (period === 'q4') { from = `${baseYear}-10-01`; to = `${baseYear}-12-31`; }

    const year = (from ? parseInt(from.slice(0, 4)) : baseYear);
    const activeFilters = { year, from: from || null, to: to || null, period: period || null };

    const [fin, cxc, pipeline, closingRate] = await Promise.all([
      fetchFinancialData(year, { from, to }),
      fetchCXC(),
      fetchPipeline(),
      fetchClosingRate(),
    ]);

    res.render('dashboards/finanzas', {
      title: 'Finanzas - Torus Dashboard',
      user:  req.user || null,
      year,
      activeFilters,
      fin,
      cxc,
      pipeline,
      closingRate,
      cxcItemsJson: JSON.stringify(cxc.items || []),
      lastUpdate: new Date().toLocaleString('es-PY', { dateStyle: 'medium', timeStyle: 'short' }),
    });
  } catch (err) {
    console.error('[finanzas]', err.message, err.stack);
    res.status(500).render('error', { message: 'Error cargando finanzas: ' + err.message });
  }
});

module.exports = router;
