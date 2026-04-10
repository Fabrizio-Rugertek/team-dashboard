/**
 * Dashboard cache — builds and returns the aggregated /equipo payload.
 * All thresholds and static data come from src/config.js.
 */
'use strict';

const config = require('./config');
const odoo    = require('./odoo');

let _cache     = null;
let _cacheTime = 0;

const round = v => Math.round(v * 10) / 10;

// ── Task helpers (now use config) ───────────────────────────────────────────
function isDone(task) {
  if (!task) return false;
  const n = (task.stageName || '').toLowerCase();
  return n.includes('complet') || n.includes('done')  ||
         n.includes('cerrad') || n.includes('terminad') || n.includes('finalizad');
}

function isBacklog(task) {
  if (!task) return false;
  if (task.stage_id && config.BACKLOG_STAGE_IDS.has(task.stage_id[0])) return true;
  const n = (task.stageName || '').toLowerCase();
  return config.BACKLOG_KEYWORDS.some(k => n.includes(k));
}

// ── Project attention flags (use config thresholds) ────────────────────────
function computeProjectFlags(p) {
  return {
    needsAttention: p.totalAlloc > 0 && p.totalLog > p.totalAlloc * (config.LOG_OVER_ALLOC_PCT / 100),
    needsUpdate:    p.daysSinceUpdate > config.DAYS_SINCE_UPDATE_WARNING,
    isOnHold:       (p.stageProgress <= 5 && p.totalTasks > 0),
    isCompleted:    p.doneTasks === p.totalTasks && p.totalTasks > 0,
  };
}

// ── Apply Odoo-style filters to project list ───────────────────────────────
function filterProjects(projects, { status = 'all', tag = 'all' } = {}) {
  return projects.filter(p => {
    // Status filter
    if (status !== 'all') {
      const flags = computeProjectFlags(p);
      if (status === 'needs_attention' && !flags.needsAttention) return false;
      if (status === 'on_hold'        && !flags.isOnHold)         return false;
      if (status === 'completed'      && !flags.isCompleted)      return false;
      if (status === 'active' && (flags.isCompleted || flags.isOnHold || flags.needsAttention)) return false;
    }

    // Tag filter
    if (tag !== 'all') {
      if (tag === 'sin_asignar' && p.assignees?.every(a => a === 'Sin asignar')) return false;
      if (tag === 'backlog'     && p.backlogTasks === 0)    return false;
      if (tag === 'sobreestimado' && p.hoursPct < 120)       return false;
    }

    return true;
  });
}

