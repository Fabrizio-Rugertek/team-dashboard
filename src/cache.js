/**
 * Dashboard cache — builds and returns the aggregated /equipo payload.
 * All thresholds and static data come from src/config.js.
 */
'use strict';

const config = require('./config');
const odoo   = require('./odoo');

let _cache     = null;
let _cacheTime = 0;

const round = v => Math.round(v * 10) / 10;
const formatPct = value => Math.round((value || 0) * 100);

// ── Date helpers ─────────────────────────────────────────────────────────────
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function fromDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(dateA, dateB) {
  const a = startOfDay(dateA).getTime();
  const b = startOfDay(dateB).getTime();
  return Math.round((a - b) / 86400000);
}

function isHoliday(dateStr) {
  return config.HOLIDAYS.has(dateStr);
}

function isBusinessDay(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !isHoliday(toDateOnly(date));
}

function getRecentBusinessDates(count, endDate = new Date()) {
  const dates = [];
  let cursor = startOfDay(endDate);
  while (dates.length < count) {
    if (isBusinessDay(cursor)) dates.push(toDateOnly(cursor));
    cursor = addDays(cursor, -1);
  }
  return dates.reverse();
}

function formatBusinessLabel(dateStr) {
  return fromDateOnly(dateStr).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: '2-digit',
  });
}

function datePart(value) {
  return String(value || '').slice(0, 10);
}

function parseCreateDate(value) {
  if (!value) return null;
  const iso = String(value).replace(' ', 'T');
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
}

function isRoundHourEntry(hours) {
  const value = Number(hours || 0);
  const fraction = Math.abs(value % 1);
  return fraction === 0 || fraction === 0.5;
}

function isMechanicalDescription(desc) {
  const value = (desc || '').trim().toLowerCase();
  if (!value) return true;
  if (value.length < config.LOG_MIN_DESC_LENGTH) return true;
  return ['-','x','.','ok','si','no','nada','listo','done','...','///','---']
    .some(token => value === token);
}

// ── Task helpers (now use config) ────────────────────────────────────────────
function isDone(task) {
  if (!task) return false;
  const n = (task.stageName || '').toLowerCase();
  return n.includes('complet') || n.includes('done') ||
         n.includes('cerrad') || n.includes('terminad') || n.includes('finalizad');
}

function isBacklog(task) {
  if (!task) return false;
  if (task.stage_id && config.BACKLOG_STAGE_IDS.has(task.stage_id[0])) return true;
  const n = (task.stageName || '').toLowerCase();
  return config.BACKLOG_KEYWORDS.some(k => n.includes(k));
}

// ── Project attention flags (use config thresholds) ──────────────────────────
function computeProjectFlags(p) {
  return {
    needsAttention: p.totalAlloc > 0 && p.totalLog > p.totalAlloc * (config.LOG_OVER_ALLOC_PCT / 100),
    needsUpdate:    p.daysSinceUpdate > config.DAYS_SINCE_UPDATE_WARNING,
    isOnHold:       (p.stageProgress <= 5 && p.totalTasks > 0),
    isCompleted:    p.doneTasks === p.totalTasks && p.totalTasks > 0,
  };
}

// ── Apply Odoo-style filters to project list ─────────────────────────────────
function filterProjects(projects, { status = 'all', tag = 'all' } = {}) {
  return projects.filter(p => {
    if (status !== 'all') {
      const flags = computeProjectFlags(p);
      if (status === 'needs_attention' && !flags.needsAttention) return false;
      if (status === 'on_hold' && !flags.isOnHold) return false;
      if (status === 'completed' && !flags.isCompleted) return false;
      if (status === 'active' && (flags.isCompleted || flags.isOnHold || flags.needsAttention)) return false;
    }

    if (tag !== 'all') {
      if (tag === 'sin_asignar' && !p.assignees?.some(a => a === 'Sin asignar')) return false;
      if (tag === 'backlog' && p.backlogTasks === 0) return false;
      if (tag === 'sobreestimado' && p.hoursPct < 120) return false;
    }

    return true;
  });
}

