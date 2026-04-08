const express = require('express');
const router = express.Router();
const odoo = require('../src/odoo');
const { getCached } = require('../src/cache');

const HOLIDAYS = [
  '2026-01-01', '2026-01-08', '2026-02-09', '2026-02-10',
  '2026-03-01', '2026-04-01', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-14', '2026-06-15', '2026-07-28',
  '2026-08-15', '2026-09-29', '2026-12-08', '2026-12-25'
];

const API_TTL_MS = 45 * 1000;
const USERS_TTL_MS = 5 * 60 * 1000;

const isHoliday = (date) => HOLIDAYS.includes(date.toISOString().slice(0, 10));
const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

function dayFromString(value) {
  return new Date(`${value}T00:00:00`);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function isTaskDone(task) {
  if (!task) return false;
  const stageName = (task.stageName || '').toLowerCase();
  return (
    stageName.includes('complet') ||
    stageName.includes('done') ||
    stageName.includes('cerrad') ||
    stageName.includes('terminad') ||
    stageName.includes('finalizad')
  );
}

function shortName(name) {
  if (!name) return '?';
  const words = name.split(' ');
  if (words.length === 1) return name.slice(0, 25);
  return `${words[0]} ${words[1]}`;
}

async function getUsersCached() {
  return getCached('users', USERS_TTL_MS, () => odoo.fetchUsers());
}

async function getProjectsCached() {
  return getCached('projects:with-tasks', API_TTL_MS, () => odoo.fetchProjectsWithTasks());
}

async function getTimesheetsCached(daysBack) {
  return getCached(`timesheets:${daysBack}`, API_TTL_MS, () => odoo.fetchTimesheets(daysBack));
}

async function getDashboardData() {
  return getCached('dashboard:equipo:bootstrap', API_TTL_MS, async () => {
    const [users, projects, timesheets30, timesheets60, timesheets90] = await Promise.all([
      getUsersCached(),
      getProjectsCached(),
      getTimesheetsCached(30),
      getTimesheetsCached(60),
      getTimesheetsCached(90)
    ]);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(weekStart.getDate() - 7);
    const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    const allTasks = projects.flatMap((project) => project.tasks || []);
    const totalTasks = allTasks.length;
    const doneTasks = allTasks.filter((task) => isTaskDone(task)).length;
    const totalAllocated = allTasks.reduce((sum, task) => sum + parseFloat(task.allocated_hours || 0), 0);
    const totalLogged = allTasks.reduce((sum, task) => sum + parseFloat(task.effective_hours || 0), 0);

    const summary = {
      weekHours: round1(
        timesheets30
          .filter((entry) => dayFromString(entry.date) >= weekStart)
          .reduce((sum, entry) => sum + parseFloat(entry.unit_amount || 0), 0)
      ),
      monthHours: round1(
        timesheets30
          .filter((entry) => dayFromString(entry.date) >= monthStart)
          .reduce((sum, entry) => sum + parseFloat(entry.unit_amount || 0), 0)
      ),
      activeUsers: new Set(
        timesheets30
          .filter((entry) => dayFromString(entry.date) >= weekStart)
          .map((entry) => entry.user_id?.[0])
          .filter(Boolean)
      ).size,
      totalUsers: users.length,
      totalTasks,
      doneTasks,
      completionRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      totalAllocated: round1(totalAllocated),
      totalLogged: round1(totalLogged)
    };

    const userMap = {};
    for (const entry of timesheets60) {
      const userId = entry.user_id?.[0];
      if (!userId) continue;

      if (!userMap[userId]) {
        userMap[userId] = {
          name: entry.user_id?.[1] || '?',
          entries: [],
          hoursThisWeek: 0,
          hoursPrevWeek: 0,
          hoursThisMonth: 0,
          hoursPrevMonth: 0,
          projects: {}
        };
      }

      const data = userMap[userId];
      const day = dayFromString(entry.date);
      const hours = parseFloat(entry.unit_amount || 0);
      data.entries.push(entry);

      if (day >= weekStart) data.hoursThisWeek += hours;
      if (day >= prevWeekStart && day < weekStart) data.hoursPrevWeek += hours;
      if (day >= monthStart) data.hoursThisMonth += hours;
      if (day >= prevMonthStart && day < monthStart) data.hoursPrevMonth += hours;

      const projectId = entry.project_id?.[0];
      if (projectId) {
        data.projects[projectId] = (data.projects[projectId] || 0) + hours;
      }
    }

    const consultants = Object.values(userMap)
      .sort((a, b) => b.hoursThisWeek - a.hoursThisWeek)
      .map((consultant) => ({
        name: consultant.name,
        hoursThisWeek: round1(consultant.hoursThisWeek),
        hoursPrevWeek: round1(consultant.hoursPrevWeek),
        hoursThisMonth: round1(consultant.hoursThisMonth),
        hoursPrevMonth: round1(consultant.hoursPrevMonth),
        entries: consultant.entries.length,
        projectCount: Object.keys(consultant.projects).length
      }));

    const taskMap = {};
    for (const project of projects) {
      for (const task of project.tasks || []) {
        taskMap[task.id] = task;
      }
    }

    const anomalies = [];
    for (const entry of timesheets30) {
      const hours = parseFloat(entry.unit_amount || 0);
      const day = dayFromString(entry.date);
      const task = taskMap[entry.task_id?.[0]];
      const description = (entry.name || '').trim();
      const user = entry.user_id?.[1] || '?';

      if (hours > 12) {
        anomalies.push({
          type: 'critical',
          icon: '⚠️',
          user,
          message: `${hours.toFixed(1)}h en un día`,
          detail: `${entry.date}${description ? ` - ${description.slice(0, 60)}` : ''}`,
          category: 'exceso_dia'
        });
      }

      if ((isWeekend(day) || isHoliday(day)) && hours > 0) {
        anomalies.push({
          type: 'warning',
          icon: '📅',
          user,
          message: `${isWeekend(day) ? 'Fin de semana' : 'Feriado'}: ${entry.date}`,
          detail: `${hours.toFixed(1)}h - ${description || '(sin descripcion)'}`.slice(0, 80),
          category: 'horas_inhabituales'
        });
      }

      if (hours > 0 && task && !task.allocated_hours && entry.task_id) {
        anomalies.push({
          type: 'warning',
          icon: '📊',
          user,
          message: `Tarea sin estimacion: ${(entry.task_id?.[1] || '').slice(0, 40)}`,
          detail: `${hours.toFixed(1)}h logueadas sin horas estimadas`,
          category: 'sin_estimacion'
        });
      }

      const lowerDescription = description.toLowerCase();
      const mechanical =
        ['-', 'x', '.', 'ok', 'si', 'no', 'nada', 'listo', 'done'].includes(lowerDescription) ||
        (description.length > 0 && description.length < 5);

      if (mechanical && hours > 3) {
        anomalies.push({
          type: 'warning',
          icon: '🤖',
          user,
          message: `Descripcion mecanica: "${description}"`,
          detail: `${hours.toFixed(1)}h - "${description}" - revisar si hay progreso real`,
          category: 'descripcion_mecanica'
        });
      }
    }

    const lastEntryByUser = {};
    const userNames = {};
    for (const entry of timesheets30) {
      const userId = entry.user_id?.[0];
      if (!userId) continue;

      const day = dayFromString(entry.date);
      if (!lastEntryByUser[userId] || day > lastEntryByUser[userId]) {
        lastEntryByUser[userId] = day;
      }
      userNames[userId] = entry.user_id?.[1] || '?';
    }

    for (const [userId, lastDate] of Object.entries(lastEntryByUser)) {
      const daysSince = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 3) {
        anomalies.push({
          type: daysSince > 7 ? 'critical' : 'info',
          icon: '💤',
          user: userNames[userId] || '?',
          message: `Sin horas en ${daysSince} dias`,
          detail: `Ultima entrada: ${lastDate.toLocaleDateString('es')}`,
          category: 'inactivo'
        });
      }
    }

    anomalies.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.type] || 3) - (order[b.type] || 3);
    });

    const projectsView = projects.map((project) => {
      const projectTasks = project.tasks || [];
      const totalAllocHours = projectTasks.reduce((sum, task) => sum + parseFloat(task.allocated_hours || 0), 0);
      const totalLoggedHours = projectTasks.reduce((sum, task) => sum + parseFloat(task.effective_hours || 0), 0);
      const openTasks = projectTasks.filter((task) => !isTaskDone(task)).length;
      const doneProjectTasks = projectTasks.filter((task) => isTaskDone(task)).length;
      const lastWrite = project.write_date ? new Date(project.write_date) : null;
      const daysSinceUpdate = lastWrite ? Math.round((today - lastWrite) / 86400000) : 999;

      const stageProgress = projectTasks.length > 0
        ? Math.round(projectTasks.reduce((sum, task) => {
            const stageName = (task.stageName || '').toLowerCase();
            let percent = 0;
            if (stageName.includes('complet')) percent = 100;
            else if (stageName.includes('progreso')) percent = 50;
            else if (stageName.includes('revis')) percent = 75;
            else if (stageName.includes('espera') || stageName.includes('hold')) percent = 25;
            return sum + percent;
          }, 0) / projectTasks.length)
        : 0;

      return {
        id: project.id,
        name: shortName(project.name),
        fullName: project.name,
        totalAlloc: round1(totalAllocHours),
        totalLog: round1(totalLoggedHours),
        openTasks,
        doneTasks: doneProjectTasks,
        totalTasks: projectTasks.length,
        hoursPct: totalAllocHours > 0 ? Math.round((totalLoggedHours / totalAllocHours) * 100) : null,
        daysSinceUpdate,
        needsAttention: (totalAllocHours > 0 && totalLoggedHours > totalAllocHours * 1.2) || daysSinceUpdate > 14,
        needsUpdate: daysSinceUpdate > 7,
        stageProgress,
        assignees: [...new Set(projectTasks.map((task) => task.user_id?.[1] || 'Sin asignar'))].slice(0, 4)
      };
    });

    const weekly = [];
    for (let i = 7; i >= 0; i -= 1) {
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() - today.getDay() - (i * 7));
      const weekStartForSeries = new Date(weekEnd);
      weekStartForSeries.setDate(weekEnd.getDate() - 6);

      const hours = timesheets90
        .filter((entry) => {
          const day = dayFromString(entry.date);
          return day >= weekStartForSeries && day <= weekEnd;
        })
        .reduce((sum, entry) => sum + parseFloat(entry.unit_amount || 0), 0);

      weekly.push({
        label: `Sem ${weekStartForSeries.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`,
        hours: round1(hours)
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      summary,
      consultants,
      anomalies: anomalies.slice(0, 50),
      projects: projectsView,
      weekly
    };
  });
}

router.get('/equipo/bootstrap', async (req, res) => {
  try {
    res.json(await getDashboardData());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/summary', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data.summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/consultants', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data.consultants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/anomalies', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data.anomalies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/projects', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data.projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/weekly', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data.weekly);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
