'use strict';

/**
 * Odoo data layer for the Finance dashboard.
 * Uses batched queries (2 round-trips instead of N+1) for speed.
 */

const { callKw } = require('./odoo');

const TORUS_COMPANY_ID  = 1;
const SKIP_ACCOUNT_IDS  = new Set([3908, 3914, 3923]); // IVA / tax throughput accounts
const MONTH_LABELS      = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const CACHE_TTL_MS      = 60 * 60 * 1000; // 1 hour for financial data

const _finCache  = { data: null, time: 0, key: null };
const _cxcCache  = { data: null, time: 0 };
const _rateCache = { data: null, time: 0 };

// ── Exchange rate (USD → PYG) ──────────────────────────────────────────────
async function fetchExchangeRate() {
  const now = Date.now();
  if (_rateCache.data && now - _rateCache.time < 60 * 60 * 1000) return _rateCache.data;
  try {
    const [usd] = await callKw('res.currency', 'search_read', [[['name', '=', 'USD'], ['active', '=', true]]], {
      fields: ['name', 'rate', 'symbol'],
      limit: 1,
    });
    // Odoo stores rate as "1 unit of this currency = rate units of company currency"
    // For PYG company: USD.rate ≈ 7500 (7500 PYG per 1 USD)
    // If Odoo returns inverse (<1), flip it
    let rate = usd?.rate || 7500;
    if (rate < 1) rate = Math.round(1 / rate);
    _rateCache.data = rate;
    _rateCache.time = now;
    console.log(`[Finanzas] USD/PYG rate: ${rate}`);
    return rate;
  } catch (e) {
    console.warn('[Finanzas] fetchExchangeRate failed, using fallback 7500:', e.message);
    return 7500;
  }
}

function pad(n) { return String(n).padStart(2, '0'); }
function monthKey(dateStr) { return dateStr ? String(dateStr).slice(0, 7) : null; }

// ── Main financial data ───────────────────────────────────────────────────

