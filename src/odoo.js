const xmlrpc = require('xmlrpc');
const { URL } = require('url');
require('dotenv').config();

const ODOO = {
  url: process.env.ODOO_URL || 'https://www.torus.dev',
  db: process.env.ODOO_DB || 'rugertek-company-odoo-production-17029773',
  user: process.env.ODOO_USER || 'odoo@rugertek.com',
  password: process.env.ODOO_PASSWORD || 'GGAmLPq@FxyUL85'
};

let _uid = null;
let _client = null;
let _models = null;
let _authPromise = null;

function getXmlrpcTarget(pathname) {
  const parsed = new URL(ODOO.url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    path: pathname,
    headers: {
      Host: parsed.hostname,
      'User-Agent': 'team-dashboard/1.0'
    }
  };
}

function getClient() {
  if (!_client) _client = xmlrpc.createSecureClient(getXmlrpcTarget('/xmlrpc/2/common'));
  return _client;
}

function getModels() {
  if (!_models) _models = xmlrpc.createSecureClient(getXmlrpcTarget('/xmlrpc/2/object'));
  return _models;
}

async function authenticate() {
  if (_uid) return _uid;
  if (_authPromise) return _authPromise;

  _authPromise = new Promise((resolve, reject) => {
    getClient().methodCall('authenticate', [ODOO.db, ODOO.user, ODOO.password, {}], (err, uid) => {
      if (err || !uid) {
        console.error('[Odoo] Auth error:', err);
        reject(err || new Error('Authentication failed'));
      } else {
        _uid = uid;
        console.log(`[Odoo] Authenticated as UID ${uid}`);
        resolve(uid);
      }
    });
  });

  try {
    return await _authPromise;
  } finally {
    _authPromise = null;
  }
}

async function callKw(model, method, args = [], kwargs = {}) {
  return new Promise(async (resolve, reject) => {
    const uid = await authenticate().catch(reject);
    if (!uid) return;
    const params = [ODOO.db, uid, ODOO.password, model, method, args];
    if (kwargs && Object.keys(kwargs).length) params.push(kwargs);
    getModels().methodCall('execute_kw', params, (err, data) => {
      if (err) {
        const fault = err?.faultString || err?.message || String(err);
        console.error(`[Odoo] ${model}.${method} error:`, fault);
        reject(new Error(`XML-RPC fault: ${fault}`));
      } else {
        resolve(data);
      }
    });
  });
}

async function fetchTimesheets(daysBack = 30) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().slice(0, 10);
  return callKw('account.analytic.line', 'search_read', [[['date', '>=', dateStr]]], {
    fields: ['id', 'date', 'user_id', 'project_id', 'task_id', 'unit_amount', 'name', 'create_date'],
    context: { bin_size: true }
  });
}

async function fetchProjectsWithTasks() {
  const projects = await callKw('project.project', 'search_read', [[['active', 'in', [true, false]]]], {
    fields: ['id', 'name', 'date_start', 'write_date', 'user_id'],
    context: { bin_size: true }
  });

  const tasks = await callKw('project.task', 'search_read', [['|', ['active', '=', true], ['active', '=', false]]], {
    fields: ['id', 'name', 'project_id', 'stage_id', 'allocated_hours', 'effective_hours', 'date_deadline', 'write_date', 'create_date', 'date_last_stage_update', 'description'],
    context: { bin_size: true }
  });

  const stages = await callKw('project.task.type', 'search_read', [[]], {
    fields: ['id', 'name', 'sequence', 'mail_template_id'],
    context: { bin_size: true }
  });

  const stageMap = {};
  stages.forEach(s => { stageMap[s.id] = s.name; });

  const projectMap = {};
  projects.forEach(p => { projectMap[p.id] = { ...p, tasks: [] }; });
  tasks.forEach(t => {
    const pid = t.project_id?.[0];
    if (pid && projectMap[pid]) {
      projectMap[pid].tasks.push({
        ...t,
        user_id: null,
        stageName: stageMap[t.stage_id?.[0]] || 'Unknown'
      });
    }
  });

  return Object.values(projectMap).filter(p => p.tasks.length > 0);
}

async function fetchUsers() {
  return callKw('res.users', 'search_read', [[['share', '=', false]]], {
    fields: ['id', 'name', 'login', 'email'],
    context: { bin_size: true }
  });
}

module.exports = {
  authenticate,
  callKw,
  fetchTimesheets,
  fetchProjectsWithTasks,
  fetchUsers
};
