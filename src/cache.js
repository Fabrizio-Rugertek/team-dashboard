const odoo = require('./odoo');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache = null;
let cacheTime = 0;

async function getDashboardCached() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL_MS) {
    console.log('[Cache] Using cached data');
    return cache;
  }

  console.log('[Cache] Refreshing data from Odoo...');

  const [employees, timesheets, projects] = await Promise.all([
    odoo.fetchActiveEmployees(),
    odoo.fetchTimesheets(60),
    odoo.fetchProjectsWithTasks()
  ]);

  const activeLogins = new Set(employees.map(e => e.login).filter(Boolean));

  // Build user map from active employees
  const userMap = {};
  for (const e of employees) {
    if (e.login) {
      userMap[e.login] = {
        name: e.name,
        department: e.department || null,
        job: e.job || null,
        hoursThisWeek: 0, hoursPrevWeek: 0,
        hoursThisMonth: 0, hoursPrevMonth: 0,
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

  const round = v => Math.round(v * 10) / 10;

  // Assign timesheets to employees
  for (const ts of timesheets) {
    const login = ts.user_id && ts.user_id[1];
    if (!login || !userMap[login]) continue;

    const ue = userMap[login];
    const d = new Date(ts.date + 'T00:00:00');
    const h = parseFloat(ts.unit_amount || 0);

    ue.entries++;
    ue.hoursThisWeek += h;
    ue.hoursPrevWeek += h;
    ue.hoursThisMonth += h;
    ue.hoursPrevMonth += h;

    const pid = ts.project_id && ts.project_id[0];
    if (pid) ue.projects[pid] = (ue.projects[pid] || 0) + h;
  }

  // Task completion
  function isDone(task) {
    if (!task) return false;
    const n = (task.stageName || '').toLowerCase();
    return n.includes('complet') || n.includes('done') || n.includes('cerrad') || n.includes('terminad') || n.includes('finalizad');
  }

  // Stages
  const stageMap = {};
  const stageSet = new Set();
  projects.forEach(p => {
    (p.tasks || []).forEach(t => {
      if (t.stageName) { stageMap[t.stageName] = (stageMap[t.stageName] || 0) + 1; stageSet.add(t.stageName); }
    });
  });

  // Build stage data
  const stageData = Object.entries(stageMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Project status
  const projectStatuses = projects.map(p => {
    const tasks = p.tasks || [];
    const totalAlloc = tasks.reduce((s, t) => s + parseFloat(t.allocated_hours || 0), 0);
    const totalLog = tasks.reduce((s, t) => s + parseFloat(t.effective_hours || 0), 0);
    const openTasks = tasks.filter(t => !isDone(t)).length;
    const doneTasks = tasks.filter(t => isDone(t)).length;
    const lastWrite = p.write_date ? new Date(p.write_date) : null;
    const daysSince = lastWrite ? Math.round((today - lastWrite) / 86400000) : 999;
    const avgProg = tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => {
          const n = (t.stageName || '').toLowerCase();
          let p = 0;
          if (n.includes('complet') || n.includes('done')) p = 100;
          else if (n.includes('progreso')) p = 50;
          else if (n.includes('revis')) p = 75;
          else if (n.includes('espera') || n.includes('hold')) p = 25;
          return s + p;
        }, 0) / tasks.length)
      : 0;
    const shortName = p.name.length > 25 ? p.name.slice(0, 25) + '…' : p.name;
    return {
      id: p.id, name: shortName, fullName: p.name,
      totalAlloc: round(totalAlloc), totalLog: round(totalLog),
      openTasks, doneTasks, totalTasks: tasks.length,
      hoursPct: totalAlloc > 0 ? Math.round(totalLog / totalAlloc * 100) : null,
      daysSinceUpdate: daysSince,
      needsAttention: (totalAlloc > 0 && totalLog > totalAlloc * 1.2) || daysSince > 14,
      needsUpdate: daysSince > 7,
      stageProgress: avgProg,
      assignees: [...new Set(tasks.map(t => t.user_id && t.user_id[1] || 'Sin asignar'))].slice(0, 4)
    };
  });

  // Consultants
  const consultants = Object.values(userMap).map(u => ({
    name: u.name,
    department: u.department,
    job: u.job,
    hoursThisWeek: round(u.hoursThisWeek),
    hoursPrevWeek: round(u.hoursPrevWeek),
    hoursThisMonth: round(u.hoursThisMonth),
    hoursPrevMonth: round(u.hoursPrevMonth),
    entries: u.entries,
    projectCount: Object.keys(u.projects).length,
    hasHours: u.hoursThisWeek > 0 || u.hoursThisMonth > 0
  })).sort((a, b) => b.hoursThisWeek - a.hoursThisWeek);

  // Summary
  const weekTotal = Object.values(userMap).reduce((s, u) => s + u.hoursThisWeek, 0);
  const monthTotal = Object.values(userMap).reduce((s, u) => s + u.hoursThisMonth, 0);
  const allTasks = projects.flatMap(p => p.tasks || []);
  const doneTasks = allTasks.filter(t => isDone(t)).length;

  // Anomalies
  const anomalies = [];

  for (const ts of timesheets) {
    const login = ts.user_id && ts.user_id[1];
    if (!login || !activeLogins.has(login)) continue;

    const hours = parseFloat(ts.unit_amount || 0);
    const d = new Date(ts.date + 'T00:00:00');
    const desc = (ts.name || '').trim();
    const task = allTasks.find(t => t.id === ts.task_id?.[0]);

    if (hours > 12) {
      anomalies.push({ type: 'critical', icon: '⚠️', user: login,
        message: `${hours.toFixed(1)}h en un día`,
        detail: `${ts.date}${desc ? ' — ' + desc.slice(0,60) : ''}`,
        category: 'exceso_dia' });
    }

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const holidays = ['2026-01-01','2026-01-08','2026-02-09','2026-02-10','2026-03-01','2026-04-01','2026-04-02','2026-04-03','2026-05-01','2026-05-14','2026-06-15','2026-07-28','2026-08-15','2026-09-29','2026-12-08','2026-12-25'];
    const isHoliday = holidays.includes(ts.date);

    if ((isWeekend || isHoliday) && hours > 0) {
      anomalies.push({ type: 'warning', icon: '📅', user: login,
        message: `${isWeekend ? 'Fin de semana' : 'Feriado'}: ${ts.date}`,
        detail: `${hours.toFixed(1)}h — ${desc || '(sin descripción)'}`.slice(0, 80),
        category: 'horas_inhabituales' });
    }

    if (hours > 0 && task && !task.allocated_hours && ts.task_id) {
      anomalies.push({ type: 'warning', icon: '📊', user: login,
        message: `Tarea sin estimación: ${(ts.task_id[1] || '').slice(0, 40)}`,
        detail: `${hours.toFixed(1)}h sin horas estimadas`,
        category: 'sin_estimacion' });
    }

    const mechanical = ['-','x','.','ok','si','no','nada','listo','done','...','///','---'].some(m => desc.toLowerCase() === m) || (desc.length > 0 && desc.length < 4);
    if (mechanical && hours > 3) {
      anomalies.push({ type: 'warning', icon: '🤖', user: login,
        message: `Descripción mecánica: "${desc}"`,
        detail: `${hours.toFixed(1)}h — revisar si hay progreso real`,
        category: 'descripcion_mecanica' });
    }
  }

  // Inactive employees
  const weekLogins = new Set(
    timesheets.filter(ts => new Date(ts.date + 'T00:00:00') >= weekStart)
      .map(ts => ts.user_id && ts.user_id[1]).filter(Boolean)
  );
  for (const emp of employees) {
    if (!weekLogins.has(emp.login) && emp.login) {
      anomalies.push({ type: emp.contract_state === 'draft' ? 'info' : 'info', icon: '💤', user: emp.name,
        message: `Sin horas esta semana`,
        detail: `${emp.department || 'Sin dept.'} · ${emp.job || 'Sin rol'}`,
        category: 'inactivo' });
    }
  }

  anomalies.sort((a, b) => {
    const o = { critical: 0, warning: 1, info: 2 };
    return (o[a.type] || 3) - (o[b.type] || 3);
  });

  // Weekly hours for last 8 weeks
  const weeklyData = [];
  for (let i = 7; i >= 0; i--) {
    const wEnd = new Date(nowDate);
    wEnd.setDate(nowDate.getDate() - nowDate.getDay() - (i * 7));
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);

    const weekHours = timesheets
      .filter(ts => {
        const d = new Date(ts.date + 'T00:00:00');
        return d >= wStart && d <= wEnd;
      })
      .reduce((s, ts) => s + parseFloat(ts.unit_amount || 0), 0);

    weeklyData.push({
      label: `Sem ${wStart.toLocaleDateString('es', {day:'numeric',month:'short'})}`,
      hours: round(weekHours)
    });
  }

  cache = {
    summary: {
      weekHours: round(weekTotal),
      monthHours: round(monthTotal),
      activeUsers: Object.values(userMap).filter(u => u.hoursThisWeek > 0).length,
      totalActiveEmployees: employees.length,
      totalTasks: allTasks.length,
      doneTasks,
      completionRate: allTasks.length > 0 ? Math.round(doneTasks / allTasks.length * 100) : 0
    },
    consultants,
    stageData,
    projectStatuses,
    anomalies: anomalies.slice(0, 50),
    lastUpdate: new Date().toISOString(),
    weeklyData
  };

  cacheTime = now;
  console.log('[Cache] Data cached. Employees:', employees.length);
  return cache;
}

module.exports = { getDashboardCached };
