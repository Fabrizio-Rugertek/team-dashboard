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
    loggingControl: data.loggingControl || { overview: {}, displayDates: [], people: [] },
    projects,
    weekly:       data.weeklyData   || [],
    scrumTeams:   data.scrumTeams   || [],
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

router.get('/equipo/logging', async (req, res) => {
  try {
    const payload = await getDashboardData({
      status: req.query.status,
      tag:    req.query.tag,
    });
    res.json(payload.loggingControl || { overview: {}, displayDates: [], people: [] });
  } catch (error) {
    console.error('[/api/equipo/logging]', error.message);
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

router.get('/equipo/scrum', async (req, res) => {
  try {
    const payload = await getDashboardData({ status: req.query.status, tag: req.query.tag });
    res.json(payload.scrumTeams || []);
  } catch (error) {
    console.error('[/api/equipo/scrum]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── SOP Editor API ────────────────────────────────────────────────────────────
const { requireRole } = require('../middleware/requireAuth');
const sopLoader = require('../src/sop-loader');
const { PROCESSES, REFERENCE_PAGES, ENCYCLOPEDIA } = require('../src/sop-data');

// GET raw SOP data (for editor)
router.get('/sop/:id/raw', (req, res) => {
  const raw = sopLoader.loadRaw(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not found' });
  res.json(raw);
});

// PUT save SOP data
router.put('/sop/:id/raw', requireRole('director'), express.json(), (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    if (!data || !data.steps || !data.lanes || !data.edges) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    sopLoader.saveRaw(id, { ...data, id });
    res.json({ ok: true });
  } catch (e) {
    console.error('[SOP API] save error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST AI generation
router.post('/sop/ai-generate', requireRole('director'), express.json(), async (req, res) => {
  try {
    const { description, lanes } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });

    const lanesContext = lanes ? JSON.stringify(lanes) : '[]';
    const prompt = `You are a business process designer. Convert this description into a swimlane flowchart JSON.

Process description: ${description}

${lanes && lanes.length > 0 ? `Existing lanes (keep these if appropriate): ${lanesContext}` : ''}

Return ONLY valid JSON (no markdown, no explanation) matching this exact schema:
{
  "lanes": [
    {"id": "role1", "label": "Role Name", "color": "#3B82F6", "bg": "#EFF6FF", "row": 0}
  ],
  "steps": [
    {"id": "s1", "label": "Step Name", "sublabel": "Tool or note", "lane": 0, "col": 1, "description": "What happens in this step"}
  ],
  "edges": [
    {"from": "s1", "to": "s2", "type": "normal"}
  ]
}

Rules:
- lane is the row INDEX (0-based integer matching lanes array index)
- col starts at 1 (1-based integer, no two steps can share same lane+col)
- Edge types: "normal" (same lane), "handoff" (lane change), "parallel" (dashed, concurrent/optional)
- Use 4-8 steps max, keep it concise
- Use professional Spanish for labels
- Colors: blue #3B82F6/#EFF6FF, orange #D97706/#FFFBEB, purple #8B5CF6/#F5F3FF, green #10B981/#ECFDF5, pink #EC4899/#FDF2F8`;

    const response = await fetch('http://localhost:18789/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenClaw error ${response.status}: ${err.slice(0, 200)}`);
    }

    const aiRes = await response.json();
    const text = aiRes.choices?.[0]?.message?.content || '';

    // Extract JSON from response (handle if wrapped in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    const generated = JSON.parse(jsonMatch[0]);
    if (!generated.lanes || !generated.steps || !generated.edges) {
      throw new Error('Invalid structure in AI response');
    }

    res.json({ ok: true, generated });
  } catch (e) {
    console.error('[SOP AI] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── SOP Export (machine-readable, for AI context) ─────────────────────────────
// GET /api/sop/export          → full SOP data as JSON (no auth required — data is not sensitive)
// GET /api/sop/export?format=ai → stripped-down version optimised for LLM context
router.get('/sop/export', (req, res) => {
  const aiMode = req.query.format === 'ai';

  // Build processes export — use sopLoader so edits from the visual editor are reflected
  const processesOut = {};
  for (const key of sopLoader.listEditable()) {
    const raw = sopLoader.loadRaw(key);
    if (!raw) continue;
    if (aiMode) {
      const laneLabels = (raw.lanes || []).map(l => l.label);
      processesOut[key] = {
        steps: (raw.steps || []).map(s => ({
          id:          s.id,
          label:       s.label,
          role:        laneLabels[s.lane] || '',
          description: s.description || s.sublabel || '',
          inputs:      s.inputs   || [],
          outputs:     s.outputs  || [],
          tools:       s.tools    || [],
          mistakes:    s.mistakes || [],
        })),
        lanes: laneLabels,
      };
    } else {
      processesOut[key] = raw;
    }
  }

  // Build reference pages export
  const refOut = {};
  for (const key of sopLoader.listRefs()) {
    const page = sopLoader.loadRef(key);
    if (!page) continue;
    if (aiMode) {
      // AI mode: include products, rules, conditions — skip colors/icons
      refOut[key] = {
        title: page.title,
        products: (page.products || []).map(cat => ({
          category: cat.category,
          items: cat.items.map(i => ({ code: i.code, name: i.name, when: i.when, billing: i.billing })),
        })),
        decisionTree: page.decisionTree || [],
        conditions:   page.conditions   || {},
        soRules:      page.soRules ? {
          alert: page.soRules.alert,
          rules: page.soRules.rules.map(r => r.label + ': ' + r.text),
          checklist: page.soRules.checklist,
        } : undefined,
        analyticRules: page.analyticRules ? {
          alert:         page.analyticRules.alert,
          plans:         page.analyticRules.plans,
          matchLogic:    page.analyticRules.matchLogic,
          howPlan1Works: page.analyticRules.howPlan1Works,
        } : undefined,
        projectStandards: page.projectStandards ? {
          alert:     page.projectStandards.alert,
          naming:    page.projectStandards.naming,
          stages:    page.projectStandards.stages,
          assignees: page.projectStandards.assignees,
          templates: page.projectStandards.templates,
          tags:      page.projectStandards.tags,
        } : undefined,
      };
    } else {
      refOut[key] = page;
    }
  }

  res.json({
    generated_at: new Date().toISOString(),
    format: aiMode ? 'ai' : 'full',
    source: 'dashboard.torus.dev/sop',
    processes: processesOut,
    reference_pages: refOut,
    encyclopedia: aiMode ? ENCYCLOPEDIA.sections.map(s => ({
      id: s.id, name: s.name, description: s.description,
      processes: s.processes.map(p => ({ id: p.id, name: p.name, description: p.description })),
    })) : ENCYCLOPEDIA,
  });
});

// ── Reference page raw API ──────────────────────────────────────────────────
router.get('/sop-ref/:pageId/raw', (req, res) => {
  const { pageId } = req.params;
  const data = sopLoader.loadRef(pageId);
  if (!data) return res.status(404).json({ error: 'Page not found: ' + pageId });
  res.json({
    pageId,
    data,
    modifiedAt: sopLoader.getModifiedAt('ref', pageId),
  });
});

router.put('/sop-ref/:pageId/raw', express.json({ limit: '2mb' }), (req, res) => {
  const { pageId } = req.params;
  if (!sopLoader.listRefs().includes(pageId)) {
    return res.status(404).json({ error: 'Unknown page: ' + pageId });
  }
  try {
    sopLoader.saveRef(pageId, req.body);
    res.json({ ok: true, pageId, savedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/sop-ref/:pageId/raw', (req, res) => {
  const { pageId } = req.params;
  const REF_DIR = require('path').join(__dirname, '../data/refs');
  const filePath = require('path').join(REF_DIR, pageId + '.json');
  try {
    if (require('fs').existsSync(filePath)) {
      require('fs').unlinkSync(filePath);
    }
    // Return the default data after deletion
    const data = sopLoader.loadRef(pageId);
    res.json({ ok: true, pageId, data, resetToDefault: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
