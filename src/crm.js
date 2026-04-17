/**
 * CRM data computation for the dashboard.
 * All monetary values are in PYG (Guaraníes).
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

/**
 * @param {Array} opps - raw crm.lead records from Odoo
 * @returns {object} crm summary for the dashboard
 */
function computeCRMStats(opps) {
  const now  = new Date();
  const d90  = new Date(now); d90.setDate(d90.getDate() - 90);
  const d180 = new Date(now); d180.setDate(d180.getDate() - 180);

  const all     = opps.filter(o => o.type === 'opportunity');
  const won     = all.filter(o => o.active && o.stage_id?.[0] === WON_STAGE_ID);
  const lost    = all.filter(o => !o.active);
  const open    = all.filter(o => o.active && o.stage_id?.[0] !== WON_STAGE_ID);

  // ── Win Rate (last 90 days) ───────────────────────────────────────────────
  const won90  = won.filter(o  => o.date_closed && new Date(o.date_closed)  >= d90);
  const lost90 = lost.filter(o => {
    const ref = o.date_closed || o.create_date;
    return ref && new Date(ref) >= d90;
  });
  const closedTotal = won90.length + lost90.length;
  const winRate = closedTotal > 0 ? Math.round(won90.length / closedTotal * 100) : null;

  // ── Pipeline value ────────────────────────────────────────────────────────
  const pipelineValue = open.reduce((s, o) => s + (o.expected_revenue || 0), 0);

  // ── Avg ticket (all won with revenue) ─────────────────────────────────────
  const wonWithRev = won.filter(o => o.expected_revenue > 0);
  const avgTicket  = wonWithRev.length
    ? wonWithRev.reduce((s, o) => s + o.expected_revenue, 0) / wonWithRev.length
    : 0;

  // ── Velocity: avg days create → date_closed (won, last 180d) ──────────────
  const wonWithDates = won
    .filter(o => o.date_closed && o.create_date && new Date(o.date_closed) >= d180);
  const avgDays = wonWithDates.length
    ? Math.round(wonWithDates.reduce((s, o) => s + daysBetween(o.create_date, o.date_closed), 0) / wonWithDates.length)
    : null;

  // ── By Hunter ─────────────────────────────────────────────────────────────
  const hunterMap = {};
  all.forEach(o => {
    const raw  = o.x_hunter_id?.[1] || o.user_id?.[1] || 'Sin Hunter';
    const name = raw.split(' ').slice(0, 2).join(' '); // "Nombre Apellido"
    const key  = name;
    if (!hunterMap[key]) hunterMap[key] = { name, leads: 0, won: 0, revenue: 0 };
    hunterMap[key].leads++;
    if (o.active && o.stage_id?.[0] === WON_STAGE_ID) {
      hunterMap[key].won++;
      hunterMap[key].revenue += (o.expected_revenue || 0);
    }
  });
  const byHunter = Object.values(hunterMap)
    .filter(h => h.name !== 'Sin Hunter' || h.leads > 0)
    .sort((a, b) => b.revenue - a.revenue);

  // ── By Source ─────────────────────────────────────────────────────────────
  const sourceMap = {};
  all.filter(o => o.active).forEach(o => {
    const src = o.source_id?.[1] || 'Sin Fuente';
    if (!sourceMap[src]) sourceMap[src] = { name: src, count: 0, wonCount: 0, revenue: 0 };
    sourceMap[src].count++;
    if (o.stage_id?.[0] === WON_STAGE_ID) {
      sourceMap[src].wonCount++;
      sourceMap[src].revenue += (o.expected_revenue || 0);
    }
  });
  const bySource = Object.values(sourceMap).sort((a, b) => b.count - a.count);

  // ── Pipeline by stage ─────────────────────────────────────────────────────
  const stageMap = {};
  open.forEach(o => {
    const stage = o.stage_id?.[1] || 'Sin etapa';
    if (!stageMap[stage]) stageMap[stage] = { name: stage, count: 0, value: 0 };
    stageMap[stage].count++;
    stageMap[stage].value += (o.expected_revenue || 0);
  });
  const byStage = Object.values(stageMap).sort((a, b) => b.value - a.value);

  // ── Top active opportunities (sorted by value) ─────────────────────────────
  const topActive = open
    .sort((a, b) => (b.expected_revenue || 0) - (a.expected_revenue || 0))
    .slice(0, 15)
    .map(o => ({
      id:      o.id,
      name:    o.name,
      stage:   o.stage_id?.[1] || '—',
      hunter:  (o.x_hunter_id?.[1] || o.user_id?.[1] || '—').split(' ')[0],
      source:  o.source_id?.[1] || 'Sin Fuente',
      revenue: o.expected_revenue || 0,
      revenueFmt: fmtGs(o.expected_revenue || 0),
      daysOpen: daysBetween(o.create_date, new Date().toISOString()),
    }));

  return {
    // Summary KPIs
    winRate,
    winRateLabel:   winRate !== null ? `${winRate}%` : 'N/D',
    winRateColor:   winRate === null ? 'slate' : winRate >= 50 ? 'green' : winRate >= 30 ? 'amber' : 'red',
    won90Count:     won90.length,
    lost90Count:    lost90.length,
    wonTotal:       won.length,
    lostTotal:      lost.length,

    pipelineValue,
    pipelineFmt:    fmtGs(pipelineValue),
    pipelineCount:  open.length,

    avgTicket,
    avgTicketFmt:   fmtGs(avgTicket),
    wonWithRevCount: wonWithRev.length,

    avgDays,
    avgDaysLabel:   avgDays !== null ? `${avgDays}d` : 'N/D',
    avgDaysColor:   avgDays === null ? 'slate' : avgDays <= 60 ? 'green' : avgDays <= 120 ? 'amber' : 'red',

    // Breakdowns
    byHunter,
    bySource,
    byStage,
    topActive,

    // Totals
    totalAll: all.length,
    openCount: open.length,
  };
}

module.exports = { computeCRMStats };
