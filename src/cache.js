/**
 * Dashboard cache — two-layer architecture:
 *   Layer 1: _rawCache      — Odoo data (employees, timesheets, tasks), 5-min TTL
 *   Layer 2: _derivedCache  — Computed aggregations per filter combo, 5-min TTL
 *
 * Filters supported:
 *   range      : '7d' | '30d' | 'mtd' | '60d' | '90d'  (default '30d')
 *   consultant : login string | 'all'
 *   status, tag: project-level filters (applied at render time)
 */
'use strict';

const config = require('./config');
const odoo   = require('./odoo');

// ── Layer 1: raw Odoo data ────────────────────────────────────────────────────
let _rawCache     = null;
let _rawCacheTime = 0;

// ── Layer 2: derived per filter combo ────────────────────────────────────────
const _derivedCache = new Map();   // key → { data, time }
const MAX_DERIVED   = 10;

const round      = v => Math.round(v * 10) / 10;
const formatPct  = value => Math.round((value || 0) * 100);

// ── Date helpers ──────────────────────────────────────────────────────────────
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function toDateOnly(date) { return date.toISOString().slice(0, 10); }
function fromDateOnly(value) { return new Date(`${value}T00:00:00`); }
function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function diffDays(dateA, dateB) {
  return Math.round((startOfDay(dateA).getTime() - startOfDay(dateB).getTime()) / 86400000);
}
function isHoliday(dateStr) { return config.HOLIDAYS.has(dateStr); }
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
  return fromDateOnly(dateStr).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit' });
}
function datePart(value) { return String(value || '').slice(0, 10); }
function getJobType(job) {
  const j = (job || '').toLowerCase();
  if (j.includes('técn') || j.includes('tecn') || j.includes('technical')) return 'technical';
  if (j.includes('funcional') || j.includes('contable') || j.includes('functional')) return 'functional';
  return 'other';
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

// ── Range helpers ─────────────────────────────────────────────────────────────
function getRangeStart(range) {
  const today = startOfDay(new Date());
  switch (range) {
    case '7d':  return addDays(today, -7);
    case 'mtd': return new Date(today.getFullYear(), today.getMonth(), 1);
    case '60d': return addDays(today, -60);
    case '90d': return addDays(today, -90);
    default:    return addDays(today, -30);   // '30d'
  }
}
function getEffectiveDateRange(filters) {
  const range = filters.range || '30d';
  if (range === 'custom' && filters.from && filters.to) {
    const start  = fromDateOnly(filters.from);
    const toDate = addDays(fromDateOnly(filters.to), 1); // inclusive end
    return { start, toDate, from: filters.from, to: filters.to };
  }
  return { start: getRangeStart(range), toDate: null };
}
function getRangeComplianceDays(range) {
  return { '7d': 5, '30d': 20, 'mtd': 20, '60d': 20, '90d': 20 }[range] || 20;
}
function getRangeDisplayDays(range) {
  return { '7d': 5, '30d': 10, 'mtd': 10, '60d': 10, '90d': 10 }[range] || 10;
}

// ── Task helpers ──────────────────────────────────────────────────────────────
function isDone(task) {
  if (!task) return false;
  const n = (task.stageName || '').toLowerCase();
  return n.includes('complet') || n.includes('done') ||
         n.includes('cerrad')  || n.includes('terminad') || n.includes('finalizad');
}
function isBacklog(task) {
  if (!task) return false;
  if (task.stage_id && config.BACKLOG_STAGE_IDS.has(task.stage_id[0])) return true;
  const n = (task.stageName || '').toLowerCase();
  return config.BACKLOG_KEYWORDS.some(k => n.includes(k));
}
function computeProjectFlags(p) {
  return {
    needsAttention: p.totalAlloc > 0 && p.totalLog > p.totalAlloc * (config.LOG_OVER_ALLOC_PCT / 100),
    needsUpdate:    p.daysSinceUpdate > config.DAYS_SINCE_UPDATE_WARNING,
    isOnHold:       (p.stageProgress <= 5 && p.totalTasks > 0),
    isCompleted:    p.doneTasks === p.totalTasks && p.totalTasks > 0,
  };
}

// ── Project filter (applied at render, not at cache) ─────────────────────────
function filterProjects(projects, { status = 'all', tag = 'all' } = {}) {
  return projects.filter(p => {
    if (status !== 'all') {
      const flags = computeProjectFlags(p);
      if (status === 'needs_attention' && !flags.needsAttention) return false;
      if (status === 'on_hold'         && !flags.isOnHold)        return false;
      if (status === 'completed'       && !flags.isCompleted)     return false;
      if (status === 'active' && (flags.isCompleted || flags.isOnHold || flags.needsAttention)) return false;
    }
    if (tag !== 'all') {
      if (tag === 'sin_asignar' && !p.assignees?.some(a => a === 'Sin asignar')) return false;
      if (tag === 'backlog'     && p.backlogTasks === 0)  return false;
      if (tag === 'sobreestimado' && p.hoursPct < 120)    return false;
    }
    return true;
  });
}

// ── buildLoggingControl ───────────────────────────────────────────────────────
function buildLoggingControl({ employees, userIdToLogin, timesheets, complianceDays, displayDays }) {
  const displayDates   = getRecentBusinessDates(displayDays || config.LOG_HISTORY_BUSINESS_DAYS);
  const complianceDates = getRecentBusinessDates(complianceDays || config.LOG_COMPLIANCE_BUSINESS_DAYS);
  const latestBusinessDate = displayDates[displayDates.length - 1] || null;
  const weekStart = startOfDay(new Date());
  const _lcDow = weekStart.getDay(); // 0=Sun … 6=Sat
  weekStart.setDate(weekStart.getDate() - (_lcDow === 0 ? 6 : _lcDow - 1));

  const personLogs = new Map(
    employees
      .filter(emp => emp.login)
      .map(emp => [emp.login, {
        login:           emp.login,
        name:            emp.name,
        department:      emp.department || null,
        job:             emp.job || null,
        contract_start:  emp.contract_start || null,
        contract_end:    emp.contract_end   || null,
        byDate:          new Map(),
        totalEntries:    0,
        shortEntries:    0,
        roundEntries:    0,
        lateEntries:     0,
        preLogEntries:   0,
        entriesThisWeek: 0,
        hoursThisWeek:   0,
        lastLogDate:     null,
      }])
  );

  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !personLogs.has(login)) continue;

    const person      = personLogs.get(login);
    const workDate    = ts.date;
    const workDay     = fromDateOnly(workDate);
    const createDate  = parseCreateDate(ts.create_date);
    const hours       = parseFloat(ts.unit_amount || 0);
    const description = (ts.name || '').trim();
    const lateDays    = createDate ? diffDays(createDate, workDay) : 0;
    const isLate      = lateDays > config.LATE_LOG_DAYS_THRESHOLD;
    const isPreLog    = lateDays < -1;
    const isShort     = isMechanicalDescription(description);
    const isRound     = isRoundHourEntry(hours);

    if (!person.byDate.has(workDate)) {
      person.byDate.set(workDate, { date: workDate, hours: 0, entries: 0, shortEntries: 0, roundEntries: 0, lateEntries: 0, preLogEntries: 0, items: [] });
    }
    const bucket = person.byDate.get(workDate);
    bucket.hours       += hours;
    bucket.entries     += 1;
    if (isShort)   bucket.shortEntries  += 1;
    if (isRound)   bucket.roundEntries  += 1;
    if (isLate)    bucket.lateEntries   += 1;
    if (isPreLog)  bucket.preLogEntries += 1;
    bucket.items.push({ hours: round(hours), desc: description.slice(0, 120), isLate, isPreLog });

    person.totalEntries  += 1;
    if (isShort)   person.shortEntries  += 1;
    if (isRound)   person.roundEntries  += 1;
    if (isLate)    person.lateEntries   += 1;
    if (isPreLog)  person.preLogEntries += 1;

    if (workDay >= weekStart) { person.entriesThisWeek += 1; person.hoursThisWeek += hours; }
    if (!person.lastLogDate || workDate > person.lastLogDate) person.lastLogDate = workDate;
  }

  const statusOrder = { critical: 0, warning: 1, healthy: 2 };

  const people = [...personLogs.values()].map(person => {
    // Only count dates where the employee had an active contract
    const contractStart = person.contract_start ? fromDateOnly(person.contract_start) : null;
    const contractEnd   = person.contract_end   ? addDays(fromDateOnly(person.contract_end), 1) : null;
    const activeDates   = complianceDates.filter(dateStr => {
      const d = fromDateOnly(dateStr);
      if (contractStart && d < contractStart) return false;
      if (contractEnd   && d >= contractEnd)  return false;
      return true;
    });

    const loggedDays = activeDates.reduce((count, dateStr) => {
      const day = person.byDate.get(dateStr);
      return count + ((day && day.hours > 0) ? 1 : 0);
    }, 0);
    const missingDays = activeDates.length - loggedDays;
    let missingStreak = 0;
    for (let i = activeDates.length - 1; i >= 0; i -= 1) {
      const day = person.byDate.get(activeDates[i]);
      if (day && day.hours > 0) break;
      missingStreak += 1;
    }

    const shortDescPct = person.totalEntries > 0 ? person.shortEntries  / person.totalEntries : 0;
    const roundPct     = person.totalEntries > 0 ? person.roundEntries   / person.totalEntries : 0;
    const latePct      = person.totalEntries > 0 ? person.lateEntries    / person.totalEntries : 0;
    const preLogPct    = person.totalEntries > 0 ? person.preLogEntries  / person.totalEntries : 0;

    const currentWeekDays  = activeDates.filter(dateStr => fromDateOnly(dateStr) >= weekStart);
    const maxWeekDayHours  = currentWeekDays.reduce((max, dateStr) => Math.max(max, person.byDate.get(dateStr)?.hours || 0), 0);
    const concentratedWeek = person.hoursThisWeek >= 16 && maxWeekDayHours / Math.max(person.hoursThisWeek, 1) >= 0.6;

    const flags = [];
    let suspiciousScore = 0;

    if (person.hoursThisWeek === 0) { suspiciousScore += 40; flags.push('Sin horas esta semana'); }
    if (missingStreak >= 2) { suspiciousScore += 20; flags.push(`${missingStreak} dias habiles seguidos sin log`); }
    if (missingDays >= Math.ceil(complianceDates.length * 0.4)) { suspiciousScore += 20; flags.push(`Compliance bajo (${loggedDays}/${complianceDates.length})`); }
    if (latePct >= 0.4  && person.totalEntries >= 4) { suspiciousScore += 20; flags.push(`Carga tardia alta (${formatPct(latePct)}%)`); }
    if (preLogPct >= 0.15 && person.totalEntries >= 4) { suspiciousScore += 25; flags.push(`Pre-logeo detectado (${formatPct(preLogPct)}%)`); }
    if (shortDescPct >= 0.45 && person.totalEntries >= 4) { suspiciousScore += 20; flags.push(`Descripciones pobres (${formatPct(shortDescPct)}%)`); }
    if (roundPct >= 0.8 && person.totalEntries >= 6) { suspiciousScore += 15; flags.push(`Demasiadas cargas redondas (${formatPct(roundPct)}%)`); }
    if (person.entriesThisWeek <= 2 && person.hoursThisWeek >= 24) { suspiciousScore += 20; flags.push('Muchas horas en muy pocas cargas'); }
    if (concentratedWeek) { suspiciousScore += 15; flags.push('Semana concentrada en un solo dia'); }

    let status = 'healthy';
    if (suspiciousScore >= config.SUSPICIOUS_LOG_SCORE_CRITICAL || missingStreak >= 3 || person.hoursThisWeek === 0) status = 'critical';
    else if (suspiciousScore >= config.SUSPICIOUS_LOG_SCORE_WARNING || missingStreak >= 2 || missingDays >= 4) status = 'warning';

    const recentDays = displayDates.map(dateStr => {
      const day = person.byDate.get(dateStr) || { date: dateStr, hours: 0, entries: 0, shortEntries: 0, roundEntries: 0, lateEntries: 0, preLogEntries: 0, items: [] };
      return {
        date:        dateStr,
        label:       formatBusinessLabel(dateStr),
        hours:       round(day.hours),
        entries:     day.entries,
        isMissing:   day.hours === 0,
        lateEntries: day.lateEntries,
        preLogEntries: day.preLogEntries,
        items:       day.items || [],
      };
    });

    return {
      login:          person.login,
      name:           person.name,
      department:     person.department,
      job:            person.job,
      compliancePct:  Math.round((loggedDays / Math.max(activeDates.length, 1)) * 100),
      loggedDays,
      expectedDays:   activeDates.length,
      missingDays,
      missingStreak,
      lastLogDate:    person.lastLogDate,
      hoursThisWeek:  round(person.hoursThisWeek),
      entriesThisWeek: person.entriesThisWeek,
      suspiciousScore,
      status,
      flags:          flags.slice(0, 3),
      quality: {
        shortDescPct: formatPct(shortDescPct),
        roundPct:     formatPct(roundPct),
        latePct:      formatPct(latePct),
        preLogPct:    formatPct(preLogPct),
      },
      recentDays,
    };
  }).sort((a, b) =>
    (statusOrder[a.status] - statusOrder[b.status]) ||
    (b.suspiciousScore - a.suspiciousScore) ||
    a.name.localeCompare(b.name, 'es')
  );

  const peopleCount   = people.length;
  const totalExpected = people.reduce((sum, p) => sum + p.expectedDays, 0);
  const totalLogged   = people.reduce((sum, p) => sum + p.loggedDays, 0);

  return {
    overview: {
      peopleCount,
      complianceDays:    complianceDates.length,
      displayDays:       displayDates.length,
      latestBusinessDate,
      latestBusinessLabel: latestBusinessDate ? formatBusinessLabel(latestBusinessDate) : null,
      compliancePct: totalExpected > 0 ? Math.round((totalLogged / totalExpected) * 100) : 0,
      missingLatestBusinessDayCount: latestBusinessDate
        ? people.filter(p => (p.recentDays.find(d => d.date === latestBusinessDate)?.hours || 0) === 0).length
        : 0,
      noLogThisWeekCount: people.filter(p => p.hoursThisWeek === 0).length,
      suspiciousCount:    people.filter(p => p.status !== 'healthy').length,
      warningCount:       people.filter(p => p.status === 'warning').length,
      criticalCount:      people.filter(p => p.status === 'critical').length,
    },
    displayDates: displayDates.map(dateStr => ({ date: dateStr, label: formatBusinessLabel(dateStr) })),
    people,
  };
}

