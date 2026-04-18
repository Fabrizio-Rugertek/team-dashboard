/**
 * Odoo XML-RPC connector.
 * All credentials MUST come from environment variables — no hardcoded defaults.
 */
'use strict';

const xmlrpc   = require('xmlrpc');
const { URL }  = require('url');
require('dotenv').config();

const ODOO_URL      = process.env.ODOO_URL;
const ODOO_DB       = process.env.ODOO_DB;
const ODOO_USER     = process.env.ODOO_USER;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_PASSWORD) {
  throw new Error(
    '[Odoo] Missing required env vars: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD'
  );
}

// ── Auth state ────────────────────────────────────────────────────────────
let _uid          = null;
let _client       = null;
let _models       = null;
let _authPromise  = null;

function getXmlrpcTarget(pathname) {
  const parsed = new URL(ODOO_URL);
  return {
    host:     parsed.hostname,
    port:     Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    path:     pathname,
    headers:  { Host: parsed.hostname, 'User-Agent': 'team-dashboard/1.0' }
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
    getClient().methodCall(
      'authenticate',
      [ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}],
      (err, uid) => {
        if (err || !uid) {
          console.error('[Odoo] Auth error:', err);
          reject(err || new Error('Authentication failed'));
        } else {
          _uid = uid;
          console.log(`[Odoo] Authenticated as UID ${uid}`);
          resolve(uid);
        }
      }
    );
  });

  try {
    return await _authPromise;
  } finally {
    _authPromise = null;
  }
}

