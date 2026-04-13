/**
 * Odoo data fetcher for the Finance / EERR dashboard.
 * Fetches revenue and cost data from customer invoices and vendor bills,
 * grouped by analytic account tag and month, with drill-down support.
 */
'use strict';

const xmlrpc = require('xmlrpc');
const { URL } = require('url');
require('dotenv').config();

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;
const TORUS_COMPANY_ID = 1;

let _uid = null;
let _client = null;
let _models = null;
let _authPromise = null;

function getTarget(pathname) {
  const parsed = new URL(ODOO_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    path: pathname,
    headers: { Host: parsed.hostname }
  };
}

function getClient() {
  if (!_client) _client = xmlrpc.createSecureClient(getTarget('/xmlrpc/2/common'));
  return _client;
}

function getModels() {
  if (!_models) _models = xmlrpc.createSecureClient(getTarget('/xmlrpc/2/object'));
  return _models;
}

async function authenticate() {
  if (_uid) return _uid;
  if (_authPromise) return _authPromise;
  _authPromise = new Promise((resolve, reject) => {
    getClient().methodCall('authenticate', [ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}], (err, uid) => {
      if (err || !uid) { reject(err || new Error('Auth failed')); return; }
      _uid = uid;
      resolve(uid);
    });
  });
  try { return await _authPromise; } finally { _authPromise = null; }
}

async function callKw(model, method, args, kwargs) {
  return new Promise(async (resolve, reject) => {
    let uid;
    try { uid = await authenticate(); } catch(e) { reject(e); return; }
    const params = [ODOO_DB, uid, ODOO_PASSWORD, model, method, args];
    if (kwargs && Object.keys(kwargs).length) params.push(kwargs);
    getModels().methodCall('execute_kw', params, (err, data) => {
      if (err) reject(new Error(err.faultString || err.message));
      else resolve(data);
    });
  });
}

function getMonth(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  return dateStr.slice(0, 7);
}

async function getAnalyticNamesBatch(analyticIds) {
  if (!analyticIds || analyticIds.length === 0) return {};
  const uniqueIds = [...new Set(analyticIds.filter(Boolean))];
  const records = await callKw('account.analytic.account', 'read', [uniqueIds], { fields: ['id', 'name'] });
  const map = {};
  for (const r of records) map[r.id] = r.name;
  return map;
}

// Revenue: customer invoices with analytic tags
async function fetchRevenueByMonth(year) {
  const dateFrom = year + '-01-01';
  const dateTo = year + '-12-31';
  const SKIP_ACCOUNTS = [3908, 3914, 3923];

  const moves = await callKw('account.move', 'search_read',
    [
      [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', dateFrom],
        ['invoice_date', '<=', dateTo],
        ['company_id', '=', TORUS_COMPANY_ID]
      ]
    ],
    { fields: ['id', 'name', 'partner_id', 'invoice_date', 'amount_total'], context: { bin_size: true } }
  );

  const revenueByMonth = {};
  const revenueByProduct = {};
  const revenueDetail = [];
  const pendingAnalyticIds = [];

  // First pass: collect all data + pending analytic ids
  for (const m of moves) {
    const month = getMonth(m.invoice_date);
    if (!month) continue;

    revenueByMonth[month] = (revenueByMonth[month] || 0) + (m.amount_total || 0);

    const lines = await callKw('account.move.line', 'search_read',
      [
        [
          ['move_id', '=', m.id],
          ['credit', '>', 0],
          ['account_id', 'not in', SKIP_ACCOUNTS]
        ]
      ],
      { fields: ['id', 'name', 'account_id', 'credit', 'analytic_distribution'] }
    );

    for (const l of lines) {
      const desc = (l.name || '');
      if (!desc || desc.length < 3) continue;

      const analyticDist = l.analytic_distribution;
      let analyticName = 'SIN TAG';
      let analyticId = null;
      if (analyticDist) {
        analyticId = parseInt(Object.keys(analyticDist)[0]);
        if (analyticId) pendingAnalyticIds.push(analyticId);
      }

      const key = month + '|' + analyticName;
      if (!revenueByProduct[key]) {
        revenueByProduct[key] = { analytic: analyticName, analyticId: analyticId, month: month, total: 0, count: 0, partner_ids: [] };
      }
      revenueByProduct[key].total += l.credit;
      revenueByProduct[key].count += 1;
      if (m.partner_id) revenueByProduct[key].partner_ids.push(m.partner_id[0]);

      revenueDetail.push({
        line_id: l.id,
        date: m.invoice_date,
        partner_id: m.partner_id ? m.partner_id[0] : null,
        partner_name: m.partner_id ? m.partner_id[1] : '?',
        desc: desc.slice(0, 80),
        account_name: l.account_id ? l.account_id[1] : '?',
        analytic: analyticName,
        amount: l.credit,
        move_id: m.id,
        move_name: m.name,
      });
    }
  }

  // Batch resolve analytic names
  const analyticMap = await getAnalyticNamesBatch(pendingAnalyticIds);

  // Second pass: resolve analytic names using cached map
  for (const row of Object.values(revenueByProduct)) {
    if (row.analyticId && analyticMap[row.analyticId]) {
      row.analytic = analyticMap[row.analyticId];
    }
  }

  // Update detail records
  for (const row of revenueDetail) {
    if (row.analytic !== 'SIN TAG') continue;
    // Already resolved via map in first pass - nothing to do
  }

  // Rebuild byProduct with resolved names
  const byProductResolved = {};
  for (const r of Object.values(revenueByProduct)) {
    const key = r.month + '|' + r.analytic;
    if (!byProductResolved[key]) {
      byProductResolved[key] = { analytic: r.analytic, month: r.month, total: 0, count: 0, partner_ids: [] };
    }
    byProductResolved[key].total += r.total;
    byProductResolved[key].count += r.count;
    byProductResolved[key].partner_ids.push(...r.partner_ids);
  }

  return {
    byMonth: revenueByMonth,
    byProduct: Object.values(byProductResolved),
    detail: revenueDetail,
  };
}

