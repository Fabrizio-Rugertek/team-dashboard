'use strict';
/**
 * MCP Server — Model Context Protocol over HTTP (Streamable HTTP transport)
 * Exposes Torus SOPs as tools for AI clients (Claude Desktop, Cursor, etc.)
 *
 * Endpoint: GET/POST /mcp
 * Tools:
 *   - list_processes       → list all available SOP processes
 *   - get_process(name)    → full steps + roles for a specific process
 *   - get_catalog          → product catalog, SO rules, analytic rules
 *   - search_sop(query)    → text search across all SOPs
 */

const express = require('express');
const router  = express.Router();
const sopLoader = require('../src/sop-loader');
const { REFERENCE_PAGES } = require('../src/sop-data');

// ── MCP Protocol helpers ───────────────────────────────────────────────────────
const SERVER_INFO = {
  name:    'torus-sop',
  version: '1.0.0',
};
const TOOLS = [
  {
    name:        'list_processes',
    description: 'Lista todos los procesos SOP disponibles de Torus con una descripcion breve de cada uno.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name:        'get_process',
    description: 'Obtiene el detalle completo de un proceso SOP: pasos, roles, inputs, outputs, herramientas y errores comunes.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nombre del proceso. Opciones: ventas, facturacion, implementacion, soporte, desarrollo, scrum, tareas',
        },
      },
      required: ['name'],
    },
  },
  {
    name:        'get_catalog',
    description: 'Obtiene el catalogo de productos Torus (CORE, LOC, SALES, SCM, HR, PROJ, CDEV, SUPP, HOURS), reglas de presupuesto (SO), reglas de cuentas analiticas y arbol de decision comercial.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name:        'search_sop',
    description: 'Busca texto en todos los SOPs. Util para encontrar en que proceso aparece un concepto, herramienta o rol especifico.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar (ej: "factura", "Odoo CRM", "Hunter")' },
      },
      required: ['query'],
    },
  },
];

// ── Tool implementations ───────────────────────────────────────────────────────
function toolListProcesses() {
  const ids = sopLoader.listEditable();
  const META = {
    ventas:         'Proceso comercial: desde captacion de lead hasta cierre y soporte post-venta. 10 pasos.',
    facturacion:    'Facturacion y cobros: desde configuracion hasta cierre contable. 7 pasos.',
    implementacion: 'Implementacion Odoo: analisis, configuracion, capacitacion, UAT, go-live. 8 pasos.',
    soporte:        'Soporte y mantenimiento post go-live. 6 pasos.',
    desarrollo:     'Pipeline tecnico de desarrollo a medida: DEV, staging, validacion, produccion. 5 pasos.',
    scrum:          'Ciclo de sprint Scrum: refinamiento, planning, daily, ejecucion, review, retro. 6 ceremonias.',
    tareas:         'Gestion de tareas en Odoo: crear, ejecutar, alerta 48hs, validar, cerrar. 6 pasos.',
  };
  return ids.map(id => ({ id, description: META[id] || id }));
}

function toolGetProcess(name) {
  const id  = name.toLowerCase().trim();
  const raw = sopLoader.loadRaw(id);
  if (!raw) return { error: `Proceso "${name}" no encontrado. Disponibles: ${sopLoader.listEditable().join(', ')}` };
  const laneLabels = (raw.lanes || []).map(l => l.label);
  return {
    process: id,
    lanes:   laneLabels,
    steps:   (raw.steps || []).map(s => ({
      step:        s.col,
      id:          s.id,
      label:       s.label,
      role:        laneLabels[s.lane] || '',
      description: s.description || s.sublabel || '',
      inputs:      s.inputs   || [],
      outputs:     s.outputs  || [],
      tools:       s.tools    || [],
      mistakes:    s.mistakes || [],
    })),
    edges: (raw.edges || []).map(e => ({ from: e.from, to: e.to, type: e.type || 'normal' })),
  };
}