// ── Main cached data builder ───────────────────────────────────────────────
async function getDashboardCached(filters = {}) {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < config.CACHE_TTL_MS) {
    // Return filtered view without re-fetching
    return {
      ..._cache,
      projectStatuses: filterProjects(_cache.projectStatuses, filters),
    };
  }

  console.log('[Cache] Refreshing dashboard data…');

  const [employees, timesheets, projects] = await Promise.all([
    odoo.fetchActiveEmployees(),
    odoo.fetchTimesheets(config.TIMESHEET_DAYS_BACK),
    odoo.fetchProjectsWithTasks(),
  ]);

  // ── Build lookup Maps ──────────────────────────────────────────────────
  /** @type {Map<number, string>} odoo-user-id → login */
  const userIdToLogin = new Map();
  /** @type {Map<string, object>} login → employee summary */
  const loginToEmployee = new Map();

  for (const e of employees) {
    if (e.login) {
      loginToEmployee.set(e.login, {
        name:       e.name,
        department: e.department    || null,
        job:        e.job           || null,
      });
      if (e.userId) userIdToLogin.set(e.userId, e.login);
    }
  }

  /** @type {Set<string>} activeLogins */
  const activeLogins = new Set([...loginToEmployee.keys()]);

  /** @type {Map<number, object>} taskId → task */
  const taskMap = new Map();
  const allTasks = projects.flatMap(p =>
    p.tasks.map(t => { taskMap.set(t.id, t); return t; })
  );

  /** @type {Map<number, object>} projectId → project (with tasks) */
  const projectMap = new Map(projects.map(p => [p.id, p]));

  // ── Timesheet aggregation per user ───────────────────────────────────
  /** @type {Map<string, object>} login → hours summary */
  const userHoursMap = new Map([...activeLogins].map(login => [login, {
    name:             loginToEmployee.get(login)?.name       || login,
    department:       loginToEmployee.get(login)?.department  || null,
    job:              loginToEmployee.get(login)?.job         || null,
    hoursThisWeek:    0, hoursPrevWeek:    0,
    hoursThisMonth:   0, hoursPrevMonth:   0,
    billableWeek:     0, nonBillableWeek:  0,
    entries:          0,
    projects:         {},   // projectId → hours
  }]));

  const nowDate   = new Date();
  const today     = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);
  const monthStart   = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  /** @type {Map<number, object>} taskId → sale_line_id (for billable check) */
  const taskSaleLine = new Map();
  allTasks.forEach(t => { if (t.sale_line_id) taskSaleLine.set(t.id, t.sale_line_id); });

  // Timesheet loop — always resolve via userIdToLogin Map, fallback to user_id[1]
  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !userHoursMap.has(login)) continue;

    const ue  = userHoursMap.get(login);
    const d   = new Date(ts.date + 'T00:00:00');
    const h   = parseFloat(ts.unit_amount || 0);
    const tid = ts.task_id?.[0];
    const isBillable = tid && taskSaleLine.has(tid);

    ue.entries++;
    if (d >= weekStart) {
      ue.hoursThisWeek += h;
      if (isBillable) ue.billableWeek    += h;
      else            ue.nonBillableWeek += h;
    }
    if (d >= prevWeekStart && d < weekStart)    ue.hoursPrevWeek    += h;
    if (d >= monthStart)                          ue.hoursThisMonth   += h;
    if (d >= prevMonthStart  && d < monthStart)  ue.hoursPrevMonth   += h;

    const pid = ts.project_id?.[0];
    if (pid) ue.projects[pid] = (ue.projects[pid] || 0) + h;
  }

  // ── Anomalies ──────────────────────────────────────────────────────────
  const anomalies = [];

  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !activeLogins.has(login)) continue;

    const hours = parseFloat(ts.unit_amount || 0);
    const d     = new Date(ts.date + 'T00:00:00');
    const desc  = (ts.name || '').trim();
    const tid   = ts.task_id?.[0];
    const task  = tid ? taskMap.get(tid) : null;

    if (hours > config.EXCESSIVE_HOURS_THRESHOLD) {
      anomalies.push({
        type:     'critical',
        icon:     '🚨',
        user:     login,
        message:  `${hours.toFixed(1)}h en un día`,
        detail:   `${ts.date}${desc ? ' — ' + desc.slice(0, 60) : ''}`,
        category: 'exceso_dia',
      });
    }

    const isWeekend  = d.getDay() === 0 || d.getDay() === 6;
    const isHoliday  = config.HOLIDAYS.has(ts.date);
    if ((isWeekend || isHoliday) && hours > 0) {
      anomalies.push({
        type:     'warning',
        icon:     '📅',
        user:     login,
        message:  `${isWeekend ? 'Fin de semana' : 'Feriado'}: ${ts.date}`,
        detail:   `${hours.toFixed(1)}h — ${desc || '(sin descripción)'}`.slice(0, 80),
        category: 'horas_inhabituales',
      });
    }

    if (task && !task.allocated_hours && hours > 0) {
      anomalies.push({
        type:     'warning',
        icon:     '📊',
        user:     login,
        message:  `Tarea sin estimación: ${(ts.task_id?.[1] || '').slice(0, 40)}`,
        detail:   `${hours.toFixed(1)}h logueadas sin horas estimadas`,
        category: 'sin_estimacion',
      });
    }

    const mechanical = ['-','x','.','ok','si','no','nada','listo','done','...','///','---']
      .some(m => desc.toLowerCase() === m) || (desc.length > 0 && desc.length < 4);
    if (mechanical && hours > config.MECHANICAL_DESC_HOURS) {
      anomalies.push({
        type:     'warning',
        icon:     '🤖',
        user:     login,
        message:  `Descripción mecánica: "${desc}"`,
        detail:   `${hours.toFixed(1)}h — "${desc}"`,
        category: 'descripcion_mecanica',
      });
    }
  }

  // Inactive employees
  const weekLogins = new Set(
    timesheets
      .filter(ts => new Date(ts.date + 'T00:00:00') >= weekStart)
      .map(ts => {
        const ruId = ts.user_id?.[0];
        return ruId ? (userIdToLogin.get(ruId) || null) : null;
      })
      .filter(Boolean)
  );
  for (const emp of employees) {
    if (!weekLogins.has(emp.login) && emp.login) {
      anomalies.push({
        type:     'info',
        icon:     '💤',
        user:     emp.name,
        message:  'Sin horas esta semana',
        detail:   `${emp.department || 'Sin dept.'} · ${emp.job || 'Sin rol'}`,
        category: 'inactivo',
      });
    }
  }

  // Task quality anomalies
  for (const task of allTasks) {
    if (isBacklog(task)) continue;
    const allocH = parseFloat(task.allocated_hours || 0);

    // Large tasks without dates
    if (allocH > 8) {
      const missing = [];
      if (!task.date_start) missing.push('inicio');
      if (!task.date_end)   missing.push('fin');
      if (missing.length > 0) {
        anomalies.push({
          type:     'warning',
          icon:     '📅',
          user:     task.user_id ? task.user_id[1] || '?' : '?',
          message:  `Tarea sin ${missing.join(' ni ')}: ${(task.name || '').slice(0, 40)}`,
          detail:   `${allocH}h estimadas — requiere fechas de ${missing.join(' y ')}`,
          category: 'tarea_sin_fechas',
          taskId:   task.id,
        });
      }
    }

    // Child task without sprint
    if (task.parent_id && !task.sprint_id?.[0]) {
      anomalies.push({
        type:     'warning',
        icon:     '🔗',
        user:     task.user_id ? task.user_id[1] || '?' : '?',
        message:  `Tarea hija sin sprint: ${(task.name || '').slice(0, 40)}`,
        detail:   `Pertenece a: ${task.parent_id?.[1] || '?'} — debe estar en un sprint`,
        category: 'hijo_sin_sprint',
        taskId:   task.id,
      });
    }
  }

  anomalies.sort((a, b) => {
    const o = { critical: 0, warning: 1, info: 2 };
    return (o[a.type] || 3) - (o[b.type] || 3);
  });

  // ── Billable Summary ────────────────────────────────────────────────────
  let totalBillableWeek = 0, totalNonBillableWeek = 0;
  let totalBillableMonth = 0, totalNonBillableMonth = 0;

  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !activeLogins.has(login)) continue;

    const d = new Date(ts.date + 'T00:00:00');
    const h = parseFloat(ts.unit_amount || 0);
    const tid = ts.task_id?.[0];
    const isBillable = tid && taskSaleLine.has(tid);

    if (d >= weekStart) {
      if (isBillable) totalBillableWeek    += h;
      else            totalNonBillableWeek += h;
    }
    if (d >= monthStart) {
      if (isBillable) totalBillableMonth    += h;
      else            totalNonBillableMonth += h;
    }
  }

  // ── Weekly Hours ─────────────────────────────────────────────────────────
  const weeklyData = [];
  for (let i = 7; i >= 0; i--) {
    const wEnd  = new Date(nowDate);
    wEnd.setDate(nowDate.getDate() - nowDate.getDay() - (i * 7));
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);

    const weekHours = timesheets
      .filter(ts => {
        const d = new Date(ts.date + 'T00:00:00');
        const login = ts.user_id?.[0] ? userIdToLogin.get(ts.user_id[0]) : null;
        return d >= wStart && d <= wEnd && login && activeLogins.has(login);
      })
      .reduce((s, ts) => s + parseFloat(ts.unit_amount || 0), 0);

    weeklyData.push({
      label: `Sem ${wStart.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`,
      hours: round(weekHours),
    });
  }

  // ── Project Status ──────────────────────────────────────────────────────
  const projectStatuses = projects.map(p => {
    const tasks      = p.tasks || [];
    const totalAlloc = tasks.reduce((s, t) => s + parseFloat(t.allocated_hours || 0), 0);
    const totalLog   = tasks.reduce((s, t) => s + parseFloat(t.effective_hours  || 0), 0);
    const openTasks  = tasks.filter(t => !isDone(t)).length;
    const doneTasks  = tasks.filter(t =>  isDone(t)).length;
    const backlogTasks = tasks.filter(t => isBacklog(t)).length;
    const lastWrite  = p.write_date ? new Date(p.write_date) : null;
    const daysSince  = lastWrite ? Math.round((today - lastWrite) / 86400000) : 999;
    const avgProg    = tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => {
          const n = (t.stageName || '').toLowerCase();
          let p2 = 0;
          if      (n.includes('complet') || n.includes('done'))    p2 = 100;
          else if (n.includes('progreso'))                         p2 =  50;
          else if (n.includes('revis')   || n.includes('qa'))     p2 =  75;
          else if (n.includes('espera')  || n.includes('hold'))   p2 =  25;
          else if (n.includes('backlog'))                         p2 =   0;
          return s + p2;
        }, 0) / tasks.length)
      : 0;
    const shortName  = p.name.length > 28 ? p.name.slice(0, 28) + '…' : p.name;

    const flags = computeProjectFlags({
      totalAlloc, totalLog, daysSince,
      stageProgress: avgProg,
      doneTasks, totalTasks: tasks.length,
    });

    return {
      id:             p.id,
      name:           shortName,
      fullName:       p.name,
      totalAlloc:     round(totalAlloc),
      totalLog:       round(totalLog),
      openTasks,
      doneTasks,
      backlogTasks,
      totalTasks:     tasks.length,
      hoursPct:       totalAlloc > 0 ? Math.round((totalLog / totalAlloc) * 100) : null,
      daysSinceUpdate: daysSince,
      needsAttention: flags.needsAttention,
      needsUpdate:    flags.needsUpdate,
      isOnHold:       flags.isOnHold,
      isCompleted:    flags.isCompleted,
      stageProgress:  avgProg,
      assignees:      [...new Set(tasks.map(t => t.user_id ? t.user_id[1] || 'Sin asignar' : 'Sin asignar'))].slice(0, 4),
    };
  });

  // ── Consultants ──────────────────────────────────────────────────────────
  const consultants = [...userHoursMap.values()]
    .map(u => ({
      name:              u.name,
      department:        u.department,
      job:               u.job,
      hoursThisWeek:     round(u.hoursThisWeek),
      hoursPrevWeek:     round(u.hoursPrevWeek),
      hoursThisMonth:    round(u.hoursThisMonth),
      hoursPrevWeekMonth: round(u.hoursPrevMonth),
      billableWeek:      round(u.billableWeek),
      nonBillableWeek:  round(u.nonBillableWeek),
      entries:           u.entries,
      projectCount:      Object.keys(u.projects).length,
      hasHours:          u.hoursThisWeek > 0 || u.hoursThisMonth > 0,
    }))
    .sort((a, b) => b.hoursThisWeek - a.hoursThisWeek);

  // ── Summary ──────────────────────────────────────────────────────────────
  const weekTotal  = [...userHoursMap.values()].reduce((s, u) => s + u.hoursThisWeek, 0);
  const monthTotal = [...userHoursMap.values()].reduce((s, u) => s + u.hoursThisMonth, 0);
  const allDone    = allTasks.filter(t => isDone(t)).length;

  _cache = {
    summary: {
      weekHours:       round(weekTotal),
      monthHours:      round(monthTotal),
      billableWeek:    round(totalBillableWeek),
      nonBillableWeek: round(totalNonBillableWeek),
      billableMonth:   round(totalBillableMonth),
      nonBillableMonth: round(totalNonBillableMonth),
      activeUsers:     [...userHoursMap.values()].filter(u => u.hoursThisWeek > 0).length,
      totalActiveEmployees: employees.length,
      totalTasks:      allTasks.length,
      doneTasks:       allDone,
      completionRate:  allTasks.length > 0 ? Math.round((allDone / allTasks.length) * 100) : 0,
    },
    consultants,
    projectStatuses,
    anomalies: anomalies.slice(0, 500),
    weeklyData,
    lastUpdate: new Date().toISOString(),
    // Raw maps kept for filter re-evaluation without re-fetch
    _userIdToLogin:   userIdToLogin,
    _loginToEmployee: loginToEmployee,
    _taskMap:         taskMap,
    _projectMap:      projectMap,
  };

  _cacheTime = now;
  console.log(
    `[Cache] Done. Employees: ${employees.length}, Tasks: ${allTasks.length}, Anomalies: ${anomalies.length}`
  );

  // Apply filters to the fresh cache
  return {
    ..._cache,
    projectStatuses: filterProjects(_cache.projectStatuses, filters),
  };
}

// ── Exports ─────────────────────────────────────────────────────────────────
module.exports = { getDashboardCached, filterProjects };