function buildLoggingControl({ employees, userHoursMap, userIdToLogin, timesheets }) {
  const displayDates = getRecentBusinessDates(config.LOG_HISTORY_BUSINESS_DAYS);
  const complianceDates = getRecentBusinessDates(config.LOG_COMPLIANCE_BUSINESS_DAYS);
  const latestBusinessDate = displayDates[displayDates.length - 1] || null;
  const weekStart = startOfDay(new Date());
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const personLogs = new Map(
    employees
      .filter(emp => emp.login)
      .map(emp => [emp.login, {
        login: emp.login,
        name: emp.name,
        department: emp.department || null,
        job: emp.job || null,
        byDate: new Map(),
        totalEntries: 0,
        shortEntries: 0,
        roundEntries: 0,
        lateEntries: 0,
        entriesThisWeek: 0,
        hoursThisWeek: 0,
        lastLogDate: null,
      }])
  );

  for (const ts of timesheets) {
    const ruId = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !personLogs.has(login)) continue;

    const person = personLogs.get(login);
    const workDate = ts.date;
    const workDay = fromDateOnly(workDate);
    const createDate = parseCreateDate(ts.create_date);
    const hours = parseFloat(ts.unit_amount || 0);
    const description = (ts.name || '').trim();
    const lateDays = createDate ? diffDays(createDate, workDay) : 0;
    const isLate = lateDays > config.LATE_LOG_DAYS_THRESHOLD;
    const isShort = isMechanicalDescription(description);
    const isRound = isRoundHourEntry(hours);

    if (!person.byDate.has(workDate)) {
      person.byDate.set(workDate, {
        date: workDate,
        hours: 0,
        entries: 0,
        shortEntries: 0,
        roundEntries: 0,
        lateEntries: 0,
      });
    }

    const bucket = person.byDate.get(workDate);
    bucket.hours += hours;
    bucket.entries += 1;
    if (isShort) bucket.shortEntries += 1;
    if (isRound) bucket.roundEntries += 1;
    if (isLate) bucket.lateEntries += 1;

    person.totalEntries += 1;
    if (isShort) person.shortEntries += 1;
    if (isRound) person.roundEntries += 1;
    if (isLate) person.lateEntries += 1;

    if (workDay >= weekStart) {
      person.entriesThisWeek += 1;
      person.hoursThisWeek += hours;
    }

    if (!person.lastLogDate || workDate > person.lastLogDate) {
      person.lastLogDate = workDate;
    }
  }

  const statusOrder = { critical: 0, warning: 1, healthy: 2 };
  const people = [...personLogs.values()].map(person => {
    const loggedDays = complianceDates.reduce((count, dateStr) => {
      const day = person.byDate.get(dateStr);
      return count + ((day && day.hours > 0) ? 1 : 0);
    }, 0);

    const missingDays = complianceDates.length - loggedDays;
    let missingStreak = 0;
    for (let i = complianceDates.length - 1; i >= 0; i -= 1) {
      const dateStr = complianceDates[i];
      const day = person.byDate.get(dateStr);
      if (day && day.hours > 0) break;
      missingStreak += 1;
    }

    const shortDescPct = person.totalEntries > 0 ? person.shortEntries / person.totalEntries : 0;
    const roundPct = person.totalEntries > 0 ? person.roundEntries / person.totalEntries : 0;
    const latePct = person.totalEntries > 0 ? person.lateEntries / person.totalEntries : 0;

    const currentWeekDays = complianceDates.filter(dateStr => fromDateOnly(dateStr) >= weekStart);
    const maxWeekDayHours = currentWeekDays.reduce((max, dateStr) => {
      const hours = person.byDate.get(dateStr)?.hours || 0;
      return Math.max(max, hours);
    }, 0);
    const concentratedWeek = person.hoursThisWeek >= 16 && maxWeekDayHours / Math.max(person.hoursThisWeek, 1) >= 0.6;

    const flags = [];
    let suspiciousScore = 0;

    if (person.hoursThisWeek === 0) {
      suspiciousScore += 40;
      flags.push('Sin horas esta semana');
    }
    if (missingStreak >= 2) {
      suspiciousScore += 20;
      flags.push(`${missingStreak} dias habiles seguidos sin log`);
    }
    if (missingDays >= Math.ceil(complianceDates.length * 0.4)) {
      suspiciousScore += 20;
      flags.push(`Compliance bajo (${loggedDays}/${complianceDates.length})`);
    }
    if (latePct >= 0.4 && person.totalEntries >= 4) {
      suspiciousScore += 20;
      flags.push(`Carga tardia alta (${formatPct(latePct)}%)`);
    }
    if (shortDescPct >= 0.45 && person.totalEntries >= 4) {
      suspiciousScore += 20;
      flags.push(`Descripciones pobres (${formatPct(shortDescPct)}%)`);
    }
    if (roundPct >= 0.8 && person.totalEntries >= 6) {
      suspiciousScore += 15;
      flags.push(`Demasiadas cargas redondas (${formatPct(roundPct)}%)`);
    }
    if (person.entriesThisWeek <= 2 && person.hoursThisWeek >= 24) {
      suspiciousScore += 20;
      flags.push('Muchas horas en muy pocas cargas');
    }
    if (concentratedWeek) {
      suspiciousScore += 15;
      flags.push('Semana concentrada en un solo dia');
    }

    let status = 'healthy';
    if (suspiciousScore >= config.SUSPICIOUS_LOG_SCORE_CRITICAL || missingStreak >= 3 || person.hoursThisWeek === 0) {
      status = 'critical';
    } else if (suspiciousScore >= config.SUSPICIOUS_LOG_SCORE_WARNING || missingStreak >= 2 || missingDays >= 4) {
      status = 'warning';
    }

    const recentDays = displayDates.map(dateStr => {
      const day = person.byDate.get(dateStr) || {
        date: dateStr,
        hours: 0,
        entries: 0,
        shortEntries: 0,
        roundEntries: 0,
        lateEntries: 0,
      };
      return {
        date: dateStr,
        label: formatBusinessLabel(dateStr),
        hours: round(day.hours),
        entries: day.entries,
        isMissing: day.hours === 0,
        lateEntries: day.lateEntries,
      };
    });

    return {
      login: person.login,
      name: person.name,
      department: person.department,
      job: person.job,
      compliancePct: Math.round((loggedDays / Math.max(complianceDates.length, 1)) * 100),
      loggedDays,
      expectedDays: complianceDates.length,
      missingDays,
      missingStreak,
      lastLogDate: person.lastLogDate,
      hoursThisWeek: round(person.hoursThisWeek),
      entriesThisWeek: person.entriesThisWeek,
      suspiciousScore,
      status,
      flags: flags.slice(0, 3),
      quality: {
        shortDescPct: formatPct(shortDescPct),
        roundPct: formatPct(roundPct),
        latePct: formatPct(latePct),
      },
      recentDays,
    };
  }).sort((a, b) => {
    return (statusOrder[a.status] - statusOrder[b.status]) ||
      (b.suspiciousScore - a.suspiciousScore) ||
      (b.missingDays - a.missingDays) ||
      a.name.localeCompare(b.name, 'es');
  });

  const peopleCount = people.length;
  const totalExpected = peopleCount * complianceDates.length;
  const totalLogged = people.reduce((sum, person) => sum + person.loggedDays, 0);
  const warningCount = people.filter(person => person.status === 'warning').length;
  const criticalCount = people.filter(person => person.status === 'critical').length;

  return {
    overview: {
      peopleCount,
      complianceDays: complianceDates.length,
      displayDays: displayDates.length,
      latestBusinessDate,
      latestBusinessLabel: latestBusinessDate ? formatBusinessLabel(latestBusinessDate) : null,
      compliancePct: totalExpected > 0 ? Math.round((totalLogged / totalExpected) * 100) : 0,
      missingLatestBusinessDayCount: latestBusinessDate
        ? people.filter(person => (person.recentDays.find(day => day.date === latestBusinessDate)?.hours || 0) === 0).length
        : 0,
      noLogThisWeekCount: people.filter(person => person.hoursThisWeek === 0).length,
      suspiciousCount: people.filter(person => person.status !== 'healthy').length,
      warningCount,
      criticalCount,
    },
    displayDates: displayDates.map(dateStr => ({ date: dateStr, label: formatBusinessLabel(dateStr) })),
    people,
  };
}

