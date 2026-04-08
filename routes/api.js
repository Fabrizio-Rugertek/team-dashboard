const express = require('express');
const router = express.Router();
const odoo = require('../src/odoo');

// PY holidays 2024-2026
const HOLIDAYS = [
  '2026-01-01','2026-01-08','2026-02-09','2026-02-10',
  '2026-03-01','2026-04-01','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-14','2026-06-15','2026-07-28',
  '2026-08-15','2026-09-29','2026-12-08','2026-12-25'
];
const isHoliday = d => HOLIDAYS.includes(d.toISOString().slice(0,10));
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

function isTaskDone(task) {
  if (!task) return false;
  const stageName = (task.stageName || '').toLowerCase();
  return stageName.includes('complet') || stageName.includes('done') || stageName.includes('cerrad');
}

function shortName(name) {
  if (!name) return '?';
  const words = name.split(' ');
  if (words.length === 1) return name.slice(0, 25);
  return words[0] + ' ' + words[1];
}

// GET /api/equipo/summary — top-level KPIs
router.get('/equipo/summary', async (req, res) => {
  try {
    const ts = await odoo.fetchTimesheets(30);
    const projects = await odoo.fetchProjectsWithTasks();
    const users = await odoo.fetchUsers();
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);

    const weekTotal = ts.filter(e => new Date(e.date + 'T00:00:00') >= weekStart)
      .reduce((s, e) => s + parseFloat(e.unit_amount || 0), 0);
    const monthTotal = ts.filter(e => new Date(e.date + 'T00:00:00') >= monthStart)
      .reduce((s, e) => s + parseFloat(e.unit_amount || 0), 0);
    const activeUsers = new Set(ts.filter(e => new Date(e.date + 'T00:00:00') >= weekStart).map(e => e.user_id?.[0])).size;
    
    const totalTasks = projects.flatMap(p => p.tasks).length;
    const doneTasks = projects.flatMap(p => p.tasks).filter(t => isTaskDone(t)).length;
    const totalAllocated = projects.flatMap(p => p.tasks).reduce((s, t) => s + parseFloat(t.allocated_hours || 0), 0);
    const totalLogged = projects.flatMap(p => p.tasks).reduce((s, t) => s + parseFloat(t.effective_hours || 0), 0);

    res.json({
      weekHours: Math.round(weekTotal * 10) / 10,
      monthHours: Math.round(monthTotal * 10) / 10,
      activeUsers,
      totalUsers: users.length,
      totalTasks,
      doneTasks,
      completionRate: totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0,
      totalAllocated: Math.round(totalAllocated * 10) / 10,
      totalLogged: Math.round(totalLogged * 10) / 10
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipo/consultants — per-consultant hours
router.get('/equipo/consultants', async (req, res) => {
  try {
    const ts = await odoo.fetchTimesheets(60);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    const userMap = {};
    ts.forEach(e => {
      const uid = e.user_id?.[0];
      if (!uid) return;
      if (!userMap[uid]) {
        userMap[uid] = { name: e.user_id?.[1] || '?', entries: [], hoursThisWeek: 0, hoursPrevWeek: 0, hoursThisMonth: 0, hoursPrevMonth: 0, projects: {} };
      }
      const ue = userMap[uid];
      ue.entries.push(e);
      const d = new Date(e.date + 'T00:00:00');
      const h = parseFloat(e.unit_amount || 0);
      if (d >= weekStart) ue.hoursThisWeek += h;
      if (d >= prevWeekStart && d < weekStart) ue.hoursPrevWeek += h;
      if (d >= monthStart) ue.hoursThisMonth += h;
      if (d >= prevMonthStart && d < monthStart) ue.hoursPrevMonth += h;
      const pid = e.project_id?.[0];
      if (pid) ue.projects[pid] = (ue.projects[pid] || 0) + h;
    });

    const consultants = Object.values(userMap).sort((a, b) => b.hoursThisWeek - a.hoursThisWeek);
    res.json(consultants.map(c => ({
      name: c.name,
      hoursThisWeek: Math.round(c.hoursThisWeek * 10) / 10,
      hoursPrevWeek: Math.round(c.hoursPrevWeek * 10) / 10,
      hoursThisMonth: Math.round(c.hoursThisMonth * 10) / 10,
      hoursPrevMonth: Math.round(c.hoursPrevMonth * 10) / 10,
      entries: c.entries.length,
      projectCount: Object.keys(c.projects).length
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipo/anomalies — anomaly detection
router.get('/equipo/anomalies', async (req, res) => {
  try {
    const ts = await odoo.fetchTimesheets(30);
    const projects = await odoo.fetchProjectsWithTasks();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const anomalies = [];
    const taskMap = {};
    projects.forEach(p => (p.tasks || []).forEach(t => { taskMap[t.id] = t; }));

    ts.forEach(e => {
      const hours = parseFloat(e.unit_amount || 0);
      const d = new Date(e.date + 'T00:00:00');
      const uid = e.user_id?.[0];
      const task = taskMap[e.task_id?.[0]];
      const desc = (e.name || '').trim();

      // Excessive hours in single day
      if (hours > 12) {
        anomalies.push({ type: 'critical', icon: '⚠️', user: e.user_id?.[1] || '?',
          message: `${hours.toFixed(1)}h en un día`, detail: `${e.date}${desc ? ' — ' + desc.slice(0,60) : ''}`,
          category: 'exceso_dia' });
      }

      // Weekend/holiday work
      if ((isWeekend(d) || isHoliday(d)) && hours > 0) {
        anomalies.push({ type: 'warning', icon: '📅', user: e.user_id?.[1] || '?',
          message: `${isWeekend(d) ? 'Fin de semana' : 'Feriado'}: ${e.date}`,
          detail: `${hours.toFixed(1)}h — ${desc || '(sin descripción)'}`.slice(0, 80),
          category: 'horas_inhabituales' });
      }

      // Task with 0 estimate
      if (hours > 0 && task && !task.allocated_hours && e.task_id) {
        anomalies.push({ type: 'warning', icon: '📊', user: e.user_id?.[1] || '?',
          message: `Tarea sin estimación: ${(e.task_id?.[1] || '').slice(0, 40)}`,
          detail: `${hours.toFixed(1)}h logueadas sin horas estimadas`,
          category: 'sin_estimacion' });
      }

      // Mechanical/short description
      const mechanical = ['-', 'x', '.', 'ok', 'si', 'no', 'nada', 'listo', 'done'].some(m => desc.toLowerCase() === m)
        || (desc.length > 0 && desc.length < 5);
      if (mechanical && hours > 3) {
        anomalies.push({ type: 'warning', icon: '🤖', user: e.user_id?.[1] || '?',
          message: `Descripción mecánica: "${desc}"`,
          detail: `${hours.toFixed(1)}h — "${desc}" — revisar si hay progreso real`,
          category: 'descripcion_mecanica' });
      }
    });

    // Inactive users
    const lastEntry = {};
    ts.forEach(e => {
      const uid = e.user_id?.[0];
      const d = new Date(e.date + 'T00:00:00');
      if (!lastEntry[uid] || d > lastEntry[uid]) lastEntry[uid] = d;
    });
    Object.entries(lastEntry).forEach(([uid, lastDate]) => {
      const daysSince = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 3) {
        const name = Object.values(lastEntry).find ? '?' : (ts.find(e => e.user_id?.[0] == uid)?.user_id?.[1]) || '?';
        anomalies.push({ type: daysSince > 7 ? 'critical' : 'info', icon: '💤', user: name,
          message: `Sin horas en ${daysSince} días`,
          detail: `Última entrada: ${lastDate.toLocaleDateString('es')}`,
          category: 'inactivo' });
      }
    });

    anomalies.sort((a, b) => {
      const o = { critical: 0, warning: 1, info: 2 };
      return (o[a.type] || 3) - (o[b.type] || 3);
    });

    res.json(anomalies.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipo/projects — project status
router.get('/equipo/projects', async (req, res) => {
  try {
    const projects = await odoo.fetchProjectsWithTasks();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const statuses = projects.map(p => {
      const totalAlloc = (p.tasks || []).reduce((s, t) => s + parseFloat(t.allocated_hours || 0), 0);
      const totalLog = (p.tasks || []).reduce((s, t) => s + parseFloat(t.effective_hours || 0), 0);
      const openTasks = (p.tasks || []).filter(t => !isTaskDone(t)).length;
      const doneTasks = (p.tasks || []).filter(t => isTaskDone(t)).length;
      const lastWrite = p.write_date ? new Date(p.write_date) : null;
      const daysSince = lastWrite ? Math.round((today - lastWrite) / (86400000)) : 999;
      const avgProgress = p.tasks.length > 0 
        ? Math.round(p.tasks.reduce((s, t) => {
            const stageName = (t.stageName || '').toLowerCase();
            let pct = 0;
            if (stageName.includes('complet')) pct = 100;
            else if (stageName.includes('progreso')) pct = 50;
            else if (stageName.includes('revis')) pct = 75;
            else if (stageName.includes('espera') || stageName.includes('hold')) pct = 25;
            return s + pct;
          }, 0) / p.tasks.length)
        : 0;

      return {
        id: p.id,
        name: shortName(p.name),
        fullName: p.name,
        totalAlloc: Math.round(totalAlloc * 10) / 10,
        totalLog: Math.round(totalLog * 10) / 10,
        openTasks,
        doneTasks,
        totalTasks: p.tasks.length,
        hoursPct: totalAlloc > 0 ? Math.round(totalLog / totalAlloc * 100) : null,
        daysSinceUpdate: daysSince,
        needsAttention: (totalAlloc > 0 && totalLog > totalAlloc * 1.2) || daysSince > 14,
        needsUpdate: daysSince > 7,
        stageProgress: avgProgress,
        assignees: [...new Set(p.tasks.map(t => t.user_id?.[1] || 'Sin asignar'))].slice(0, 4)
      };
    });

    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipo/weekly — weekly hours for last 8 weeks
router.get('/equipo/weekly', async (req, res) => {
  try {
    const ts = await odoo.fetchTimesheets(90);
    const now = new Date();
    const weeks = [];

    for (let i = 7; i >= 0; i--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - now.getDay() - (i * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);
      
      const weekHours = ts.filter(e => {
        const d = new Date(e.date + 'T00:00:00');
        return d >= weekStart && d <= weekEnd;
      }).reduce((s, e) => s + parseFloat(e.unit_amount || 0), 0);

      weeks.push({
        label: `Sem ${weekStart.toLocaleDateString('es', {day:'numeric',month:'short'})}`,
        hours: Math.round(weekHours * 10) / 10
      });
    }

    res.json(weeks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
