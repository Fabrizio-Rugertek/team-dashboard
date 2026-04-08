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
    _client = xmlrpc.createClient({
      host: ODOO.url.replace('https://', ''),
      port: 443,
      path: '/xmlrpc/2/common',
      ssl: true
    });
  }
  return _client;
}

function getModels() {
  if (!_models) {
    _models = xmlrpc.createClient({
      host: ODOO.url.replace('https://', ''),
      port: 443,
      path: '/xmlrpc/2/object',
      ssl: true
    });
  }
  return _models;
}

async function authenticate() {
  if (_uid) return _uid;
  
  return new Promise((resolve, reject) => {
    getClient().methodCall('authenticate', [ODOO.db, ODOO.user, ODOO.password, {}], (err, uid) => {
      if (err || !uid) {
        console.error('[Odoo] Auth error:', err);
        reject(err);
      } else {
        _uid = uid;
        console.log(`[Odoo] Authenticated as UID ${uid}`);
        resolve(uid);
      }
    });
  });
}

async function callKw(model, method, args) {
  return new Promise(async (resolve, reject) => {
    const uid = await authenticate().catch(reject);
    if (!uid) return;
    
    getModels().methodCall('execute_kw', [
      ODOO.db, uid, ODOO.password,
      model, method, args
    ], (err, data) => {
      if (err) {
        console.error(`[Odoo] ${model}.${method} error:`, err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

// ─── Raw Odoo Data Fetchers ───────────────────────────────────────────────────

async function fetchTimesheets(daysBack = 30) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().slice(0, 10);
  
  const records = await callKw('account.analytic.line', 'search_read', [[
    ['date', '>=', dateStr]
  ], {
    fields: ['id', 'date', 'user_id', 'project_id', 'task_id', 'unit_amount', 'name', 'create_date'],
    context: { bin_size: true }
  }]);
  
  return records;
}

async function fetchProjectsWithTasks() {
  const projects = await callKw('project.project', 'search_read', [[
    ['active', 'in', [true, false]]
  ], {
    fields: ['id', 'name', 'date_start', 'date_end', 'write_date', 'user_id', 'percent'],
    context: { bin_size: true }
  }]);
  
  const tasks = await callKw('project.task', 'search_read', [[
    '|', ['active', '=', true], ['active', '=', false]
  ], {
    fields: ['id', 'name', 'project_id', 'user_id', 'stage_id', 'allocated_hours', 'effective_hours', 
             'date_deadline', 'write_date', 'create_date', 'date_last_stage_update', 'description'],
    context: { bin_size: true }
  }]);
  
  const stages = await callKw('project.task.type', 'search_read', [[
  ], {
    fields: ['id', 'name', 'sequence', 'mail_template_id'],
    context: { bin_size: true }
  }]);
  
  // Build stage mapping
  const stageMap = {};
  stages.forEach(s => { stageMap[s.id] = s.name; });
  
  // Attach tasks to projects
  const projectMap = {};
  projects.forEach(p => { projectMap[p.id] = { ...p, tasks: [] }; });
  tasks.forEach(t => {
    const pid = t.project_id?.[0];
    if (pid && projectMap[pid]) {
      projectMap[pid].tasks.push({
        ...t,
        stageName: stageMap[t.stage_id?.[0]] || 'Unknown'
      });
    }
  });
  
  return Object.values(projectMap).filter(p => p.tasks.length > 0);
}

async function fetchUsers() {
  const users = await callKw('res.users', 'search_read', [[
    ['share', '=', false]
  ], {
    fields: ['id', 'name', 'login', 'email'],
    context: { bin_size: true }
  }]);
  return users;
}

module.exports = {
  authenticate,
  callKw,
  fetchTimesheets,
  fetchProjectsWithTasks,
  fetchUsers
};
