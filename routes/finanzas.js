'use strict';

const express = require('express');
const router  = express.Router();
const { fetchFinancialData, fetchCXC, fetchPipeline } = require('../src/finanzas');

router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const [fin, cxc, pipeline] = await Promise.all([
      fetchFinancialData(year),
      fetchCXC(),
      fetchPipeline(),
    ]);

    res.render('dashboards/finanzas', {
      title: 'Finanzas - Torus Dashboard',
      user:  req.user || null,
      year,
      fin,
      cxc,
      pipeline,
      lastUpdate: new Date().toLocaleString('es-PY', { dateStyle: 'medium', timeStyle: 'short' }),
    });
  } catch (err) {
    console.error('[finanzas]', err.message, err.stack);
    res.status(500).render('error', { message: 'Error cargando finanzas: ' + err.message });
  }
});

module.exports = router;
