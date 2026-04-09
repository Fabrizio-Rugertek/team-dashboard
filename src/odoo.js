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
    fields: ['id', 'name', 'project_id', 'stage_id', 'user_ids', 'allocated_hours', 'effective_hours',
             'planned_date_begin', 'date_end', 'date_deadline', 'write_date', 'create_date',
             'date_last_stage_update', 'description', 'sale_line_id', 'parent_id',
             'x_studio_sprint', 'x_studio_fecha_de_sprint'],
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
        id: t.id, name: t.name, project_id: t.project_id,
        stage_id: t.stage_id, stageName: stageMap[t.stage_id?.[0]] || 'Unknown',
        user_id: t.user_ids && t.user_ids[0] || null,
        user_ids: t.user_ids,
        allocated_hours: t.allocated_hours, effective_hours: t.effective_hours,
        date_start: t.planned_date_begin, date_end: t.date_end,
        sale_line_id: t.sale_line_id, parent_id: t.parent_id,
        sprint_id: t.x_studio_sprint,
        sprint_start: t.x_studio_fecha_de_sprint
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

// ─── Active Employees (Torus only) ───────────────────────────────────────────

const TORUS_COMPANY_ID = 1;
const ACTIVE_CONTRACT_STATES = ['open', 'draft'];

async function fetchActiveEmployees() {
  let contracts = [];
  try {
    contracts = await callKw('hr.contract', 'search_read', [[
      ['employee_id.company_id', '=', TORUS_COMPANY_ID],
      ['state', 'in', ACTIVE_CONTRACT_STATES]
    ]], {
      fields: ['id', 'state', 'employee_id', 'date_start', 'date_end']
    }) || [];
  } catch (e) {
    console.error('[Odoo] fetchActiveEmployees (contracts):', e.message);
    return [];
  }

  const empIds = [...new Set(contracts.map(c => c.employee_id && c.employee_id[0]).filter(Boolean))];
  if (!empIds.length) return [];

  let employees = [];
  try {
    employees = await callKw('hr.employee', 'search_read', [[
      ['id', 'in', empIds]
    ]], {
      fields: ['id', 'name', 'user_id', 'department_id', 'job_id', 'active']
    }) || [];
  } catch (e) {
    console.error('[Odoo] fetchActiveEmployees (employees):', e.message);
    return [];
  }

  const userIds = employees.map(e => e.user_id && e.user_id[0]).filter(Boolean);
  let userMap = {};
  if (userIds.length) {
    try {
      const users = await callKw('res.users', 'search_read', [[
        ['id', 'in', userIds]
      ]], { fields: ['id', 'login'] }) || [];
      users.forEach(u => { userMap[u.id] = u.login; });
    } catch (e) {
      console.error('[Odoo] fetchActiveEmployees (users):', e.message);
    }
  }

  const cMap = {};
  contracts.forEach(c => {
    const eid = c.employee_id && c.employee_id[0];
    if (eid && !cMap[eid]) cMap[eid] = c;
  });

  return employees.map(e => {
    const c = cMap[e.id] || {};
    const ruId = e.user_id && e.user_id[0];
    return {
      id: e.id,
      name: e.name,
      login: ruId ? (userMap[ruId] || null) : null,
      userId: ruId || null,
      department: e.department_id && e.department_id[1] || null,
      job: e.job_id && e.job_id[1] || null,
      contract_state: c.state || null,
      contract_start: c.date_start || null
    };
  });
}

async function fetchAllEmployees() {
  let employees = [];
  try {
    employees = await callKw('hr.employee', 'search_read', [[
      ['company_id', '=', TORUS_COMPANY_ID]
    ]], {
      fields: ['id', 'name', 'user_id', 'department_id', 'job_id', 'active']
    }) || [];
  } catch (e) {
    console.error('[Odoo] fetchAllEmployees:', e.message);
    return [];
  }

  let contracts = [];
  try {
    contracts = await callKw('hr.contract', 'search_read', [[
      ['employee_id.company_id', '=', TORUS_COMPANY_ID]
    ]], { fields: ['id', 'state', 'employee_id', 'date_start', 'date_end'] }) || [];
  } catch (e) {
    console.error('[Odoo] fetchAllEmployees (contracts):', e.message);
  }

  const activeMap = {};
  contracts.forEach(c => {
    const eid = c.employee_id && c.employee_id[0];
    if (eid) {
      if (!activeMap[eid]) activeMap[eid] = c;
    }
  });

  return employees.map(e => {
    const c = activeMap[e.id];
    return {
      id: e.id, name: e.name,
      department: e.department_id && e.department_id[1] || null,
      job: e.job_id && e.job_id[1] || null,
      active: e.active,
      contract_state: c ? c.state : null
    };
  });
}

module.exports = {
  authenticate, callKw,
  fetchTimesheets, fetchProjectsWithTasks,
  fetchActiveEmployees, fetchAllEmployees
};
