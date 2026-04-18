/**
 * /proyectos page route — Portfolio view with RAG status, capacity, and alerts.
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const { getDashboardCached } = require('../src/cache');
const { fetchExchangeRate }  = require('../src/finanzas');

const ODOO_URL = process.env.ODOO_URL || 'https://www.torus.dev';

// RAG helpers
function computeRag(p) {
  if ((p.hoursPct !== null && p.hoursPct >= 120) || p.daysSinceUpdate >= 14) return 'red';
  if ((p.hoursPct !== null && p.hoursPct >= 80)  || p.daysSinceUpdate >= 7)  return 'amber';
  return 'green';
}

function ragOrder(rag) { return rag === 'red' ? 0 : rag === 'amber' ? 1 : 2; }

router.get('/', async (req, res) => {
  try {
    const [data, usdRate] = await Promise.all([
      getDashboardCached({ range: '30d' }),
      fetchExchangeRate().catch(() => 7500),
    ]);

    const { capacityData, projectAlerts } = data;

    // All non-internal projects
    const allProjects = (data.projectStatuses || []).filter(p => !p.isInternal);

    // Active = non-completed, non-internal
    const activeProjects = allProjects.filter(p => !p.isCompleted);

    // Annotate with RAG
    const annotated = allProjects.map(p => ({
      ...p,
      rag: computeRag(p),
    }));

    // Sort: red → amber → green; within group by daysSinceUpdate desc
    annotated.sort((a, b) => {
      const ragDiff = ragOrder(a.rag) - ragOrder(b.rag);
      if (ragDiff !== 0) return ragDiff;
      return (b.daysSinceUpdate || 0) - (a.daysSinceUpdate || 0);
    });

    // Summary stats
    const activeAnnotated = annotated.filter(p => !p.isCompleted);
    const redCount    = activeAnnotated.filter(p => p.rag === 'red').length;
    const amberCount  = activeAnnotated.filter(p => p.rag === 'amber').length;
    const greenCount  = activeAnnotated.filter(p => p.rag === 'green').length;
    const overloaded  = activeAnnotated.filter(p => p.hoursPct !== null && p.hoursPct >= 120).length;
    const totalBudgetHours  = activeAnnotated.reduce((s, p) => s + (p.totalAlloc || 0), 0);
    const totalLoggedHours  = activeAnnotated.reduce((s, p) => s + (p.totalLog  || 0), 0);

    res.render('dashboards/proyectos', {
      title:            'Portfolio de Proyectos - Torus Dashboard',
      user:             req.user || null,
      projects:         annotated,
      capacityData:     capacityData || [],
      projectAlerts:    projectAlerts || [],
      totalActive:      activeAnnotated.length,
      redCount,
      amberCount,
      greenCount,
      overloaded,
      totalBudgetHours,
      totalLoggedHours,
      usdRate,
      odooUrl:          ODOO_URL,
      lastUpdate:       new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
    });
  } catch (err) {
    console.error('Error loading proyectos:', err.message);
    res.status(500).render('error', { message: 'Error cargando datos: ' + err.message });
  }
});

module.exports = router;