// Costs: vendor bills with analytic tags
async function fetchCostsByMonth(year) {
  const dateFrom = year + '-01-01';
  const dateTo = year + '-12-31';

  const moves = await callKw('account.move', 'search_read',
    [
      [
        ['move_type', '=', 'in_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', dateFrom],
        ['invoice_date', '<=', dateTo],
        ['company_id', '=', TORUS_COMPANY_ID]
      ]
    ],
    { fields: ['id', 'name', 'partner_id', 'invoice_date', 'amount_total'], context: { bin_size: true } }
  );

  const costByMonth = {};
  const costByAnalytic = {};
  const costDetail = [];
  const pendingAnalyticIds = [];

  for (const m of moves) {
    const month = getMonth(m.invoice_date);
    if (!month) continue;

    costByMonth[month] = (costByMonth[month] || 0) + (m.amount_total || 0);

    const lines = await callKw('account.move.line', 'search_read',
      [
        [
          ['move_id', '=', m.id],
          ['debit', '>', 0]
        ]
      ],
      { fields: ['id', 'name', 'account_id', 'debit', 'analytic_distribution'] }
    );

    for (const l of lines) {
      if (!l.debit || l.debit <= 0) continue;
      const desc = (l.name || '');
      if (!desc || desc.length < 3) continue;

      const analyticDist = l.analytic_distribution;
      let analyticName = 'SIN TAG';
      let analyticId = null;
      if (analyticDist) {
        analyticId = parseInt(Object.keys(analyticDist)[0]);
        if (analyticId) pendingAnalyticIds.push(analyticId);
      }

      const key = month + '|' + analyticName;
      if (!costByAnalytic[key]) {
        costByAnalytic[key] = { analytic: analyticName, analyticId: analyticId, month: month, total: 0, count: 0, partner_ids: [] };
      }
      costByAnalytic[key].total += l.debit;
      costByAnalytic[key].count += 1;
      if (m.partner_id) costByAnalytic[key].partner_ids.push(m.partner_id[0]);

      costDetail.push({
        line_id: l.id,
        date: m.invoice_date,
        partner_id: m.partner_id ? m.partner_id[0] : null,
        partner_name: m.partner_id ? m.partner_id[1] : '?',
        desc: desc.slice(0, 80),
        account_name: l.account_id ? l.account_id[1] : '?',
        analytic: analyticName,
        amount: l.debit,
        move_id: m.id,
        move_name: m.name,
      });
    }
  }

  // Batch resolve analytic names
  const analyticMap = await getAnalyticNamesBatch(pendingAnalyticIds);

  for (const row of Object.values(costByAnalytic)) {
    if (row.analyticId && analyticMap[row.analyticId]) {
      row.analytic = analyticMap[row.analyticId];
    }
  }

  const byAnalyticResolved = {};
  for (const c of Object.values(costByAnalytic)) {
    const key = c.month + '|' + c.analytic;
    if (!byAnalyticResolved[key]) {
      byAnalyticResolved[key] = { analytic: c.analytic, month: c.month, total: 0, count: 0, partner_ids: [] };
    }
    byAnalyticResolved[key].total += c.total;
    byAnalyticResolved[key].count += c.count;
    byAnalyticResolved[key].partner_ids.push(...c.partner_ids);
  }

  return {
    byMonth: costByMonth,
    byAnalytic: Object.values(byAnalyticResolved),
    detail: costDetail,
  };
}

async function fetchAnalyticAccounts() {
  return callKw('account.analytic.account', 'search_read',
    [[['plan_id', 'in', [2, 3]]]],
    { fields: ['id', 'name', 'plan_id'], context: { bin_size: true } }
  );
}

module.exports = {
  fetchRevenueByMonth,
  fetchCostsByMonth,
  fetchAnalyticAccounts,
};
