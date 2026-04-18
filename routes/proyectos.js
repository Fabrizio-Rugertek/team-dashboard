'use strict';
const express = require('express');
const router  = express.Router();
const { fetchProjectsWithStatus } = require('../src/odoo');
const { fetchExchangeRate }       = require('../src/finanzas');

const ODOO_URL = process.env.ODOO_URL || 'https://www.torus.dev';

const STAGE_MAP = {
  14: { phase: 0, label: 'Kick-off' },
  15: { phase: 1, label: 'Análisis' },
  16: { phase: 2, label: 'Implementación' },
  17: { phase: 3, label: 'Capacitación' },
  18: { phase: 4, label: 'UAT' },
  19: { phase: 5, label: 'Cut-over' },
  20: { phase: 6, label: 'Go-Live' },
  21: { phase: 7, label: 'Estabilización' },
  22: { phase: 8, label: 'Cerrado' },
  2:  { phase: null, label: 'En progreso' },
  5:  { phase: null, label: 'Interno' },
  6:  { phase: null, label: 'Template' },
  4:  { phase: null, label: 'Cancelada' },
};

const STATUS_CONFIG = {
  on_track:  { label: 'En curso',      color: '#10B981', bg: '#D1FAE5', icon: 'checkmark' },
  at_risk:   { label: 'En riesgo',     color: '#EF4444', bg: '#FEE2E2', icon: 'warning' },
  off_track: { label: 'Fuera de ruta', color: '#F59E0B', bg: '#FEF3C7', icon: 'exclamation' },
  done:      { label: 'Cerrado',       color: '#6366F1', bg: '#EEF2FF', icon: 'checkmark' },
  to_define: { label: 'Sin estado',    color: '#94A3B8', bg: '#F1F5F9', icon: 'dash' },
};

router.get('/', async (req, res) => {
  try {
    const [{ projects, latestUpdate }] = await Promise.all([
      fetchProjectsWithStatus(),
      fetchExchangeRate().catch(() => 7500),
    ]);

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const enriched = projects.map(p => {
      const stageId   = p.stage_id?.[0];
      const stageInfo = STAGE_MAP[stageId] || { phase: null, label: p.stage_id?.[1] || '?' };
      const status    = p.last_update_status || 'to_define';
      const statusInfo = STATUS_CONFIG[status] || STATUS_CONFIG.to_define;
      const update    = latestUpdate.get(p.id) || null;

      const goLiveDate = p.date       ? new Date(p.date       + 'T00:00:00') : null;
      const startDate  = p.date_start ? new Date(p.date_start + 'T00:00:00') : null;
      const daysToGoLive = goLiveDate ? Math.round((goLiveDate - today) / 86400000) : null;

      const isInternal = !p.partner_id;
      const isClosed   = stageId === 22 || stageId === 4;
      const isTemplate = stageId === 6;

      return {
        id:          p.id,
        name:        p.name,
        client:      p.partner_id ? p.partner_id[1].split(',')[0].trim() : null,
        responsible: p.user_id    ? p.user_id[1].split(' ').slice(0, 2).join(' ') : null,
        goLiveDate:  p.date       || null,
        startDate:   p.date_start || null,
        daysToGoLive,
        saleOrder:   p.sale_order_id ? p.sale_order_id[1] : null,
        stageId,
        stageName:   stageInfo.label,
        phase:       stageInfo.phase,
        status,
        statusInfo,
        isInternal,
        isClosed,
        isTemplate,
        update: update ? {
          date:          update.date,
          title:         update.name,
          author:        update.user_id ? update.user_id[1].split(' ').slice(0, 2).join(' ') : '?',
          status:        update.status,
          statusInfo:    STATUS_CONFIG[update.status] || STATUS_CONFIG.to_define,
          allocatedTime: Math.round((update.allocated_time  || 0) * 10) / 10,
          timesheetTime: Math.round((update.timesheet_time  || 0) * 10) / 10,
          timesheetPct:  Math.round(update.timesheet_percentage    || 0),
          taskCount:     update.task_count       || 0,
          closedTasks:   update.closed_task_count || 0,
          closedTaskPct: Math.round(update.closed_task_percentage || 0),
        } : null,
        odooUrl: `${ODOO_URL}/odoo/project/${p.id}`,
      };
    }).filter(p => !p.isTemplate && !p.isInternal);

    const statusOrder = { at_risk: 0, off_track: 1, on_track: 2, to_define: 3, done: 4 };
    enriched.sort((a, b) => {
      const ao = statusOrder[a.status] ?? 5;
      const bo = statusOrder[b.status] ?? 5;
      return ao !== bo ? ao - bo : (a.daysToGoLive ?? 9999) - (b.daysToGoLive ?? 9999);
    });

    const active  = enriched.filter(p => !p.isClosed);
    const closed  = enriched.filter(p => p.isClosed);
    const atRisk  = active.filter(p => p.status === 'at_risk').length;
    const onTrack = active.filter(p => p.status === 'on_track').length;
    const noStatus = active.filter(p => p.status === 'to_define').length;

    // Compute timeline bounds for all active projects that have both dates
    const datedProjects = active.filter(p => p.startDate && p.goLiveDate);
    let tlMin = today, tlMax = new Date(today.getTime() + 365 * 86400000);
    if (datedProjects.length) {
      tlMin = datedProjects.reduce((m, p) => new Date(p.startDate) < m ? new Date(p.startDate) : m, new Date(datedProjects[0].startDate));
      tlMax = datedProjects.reduce((m, p) => new Date(p.goLiveDate) > m ? new Date(p.goLiveDate) : m, new Date(datedProjects[0].goLiveDate));
      // Pad a bit
      tlMin = new Date(tlMin.getTime() - 7 * 86400000);
      tlMax = new Date(tlMax.getTime() + 7 * 86400000);
    }

    res.render('dashboards/proyectos', {
      title:         'Portfolio de Proyectos — Torus Dashboard',
      user:          req.user || null,
      projects:      enriched,
      active,
      closed,
      atRisk,
      onTrack,
      noStatus,
      totalActive:   active.length,
      odooUrl:       ODOO_URL,
      lastUpdate:    new Date().toLocaleString('es-PY', { dateStyle: 'medium', timeStyle: 'short' }),
      timelineMin:   tlMin.toISOString().slice(0, 10),
      timelineMax:   tlMax.toISOString().slice(0, 10),
      projectsJson:  JSON.stringify(enriched),
    });
  } catch (err) {
    console.error('[proyectos]', err.message, err.stack);
    res.status(500).render('error', { message: 'Error cargando proyectos: ' + err.message });
  }
});

module.exports = router;
