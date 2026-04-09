const express = require('express');
const router = express.Router();
const { getDashboardCached } = require('../src/cache');

router.get('/', async (req, res) => {
  try {
    const data = await getDashboardCached();
    const { summary, consultants, projectStatuses, anomalies, weeklyData } = data;

    const criticalCount = anomalies.filter(a => a.type === 'critical').length;
    const warningCount = anomalies.filter(a => a.type === 'warning').length;
    const infoCount = anomalies.filter(a => a.type === 'info').length;

    res.render('dashboards/equipo', {
      title: 'Control de Equipo — Torus Dashboard',
      summary, consultants, projectStatuses, anomalies,
      criticalCount, warningCount, infoCount,
      weeklyLabels: weeklyData.map(w => w.label),
      weeklyHours: weeklyData.map(w => w.hours),
      lastUpdate: new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
    });
  } catch (err) {
    console.error('Error loading equipo:', err.message);
    res.status(500).render('error', { message: 'Error cargando datos: ' + err.message });
  }
});

module.exports = router;
