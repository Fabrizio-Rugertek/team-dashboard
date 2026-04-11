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
  return new Promise((resolve, reject) => {
    getClient().methodCall('authenticate', [ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}], (err, uid) => {
      if (err || !uid) { reject(err || new Error('Auth failed')); return; }
      _uid = uid;
      resolve(uid);
    });
  });
}

async function callKw(model, method, args, kwargs) {
  return new Promise(async (resolve, reject) => {
    const uid = await authenticate().catch(reject);
    if (!uid) return;
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

async function getAnalyticName(analyticDist) {
  if (!analyticDist) return 'SIN TAG';
  const aid = Object.keys(analyticDist)[0];
  if (!aid) return 'SIN TAG';
  const a = await callKw('account.analytic.account', 'read', [[parseInt(aid)]], { fields: ['name'] });
  return a && a[0] ? a[0].name : 'SIN TAG';
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

      const analyticName = await getAnalyticName(l.analytic_distribution);
      const key = month + '|' + analyticName;
      if (!revenueByProduct[key]) {
        revenueByProduct[key] = { analytic: analyticName, month: month, total: 0, count: 0, partner_ids: [] };
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

  return {
    byMonth: revenueByMonth,
    byProduct: Object.values(revenueByProduct),
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

      const analyticName = await getAnalyticName(l.analytic_distribution);
      const key = month + '|' + analyticName;
      if (!costByAnalytic[key]) {
        costByAnalytic[key] = { analytic: analyticName, month: month, total: 0, count: 0, partner_ids: [] };
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

  return {
    byMonth: costByMonth,
    byAnalytic: Object.values(costByAnalytic),
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