async function fetchFinancialData(year, opts = {}) {
  const dateFrom = opts.from || `${year}-01-01`;
  const dateTo   = opts.to   || `${year}-12-31`;
  const cacheKey = `${year}_${dateFrom}_${dateTo}`;
  const now = Date.now();
  if (_finCache.data && _finCache.key === cacheKey && now - _finCache.time < CACHE_TTL_MS) {
    return _finCache.data;
  }

  // 1. All posted invoices + bills for the year — one query
  const moves = await callKw('account.move', 'search_read', [[
    ['move_type',    'in', ['out_invoice', 'in_invoice']],
    ['state',        '=',  'posted'],
    ['invoice_date', '>=', dateFrom],
    ['invoice_date', '<=', dateTo],
    ['company_id',   '=',  TORUS_COMPANY_ID],
  ]], {
    fields: ['id', 'name', 'move_type', 'invoice_date', 'partner_id', 'amount_untaxed'],
    limit: 2000,
  });

  if (!moves.length) return _buildEmpty(year, opts);

  const moveIds  = moves.map(m => m.id);
  const moveById = new Map(moves.map(m => [m.id, m]));

  // 2. All lines for all moves — one query
  const allLines = await callKw('account.move.line', 'search_read', [[
    ['move_id', 'in', moveIds],
  ]], {
    fields: ['move_id', 'name', 'account_id', 'credit', 'debit', 'analytic_distribution', 'product_id'],
    limit: 10000,
  });

  // 3. Batch-resolve analytic account names + product categories
  const analyticIds = new Set();
  const productIds  = new Set();
  for (const l of allLines) {
    if (l.analytic_distribution) {
      for (const id of Object.keys(l.analytic_distribution)) analyticIds.add(parseInt(id));
    }
    if (l.product_id?.[0]) productIds.add(l.product_id[0]);
  }

  const analyticById = {};
  if (analyticIds.size) {
    const accs = await callKw('account.analytic.account', 'read', [[...analyticIds]], {
      fields: ['id', 'name'],
    });
    for (const a of accs) analyticById[a.id] = a.name;
  }

  // Resolve account types (to classify COGS vs Opex)
  const accountIds = new Set();
  for (const l of allLines) {
    if (l.account_id?.[0]) accountIds.add(l.account_id[0]);
  }
  const accountTypeMap = {}; // accountId → account_type string
  if (accountIds.size) {
    const accounts = await callKw('account.account', 'read', [[...accountIds]], {
      fields: ['id', 'account_type', 'code'],
    });
    for (const a of accounts) accountTypeMap[a.id] = a.account_type || 'expense';
  }

  // Resolve product → second-order category name
  const productCatMap = {}; // productId → categoryId
  if (productIds.size) {
    const products = await callKw('product.product', 'read', [[...productIds]], {
      fields: ['id', 'categ_id'],
    });
    for (const p of products) {
      if (p.categ_id?.[0]) productCatMap[p.id] = p.categ_id[0];
    }
  }
  const catSecondOrder = {}; // categoryId → secondOrderName
  const catIdsNeeded = new Set(Object.values(productCatMap).filter(Boolean));
  if (catIdsNeeded.size) {
    const cats = await callKw('product.category', 'read', [[...catIdsNeeded]], {
      fields: ['id', 'complete_name'],
    });
    for (const c of cats) {
      // complete_name = "All / Servicios / Implementación / CDEV"
      // [0]=root [1]=second-order (what user wants) [2+]=deeper
      const parts = (c.complete_name || '').split(' / ').map(s => s.trim()).filter(Boolean);
      catSecondOrder[c.id] = parts.length >= 2 ? parts[1] : (parts[0] || 'Otros');
    }
  }
  const getProductCategory = pid => {
    const catId = productCatMap[pid];
    return catId ? (catSecondOrder[catId] || 'Sin categoría') : 'Sin categoría';
  };

  // 4. Aggregate in memory
  const revByMonth    = {};
  const costByMonth   = {};
  const byAnalytic    = {}; // name -> { revByMonth, costByMonth, totalRev, totalCost, costByType }
  const byCat         = {}; // secondOrderCategory -> { revByMonth, costByMonth, totalRev, totalCost }
  const costByType    = {}; // account_type -> total cost (for cost structure breakdown)

  for (const l of allLines) {
    const move = moveById.get(l.move_id?.[0]);
    if (!move) continue;
    if (l.account_id && SKIP_ACCOUNT_IDS.has(l.account_id[0])) continue;

    const month  = monthKey(move.invoice_date);
    if (!month) continue;

    const isRev  = move.move_type === 'out_invoice';
    const amount = isRev ? (l.credit || 0) : (l.debit || 0);
    if (amount <= 0) continue;

    // Resolve analytic name
    let analytic = 'Sin clasificar';
    if (l.analytic_distribution) {
      const firstId = parseInt(Object.keys(l.analytic_distribution)[0]);
      if (analyticById[firstId]) analytic = analyticById[firstId];
    }

    // Monthly totals
    if (isRev) revByMonth[month]  = (revByMonth[month]  || 0) + amount;
    else       costByMonth[month] = (costByMonth[month] || 0) + amount;

    // Track cost type (COGS vs Opex)
    if (!isRev) {
      const accType = accountTypeMap[l.account_id?.[0]] || 'expense';
      costByType[accType] = (costByType[accType] || 0) + amount;
    }

    // By analytic
    if (!byAnalytic[analytic]) {
      byAnalytic[analytic] = { revByMonth: {}, costByMonth: {}, totalRev: 0, totalCost: 0, costByType: {} };
    }
    const a = byAnalytic[analytic];
    if (isRev) {
      a.revByMonth[month]  = (a.revByMonth[month]  || 0) + amount;
      a.totalRev  += amount;
    } else {
      a.costByMonth[month] = (a.costByMonth[month] || 0) + amount;
      a.totalCost += amount;
      const accType = accountTypeMap[l.account_id?.[0]] || 'expense';
      a.costByType[accType] = (a.costByType[accType] || 0) + amount;
    }

    // By second-order product category
    const catName = l.product_id?.[0] ? getProductCategory(l.product_id[0]) : 'Sin categoría';
    if (!byCat[catName]) byCat[catName] = { revByMonth: {}, costByMonth: {}, totalRev: 0, totalCost: 0 };
    const cat = byCat[catName];
    if (isRev) { cat.revByMonth[month]  = (cat.revByMonth[month]  || 0) + amount; cat.totalRev  += amount; }
    else       { cat.costByMonth[month] = (cat.costByMonth[month] || 0) + amount; cat.totalCost += amount; }
  }

  // 5. Build month series covering the actual date range (may span years)
  const fromY = parseInt(dateFrom.slice(0, 4));
  const fromM = parseInt(dateFrom.slice(5, 7));
  const toY   = parseInt(dateTo.slice(0, 4));
  const toM   = parseInt(dateTo.slice(5, 7));
  const spansYears = fromY !== toY;

  const months = [];
  let cy = fromY, cm = fromM;
  while (cy < toY || (cy === toY && cm <= toM)) {
    const ms   = `${cy}-${pad(cm)}`;
    const rev  = revByMonth[ms]  || 0;
    const cost = costByMonth[ms] || 0;
    // Include year suffix in label when range spans years (e.g. "Abr 25")
    const label = spansYears
      ? MONTH_LABELS[cm - 1] + ' ' + String(cy).slice(2)
      : MONTH_LABELS[cm - 1];
    months.push({
      month: ms, label,
      revenue: rev, cost, margin: rev - cost,
      marginPct: rev > 0 ? Math.round((rev - cost) / rev * 100) : null,
    });
    cm++;
    if (cm > 12) { cm = 1; cy++; }
  }

  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const totalCost    = months.reduce((s, m) => s + m.cost,    0);
  const totalMargin  = totalRevenue - totalCost;
  const marginPct    = totalRevenue > 0 ? (totalMargin / totalRevenue * 100).toFixed(1) : '0.0';

  // Month-over-month comparison (based on current real date, not filtered range)
  const today    = new Date();
  const curMs    = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMs   = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}`;
  const curM     = months.find(m => m.month === curMs)  || { revenue: 0, cost: 0, margin: 0 };
  const prevM    = months.find(m => m.month === prevMs) || { revenue: 0, cost: 0, margin: 0 };
  const revDelta = prevM.revenue > 0
    ? Math.round((curM.revenue - prevM.revenue) / prevM.revenue * 100)
    : null;

  // EERR rows sorted by revenue desc
  // dominantCostType: 'cogs' if expense_direct_cost dominates, 'opex' otherwise
  const _getCostType = (costByTypeMap) => {
    const cogs = costByTypeMap['expense_direct_cost'] || 0;
    const total = Object.values(costByTypeMap).reduce((s, v) => s + v, 0);
    if (total === 0) return 'opex';
    return cogs / total >= 0.5 ? 'cogs' : 'opex';
  };

  const eerrRows = Object.entries(byAnalytic)
    .map(([name, d]) => ({
      name,
      totalRevenue:    d.totalRev,
      totalCost:       d.totalCost,
      margin:          d.totalRev - d.totalCost,
      marginPct:       d.totalRev > 0 ? Math.round((d.totalRev - d.totalCost) / d.totalRev * 100) : 0,
      dominantCostType: _getCostType(d.costByType),
      months: months.map(m => ({
        label:   m.label,
        month:   m.month,
        revenue: d.revByMonth[m.month]  || 0,
        cost:    d.costByMonth[m.month] || 0,
      })),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Cost structure breakdown (for the cost visibility card)
  const cogs  = Math.round(costByType['expense_direct_cost'] || 0);
  const opex  = Math.round(Object.entries(costByType)
    .filter(([k]) => k !== 'expense_direct_cost')
    .reduce((s, [, v]) => s + v, 0));
  const costBreakdown = {
    cogs,
    opex,
    total:   cogs + opex,
    cogsPct: (cogs + opex) > 0 ? Math.round(cogs / (cogs + opex) * 100) : 0,
    opexPct: (cogs + opex) > 0 ? Math.round(opex / (cogs + opex) * 100) : 0,
  };

  // Category rows (second-order product category) sorted by revenue desc
  const catRows = Object.entries(byCat)
    .map(([name, d]) => ({
      name,
      totalRevenue: Math.round(d.totalRev),
      totalCost:    Math.round(d.totalCost),
      margin:       Math.round(d.totalRev - d.totalCost),
      marginPct:    d.totalRev > 0 ? Math.round((d.totalRev - d.totalCost) / d.totalRev * 100) : 0,
      months: months.map(m => ({
        label:   m.label,
        month:   m.month,
        revenue: Math.round(d.revByMonth[m.month]  || 0),
        cost:    Math.round(d.costByMonth[m.month] || 0),
      })),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  const result = {
    year, months, totalRevenue, totalCost, totalMargin, marginPct,
    curMonth: { ...curM, label: MONTH_LABELS[today.getMonth()], revDelta },
    eerrRows,
    catRows,
    costBreakdown,
    note: 'Los costos no incluyen nómina (payslips no registrados en Odoo).',
    generatedAt: new Date().toISOString(),
  };

  _finCache.data = result;
  _finCache.time = Date.now();
  _finCache.key  = cacheKey;
  console.log(`[Finanzas] key=${cacheKey} rev=${totalRevenue.toLocaleString()} cost=${totalCost.toLocaleString()} rows=${eerrRows.length}`);
  return result;
}

function _buildEmpty(year, opts = {}) {
  const dateFrom = opts.from || `${year}-01-01`;
  const dateTo   = opts.to   || `${year}-12-31`;
  const fromY = parseInt(dateFrom.slice(0, 4)), fromMo = parseInt(dateFrom.slice(5, 7));
  const toY   = parseInt(dateTo.slice(0, 4)),   toMo   = parseInt(dateTo.slice(5, 7));
  const spansYears = fromY !== toY;
  const months = [];
  let cy = fromY, cm = fromMo;
  while (cy < toY || (cy === toY && cm <= toMo)) {
    const label = spansYears ? MONTH_LABELS[cm - 1] + ' ' + String(cy).slice(2) : MONTH_LABELS[cm - 1];
    months.push({ month: `${cy}-${pad(cm)}`, label, revenue: 0, cost: 0, margin: 0, marginPct: null });
    cm++; if (cm > 12) { cm = 1; cy++; }
  }
  return {
    year, months,
    totalRevenue: 0, totalCost: 0, totalMargin: 0, marginPct: '0.0',
    curMonth: { revenue: 0, cost: 0, margin: 0, revDelta: null },
    eerrRows: [],
    catRows: [],
    costBreakdown: { cogs: 0, opex: 0, total: 0, cogsPct: 0, opexPct: 0 },
    note: 'Sin datos para el año seleccionado.',
    generatedAt: new Date().toISOString(),
  };
}

// ── Cuentas por Cobrar (CXC) with aging ──────────────────────────────────

async function fetchCXC() {
  const now = Date.now();
  if (_cxcCache.data && now - _cxcCache.time < 15 * 60 * 1000) return _cxcCache.data;

  const today = new Date().toISOString().slice(0, 10);

  const invoices = await callKw('account.move', 'search_read', [[
    ['move_type',     '=',  'out_invoice'],
    ['state',         '=',  'posted'],
    ['payment_state', 'in', ['not_paid', 'partial']],
    ['company_id',    '=',  TORUS_COMPANY_ID],
  ]], {
    fields: ['name', 'partner_id', 'invoice_date', 'invoice_date_due',
             'amount_total_signed', 'amount_residual_signed', 'currency_id', 'payment_state'],
    order: 'invoice_date_due asc',
    limit: 300,
  });

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const items   = [];

  for (const inv of invoices) {
    // amount_residual_signed is in company currency (PYG) — always positive for out_invoice
    const residual = Math.abs(inv.amount_residual_signed || 0);
    if (residual <= 0) continue;

    const due = inv.invoice_date_due || null;
    let daysOverdue = 0;
    let bucket = 'current';

    if (due && due < today) {
      daysOverdue = Math.round((new Date(today) - new Date(due)) / 86400000);
      if      (daysOverdue <= 30) bucket = 'd1_30';
      else if (daysOverdue <= 60) bucket = 'd31_60';
      else if (daysOverdue <= 90) bucket = 'd61_90';
      else                        bucket = 'd90plus';
    }

    buckets[bucket] += residual;
    items.push({
      name: inv.name, partner: inv.partner_id?.[1] || '?',
      invoiceDate: inv.invoice_date, dueDate: due,
      currency: inv.currency_id?.[1] || 'PYG',
      total: Math.abs(inv.amount_total_signed || 0), residual, daysOverdue, bucket,
    });
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const data  = { total, buckets, items, count: items.length };
  _cxcCache.data = data;
  _cxcCache.time = Date.now();
  return data;
}

// ── Pipeline comercial ────────────────────────────────────────────────────

async function fetchPipeline() {
  const orders = await callKw('sale.order', 'search_read', [[
    ['state',      'in', ['draft', 'sent']],
    ['company_id', '=',  TORUS_COMPANY_ID],
  ]], {
    fields: ['name', 'partner_id', 'state', 'amount_total', 'user_id', 'date_order', 'validity_date'],
    order: 'amount_total desc',
    limit: 100,
  });

  let totalDraft = 0, totalSent = 0, countDraft = 0, countSent = 0;
  const items = orders.map(o => {
    const amount = o.amount_total || 0;
    if (o.state === 'draft') { totalDraft += amount; countDraft++; }
    else                     { totalSent  += amount; countSent++;  }
    return {
      name: o.name, partner: o.partner_id?.[1] || '?', state: o.state,
      amount, user: o.user_id?.[1] || '?',
      date: o.date_order?.slice(0, 10), validUntil: o.validity_date || null,
    };
  });

  return { total: totalDraft + totalSent, totalDraft, totalSent,
           count: items.length, countDraft, countSent, items };
}

// ── Tasa de cierre (Win Rate) ────────────────────────────────────────────────
async function fetchClosingRate() {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString().slice(0, 10);

    const [won, eligible] = await Promise.all([
      callKw('sale.order', 'search_read', [[
        ['state',       '=',  'sale'],
        ['company_id',  '=',  TORUS_COMPANY_ID],
        ['date_order',  '>=', sinceStr],
      ]], { fields: ['id'], limit: 500 }),
      callKw('sale.order', 'search_read', [[
        ['state',      'in', ['sale', 'sent', 'cancel']],
        ['company_id', '=',  TORUS_COMPANY_ID],
        ['date_order', '>=', sinceStr],
      ]], { fields: ['id', 'state'], limit: 500 }),
    ]);

    const wonCount   = won.length;
    const totalCount = eligible.length;
    const rate = totalCount > 0 ? Math.round(wonCount / totalCount * 100) : null;
    return { wonCount, totalCount, rate, period: '90 días' };
  } catch (e) {
    console.error('[Finanzas] fetchClosingRate:', e.message);
    return { wonCount: 0, totalCount: 0, rate: null, period: '90 días' };
  }
}

// ── Cuentas por Pagar (CXP) ──────────────────────────────────────────────
const _cxpCache = { data: null, time: 0 };

async function fetchCXP() {
  const now = Date.now();
  if (_cxpCache.data && now - _cxpCache.time < 15 * 60 * 1000) return _cxpCache.data;

  const today = new Date().toISOString().slice(0, 10);

  const invoices = await callKw('account.move', 'search_read', [[
    ['move_type',     '=',  'in_invoice'],
    ['state',         '=',  'posted'],
    ['payment_state', 'in', ['not_paid', 'partial']],
    ['company_id',    '=',  TORUS_COMPANY_ID],
  ]], {
    fields: ['name', 'partner_id', 'invoice_date', 'invoice_date_due',
             'amount_total_signed', 'amount_residual_signed', 'currency_id'],
    order: 'invoice_date_due asc',
    limit: 300,
  });

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const items   = [];

  for (const inv of invoices) {
    // amount_residual_signed is negative for in_invoice (you owe), abs it for display
    const residual = Math.abs(inv.amount_residual_signed || 0);
    if (residual <= 0) continue;
    const due = inv.invoice_date_due || null;
    let daysOverdue = 0, bucket = 'current';
    if (due && due < today) {
      daysOverdue = Math.round((new Date(today) - new Date(due)) / 86400000);
      if      (daysOverdue <= 30) bucket = 'd1_30';
      else if (daysOverdue <= 60) bucket = 'd31_60';
      else if (daysOverdue <= 90) bucket = 'd61_90';
      else                        bucket = 'd90plus';
    }
    buckets[bucket] += residual;
    items.push({
      name: inv.name, partner: inv.partner_id?.[1] || '?',
      invoiceDate: inv.invoice_date, dueDate: due,
      currency: inv.currency_id?.[1] || 'PYG',
      total: Math.abs(inv.amount_total_signed || 0), residual, daysOverdue, bucket,
    });
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const data  = { total, buckets, items, count: items.length };
  _cxpCache.data = data; _cxpCache.time = Date.now();
  return data;
}

// ── Rentabilidad por cliente ──────────────────────────────────────────────
const _clientCache = { data: null, time: 0, key: null };

async function fetchClientProfitability(year, opts = {}) {
  const dateFrom = opts.from || `${year}-01-01`;
  const dateTo   = opts.to   || `${year}-12-31`;
  const cacheKey = `${year}_${dateFrom}_${dateTo}`;
  const now = Date.now();
  if (_clientCache.data && _clientCache.key === cacheKey && now - _clientCache.time < CACHE_TTL_MS) {
    return _clientCache.data;
  }

  const moves = await callKw('account.move', 'search_read', [[
    ['move_type',    '=',  'out_invoice'],
    ['state',        '=',  'posted'],
    ['invoice_date', '>=', dateFrom],
    ['invoice_date', '<=', dateTo],
    ['company_id',   '=',  TORUS_COMPANY_ID],
  ]], {
    fields: ['id', 'name', 'partner_id', 'amount_untaxed_signed', 'amount_residual_signed', 'payment_state', 'invoice_date'],
    limit: 2000,
  });

  const byPartner = {};
  for (const m of moves) {
    const pid  = m.partner_id?.[0];
    const name = m.partner_id?.[1] || 'Sin cliente';
    if (!pid) continue;
    if (!byPartner[pid]) byPartner[pid] = { id: pid, name, revenue: 0, paid: 0, unpaid: 0, invoiceCount: 0, monthlyRev: {} };
    // _signed fields are in company currency (PYG), always positive for out_invoice
    const rev = Math.abs(m.amount_untaxed_signed || 0);
    byPartner[pid].revenue      += rev;
    byPartner[pid].invoiceCount += 1;
    const monthKey = (m.invoice_date || '').slice(0, 7);
    if (monthKey) byPartner[pid].monthlyRev[monthKey] = (byPartner[pid].monthlyRev[monthKey] || 0) + rev;
    if (m.payment_state === 'paid' || m.payment_state === 'in_payment') {
      byPartner[pid].paid += rev;
    } else {
      byPartner[pid].unpaid += Math.abs(m.amount_residual_signed || 0);
    }
  }

  const totalRevenue = Object.values(byPartner).reduce((s, p) => s + p.revenue, 0);

  const clients = Object.values(byPartner)
    .map(p => ({
      id: p.id, name: p.name,
      revenue:      Math.round(p.revenue),
      unpaid:       Math.round(p.unpaid),
      invoiceCount: p.invoiceCount,
      revPct:       totalRevenue > 0 ? Math.round(p.revenue / totalRevenue * 100) : 0,
      dso:          p.revenue > 0 ? Math.round(p.unpaid / (p.revenue / 365)) : 0,
      monthlyRev:   p.monthlyRev,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Concentration: top-3 share
  const top3Rev = clients.slice(0, 3).reduce((s, c) => s + c.revenue, 0);
  const top3Pct = totalRevenue > 0 ? Math.round(top3Rev / totalRevenue * 100) : 0;

  const result = { year, clients, totalRevenue: Math.round(totalRevenue), clientCount: clients.length, top3Pct };
  _clientCache.data = result; _clientCache.time = Date.now(); _clientCache.key = cacheKey;
  console.log(`[Finanzas] clients year=${year} count=${clients.length} rev=${totalRevenue.toLocaleString()}`);
  return result;
}

// ── Comparativa Año Anterior (YoY) ───────────────────────────────────────
async function fetchYoY(currentYear) {
  try {
    const prev = await fetchFinancialData(currentYear - 1);
    const prevClients = await fetchClientProfitability(currentYear - 1);
    return {
      prevRevenue:    prev.totalRevenue,
      prevCost:       prev.totalCost,
      prevMargin:     prev.totalMargin,
      prevClientCount: prevClients.clientCount,
      prevMonths:     prev.months,
    };
  } catch (e) {
    console.error('[Finanzas] fetchYoY:', e.message);
    return { prevRevenue: 0, prevCost: 0, prevMargin: 0, prevClientCount: 0, prevMonths: [] };
  }
}

// ── Pipeline por etapa CRM ────────────────────────────────────────────────
const _crmCache = { data: null, time: 0 };

async function fetchCRMPipeline() {
  const now = Date.now();
  if (_crmCache.data && now - _crmCache.time < 15 * 60 * 1000) return _crmCache.data;

  try {
    const leads = await callKw('crm.lead', 'search_read', [[
      ['type',       '=',  'opportunity'],
      ['active',     '=',  true],
      ['company_id', '=',  TORUS_COMPANY_ID],
    ]], {
      fields: ['name', 'partner_id', 'stage_id', 'expected_revenue', 'probability',
               'user_id', 'date_deadline', 'create_date', 'planned_revenue'],
      limit: 200,
    });

    const byStage = {};
    let totalExpected = 0;
    const today = new Date().toISOString().slice(0, 10);

    const items = leads.map(l => {
      const expected = l.expected_revenue || l.planned_revenue || 0;
      const weighted = Math.round(expected * (l.probability || 0) / 100);
      const stageName = l.stage_id?.[1] || 'Sin etapa';
      const agedays = l.create_date ? Math.floor((new Date(today) - new Date(l.create_date.slice(0,10))) / 86400000) : 0;
      const stale = agedays > 30;

      if (!byStage[stageName]) byStage[stageName] = { name: stageName, count: 0, total: 0, weighted: 0 };
      byStage[stageName].count    += 1;
      byStage[stageName].total    += expected;
      byStage[stageName].weighted += weighted;
      totalExpected += expected;

      return {
        name: l.name, partner: l.partner_id?.[1] || '?', stage: stageName,
        expected, probability: l.probability || 0, weighted,
        user: l.user_id?.[1] || '?',
        deadline: l.date_deadline || null,
        agedays, stale,
      };
    }).sort((a, b) => b.expected - a.expected);

    const totalWeighted = items.reduce((s, l) => s + l.weighted, 0);
    const staleCount    = items.filter(l => l.stale).length;
    const stages        = Object.values(byStage);

    const result = { items, byStage: stages, total: Math.round(totalExpected),
                     totalWeighted: Math.round(totalWeighted), count: items.length, staleCount };
    _crmCache.data = result; _crmCache.time = Date.now();
    return result;
  } catch (e) {
    console.error('[Finanzas] fetchCRMPipeline:', e.message);
    return { items: [], byStage: [], total: 0, totalWeighted: 0, count: 0, staleCount: 0 };
  }
}

module.exports = {
  fetchFinancialData, fetchCXC, fetchCXP,
  fetchPipeline, fetchClosingRate, fetchCRMPipeline,
  fetchClientProfitability, fetchYoY, fetchExchangeRate,
};
