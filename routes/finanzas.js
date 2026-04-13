'use strict';

const express = require('express');
const router  = express.Router();
const { fetchFinancialData, fetchCXC, fetchPipeline, fetchClosingRate } = require('../src/finanzas');

router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const [fin, cxc, pipeline, closingRate] = await Promise.all([
      fetchFinancialData(year),
      fetchCXC(),
      fetchPipeline(),
      fetchClosingRate(),
    ]);

    res.render('dashboards/finanzas', {
      title: 'Finanzas - Torus Dashboard',
      user:  req.user || null,
      year,
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