function toolGetCatalog() {
  const ct = REFERENCE_PAGES['catalogo-torus'];
  if (!ct) return { error: 'Catalogo no encontrado' };
  return {
    products: (ct.products || []).map(cat => ({
      category: cat.category,
      items: cat.items.map(i => ({
        code:    i.code,
        name:    i.name,
        when:    i.when,
        billing: i.billing,
      })),
    })),
    decisionTree:  ct.decisionTree  || [],
    conditions:    ct.conditions    || {},
    soRules: ct.soRules ? {
      alert:     ct.soRules.alert,
      rules:     (ct.soRules.rules || []).map(r => `${r.label}: ${r.text}`),
      checklist: ct.soRules.checklist || [],
    } : null,
    analyticRules: ct.analyticRules ? {
      alert:         ct.analyticRules.alert,
      plans:         ct.analyticRules.plans || [],
      matchLogic:    ct.analyticRules.matchLogic,
      howPlan1Works: ct.analyticRules.howPlan1Works,
    } : null,
  };
}

function toolSearchSop(query) {
  const q = query.toLowerCase();
  const results = [];

  for (const id of sopLoader.listEditable()) {
    const raw = sopLoader.loadRaw(id);
    if (!raw) continue;
    const laneLabels = (raw.lanes || []).map(l => l.label);
    for (const s of (raw.steps || [])) {
      const haystack = [
        s.label, s.sublabel, s.description,
        ...(s.inputs || []), ...(s.outputs || []),
        ...(s.tools || []),  ...(s.mistakes || []),
        laneLabels[s.lane] || '',
      ].join(' ').toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          process: id,
          step:    s.label,
          role:    laneLabels[s.lane] || '',
          context: s.description || s.sublabel || '',
        });
      }
    }
  }

  // Also search reference pages
  const ct = REFERENCE_PAGES['catalogo-torus'];
  if (ct) {
    for (const cat of (ct.products || [])) {
      for (const item of (cat.items || [])) {
        const haystack = [item.code, item.name, item.when, item.billing].join(' ').toLowerCase();
        if (haystack.includes(q)) {
          results.push({ process: 'catalogo-torus', step: `[${item.code}] ${item.name}`, context: item.when });
        }
      }
    }
    if (ct.soRules) {
      for (const rule of (ct.soRules.rules || [])) {
        if ((rule.label + rule.text).toLowerCase().includes(q)) {
          results.push({ process: 'catalogo-torus', step: 'soRules: ' + rule.label, context: rule.text });
        }
      }
    }
  }

  return { query, count: results.length, results };
}

// ── MCP Request handler ────────────────────────────────────────────────────────
function handleMcpRequest(body) {
  const { jsonrpc, id, method, params } = body;

  if (method === 'initialize') {
    return {
      jsonrpc, id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo:      SERVER_INFO,
        capabilities:    { tools: {} },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null; // no response needed
  }

  if (method === 'tools/list') {
    return { jsonrpc, id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    let data;
    try {
      if (name === 'list_processes') data = toolListProcesses();
      else if (name === 'get_process') data = toolGetProcess(args.name || '');
      else if (name === 'get_catalog') data = toolGetCatalog();
      else if (name === 'search_sop')  data = toolSearchSop(args.query || '');
      else return { jsonrpc, id, error: { code: -32601, message: `Unknown tool: ${name}` } };
    } catch (e) {
      return { jsonrpc, id, error: { code: -32603, message: e.message } };
    }
    return {
      jsonrpc, id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: false,
      },
    };
  }

  return { jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ── Routes ─────────────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight
router.options('/', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  }).sendStatus(204);
});

// GET — MCP discovery (returns server info + tools list for clients that probe via GET)
router.get('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    name:    SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: 'Torus SOP MCP Server — procedimientos internos de ventas, implementacion, soporte y catalogo de productos.',
    tools:   TOOLS.map(t => ({ name: t.name, description: t.description })),
    usage:   'Agrega https://dashboard.torus.dev/mcp a tu cliente MCP (Claude Desktop, Cursor, etc.)',
  });
});

// POST — MCP JSON-RPC (main protocol endpoint)
router.post('/', express.json(), (req, res) => {
  res.set({
    'Access-Control-Allow-Origin':  '*',
    'Content-Type':                 'application/json',
  });
  const response = handleMcpRequest(req.body);
  if (response === null) return res.sendStatus(204);
  res.json(response);
});

module.exports = router;
