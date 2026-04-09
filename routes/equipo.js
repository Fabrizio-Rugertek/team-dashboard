const express = require('express');
const router = express.Router();
const { getDashboardCached } = require('../src/cache');

router.get('/', async (req, res) => {
  try {
    const data = await getDashboardCached();
    const { summary, consultants, stageData, projectStatuses, anomalies, weeklyData } = data;

    const payload = {
      title: 'Equipo — Torus Dashboard',
      weekHours: summary.weekHours,
      monthHours: summary.monthHours,
      activeUsers: summary.activeUsers,
      totalActiveEmployees: summary.totalActiveEmployees,
      totalTasks: summary.totalTasks,
      doneTasks: summary.doneTasks,
      completionRate: summary.completionRate,
      consultants: consultants.sort((a,b) => b.hoursThisWeek - a.hoursThisWeek),
      stageLabels: stageData.map(s => s.name),
      stageCounts: stageData.map(s => s.count),
      projectStatuses,
      anomalies,
      criticalCount: anomalies.filter(a => a.type === 'critical').length,
      warningCount: anomalies.filter(a => a.type === 'warning').length,
      infoCount: anomalies.filter(a => a.type === 'info').length,
      weekLabels: (weeklyData || []).map(w => w.label),
      weekHours: (weeklyData || []).map(w => w.hours),
      weekHoursTarget: Math.round(summary.activeUsers * 40),
      weekHoursPct: summary.activeUsers > 0 ? Math.round(summary.weekHours / (summary.activeUsers * 40) * 100) : 0,
      lastUpdate: new Date().toLocaleString('es-ES')
    };

    res.render('dashboards/equipo', { payload });
  } catch (err) {
    console.error('Error loading equipo:', err.message);
    res.status(500).render('error', { message: 'Error cargando datos: ' + err.message });
  }
});

module.exports = router;
