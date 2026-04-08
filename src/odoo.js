const xmlrpc = require('xmlrpc');
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

function getClient() {
  if (!_client) {
    // Use https:// explicitly via hostname (not host) for SSL
    _client = xmlrpc.createSecureClient({
      host: ODOO.url.replace('https://', ''),
      port: 443,
      path: '/xmlrpc/2/common'
    });
  }
  return _client;
}

function getModels() {
  if (!_models) {
    _models = xmlrpc.createSecureClient({
      host: ODOO.url.replace('https://', ''),
      port: 443,
      path: '/xmlrpc/2/object'
    });
  }
  return _models;
}

async function authenticate() {
  if (_uid) return _uid;

  return new Promise((resolve, reject) => {
    getClient().methodCall('authenticate', [ODOO.db, ODOO.user, ODOO.password, {}], (err, uid) => {
      if (err || !uid) {
        console.error('[Odoo] Auth error:', err?.message || err);
        reject(err || new Error('Authentication failed'));
      } else {
        _uid = uid;
        console.log(`[Odoo] Authenticated as UID ${uid}`);
        resolve(uid);
      }
    });
  });
}

async function callKw(model, method, args = []) {
  return new Promise(async (resolve, reject) => {
    try {
      const uid = await authenticate();
      if (!uid) return reject(new Error('Not authenticated'));

      const callArgs = [ODOO.db, uid, ODOO.password, model, method, args];
      getModels().methodCall('execute_kw', callArgs, (err, data) => {
        if (err) {
          console.error(`[Odoo] ${model}.${method} error:`, err?.message || err);
          reject(err);
        } else {
          resolve(data);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

// ─── Safe field getters ───────────────────────────────────────────────────────

function safeGet(obj, path, fallback = null) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : fallback, obj);
}

function idName(val) {
  // Handle Odoo many2one format: [id, 'name'] or just id
  if (Array.isArray(val)) return { id: val[0], name: val[1] };
  if (typeof val === 'number') return { id: val, name: String(val) };
  return { id: null, name: String(val || '?') };
}

// ─── Raw Odoo Data Fetchers ─────────────────────────────────────────────────

async function fetchTimesheets(daysBack = 30) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().slice(0, 10);

  try {
    const records = await callKw('account.analytic.line', 'search_read', [[
      ['date', '>=', dateStr]
    ], {
      fields: ['id', 'date', 'user_id', 'project_id', 'task_id', 'unit_amount', 'name', 'create_date'],
      context: { bin_size: false }
    }]);
    return records || [];
  } catch (e) {
    console.error('[Odoo] fetchTimesheets failed:', e.message);
    return [];
  }
}

async function fetchProjectsWithTasks() {
  // Fetch projects - use only fields that exist
  let projects = [];
  try {
    projects = await callKw('project.project', 'search_read', [[
      ['active', 'in', [true, false]]
    ], {
      fields: ['id', 'name', 'date_start', 'write_date'],
      context: { bin_size: false }
    }]) || [];
  } catch (e) {
    console.error('[Odoo] fetchProjects (projects) failed:', e.message);
  }

  // Fetch tasks with minimal fields to avoid field-not-found errors
  let tasks = [];
  try {
    tasks = await callKw('project.task', 'search_read', [[
      '|', ['active', '=', true], ['active', '=', false]
    ], {
      fields: ['id', 'name', 'project_id', 'stage_id', 'allocated_hours', 'effective_hours',
               'date_deadline', 'write_date', 'create_date'],
      context: { bin_size: false }
    }]) || [];
  } catch (e) {
    console.error('[Odoo] fetchProjects (tasks) failed:', e.message);
  }

  // Fetch stages
  let stages = [];
  try {
    stages = await callKw('project.task.type', 'search_read', [[
    ], {
      fields: ['id', 'name', 'sequence'],
      context: { bin_size: false }
    }]) || [];
  } catch (e) {
    console.error('[Odoo] fetchProjects (stages) failed:', e.message);
  }

  const stageMap = {};
  stages.forEach(s => { stageMap[s.id] = s.name; });

  const projectMap = {};
  projects.forEach(p => { projectMap[p.id] = { ...p, tasks: [] }; });
  tasks.forEach(t => {
    const pid = Array.isArray(t.project_id) ? t.project_id[0] : t.project_id;
    if (pid && projectMap[pid]) {
      projectMap[pid].tasks.push({
        ...t,
        stageName: stageMap[t.stage_id && t.stage_id[0]] || 'Unknown',
        assignedNames: [t.user_id?.[1] || 'Sin asignar']
      });
    }
  });

  return Object.values(projectMap).filter(p => p.tasks.length > 0);
}

async function fetchUsers() {
  try {
    const users = await callKw('res.users', 'search_read', [[
      ['share', '=', false]
    ], {
      fields: ['id', 'name', 'login'],
      context: { bin_size: false }
    }]) || [];
    return users;
  } catch (e) {
    console.error('[Odoo] fetchUsers failed:', e.message);
    return [];
  }
}

module.exports = {
  authenticate,
  callKw,
  fetchTimesheets,
  fetchProjectsWithTasks,
  fetchUsers
};
