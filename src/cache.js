const odoo = require('./odoo');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;
let cacheTime = 0;

const round = v => Math.round(v * 10) / 10;

function isDone(task) {
  if (!task) return false;
  const n = (task.stageName || '').toLowerCase();
  return n.includes('complet') || n.includes('done') || n.includes('cerrad') || n.includes('terminad') || n.includes('finalizad');
}

function isBacklog(task) {
  if (!task) return false;
  const n = (task.stageName || '').toLowerCase();
  return n.includes('backlog');
}

async function getDashboardCached() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL_MS) {
    return cache;
  }

  console.log('[Cache] Refreshing dashboard data...');

  const [employees, timesheets, projects] = await Promise.all([
    odoo.fetchActiveEmployees(),
    odoo.fetchTimesheets(30),
    odoo.fetchProjectsWithTasks()
  ]);

  const activeLogins = new Set(employees.map(e => e.login).filter(Boolean));
  const allTasks = projects.flatMap(p => p.tasks || []);

  // ─── Timesheet assignment ────────────────────────────────────────────────
  const userMap = {};
  for (const e of employees) {
    if (e.login) {
      userMap[e.login] = {
        name: e.name, department: e.department || null, job: e.job || null,
        hoursThisWeek: 0, hoursPrevWeek: 0, hoursThisMonth: 0, hoursPrevMonth: 0,
        billableWeek: 0, nonBillableWeek: 0,
        entries: 0, projects: {}
      };
    }
  }

  const nowDate = new Date();
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  // Build task -> sale_line_id map
  const taskSaleLine = {};
  allTasks.forEach(t => {
    if (t.sale_line_id) taskSaleLine[t.id] = t.sale_line_id;
  });

  // Timesheets
  for (const ts of timesheets) {
    const login = ts.user_id && ts.user_id[1];
    if (!login || !userMap[login]) continue;

    const ue = userMap[login];
    const d = new Date(ts.date + 'T00:00:00');
    const h = parseFloat(ts.unit_amount || 0);

    // Billable: task has sale_line_id
    const taskId = ts.task_id && ts.task_id[0];
    const isBillable = taskId && taskSaleLine[taskId];

    ue.entries++;
    if (d >= weekStart) {
      ue.hoursThisWeek += h;
      if (isBillable) ue.billableWeek += h;
      else ue.nonBillableWeek += h;
    }
    if (d >= prevWeekStart && d < weekStart) ue.hoursPrevWeek += h;
    if (d >= monthStart) ue.hoursThisMonth += h;
    if (d >= prevMonthStart && d < monthStart) ue.hoursPrevMonth += h;
    const pid = ts.project_id && ts.project_id[0];
    if (pid) ue.projects[pid] = (ue.projects[pid] || 0) + h;
  }

  // ─── Anomalías ─────────────────────────────────────────────────────────
  const anomalies = [];

  for (const ts of timesheets) {
    const login = ts.user_id && ts.user_id[1];
    if (!login || !activeLogins.has(login)) continue;

    const hours = parseFloat(ts.unit_amount || 0);
    const d = new Date(ts.date + 'T00:00:00');
    const desc = (ts.name || '').trim();
    const taskId = ts.task_id && ts.task_id[0];
    const task = allTasks.find(t => t.id === taskId);

    if (hours > 12) {
      anomalies.push({
        type: 'critical', icon: '🚨', user: login,
        message: `${hours.toFixed(1)}h en un día`,
        detail: `${ts.date}${desc ? ' — ' + desc.slice(0, 60) : ''}`,
        category: 'exceso_dia'
      });
    }

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const holidays = ['2026-04-01','2026-04-02','2026-04-03'];
    const isHoliday = holidays.includes(ts.date);
    if ((isWeekend || isHoliday) && hours > 0) {
      anomalies.push({
        type: 'warning', icon: '📅', user: login,
        message: `${isWeekend ? 'Fin de semana' : 'Feriado'}: ${ts.date}`,
        detail: `${hours.toFixed(1)}h — ${desc || '(sin descripción)'}`.slice(0, 80),
        category: 'horas_inhabituales'
      });
    }

    if (task && !task.allocated_hours && hours > 0) {
      anomalies.push({
        type: 'warning', icon: '📊', user: login,
        message: `Tarea sin estimación: ${(ts.task_id && ts.task_id[1] || '').slice(0, 40)}`,
        detail: `${hours.toFixed(1)}h logueadas sin horas estimadas`,
        category: 'sin_estimacion'
      });
    }

    const mechanical = ['-','x','.','ok','si','no','nada','listo','done','...','///','---'].some(m => desc.toLowerCase() === m)
      || (desc.length > 0 && desc.length < 4);
    if (mechanical && hours > 3) {
      anomalies.push({
        type: 'warning', icon: '🤖', user: login,
        message: `Descripción mecánica: "${desc}"`,
        detail: `${hours.toFixed(1)}h — "${desc}"`,
        category: 'descripcion_mecanica'
      });
    }

    // Billable mismatch: logged on billable task but project is non-billable or vice versa
    // We flag: timesheet on task with sale_line_id but project doesn't match expectation
    // Skip for now - requires project type info
  }

  // Inactive employees
  const weekLogins = new Set(
    timesheets.filter(ts => new Date(ts.date + 'T00:00:00') >= weekStart)
      .map(ts => ts.user_id && ts.user_id[1]).filter(Boolean)
  );
  for (const emp of employees) {
    if (!weekLogins.has(emp.login) && emp.login) {
      anomalies.push({
        type: emp.contract_state === 'draft' ? 'info' : 'info', icon: '💤', user: emp.name,
        message: `Sin horas esta semana`,
        detail: `${emp.department || 'Sin dept.'} · ${emp.job || 'Sin rol'}`,
        category: 'inactivo'
      });
    }
  }

  // ─── Task Quality Anomalías ──────────────────────────────────────────────
  // 1. Large tasks (>8h) without start OR end date (unless in backlog)
  for (const task of allTasks) {
    if (isBacklog(task)) continue;
    const allocH = parseFloat(task.allocated_hours || 0);
    if (allocH > 8) {
      const missing = [];
      if (!task.date_start) missing.push('inicio');
      if (!task.date_end) missing.push('fin');
      if (missing.length > 0) {
        anomalies.push({
          type: 'warning', icon: '📅', user: task.user_id && task.user_id[1] || '?',
          message: `Tarea sin ${missing.join(' ni ')}: ${(task.name || '').slice(0, 40)}`,
          detail: `${allocH}h estimadas — requiere fechas de ${missing.join(' y ')}`,
          category: 'tarea_sin_fechas',
          taskId: task.id
        });
      }
    }
  }

  // 2. Child tasks (has parent) without sprint assigned (not in backlog)
  for (const task of allTasks) {
    if (!task.parent_id) continue; // not a child
    if (isBacklog(task)) continue; // in backlog is fine
    // Check if task has sprint_id
    const hasSprint = task.sprint_id && task.sprint_id[0];
    if (!hasSprint) {
      anomalies.push({
        type: 'warning', icon: '🔗', user: task.user_id && task.user_id[1] || '?',
        message: `Tarea hija sin sprint: ${(task.name || '').slice(0, 40)}`,
        detail: `Pertenece a: ${task.parent_id && task.parent_id[1] || '?'} — debe estar en un sprint`,
        category: 'hijo_sin_sprint',
        taskId: task.id
      });
    }
  }

  anomalies.sort((a, b) => {
    const o = { critical: 0, warning: 1, info: 2 };
    return (o[a.type] || 3) - (o[b.type] || 3);
  });

  // ─── Billable Summary ────────────────────────────────────────────────────
  let totalBillableWeek = 0, totalNonBillableWeek = 0;
  let totalBillableMonth = 0, totalNonBillableMonth = 0;

  for (const ts of timesheets) {
    const login = ts.user_id && ts.user_id[1];
    if (!activeLogins.has(login)) continue;
    const d = new Date(ts.date + 'T00:00:00');
    const h = parseFloat(ts.unit_amount || 0);
    const taskId = ts.task_id && ts.task_id[0];
    const isBillable = taskId && taskSaleLine[taskId];
    if (d >= weekStart) {
      if (isBillable) totalBillableWeek += h;
      else totalNonBillableWeek += h;
    }
    if (d >= monthStart) {
      if (isBillable) totalBillableMonth += h;
      else totalNonBillableMonth += h;
    }
  }

  // ─── Weekly Hours ────────────────────────────────────────────────────────
  const weeklyData = [];
  for (let i = 7; i >= 0; i--) {
    const wEnd = new Date(nowDate);
    wEnd.setDate(nowDate.getDate() - nowDate.getDay() - (i * 7));
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);
    const weekHours = timesheets
      .filter(ts => {
        const d = new Date(ts.date + 'T00:00:00');
        return d >= wStart && d <= wEnd && activeLogins.has(ts.user_id && ts.user_id[1]);
      })
      .reduce((s, ts) => s + parseFloat(ts.unit_amount || 0), 0);
    weeklyData.push({
      label: `Sem ${wStart.toLocaleDateString('es', {day:'numeric',month:'short'})}`,
      hours: round(weekHours)
    });
  }

  // ─── Project Status ─────────────────────────────────────────────────────
  const projectStatuses = projects.map(p => {
    const tasks = p.tasks || [];
    const totalAlloc = tasks.reduce((s, t) => s + parseFloat(t.allocated_hours || 0), 0);
    const totalLog = tasks.reduce((s, t) => s + parseFloat(t.effective_hours || 0), 0);
    const openTasks = tasks.filter(t => !isDone(t)).length;
    const doneTasks = tasks.filter(t => isDone(t)).length;
    const backlogTasks = tasks.filter(t => isBacklog(t)).length;
    const lastWrite = p.write_date ? new Date(p.write_date) : null;
    const daysSince = lastWrite ? Math.round((today - lastWrite) / 86400000) : 999;
    const avgProg = tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => {
          const n = (t.stageName || '').toLowerCase();
          let p = 0;
          if (n.includes('complet') || n.includes('done')) p = 100;
          else if (n.includes('progreso')) p = 50;
          else if (n.includes('revis') || n.includes('qa')) p = 75;
          else if (n.includes('espera') || n.includes('hold')) p = 25;
          else if (n.includes('backlog')) p = 0;
          return s + p;
        }, 0) / tasks.length)
      : 0;
    const shortName = p.name.length > 28 ? p.name.slice(0, 28) + '…' : p.name;
    return {
      id: p.id, name: shortName, fullName: p.name,
      totalAlloc: round(totalAlloc), totalLog: round(totalLog),
      openTasks, doneTasks, backlogTasks, totalTasks: tasks.length,
      hoursPct: totalAlloc > 0 ? Math.round(totalLog / totalAlloc * 100) : null,
      daysSinceUpdate: daysSince,
      needsAttention: (totalAlloc > 0 && totalLog > totalAlloc * 1.2) || daysSince > 14,
      needsUpdate: daysSince > 7,
      stageProgress: avgProg,
      assignees: [...new Set(tasks.map(t => t.user_id && t.user_id[1] || 'Sin asignar'))].slice(0, 4)
    };
  });

  // ─── Consultants ─────────────────────────────────────────────────────────
  const consultants = Object.values(userMap).map(u => ({
    name: u.name, department: u.department, job: u.job,
    hoursThisWeek: round(u.hoursThisWeek), hoursPrevWeek: round(u.hoursPrevWeek),
    hoursThisMonth: round(u.hoursThisMonth), hoursPrevWeekMonth: round(u.hoursPrevMonth),
    billableWeek: round(u.billableWeek), nonBillableWeek: round(u.nonBillableWeek),
    entries: u.entries, projectCount: Object.keys(u.projects).length,
    hasHours: u.hoursThisWeek > 0 || u.hoursThisMonth > 0
  })).sort((a, b) => b.hoursThisWeek - a.hoursThisWeek);

  // ─── Summary ─────────────────────────────────────────────────────────────
  const weekTotal = Object.values(userMap).reduce((s, u) => s + u.hoursThisWeek, 0);
  const monthTotal = Object.values(userMap).reduce((s, u) => s + u.hoursThisMonth, 0);
  const doneTasks = allTasks.filter(t => isDone(t)).length;

  cache = {
    summary: {
      weekHours: round(weekTotal), monthHours: round(monthTotal),
      billableWeek: round(totalBillableWeek), nonBillableWeek: round(totalNonBillableWeek),
      billableMonth: round(totalBillableMonth), nonBillableMonth: round(totalNonBillableMonth),
      activeUsers: Object.values(userMap).filter(u => u.hoursThisWeek > 0).length,
      totalActiveEmployees: employees.length,
      totalTasks: allTasks.length, doneTasks,
      completionRate: allTasks.length > 0 ? Math.round(doneTasks / allTasks.length * 100) : 0
    },
    consultants,
    projectStatuses,
    anomalies: anomalies.slice(0, 60),
    weeklyData,
    lastUpdate: new Date().toISOString()
  };

  cacheTime = now;
  console.log(`[Cache] Done. Employees: ${employees.length}, Tasks: ${allTasks.length}, Anomalies: ${anomalies.length}`);
  return cache;
}

module.exports = { getDashboardCached };