// ── Main cached data builder ─────────────────────────────────────────────────
async function getDashboardCached(filters = {}) {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < config.CACHE_TTL_MS) {
    return {
      ..._cache,
      projectStatuses: filterProjects(_cache.projectStatuses, filters),
    };
  }

  console.log('[Cache] Refreshing dashboard data...');

  const [employees, timesheets, projects] = await Promise.all([
    odoo.fetchActiveEmployees(),
    odoo.fetchTimesheets(config.TIMESHEET_DAYS_BACK),
    odoo.fetchProjectsWithTasks(),
  ]);

  const userIdToLogin = new Map();
  const loginToEmployee = new Map();

  for (const e of employees) {
    if (e.login) {
      loginToEmployee.set(e.login, {
        name: e.name,
        department: e.department || null,
        job: e.job || null,
      });
      if (e.userId) userIdToLogin.set(e.userId, e.login);
    }
  }

  const activeLogins = new Set([...loginToEmployee.keys()]);
  const taskMap = new Map();
  const allTasks = projects.flatMap(p =>
    p.tasks.map(t => { taskMap.set(t.id, t); return t; })
  );

  const projectMap = new Map(projects.map(p => [p.id, p]));

  const userHoursMap = new Map([...activeLogins].map(login => [login, {
    name: loginToEmployee.get(login)?.name || login,
    department: loginToEmployee.get(login)?.department || null,
    job: loginToEmployee.get(login)?.job || null,
    hoursThisWeek: 0,
    hoursPrevWeek: 0,
    hoursThisMonth: 0,
    hoursPrevMonth: 0,
    billableWeek: 0,
    nonBillableWeek: 0,
    entries: 0,
    projects: {},
  }]));

  const nowDate = new Date();
  const today = startOfDay(nowDate);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const taskSaleLine = new Map();
  allTasks.forEach(t => { if (t.sale_line_id) taskSaleLine.set(t.id, t.sale_line_id); });

  for (const ts of timesheets) {
    const ruId = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !userHoursMap.has(login)) continue;

    const ue = userHoursMap.get(login);
    const d = fromDateOnly(ts.date);
    const h = parseFloat(ts.unit_amount || 0);
    const tid = ts.task_id?.[0];
    const isBillable = tid && taskSaleLine.has(tid);

    ue.entries += 1;
    if (d >= weekStart) {
      ue.hoursThisWeek += h;
      if (isBillable) ue.billableWeek += h;
      else ue.nonBillableWeek += h;
    }
    if (d >= prevWeekStart && d < weekStart) ue.hoursPrevWeek += h;
    if (d >= monthStart) ue.hoursThisMonth += h;
    if (d >= prevMonthStart && d < monthStart) ue.hoursPrevMonth += h;

    const pid = ts.project_id?.[0];
    if (pid) ue.projects[pid] = (ue.projects[pid] || 0) + h;
  }

  const anomalies = [];

  for (const ts of timesheets) {
    const ruId = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !activeLogins.has(login)) continue;

    const hours = parseFloat(ts.unit_amount || 0);
    const d = fromDateOnly(ts.date);
    const desc = (ts.name || '').trim();
    const tid = ts.task_id?.[0];
    const task = tid ? taskMap.get(tid) : null;

    if (hours > config.EXCESSIVE_HOURS_THRESHOLD) {
      anomalies.push({
        type: 'critical',
        icon: '??',
        user: login,
        message: `${hours.toFixed(1)}h en un dia`,
        detail: `${ts.date}${desc ? ' - ' + desc.slice(0, 60) : ''}`,
        category: 'exceso_dia',
      });
    }

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const holiday = config.HOLIDAYS.has(ts.date);
    if ((isWeekend || holiday) && hours > 0) {
      anomalies.push({
        type: 'warning',
        icon: '??',
        user: login,
        message: `${isWeekend ? 'Fin de semana' : 'Feriado'}: ${ts.date}`,
        detail: `${hours.toFixed(1)}h - ${desc || '(sin descripcion)'}`.slice(0, 80),
        category: 'horas_inhabituales',
      });
    }

    if (task && !task.allocated_hours && hours > 0) {
      anomalies.push({
        type: 'warning',
        icon: '??',
        user: login,
        message: `Tarea sin estimacion: ${(ts.task_id?.[1] || '').slice(0, 40)}`,
        detail: `${hours.toFixed(1)}h logueadas sin horas estimadas`,
        category: 'sin_estimacion',
      });
    }

    if (isMechanicalDescription(desc) && hours > config.MECHANICAL_DESC_HOURS) {
      anomalies.push({
        type: 'warning',
        icon: '??',
        user: login,
        message: `Descripcion mecanica: "${desc || '(vacia)'}"`,
        detail: `${hours.toFixed(1)}h - "${desc || '(vacia)'}"`,
        category: 'descripcion_mecanica',
      });
    }
  }

  const weekLogins = new Set(
    timesheets
      .filter(ts => fromDateOnly(ts.date) >= weekStart)
      .map(ts => {
        const ruId = ts.user_id?.[0];
        return ruId ? (userIdToLogin.get(ruId) || null) : null;
      })
      .filter(Boolean)
  );
  for (const emp of employees) {
    if (!weekLogins.has(emp.login) && emp.login) {
      anomalies.push({
        type: 'info',
        icon: '??',
        user: emp.name,
        message: 'Sin horas esta semana',
        detail: `${emp.department || 'Sin dept.'} - ${emp.job || 'Sin rol'}`,
        category: 'inactivo',
      });
    }
  }

  for (const task of allTasks) {
    if (isBacklog(task)) continue;
    const allocH = parseFloat(task.allocated_hours || 0);

    if (allocH > 8) {
      const missing = [];
      if (!task.date_start) missing.push('inicio');
      if (!task.date_end) missing.push('fin');
      if (missing.length > 0) {
        anomalies.push({
          type: 'warning',
          icon: '??',
          user: task.user_id ? task.user_id[1] || '?' : '?',
          message: `Tarea sin ${missing.join(' ni ')}: ${(task.name || '').slice(0, 40)}`,
          detail: `${allocH}h estimadas - requiere fechas de ${missing.join(' y ')}`,
          category: 'tarea_sin_fechas',
          taskId: task.id,
        });
      }
    }

    if (task.parent_id && !task.sprint_id?.[0]) {
      anomalies.push({
        type: 'warning',
        icon: '??',
        user: task.user_id ? task.user_id[1] || '?' : '?',
        message: `Tarea hija sin sprint: ${(task.name || '').slice(0, 40)}`,
        detail: `Pertenece a: ${task.parent_id?.[1] || '?'} - debe estar en un sprint`,
        category: 'hijo_sin_sprint',
        taskId: task.id,
      });
    }
  }

  anomalies.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.type] || 3) - (order[b.type] || 3);
  });

  let totalBillableWeek = 0;
  let totalNonBillableWeek = 0;
  let totalBillableMonth = 0;
  let totalNonBillableMonth = 0;

  for (const ts of timesheets) {
    const ruId = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !activeLogins.has(login)) continue;

    const d = fromDateOnly(ts.date);
    const h = parseFloat(ts.unit_amount || 0);
    const tid = ts.task_id?.[0];
    const isBillable = tid && taskSaleLine.has(tid);

    if (d >= weekStart) {
      if (isBillable) totalBillableWeek += h;
      else totalNonBillableWeek += h;
    }
    if (d >= monthStart) {
      if (isBillable) totalBillableMonth += h;
      else totalNonBillableMonth += h;
    }
  }

  const weeklyData = [];
  for (let i = 7; i >= 0; i -= 1) {
    const wEnd = new Date(nowDate);
    wEnd.setDate(nowDate.getDate() - nowDate.getDay() - (i * 7));
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);

    const weekHours = timesheets
      .filter(ts => {
        const d = fromDateOnly(ts.date);
        const login = ts.user_id?.[0] ? userIdToLogin.get(ts.user_id[0]) : null;
        return d >= wStart && d <= wEnd && login && activeLogins.has(login);
      })
      .reduce((sum, ts) => sum + parseFloat(ts.unit_amount || 0), 0);

    weeklyData.push({
      label: `Sem ${wStart.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`,
      hours: round(weekHours),
    });
  }

  const projectStatuses = projects.map(p => {
    const tasks = p.tasks || [];
    const totalAlloc = tasks.reduce((sum, t) => sum + parseFloat(t.allocated_hours || 0), 0);
    const totalLog = tasks.reduce((sum, t) => sum + parseFloat(t.effective_hours || 0), 0);
    const openTasks = tasks.filter(t => !isDone(t)).length;
    const doneTasks = tasks.filter(t => isDone(t)).length;
    const backlogTasks = tasks.filter(t => isBacklog(t)).length;
    const lastWrite = p.write_date ? new Date(p.write_date) : null;
    const daysSince = lastWrite ? Math.round((today - lastWrite) / 86400000) : 999;
    const avgProg = tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => {
          const n = (t.stageName || '').toLowerCase();
          let progress = 0;
          if (n.includes('complet') || n.includes('done')) progress = 100;
          else if (n.includes('progreso')) progress = 50;
          else if (n.includes('revis') || n.includes('qa')) progress = 75;
          else if (n.includes('espera') || n.includes('hold')) progress = 25;
          else if (n.includes('backlog')) progress = 0;
          return sum + progress;
        }, 0) / tasks.length)
      : 0;
    const shortName = p.name.length > 28 ? `${p.name.slice(0, 28)}?` : p.name;

    const flags = computeProjectFlags({
      totalAlloc,
      totalLog,
      daysSinceUpdate: daysSince,
      stageProgress: avgProg,
      doneTasks,
      totalTasks: tasks.length,
    });

    return {
      id: p.id,
      name: shortName,
      fullName: p.name,
      totalAlloc: round(totalAlloc),
      totalLog: round(totalLog),
      openTasks,
      doneTasks,
      backlogTasks,
      totalTasks: tasks.length,
      hoursPct: totalAlloc > 0 ? Math.round((totalLog / totalAlloc) * 100) : null,
      daysSinceUpdate: daysSince,
      needsAttention: flags.needsAttention,
      needsUpdate: flags.needsUpdate,
      isOnHold: flags.isOnHold,
      isCompleted: flags.isCompleted,
      stageProgress: avgProg,
      assignees: [...new Set(tasks.map(t => t.user_id ? t.user_id[1] || 'Sin asignar' : 'Sin asignar'))].slice(0, 4),
    };
  });

  const consultants = [...userHoursMap.values()]
    .map(u => ({
      name: u.name,
      department: u.department,
      job: u.job,
      hoursThisWeek: round(u.hoursThisWeek),
      hoursPrevWeek: round(u.hoursPrevWeek),
      hoursThisMonth: round(u.hoursThisMonth),
      hoursPrevWeekMonth: round(u.hoursPrevMonth),
      billableWeek: round(u.billableWeek),
      nonBillableWeek: round(u.nonBillableWeek),
      entries: u.entries,
      projectCount: Object.keys(u.projects).length,
      hasHours: u.hoursThisWeek > 0 || u.hoursThisMonth > 0,
    }))
    .sort((a, b) => b.hoursThisWeek - a.hoursThisWeek);

  const weekTotal = [...userHoursMap.values()].reduce((sum, u) => sum + u.hoursThisWeek, 0);
  const monthTotal = [...userHoursMap.values()].reduce((sum, u) => sum + u.hoursThisMonth, 0);
  const allDone = allTasks.filter(t => isDone(t)).length;
  const loggingControl = buildLoggingControl({ employees, userHoursMap, userIdToLogin, timesheets });

  _cache = {
    summary: {
      weekHours: round(weekTotal),
      monthHours: round(monthTotal),
      billableWeek: round(totalBillableWeek),
      nonBillableWeek: round(totalNonBillableWeek),
      billableMonth: round(totalBillableMonth),
      nonBillableMonth: round(totalNonBillableMonth),
      activeUsers: [...userHoursMap.values()].filter(u => u.hoursThisWeek > 0).length,
      totalActiveEmployees: employees.length,
      totalTasks: allTasks.length,
      doneTasks: allDone,
      completionRate: allTasks.length > 0 ? Math.round((allDone / allTasks.length) * 100) : 0,
    },
    consultants,
    projectStatuses,
    anomalies: anomalies.slice(0, 500),
    weeklyData,
    loggingControl,
    lastUpdate: new Date().toISOString(),
    _userIdToLogin: userIdToLogin,
    _loginToEmployee: loginToEmployee,
    _taskMap: taskMap,
    _projectMap: projectMap,
  };

  _cacheTime = now;
  console.log(`[Cache] Done. Employees: ${employees.length}, Tasks: ${allTasks.length}, Anomalies: ${anomalies.length}`);

  return {
    ..._cache,
    projectStatuses: filterProjects(_cache.projectStatuses, filters),
  };
}

module.exports = { getDashboardCached, filterProjects };