// ── Layer 1: fetch raw Odoo data ──────────────────────────────────────────────
async function getRawOdooData() {
  const now = Date.now();
  if (_rawCache && (now - _rawCacheTime) < config.CACHE_TTL_MS) return _rawCache;

  console.log('[Cache] Fetching raw data from Odoo...');
  const [employees, timesheets, projects] = await Promise.all([
    odoo.fetchActiveEmployees(),
    odoo.fetchTimesheets(config.TIMESHEET_DAYS_BACK),
    odoo.fetchProjectsWithTasks(),
  ]);

  _rawCache     = { employees, timesheets, projects };
  _rawCacheTime = now;
  console.log(`[Cache] Raw: ${employees.length} emp, ${timesheets.length} ts, ${projects.length} proj`);
  return _rawCache;
}

// ── Layer 2: compute dashboard from raw data + filters ────────────────────────
function computeDashboard(raw, filters = {}) {
  const { employees: allEmployees, timesheets: allTimesheets, projects } = raw;
  const range              = filters.range || '30d';
  const filterConsultants  = filters.consultants instanceof Set ? filters.consultants : new Set();
  const hasFilter          = filterConsultants.size > 0;

  // Consultant dropdown options (all production employees, before filtering)
  const consultantOptions = allEmployees
    .filter(e => e.login)
    .map(e => ({ name: e.name, login: e.login, jobType: getJobType(e.job) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  // Apply date range filter to timesheets
  const { start: rangeStart, toDate: rangeEnd } = getEffectiveDateRange(filters);
  const timesheets = allTimesheets.filter(ts => {
    const d = fromDateOnly(ts.date);
    return d >= rangeStart && (!rangeEnd || d < rangeEnd);
  });

  // Apply consultant filter
  const employees = hasFilter
    ? allEmployees.filter(e => e.login && filterConsultants.has(e.login))
    : allEmployees;

  // ── Build maps ────────────────────────────────────────────────────────────
  const userIdToLogin   = new Map();
  const loginToEmployee = new Map();
  for (const e of employees) {
    if (e.login) {
      loginToEmployee.set(e.login, { name: e.name, department: e.department || null, job: e.job || null });
      if (e.userId) userIdToLogin.set(e.userId, e.login);
    }
  }

  const activeLogins = new Set([...loginToEmployee.keys()]);
  const taskMap      = new Map();
  const allTasks     = projects.flatMap(p => p.tasks.map(t => { taskMap.set(t.id, t); return t; }));
  const projectMap   = new Map(projects.map(p => [p.id, p]));

  // ── Per-user hours aggregation ────────────────────────────────────────────
  const today     = startOfDay(new Date());
  const weekStart = new Date(today);
  const _dow = today.getDay(); // 0=Sun … 6=Sat
  weekStart.setDate(today.getDate() - (_dow === 0 ? 6 : _dow - 1));
  const prevWeekStart = addDays(weekStart, -7);

  const userHoursMap = new Map([...activeLogins].map(login => [login, {
    login,
    name:             loginToEmployee.get(login)?.name || login,
    department:       loginToEmployee.get(login)?.department || null,
    job:              loginToEmployee.get(login)?.job || null,
    hoursThisWeek:    0,
    hoursPrevWeek:    0,
    hoursInRange:     0,   // hours within selected range
    billableWeek:     0,
    nonBillableWeek:  0,
    entries:          0,
    projects:         {},
  }]));

  const taskSaleLine = new Map();
  allTasks.forEach(t => { if (t.sale_line_id) taskSaleLine.set(t.id, t.sale_line_id); });

  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !userHoursMap.has(login)) continue;

    const ue       = userHoursMap.get(login);
    const d        = fromDateOnly(ts.date);
    const h        = parseFloat(ts.unit_amount || 0);
    const tid      = ts.task_id?.[0];
    const isBillable = tid && taskSaleLine.has(tid);
    const pid      = ts.project_id?.[0];

    ue.entries    += 1;
    ue.hoursInRange += h;   // all timesheets here are already range-filtered
    if (pid) ue.projects[pid] = (ue.projects[pid] || 0) + h;

    if (d >= weekStart) {
      ue.hoursThisWeek += h;
      if (isBillable) ue.billableWeek    += h;
      else            ue.nonBillableWeek += h;
    }
    if (d >= prevWeekStart && d < weekStart) ue.hoursPrevWeek += h;
  }

  // ── Heatmap drilldown lookup ──────────────────────────────────────────────
  const timesheetsByPersonProject = {};
  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    const pid   = ts.project_id?.[0];
    if (!login || !pid || !activeLogins.has(login)) continue;
    const key = `${login}:${pid}`;
    if (!timesheetsByPersonProject[key]) timesheetsByPersonProject[key] = [];
    timesheetsByPersonProject[key].push({
      date:  ts.date,
      desc:  (ts.name || '').slice(0, 120),
      hours: round(parseFloat(ts.unit_amount || 0)),
    });
  }

  // ── Anomaly detection ─────────────────────────────────────────────────────
  const anomalies = [];

  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !activeLogins.has(login)) continue;

    const hours = parseFloat(ts.unit_amount || 0);
    const d     = fromDateOnly(ts.date);
    const desc  = (ts.name || '').trim();
    const tid   = ts.task_id?.[0];
    const task  = tid ? taskMap.get(tid) : null;

    if (hours > config.EXCESSIVE_HOURS_THRESHOLD) {
      anomalies.push({ type: 'critical', user: login, message: `${hours.toFixed(1)}h en un dia`, detail: `${ts.date}${desc ? ' - ' + desc.slice(0, 60) : ''}`, category: 'exceso_dia' });
    }

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if ((isWeekend || config.HOLIDAYS.has(ts.date)) && hours > 0) {
      anomalies.push({ type: 'warning', user: login, message: `${isWeekend ? 'Fin de semana' : 'Feriado'}: ${ts.date}`, detail: `${hours.toFixed(1)}h - ${desc || '(sin descripcion)'}`.slice(0, 80), category: 'horas_inhabituales' });
    }

    if (task && !task.allocated_hours && hours > 0) {
      anomalies.push({ type: 'warning', user: login, message: `Tarea sin estimacion: ${(ts.task_id?.[1] || '').slice(0, 40)}`, detail: `${hours.toFixed(1)}h logueadas sin horas estimadas`, category: 'sin_estimacion' });
    }

    if (isMechanicalDescription(desc) && hours > config.MECHANICAL_DESC_HOURS) {
      anomalies.push({ type: 'warning', user: login, message: `Descripcion mecanica: "${desc || '(vacia)'}"`, detail: `${hours.toFixed(1)}h - "${desc || '(vacia)'}"`, category: 'descripcion_mecanica' });
    }

    // Pre-logging: created more than 1 day BEFORE the work date
    const createDate = parseCreateDate(ts.create_date);
    if (createDate) {
      const lateDays = diffDays(createDate, fromDateOnly(ts.date));
      if (lateDays < -1) {
        anomalies.push({ type: 'warning', user: login, message: `Pre-logeo: trabajo del ${ts.date} cargado ${Math.abs(lateDays)} dias antes`, detail: `Creado: ${ts.create_date?.slice(0, 10)} | ${hours.toFixed(1)}h - ${desc || '(sin desc)'}`.slice(0, 90), category: 'pre_logeo' });
      }
    }
  }

  // Employees with no hours this week
  const weekLogins = new Set(
    timesheets
      .filter(ts => fromDateOnly(ts.date) >= weekStart)
      .map(ts => { const id = ts.user_id?.[0]; return id ? (userIdToLogin.get(id) || null) : null; })
      .filter(Boolean)
  );
  for (const emp of employees) {
    if (!weekLogins.has(emp.login) && emp.login) {
      anomalies.push({ type: 'info', user: emp.name, message: 'Sin horas esta semana', detail: `${emp.department || 'Sin dept.'} - ${emp.job || 'Sin rol'}`, category: 'inactivo' });
    }
  }

  // Task-level anomalies — filter by consultant if active
  const filteredTaskUserIds = hasFilter
    ? new Set([...employees].map(e => e.userId).filter(Boolean))
    : null;

  for (const task of allTasks) {
    if (filteredTaskUserIds && task.user_id && !filteredTaskUserIds.has(task.user_id[0])) continue;
    if (isBacklog(task)) continue;
    const allocH = parseFloat(task.allocated_hours || 0);
    if (allocH > 8) {
      const missing = [];
      if (!task.date_start) missing.push('inicio');
      if (!task.date_end)   missing.push('fin');
      if (missing.length > 0) {
        anomalies.push({ type: 'warning', user: task.user_id ? task.user_id[1] || '?' : '?', message: `Tarea sin ${missing.join(' ni ')}: ${(task.name || '').slice(0, 40)}`, detail: `${allocH}h estimadas - requiere fechas de ${missing.join(' y ')}`, category: 'tarea_sin_fechas', taskId: task.id });
      }
    }
    if (task.parent_id && !task.sprint_id?.[0]) {
      anomalies.push({ type: 'warning', user: task.user_id ? task.user_id[1] || '?' : '?', message: `Tarea hija sin sprint: ${(task.name || '').slice(0, 40)}`, detail: `Pertenece a: ${task.parent_id?.[1] || '?'} - debe estar en un sprint`, category: 'hijo_sin_sprint', taskId: task.id });
    }
  }

  anomalies.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.type] || 3) - ({ critical: 0, warning: 1, info: 2 }[b.type] || 3));

  // ── Methodology compliance ────────────────────────────────────────────────
  const activeTasks         = allTasks.filter(t => !isBacklog(t));
  const totalActiveTasks    = activeTasks.length;
  const tasksWithSP         = activeTasks.filter(t => t.story_points).length;
  const tasksWithSprint     = activeTasks.filter(t => t.sprint_id?.[0]).length;
  const tasksWithHours      = activeTasks.filter(t => parseFloat(t.allocated_hours || 0) > 0).length;
  const tasksWithHoursAndNoSP = activeTasks.filter(t => parseFloat(t.effective_hours || 0) > 0 && !t.story_points).length;
  const methodology = {
    totalActiveTasks,
    tasksWithSP,     spPct:     totalActiveTasks > 0 ? Math.round(tasksWithSP     / totalActiveTasks * 100) : 0,
    tasksWithSprint, sprintPct: totalActiveTasks > 0 ? Math.round(tasksWithSprint / totalActiveTasks * 100) : 0,
    tasksWithHours,  hoursPct:  totalActiveTasks > 0 ? Math.round(tasksWithHours  / totalActiveTasks * 100) : 0,
    tasksWithHoursAndNoSP,
  };

  // ── Horas por proyecto matrix ─────────────────────────────────────────────
  const projectNameMap  = new Map(projects.map(p => [p.id, p.name.length > 24 ? p.name.slice(0, 24) + '…' : p.name]));
  const projectTotals   = {};
  for (const u of userHoursMap.values()) {
    for (const [pidStr, hrs] of Object.entries(u.projects)) {
      const pid = parseInt(pidStr);
      projectTotals[pid] = (projectTotals[pid] || 0) + hrs;
    }
  }
  const topProjectIds = Object.entries(projectTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pid]) => parseInt(pid));
  const topProjectCols = topProjectIds.map(pid => ({ id: pid, name: projectNameMap.get(pid) || `P${pid}`, total: round(projectTotals[pid] || 0) }));

  // ── Consultants list ──────────────────────────────────────────────────────
  const consultants = [...userHoursMap.values()]
    .map(u => {
      const totalWeek  = u.hoursThisWeek;
      const billablePct = totalWeek > 0 ? Math.round(u.billableWeek / totalWeek * 100) : 0;
      return {
        login:            u.login,
        name:             u.name,
        department:       u.department,
        job:              u.job,
        hoursThisWeek:    round(u.hoursThisWeek),
        hoursPrevWeek:    round(u.hoursPrevWeek),
        hoursInRange:     round(u.hoursInRange),
        billableWeek:     round(u.billableWeek),
        nonBillableWeek:  round(u.nonBillableWeek),
        billablePct,
        entries:          u.entries,
        projectCount:     Object.keys(u.projects).length,
        hasHours:         u.hoursThisWeek > 0 || u.hoursInRange > 0,
        projectHours:     topProjectIds.map(pid => round(u.projects[pid] || 0)),
      };
    })
    .sort((a, b) => b.hoursInRange - a.hoursInRange);

  // ── Summary totals ────────────────────────────────────────────────────────
  let totalBillableWeek = 0, totalNonBillableWeek = 0, totalBillableRange = 0, totalNonBillableRange = 0;
  for (const ts of timesheets) {
    const ruId  = ts.user_id?.[0];
    const login = ruId ? (userIdToLogin.get(ruId) || null) : null;
    if (!login || !activeLogins.has(login)) continue;
    const d = fromDateOnly(ts.date);
    const h = parseFloat(ts.unit_amount || 0);
    const isBillable = ts.task_id?.[0] && taskSaleLine.has(ts.task_id[0]);
    if (d >= weekStart) { if (isBillable) totalBillableWeek += h; else totalNonBillableWeek += h; }
    if (isBillable) totalBillableRange += h; else totalNonBillableRange += h;
  }

  // ── Weekly chart (last 8 weeks) ───────────────────────────────────────────
  const weeklyData = [];
  const nowDate = new Date();
  for (let i = 7; i >= 0; i -= 1) {
    const wEnd   = new Date(nowDate);
    wEnd.setDate(nowDate.getDate() - nowDate.getDay() - (i * 7));
    const wStart = addDays(wEnd, -6);
    const weekHours = allTimesheets
      .filter(ts => { const d = fromDateOnly(ts.date); const login = ts.user_id?.[0] ? userIdToLogin.get(ts.user_id[0]) : null; return d >= wStart && d <= wEnd && login && activeLogins.has(login); })
      .reduce((sum, ts) => sum + parseFloat(ts.unit_amount || 0), 0);
    weeklyData.push({ label: `Sem ${wStart.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`, hours: round(weekHours) });
  }

  // ── Project statuses ──────────────────────────────────────────────────────
  const projectStatuses = projects.map(p => {
    const tasks     = p.tasks || [];
    const totalAlloc = tasks.reduce((sum, t) => sum + parseFloat(t.allocated_hours || 0), 0);
    const totalLog   = tasks.reduce((sum, t) => sum + parseFloat(t.effective_hours  || 0), 0);
    const openTasks  = tasks.filter(t => !isDone(t)).length;
    const doneTasks  = tasks.filter(t => isDone(t)).length;
    const backlogTasks = tasks.filter(t => isBacklog(t)).length;
    const lastWrite  = p.write_date ? new Date(p.write_date) : null;
    const daysSince  = lastWrite ? Math.round((today - lastWrite) / 86400000) : 999;
    const avgProg    = tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => {
          const n = (t.stageName || '').toLowerCase();
          let progress = 0;
          if (n.includes('complet') || n.includes('done')) progress = 100;
          else if (n.includes('progreso')) progress = 50;
          else if (n.includes('revis') || n.includes('qa')) progress = 75;
          else if (n.includes('espera') || n.includes('hold')) progress = 25;
          return sum + progress;
        }, 0) / tasks.length)
      : 0;

    const flags = computeProjectFlags({ totalAlloc, totalLog, daysSinceUpdate: daysSince, stageProgress: avgProg, doneTasks, totalTasks: tasks.length });
    const shortName = p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name;

    return {
      id: p.id, name: shortName, fullName: p.name,
      totalAlloc: round(totalAlloc), totalLog: round(totalLog),
      openTasks, doneTasks, backlogTasks, totalTasks: tasks.length,
      hoursPct:       totalAlloc > 0 ? Math.round((totalLog / totalAlloc) * 100) : null,
      daysSinceUpdate: daysSince,
      needsAttention: flags.needsAttention, needsUpdate: flags.needsUpdate,
      isOnHold:       flags.isOnHold, isCompleted: flags.isCompleted,
      stageProgress:  avgProg,
      assignees: [...new Set(tasks.map(t => t.user_id ? t.user_id[1] || 'Sin asignar' : 'Sin asignar'))].slice(0, 4),
      ganttTasks: tasks
        .filter(t => t.date_start || t.date_end)
        .map(t => ({
          id:    t.id,
          name:  (t.name || '').slice(0, 60),
          start: t.date_start ? String(t.date_start).slice(0, 10) : null,
          end:   t.date_end   ? String(t.date_end).slice(0, 10)   : null,
          done:  isDone(t),
        }))
        .sort((a, b) => (a.start || '9999') < (b.start || '9999') ? -1 : 1),
    };
  });

  // ── Logging control ───────────────────────────────────────────────────────
  const loggingControl = buildLoggingControl({
    employees,
    userIdToLogin,
    timesheets,
    complianceDays: getRangeComplianceDays(range),
    displayDays:    getRangeDisplayDays(range),
  });

  // ── Final cache payload ───────────────────────────────────────────────────
  const rangeHours = round([...userHoursMap.values()].reduce((s, u) => s + u.hoursInRange, 0));
  const weekTotal  = round([...userHoursMap.values()].reduce((s, u) => s + u.hoursThisWeek, 0));
  const allDone    = allTasks.filter(t => isDone(t)).length;

  return {
    summary: {
      weekHours:          weekTotal,
      rangeHours,
      billableWeek:       round(totalBillableWeek),
      nonBillableWeek:    round(totalNonBillableWeek),
      billableRange:      round(totalBillableRange),
      nonBillableRange:   round(totalNonBillableRange),
      billableRangePct:   rangeHours > 0 ? Math.round(totalBillableRange / rangeHours * 100) : 0,
      activeUsers:        [...userHoursMap.values()].filter(u => u.hoursThisWeek > 0).length,
      totalActiveEmployees: employees.length,
      totalTasks:         allTasks.length,
      doneTasks:          allDone,
      completionRate:     allTasks.length > 0 ? Math.round((allDone / allTasks.length) * 100) : 0,
    },
    consultants,
    consultantOptions,
    topProjectCols,
    methodology,
    projectStatuses,
    anomalies:      anomalies.slice(0, 500),
    weeklyData,
    loggingControl,
    timesheetsByPersonProject,
    lastUpdate:     new Date().toISOString(),
    _userIdToLogin: userIdToLogin,
    _loginToEmployee: loginToEmployee,
    _taskMap:       taskMap,
    _projectMap:    projectMap,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
async function getDashboardCached(filters = {}) {
  const raw       = await getRawOdooData();
  const range     = filters.range || '30d';
  const consultants = filters.consultants instanceof Set ? filters.consultants : new Set();
  const cacheKey  = `${range}:${filters.from || ''}:${filters.to || ''}:${[...consultants].sort().join(',')}`;

  const slot = _derivedCache.get(cacheKey);
  const now  = Date.now();
  if (slot && (now - slot.time) < config.CACHE_TTL_MS) {
    return { ...slot.data, projectStatuses: filterProjects(slot.data.projectStatuses, filters) };
  }

  console.log(`[Cache] Computing derived data for ${cacheKey}...`);
  const data = computeDashboard(raw, filters);

  // Evict oldest slot if cache is full
  if (_derivedCache.size >= MAX_DERIVED) {
    const oldest = [..._derivedCache.entries()].sort((a, b) => a[1].time - b[1].time)[0];
    _derivedCache.delete(oldest[0]);
  }
  _derivedCache.set(cacheKey, { data, time: now });

  return { ...data, projectStatuses: filterProjects(data.projectStatuses, filters) };
}

function bustCache() {
  _rawCache     = null;
  _rawCacheTime = 0;
  _derivedCache.clear();
  console.log('[Cache] Manual bust triggered');
}

module.exports = { getDashboardCached, filterProjects, bustCache };
