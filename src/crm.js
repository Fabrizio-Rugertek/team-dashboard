/**
 * CRM data computation for the dashboard.
 * All monetary values are in PYG (Guaraníes).
 *
 * Exports:
 *   extractFilterOptions(allOpps)       → { allHunters, allClosers, allSources, allStages }
 *   applyFilters(allOpps, filters)      → filtered opps array
 *   computeCRMStats(opps)               → stats object (works with raw or pre-filtered opps)
 */
'use strict';

const WON_STAGE_ID = 4;

function fmtGs(val) {
  if (!val || val === 0) return '₲ 0';
  if (val >= 1_000_000_000) return `₲ ${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000)     return `₲ ${Math.round(val / 1_000_000)}M`;
  return `₲ ${Math.round(val).toLocaleString('es-PY')}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null; // 'YYYY-MM'
}

// ── Filter options (unique values across ALL opps — for dropdowns) ─────────────
function extractFilterOptions(opps) {
  const hunters = new Map();
  const closers = new Map();
  const sources = new Map();
  const stages  = new Map();

  opps.filter(o => o.type === 'opportunity').forEach(o => {
    const hid   = o.x_hunter_id?.[0];
    const hname = o.x_hunter_id?.[1];
    if (hid && hname)       hunters.set(hid,           hname);
    else if (o.user_id?.[0]) hunters.set(o.user_id[0], o.user_id[1]);

    if (o.user_id?.[0])   closers.set(o.user_id[0],   o.user_id[1]);
    if (o.source_id?.[0]) sources.set(o.source_id[0], o.source_id[1]);
    if (o.stage_id?.[0])  stages.set(o.stage_id[0],   o.stage_id[1]);
  });

  return {
    allHunters: [...hunters.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    allClosers: [...closers.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    allSources: [...sources.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    allStages:  [...stages.entries()].map(([id, name]) => ({ id, name })),
  };
}

// ── Apply filters to raw opps array ─────────────────────────────────────────────
function applyFilters(opps, filters = {}) {
  const { hunterId, closerId, sourceId, stageId, from, to, dateType = 'created' } = filters;
  let result = opps.filter(o => o.type === 'opportunity');

  if (hunterId) {
    const id = Number(hunterId);
    result = result.filter(o => (o.x_hunter_id?.[0] || o.user_id?.[0]) === id);
  }
  if (closerId) {
    const id = Number(closerId);
    result = result.filter(o => o.user_id?.[0] === id);
  }
  if (sourceId) {
    const id = Number(sourceId);
    result = result.filter(o => o.source_id?.[0] === id);
  }
  if (stageId) {
    const ids = (Array.isArray(stageId) ? stageId : [stageId]).map(Number);
    result = result.filter(o => ids.includes(o.stage_id?.[0]));
  }
  if (from || to) {
    const field = dateType === 'closed' ? 'date_closed' : 'create_date';
    const fromD = from ? new Date(from + 'T00:00:00') : null;
    const toD   = to   ? new Date(to   + 'T23:59:59') : null;
    result = result.filter(o => {
      const d = o[field] ? new Date(o[field]) : null;
      if (!d) return !fromD;
      if (fromD && d < fromD) return false;
      if (toD   && d > toD)   return false;
      return true;
    });
  }
  return result;
}

// ── Main stats computation ─────────────────────────────────────────────────────
function computeCRMStats(opps) {
  const now  = new Date();
  const d90  = new Date(now); d90.setDate(d90.getDate() - 90);
  const d180 = new Date(now); d180.setDate(d180.getDate() - 180);

  // Support raw opps (may include leads) — filter to type=opportunity
  const all  = opps.filter(o => o.type === 'opportunity');
  const won  = all.filter(o =>  o.active && o.stage_id?.[0] === WON_STAGE_ID);
  const lost = all.filter(o => !o.active);
  const open = all.filter(o =>  o.active && o.stage_id?.[0] !== WON_STAGE_ID);

  // ── Win Rate (last 90d) ───────────────────────────────────────────────────────
  const won90  = won.filter(o  => o.date_closed && new Date(o.date_closed)  >= d90);
  const lost90 = lost.filter(o => {
    const ref = o.date_closed || o.create_date;
    return ref && new Date(ref) >= d90;
  });
  const closedTotal = won90.length + lost90.length;
  const winRate = closedTotal > 0 ? Math.round(won90.length / closedTotal * 100) : null;

  // ── Pipeline ──────────────────────────────────────────────────────────────────
  const pipelineValue = open.reduce((s, o) => s + (o.expected_revenue || 0), 0);

  // ── Revenue Won (total in filtered set) ──────────────────────────────────────
  const revenueWon = won.reduce((s, o) => s + (o.expected_revenue || 0), 0);

  // ── Avg Ticket ────────────────────────────────────────────────────────────────
  const wonWithRev = won.filter(o => o.expected_revenue > 0);
  const avgTicket  = wonWithRev.length
    ? wonWithRev.reduce((s, o) => s + o.expected_revenue, 0) / wonWithRev.length : 0;

  // ── Velocity: avg days create→close, last 180d won ───────────────────────────
  const wonWithDates = won.filter(o => o.date_closed && o.create_date && new Date(o.date_closed) >= d180);
  const avgDays = wonWithDates.length
    ? Math.round(wonWithDates.reduce((s, o) => s + daysBetween(o.create_date, o.date_closed), 0) / wonWithDates.length)
    : null;

  // ── By Hunter ─────────────────────────────────────────────────────────────────
  const hunterMap = {};
  all.forEach(o => {
    const id   = o.x_hunter_id?.[0] || o.user_id?.[0] || 0;
    const name = (o.x_hunter_id?.[1] || o.user_id?.[1] || 'Sin Hunter').split(' ').slice(0, 2).join(' ');
    if (!hunterMap[id]) hunterMap[id] = { id, name, leads: 0, won: 0, wonRevenue: 0 };
    hunterMap[id].leads++;
    if (o.active && o.stage_id?.[0] === WON_STAGE_ID) {
      hunterMap[id].won++;
      hunterMap[id].wonRevenue += (o.expected_revenue || 0);
    }
  });
  const byHunter = Object.values(hunterMap)
    .filter(h => h.name !== 'Sin Hunter')
    .map(h => ({
      ...h,
      revenue:    h.wonRevenue,
      revenueFmt: fmtGs(h.wonRevenue),
      winPct:     h.leads > 0 ? Math.round(h.won / h.leads * 100) : 0,
    }))
    .sort((a, b) => b.wonRevenue - a.wonRevenue);

  // ── By Closer ─────────────────────────────────────────────────────────────────
  const closerMap = {};
  all.forEach(o => {
    const id   = o.user_id?.[0] || 0;
    const name = (o.user_id?.[1] || 'Sin Closer').split(' ').slice(0, 2).join(' ');
    if (!closerMap[id]) closerMap[id] = { id, name, leads: 0, won: 0, wonRevenue: 0 };
    closerMap[id].leads++;
    if (o.active && o.stage_id?.[0] === WON_STAGE_ID) {
      closerMap[id].won++;
      closerMap[id].wonRevenue += (o.expected_revenue || 0);
    }
  });
  const byCloser = Object.values(closerMap)
    .map(c => ({
      ...c,
      revenueFmt: fmtGs(c.wonRevenue),
      winPct:     c.leads > 0 ? Math.round(c.won / c.leads * 100) : 0,
    }))
    .sort((a, b) => b.wonRevenue - a.wonRevenue);

  // ── By Source ─────────────────────────────────────────────────────────────────
  const sourceMap = {};
  all.forEach(o => {
    const src = o.source_id?.[1] || 'Sin Fuente';
    const sid = o.source_id?.[0] || null;
    if (!sourceMap[src]) sourceMap[src] = { name: src, id: sid, count: 0, active: 0, won: 0, lost: 0, revenue: 0 };
    sourceMap[src].count++;
    if (o.active && o.stage_id?.[0] !== WON_STAGE_ID) sourceMap[src].active++;
    if (o.active && o.stage_id?.[0] === WON_STAGE_ID) {
      sourceMap[src].won++;
      sourceMap[src].revenue += (o.expected_revenue || 0);
    }
    if (!o.active) sourceMap[src].lost++;
  });
  const bySource = Object.values(sourceMap)
    .map(s => ({
      ...s,
      winPct:     (s.won + s.lost) > 0 ? Math.round(s.won / (s.won + s.lost) * 100) : 0,
      revenueFmt: fmtGs(s.revenue),
    }))
    .sort((a, b) => b.count - a.count);

  // ── By Stage (active pipeline snapshot) ──────────────────────────────────────
  const stageMap = {};
  open.forEach(o => {
    const stageId = o.stage_id?.[0] || null;
    const stage   = o.stage_id?.[1] || 'Sin etapa';
    if (!stageMap[stage]) stageMap[stage] = { id: stageId, name: stage, count: 0, value: 0 };
    stageMap[stage].count++;
    stageMap[stage].value += (o.expected_revenue || 0);
  });
  const byStage = Object.values(stageMap).sort((a, b) => b.value - a.value);

  // ── Funnel Data (active stages + Won + Lost) ──────────────────────────────────
  const STAGE_ORDER = ['New', 'Discovery', 'Calificado', 'Propuesta', 'On Hold'];
  const openStageMap = {};
  open.forEach(o => {
    const s   = o.stage_id?.[1] || 'Sin etapa';
    const sid = o.stage_id?.[0] || null;
    if (!openStageMap[s]) openStageMap[s] = { id: sid, count: 0, value: 0 };
    openStageMap[s].count++;
    openStageMap[s].value += (o.expected_revenue || 0);
  });
  const orderedStageKeys = Object.keys(openStageMap).sort((a, b) => {
    const ai = STAGE_ORDER.findIndex(s => a.includes(s));
    const bi = STAGE_ORDER.findIndex(s => b.includes(s));
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return  1;
    return a.localeCompare(b);
  });
  const funnelData = [];
  orderedStageKeys.forEach(key => {
    funnelData.push({ name: key, stageId: openStageMap[key].id, count: openStageMap[key].count, value: openStageMap[key].value, type: 'active' });
  });
  funnelData.push({ name: 'Ganados', count: won.length,  value: revenueWon, type: 'won'  });
  funnelData.push({ name: 'Perdidos', count: lost.length, value: 0,          type: 'lost' });

  // ── Monthly Trend (last 12 months) ────────────────────────────────────────────
  const trendMap = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
    trendMap[key] = {
      month:   key,
      label:   label.charAt(0).toUpperCase() + label.slice(1),
      created: 0, won: 0, lost: 0, revenue: 0,
    };
  }
  all.forEach(o => {
    const mk = monthKey(o.create_date);
    if (mk && trendMap[mk]) trendMap[mk].created++;

    if (o.active && o.stage_id?.[0] === WON_STAGE_ID && o.date_closed) {
      const ck = monthKey(o.date_closed);
      if (ck && trendMap[ck]) {
        trendMap[ck].won++;
        trendMap[ck].revenue += (o.expected_revenue || 0);
      }
    }
    if (!o.active) {
      const ref = o.date_closed || o.create_date;
      const ck  = monthKey(ref);
      if (ck && trendMap[ck]) trendMap[ck].lost++;
    }
  });
  const trendData = Object.values(trendMap);

  // ── Top Active Opportunities ──────────────────────────────────────────────────
  const topActive = open
    .sort((a, b) => (b.expected_revenue || 0) - (a.expected_revenue || 0))
    .slice(0, 15)
    .map(o => ({
      id:         o.id,
      name:       o.name,
      stageId:    o.stage_id?.[0]  || null,
      stage:      o.stage_id?.[1]  || '—',
      hunterId:   o.x_hunter_id?.[0] || o.user_id?.[0] || null,
      hunter:     (o.x_hunter_id?.[1] || o.user_id?.[1] || '—').split(' ')[0],
      closerId:   o.user_id?.[0]   || null,
      closer:     (o.user_id?.[1]  || '—').split(' ')[0],
      sourceId:   o.source_id?.[0] || null,
      source:     o.source_id?.[1] || 'Sin Fuente',
      revenue:    o.expected_revenue || 0,
      revenueFmt: fmtGs(o.expected_revenue || 0),
      daysOpen:   daysBetween(o.create_date, new Date().toISOString()),
    }));

  return {
    // ── KPIs ──────────────────────────────────────────────────────────────────
    winRate,
    winRateLabel:    winRate !== null ? `${winRate}%` : 'N/D',
    winRateColor:    winRate === null ? 'slate' : winRate >= 50 ? 'green' : winRate >= 30 ? 'amber' : 'red',
    won90Count:      won90.length,
    lost90Count:     lost90.length,
    wonTotal:        won.length,
    lostTotal:       lost.length,
    totalAll:        all.length,

    revenueWon,
    revenueWonFmt:   fmtGs(revenueWon),

    pipelineValue,
    pipelineFmt:     fmtGs(pipelineValue),
    pipelineCount:   open.length,

    avgTicket,
    avgTicketFmt:    fmtGs(avgTicket),
    wonWithRevCount: wonWithRev.length,

    avgDays,
    avgDaysLabel:    avgDays !== null ? `${avgDays}d` : 'N/D',
    avgDaysColor:    avgDays === null ? 'slate' : avgDays <= 60 ? 'green' : avgDays <= 120 ? 'amber' : 'red',

    // ── Breakdowns ────────────────────────────────────────────────────────────
    byHunter,
    byCloser,
    bySource,
    byStage,
    topActive,
    funnelData,
    trendData,
    openCount: open.length,
  };
}

module.exports = { extractFilterOptions, applyFilters, computeCRMStats };
