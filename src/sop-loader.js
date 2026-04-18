'use strict';
/**
 * SOP Loader — loads process data from JSON files with fallback to sop-data.js.
 * JSON files live in data/sops/{processId}.json
 * Runs compileProcess() on raw data before returning.
 */

const fs   = require('fs');
const path = require('path');
const { PROCESSES, ENCYCLOPEDIA, REFERENCE_PAGES } = require('./sop-data');

// ── Local compile (mirrors logic in sop-data.js) ──────────────────────────────
const LANE_W = 120;
const COL_W  = 180;
const ROW_H  = 170;
const CARD_W = 148;
const CARD_H = 120;

function _cardBounds(col, lane) {
  const padX = (COL_W - CARD_W) / 2;
  const padY = (ROW_H  - CARD_H) / 2;
  const left = LANE_W + (col - 1) * COL_W + padX;
  const top  = lane * ROW_H + padY;
  return { left, top, right: left + CARD_W, bottom: top + CARD_H,
           cx: left + CARD_W / 2, cy: top + CARD_H / 2 };
}

function _edgePath(from, to) {
  const x1 = from.bounds.right,  y1 = from.bounds.cy;
  const x2 = to.bounds.left,     y2 = to.bounds.cy;
  if (from.lane === to.lane) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mx = Math.round((x1 + x2) / 2);
  return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

function compileProcess({ steps: rawSteps, edges: rawEdges, lanes }) {
  const stepMap = {};
  const steps = rawSteps.map(s => {
    const b    = _cardBounds(s.col, s.lane);
    const lane = lanes[s.lane];
    const enriched = { ...s, bounds: b, laneColor: lane.color, laneBg: lane.bg };
    stepMap[s.id] = enriched;
    return enriched;
  });
  const cols   = Math.max(...rawSteps.map(s => s.col));
  const nLanes = lanes.length;
  const edges  = rawEdges.map(e => ({
    ...e,
    id:   `ep-${e.from}-${e.to}`,
    path: _edgePath(stepMap[e.from], stepMap[e.to]),
    dur:  e.type === 'handoff' ? '1.4s' : '1.8s',
  }));
  const canvas = { W: LANE_W + cols * COL_W, H: nLanes * ROW_H,
                   LANE_W, COL_W, ROW_H, CARD_W, CARD_H };
  return { steps, edges, lanes, canvas };
}

const DATA_DIR = path.join(__dirname, '../data/sops');

/**
 * Load raw (uncompiled) SOP data.
 * Returns { id, name, description, lanes, steps, edges } or null.
 */
function loadRaw(processId) {
  const filePath = path.join(DATA_DIR, processId + '.json');
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('[SOP Loader] Bad JSON for', processId, e.message);
    }
  }
  // Fallback: extract raw data from compiled PROCESSES
  const p = PROCESSES[processId];
  if (!p) return null;
  // p is already compiled — extract original fields (steps without bounds, edges without path/id)
  return {
    id:    processId,
    lanes: p.lanes.map(l => ({ id: l.id, label: l.label, color: l.color, bg: l.bg, row: l.row })),
    steps: p.steps.map(s => {
      const raw = { ...s };
      delete raw.bounds;
      delete raw.laneColor;
      delete raw.laneBg;
      return raw;
    }),
    edges: p.edges.map(e => {
      const raw = { ...e };
      delete raw.id;
      delete raw.path;
      delete raw.dur;
      return raw;
    }),
  };
}

/**
 * Load and compile a process. Returns the same shape as PROCESSES[id]:
 * { steps (with bounds), edges (with paths), lanes, canvas }
 * plus id, name, description from the JSON if available.
 */
function loadProcess(processId) {
  const raw = loadRaw(processId);
  if (!raw) return null;
  const compiled = compileProcess({ steps: raw.steps, lanes: raw.lanes, edges: raw.edges });
  return {
    ...compiled,
    id:          processId,
    name:        raw.name        || null,
    description: raw.description || null,
  };
}

/**
 * Save raw SOP data to JSON.
 */
function saveRaw(processId, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, processId + '.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * List all editable process IDs.
 */
function listEditable() {
  return Object.keys(PROCESSES);
}

module.exports = { loadRaw, loadProcess, saveRaw, listEditable, ENCYCLOPEDIA, REFERENCE_PAGES };
