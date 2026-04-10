/**
 * /api/equipo/* JSON endpoints.
 * All endpoints accept optional filter query params for project filtering:
 *   ?status=all|active|on_hold|completed|needs_attention
 *   ?tag=all|sin_asignar|backlog|sobreestimado
 */
'use strict';

const express = require('express');
const fs       = require('fs/promises');
const path     = require('path');

const router = express.Router();
const { getDashboardCached } = require('../src/cache');

const PROJECTS_PAGE_SIZE = 20;
const SNAPSHOT_DIR = path.join(__dirname, '../data/cache');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'equipo-bootstrap.json');

// ── Filter validation ───────────────────────────────────────────────────────
const VALID_STATUS = new Set(['all','active','on_hold','completed','needs_attention']);
const VALID_TAG    = new Set(['all','sin_asignar','backlog','sobreestimado']);

function parseFilters(q) {
  return {
    status: VALID_STATUS.has(q.status) ? q.status : 'all',
    tag:    VALID_TAG.has(q.tag)    ? q.tag    : 'all',
  };
}

// ── Snapshot helpers ────────────────────────────────────────────────────────
async function writeSnapshot(snapshot) {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot), 'utf8');
}

async function readSnapshot() {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Pagination ──────────────────────────────────────────────────────────────
function paginateProjects(projects, page = 1, pageSize = PROJECTS_PAGE_SIZE) {
  const safePageSize = Math.max(1, Number(pageSize) || PROJECTS_PAGE_SIZE);
  const totalItems   = projects.length;
  const totalPages   = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage  = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start        = (currentPage - 1) * safePageSize;

  return {
    items: projects.slice(start, start + safePageSize),
    pagination: {
      page:        currentPage,
      pageSize:    safePageSize,
      totalItems,
      totalPages,
      hasPrev:     currentPage > 1,
      hasNext:     currentPage < totalPages,
    },
  };
}

// ── Bootstrap payload builder ───────────────────────────────────────────────
function buildBootstrapPayload(data, opts = {}) {
  const { page = 1, pageSize = PROJECTS_PAGE_SIZE, stale = false, staleReason = null } = opts;
  const projects = paginateProjects(data.projectStatuses || [], page, pageSize);

  return {
    generatedAt:   data.lastUpdate || new Date().toISOString(),
    stale,
    staleReason,
    filters:       opts.filters || { status: 'all', tag: 'all' },
    summary: {
      weekHours:       data.summary?.weekHours       || 0,
      monthHours:      data.summary?.monthHours      || 0,
      activeUsers:     data.summary?.activeUsers      || 0,
      totalUsers:      data.summary?.totalUsers ?? data.summary?.totalActiveEmployees ?? 0,
      totalTasks:     data.summary?.totalTasks       || 0,
      doneTasks:      data.summary?.doneTasks        || 0,
      completionRate: data.summary?.completionRate    || 0,
      billableWeek:   data.summary?.billableWeek     || 0,
      nonBillableWeek: data.summary?.nonBillableWeek  || 0,
      billableMonth:  data.summary?.billableMonth    || 0,
      nonBillableMonth: data.summary?.nonBillableMonth || 0,
    },
    consultants:  data.consultants || [],
    anomalies:    data.anomalies     || [],
    projects,
    weekly:       data.weeklyData   || [],
  };
}

// ── Core data fetcher ───────────────────────────────────────────────────────
async function getDashboardData(options = {}) {
  const filters  = parseFilters(options);
  const page     = Number(options.page     || 1);
  const pageSize = Number(options.pageSize || PROJECTS_PAGE_SIZE);

  try {
    const data    = await getDashboardCached(filters);
    const payload = buildBootstrapPayload(data, { page, pageSize, filters });
    await writeSnapshot(payload);
    return payload;
  } catch (error) {
    const snapshot = await readSnapshot();
    if (snapshot) {
      return { ...snapshot, stale: true, staleReason: error.message };
    }
    throw error;
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────────
router.get('/equipo/bootstrap', async (req, res) => {
  try {
    const payload = await getDashboardData({
      page:      req.query.page,
      pageSize:  req.query.pageSize,
      status:    req.query.status,
      tag:       req.query.tag,
    });
    res.json(payload);
  } catch (error) {
    console.error('[/api/equipo/bootstrap]', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/summary', async (req, res) => {
  try {
    const payload = await getDashboardData({
      status: req.query.status,
      tag:    req.query.tag,
    });
    res.json(payload.summary);
  } catch (error) {
    console.error('[/api/equipo/summary]', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/consultants', async (req, res) => {
  try {
    const payload = await getDashboardData({
      status: req.query.status,
      tag:    req.query.tag,
    });
    res.json(payload.consultants);
  } catch (error) {
    console.error('[/api/equipo/consultants]', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/anomalies', async (req, res) => {
  try {
    const payload = await getDashboardData({
      status: req.query.status,
      tag:    req.query.tag,
    });
    res.json(payload.anomalies);
  } catch (error) {
    console.error('[/api/equipo/anomalies]', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/projects', async (req, res) => {
  try {
    const payload = await getDashboardData({
      page:      req.query.page,
      pageSize:  req.query.pageSize,
      status:    req.query.status,
      tag:       req.query.tag,
    });
    res.json(payload.projects);
  } catch (error) {
    console.error('[/api/equipo/projects]', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/equipo/weekly', async (req, res) => {
  try {
    const payload = await getDashboardData({
      status: req.query.status,
      tag:    req.query.tag,
    });
    res.json(payload.weekly);
  } catch (error) {
    console.error('[/api/equipo/weekly]', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