// ── Generic call ──────────────────────────────────────────────────────────
async function callKw(model, method, args = [], kwargs = {}) {
  return new Promise(async (resolve, reject) => {
    const uid = await authenticate().catch(reject);
    if (!uid) return;

    const params = [ODOO_DB, uid, ODOO_PASSWORD, model, method, args];
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

// ── Timesheets ─────────────────────────────────────────────────────────────
async function fetchTimesheets(daysBack = 90) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().slice(0, 10);

  return callKw('account.analytic.line', 'search_read',
    [[['date', '>=', dateStr]]],
    { fields: ['id', 'date', 'user_id', 'project_id', 'task_id', 'unit_amount', 'name', 'create_date'],
      context: { bin_size: true } }
  );
}

// ── Projects & Tasks ───────────────────────────────────────────────────────
async function fetchProjectsWithTasks() {
  const [projects, tasks, stages] = await Promise.all([
    callKw('project.project', 'search_read',
      [[['active', 'in', [true, false]]]],
      { fields: ['id', 'name', 'date_start', 'write_date', 'user_id'], context: { bin_size: true } }
    ),
    callKw('project.task', 'search_read',
      [['|', ['active', '=', true], ['active', '=', false]]],
      { fields: [
          'id', 'name', 'project_id', 'stage_id', 'user_ids', 'allocated_hours',
          'effective_hours', 'planned_date_begin', 'date_end', 'date_deadline',
          'write_date', 'create_date', 'date_last_stage_update', 'description',
          'sale_line_id', 'parent_id', 'sprint_id', 'story_points', 'scrum_team_id',
        ],
        context: { bin_size: true }
      }
    ),
    callKw('project.task.type', 'search_read',
      [[]],
      { fields: ['id', 'name', 'sequence', 'mail_template_id'], context: { bin_size: true } }
    ),
  ]);

  // ── Build lookup Maps ──────────────────────────────────────────────────
  /** @type {Map<number, string>} stageId → stageName */
  const stageMap = new Map(stages.map(s => [s.id, s.name]));

  /** @type {Map<number, {id,name,date_start,write_date,user_id,tasks:Array}>} */
  const projectMap = new Map(projects.map(p => [p.id, { ...p, tasks: [] }]));

  for (const t of tasks) {
    const pid = t.project_id?.[0];
    if (pid && projectMap.has(pid)) {
      projectMap.get(pid).tasks.push({
        id:             t.id,
        name:           t.name,
        project_id:     t.project_id,
        stage_id:       t.stage_id,
        stageName:      stageMap.get(t.stage_id?.[0]) || 'Unknown',
        user_id:        t.user_ids?.[0] || null,
        user_ids:       t.user_ids,
        allocated_hours: t.allocated_hours,
        effective_hours: t.effective_hours,
        date_start:     t.planned_date_begin,
        date_end:       t.date_end,
        sale_line_id:   t.sale_line_id,
        parent_id:      t.parent_id,
        sprint_id:      t.sprint_id,
        story_points:   t.story_points ? parseInt(t.story_points) : null,
        scrum_team_id:  t.scrum_team_id,
      });
    }
  }

  return [...projectMap.values()].filter(p => p.tasks.length > 0);
}

// ── Users ──────────────────────────────────────────────────────────────────
async function fetchUsers() {
  return callKw('res.users', 'search_read',
    [[['share', '=', false]]],
    { fields: ['id', 'name', 'login', 'email'], context: { bin_size: true } }
  );
}

// ── Active Employees (Torus only) ──────────────────────────────────────────
const TORUS_COMPANY_ID       = 1;
const ACTIVE_CONTRACT_STATES = ['open', 'draft'];

async function fetchActiveEmployees() {
  let contracts = [];
  try {
    contracts = await callKw('hr.contract', 'search_read', [[
      ['employee_id.company_id', '=', TORUS_COMPANY_ID],
      ['state', 'in', ACTIVE_CONTRACT_STATES]
    ]], { fields: ['id', 'state', 'employee_id', 'date_start', 'date_end'] }) || [];
  } catch (e) {
    console.error('[Odoo] fetchActiveEmployees (contracts):', e.message);
    return [];
  }

  const empIds = [...new Set(
    contracts.map(c => c.employee_id?.[0]).filter(Boolean)
  )];
  if (!empIds.length) return [];

  let employees = [];
  try {
    employees = await callKw('hr.employee', 'search_read', [[
      ['id', 'in', empIds],
      ['job_id', 'in', [1, 2]],  // Consultores Funcionales (1) y Técnicos (2) only
    ]], { fields: ['id', 'name', 'user_id', 'department_id', 'job_id', 'active'] }) || [];
  } catch (e) {
    console.error('[Odoo] fetchActiveEmployees (employees):', e.message);
    return [];
  }

  const userIds = employees.map(e => e.user_id?.[0]).filter(Boolean);

  /** @type {Map<number, string>} userId → login */
  const userIdToLogin = new Map();
  if (userIds.length) {
    try {
      const users = await callKw('res.users', 'search_read', [[
        ['id', 'in', userIds]
      ]], { fields: ['id', 'login'] }) || [];
      users.forEach(u => userIdToLogin.set(u.id, u.login));
    } catch (e) {
      console.error('[Odoo] fetchActiveEmployees (users):', e.message);
    }
  }

  /** @type {Map<number, object>} employeeId → contract */
  const empContractMap = new Map(
    contracts.map(c => [c.employee_id?.[0], c]).filter(([k]) => k)
  );

  return employees.map(e => {
    const c         = empContractMap.get(e.id) || {};
    const ruId      = e.user_id?.[0];
    const login     = ruId ? (userIdToLogin.get(ruId) || null) : null;
    return {
      id:             e.id,
      name:           e.name,
      login,
      userId:         ruId || null,
      department:      e.department_id?.[1] || null,
      job:            e.job_id?.[1] || null,
      contract_state:  c.state || null,
      contract_start:  c.date_start || null,
      contract_end:    c.date_end   || null,
    };
  });
}

// ── All Employees ──────────────────────────────────────────────────────────
async function fetchAllEmployees() {
  let employees = [];
  try {
    employees = await callKw('hr.employee', 'search_read', [[
      ['company_id', '=', TORUS_COMPANY_ID]
    ]], { fields: ['id', 'name', 'user_id', 'department_id', 'job_id', 'active'] }) || [];
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

  /** @type {Map<number, object>} employeeId → latest contract */
  const empContractMap = new Map();
  for (const c of contracts) {
    const eid = c.employee_id?.[0];
    if (eid && !empContractMap.has(eid)) empContractMap.set(eid, c);
  }

  return employees.map(e => {
    const c = empContractMap.get(e.id);
    return {
      id:             e.id,
      name:           e.name,
      department:    e.department_id?.[1] || null,
      job:           e.job_id?.[1] || null,
      active:        e.active,
      contract_state: c ? c.state : null,
    };
  });
}

// ── Approved employee leaves (hr.leave) ───────────────────────────────────────
/**
 * Fetch validated (approved) leave requests for the company.
 * Covers daysBack days in the past + 60 days forward (for upcoming planned leaves).
 *
 * Returns records with: { employee_id, holiday_status_id, date_from, date_to, number_of_days }
 * Dates are Odoo datetime strings: "YYYY-MM-DD HH:MM:SS" in server time (UTC).
 */
async function fetchApprovedLeaves(daysBack = 120) {
  const today  = new Date();
  const past   = new Date(today); past.setDate(past.getDate() - daysBack);
  const future = new Date(today); future.setDate(future.getDate() + 60);

  // Odoo stores datetimes as "YYYY-MM-DD HH:MM:SS" strings
  const pastStr   = past.toISOString().slice(0, 10)   + ' 00:00:00';
  const futureStr = future.toISOString().slice(0, 10)  + ' 23:59:59';

  try {
    const leaves = await callKw('hr.leave', 'search_read', [[
      ['state',    '=', 'validate'],
      ['date_from', '<=', futureStr],
      ['date_to',   '>=', pastStr],
      ['employee_id.company_id', '=', TORUS_COMPANY_ID],
    ]], {
      fields: ['employee_id', 'holiday_status_id', 'date_from', 'date_to', 'number_of_days'],
    }) || [];
    return leaves;
  } catch (e) {
    console.error('[Odoo] fetchApprovedLeaves:', e.message);
    return [];
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  authenticate,
  callKw,
  fetchTimesheets,
  fetchProjectsWithTasks,
  fetchUsers,
  fetchActiveEmployees,
  fetchAllEmployees,
  fetchApprovedLeaves,
};

// ── CRM Opportunities ──────────────────────────────────────────────────────────
async function fetchCRMOpportunities() {
  return callKw('crm.lead', 'search_read',
    [['|', ['active', '=', true], ['active', '=', false],
            ['type', '=', 'opportunity']]],
    { fields: [
        'id', 'name', 'stage_id', 'probability', 'expected_revenue',
        'user_id', 'x_hunter_id', 'source_id', 'create_date',
        'date_closed', 'active', 'type',
      ],
      order: 'create_date desc',
      context: { bin_size: true },
    }
  );
}

module.exports.fetchCRMOpportunities = fetchCRMOpportunities;

// ── Scrum data (unika_scrum module) ───────────────────────────────────────
async function fetchScrumData() {
  const [teams, sprints] = await Promise.all([
    callKw('unika.scrum.team', 'search_read', [[['active', '=', true]]], {
      fields: ['id', 'name', 'code', 'product_owner_id', 'scrum_master_id',
               'sprint_count', 'active_sprint_id', 'avg_velocity', 'current_member_count']
    }).catch(e => { console.error('[Odoo] fetchScrumData teams:', e.message); return []; }),
    callKw('unika.scrum.sprint', 'search_read', [[['state', '!=', 'cancelled']]], {
      fields: ['id', 'name', 'team_id', 'date_start', 'date_end', 'state',
               'sprint_number', 'goal',
               'story_points_committed', 'story_points_completed', 'velocity_pct',
               'story_points_baseline', 'story_points_done_baseline', 'velocity_true_pct',
               'sp_added_mid_sprint', 'task_count', 'task_done_count'],
      order: 'date_start desc',
      limit: 120
    }).catch(e => { console.error('[Odoo] fetchScrumData sprints:', e.message); return []; })
  ]);
  return { teams, sprints };
}

module.exports.fetchScrumData = fetchScrumData;
