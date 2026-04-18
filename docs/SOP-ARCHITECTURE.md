# SOP Encyclopedia — Architecture & Developer Guide

> Last updated: 2026-04-18

---

## 1. Vision

The SOP Encyclopedia (`/sop`) is Torus's living operational knowledge base. It serves as both a **training tool** for new consultants and a **live reference** during active projects.

**What it is today:**
- 7 interactive swimlane flow processes (ventas, facturación, implementación, soporte, desarrollo, scrum, tareas)
- 3 reference pages (roles, metodología, catálogo-torus)
- 1 interactive org chart (organigrama)
- Checklist mode, dual visual/written views, handoff links

**What it should become:**
- The single source of truth for how Torus operates
- Deeply linked with Odoo tasks and project phases
- Auto-updated by operations, not manually maintained
- Onboarding tool: new consultants complete all processes in checklist mode in week 1

---

## 2. Architecture

### Files

| File | Purpose |
|------|---------|
| `src/sop-data.js` | All process data: step definitions, edges, lanes, encyclopedia index, ORG_DATA |
| `routes/sop.js` | Express router — hub, flow, reference, and organigrama routes |
| `views/sop/hub.ejs` | Encyclopedia homepage with sidebar + section cards |
| `views/sop/index.ejs` | Swimlane flowchart view for each process (dual view: visual + written) |
| `views/sop/reference.ejs` | Rich reference pages (roles, metodologia, catalogo) |
| `views/sop/organigrama.ejs` | Interactive SVG org chart |

### Data flow

```
sop-data.js
  compileProcess()         → enriches raw steps + edges with computed positions
  PROCESSES                → compiled process map (keyed by id)
  ENCYCLOPEDIA             → hub metadata (sections → processes)
  REFERENCE_PAGES          → rich reference page data
  ORG_DATA                 → org chart tree

routes/sop.js
  GET /sop                 → renders hub.ejs with ENCYCLOPEDIA + FLOW_PROCESSES
  GET /sop/organigrama     → renders organigrama.ejs with ORG_DATA
  GET /sop/:processId      → renders index.ejs with compiled process data
  GET /sop/ref/:pageId     → renders reference.ejs with REFERENCE_PAGES[pageId]
```

### `compileProcess()` function

Takes a raw process definition and returns an enriched object:

```javascript
compileProcess({
  steps: [ { id, col, lane, label, sublabel, time, description, substeps, inputs, outputs, tools, tips, mistakes, handoffs } ],
  edges: [ { from, to, type } ],  // type: 'normal' | 'handoff' | 'parallel'
  lanes: [ { label, color, bg } ]
})
// Returns: { steps, edges, lanes, canvas }
// steps: enriched with bounds (left/top/cx/cy), laneColor, laneBg
// edges: enriched with id, path (SVG path string), dur
// canvas: { W, H, LANE_W, COL_W, ROW_H, CARD_W, CARD_H }
```

**Layout rules:**
- Column index (`col`) starts at 1. Each column is `COL_W = 180px` wide.
- Lane index (`lane`) starts at 0. Each lane is `ROW_H = 170px` tall.
- Lane label area: `LANE_W = 120px` on the left.
- Cards: `CARD_W = 148px`, `CARD_H = 120px`, centered in their cell.

### Edge types

| Type | Visual | Use case |
|------|--------|----------|
| `normal` | Dashed gray line | Sequential flow within same lane or between lanes |
| `handoff` | Solid amber line + glow | Role transition — ownership changes |
| `parallel` | Dashed slate, lower opacity | Parallel/concurrent flow (fork) |

---

## 3. Adding a new process

### Step 1: Define lanes

```javascript
const MY_PROCESS_LANES = [
  { label: 'Rol A',   color: '#D97706', bg: '#FFFBEB' },
  { label: 'Rol B',   color: '#8B5CF6', bg: '#F5F3FF' },
];
```

### Step 2: Define steps

```javascript
const MY_PROCESS_STEPS = [
  {
    id: 'step1', col: 1, lane: 0,
    label: 'Nombre del Paso',
    sublabel: 'Descripción corta',
    time: '30 min',
    stage: 'Fase 1',
    description: 'Descripción detallada para el panel lateral.',
    substeps: ['Hacer X', 'Luego Y', 'Verificar Z'],
    inputs:  ['Datos de entrada'],
    outputs: ['Entregable producido'],
    tools:   ['Odoo CRM'],
    tips:    ['Siempre verificar antes de avanzar'],
    mistakes: ['No saltar la validación'],
    handoffs: [{ role: 'PM', description: 'Pasa al PM para ejecución', linkedProcess: 'implementacion' }],
  },
  // ... more steps
];
```

### Step 3: Define edges

```javascript
const MY_PROCESS_EDGES = [
  { from: 'step1', to: 'step2', type: 'normal' },
  { from: 'step2', to: 'step3', type: 'handoff' },
  { from: 'step2', to: 'step4', type: 'parallel' },  // fork
];
```

### Step 4: Compile and register

```javascript
const MY_PROCESS = compileProcess({
  steps: MY_PROCESS_STEPS,
  edges: MY_PROCESS_EDGES,
  lanes: MY_PROCESS_LANES,
});

const PROCESSES = {
  // ... existing
  miproceso: MY_PROCESS,
};
```

### Step 5: Add route metadata (routes/sop.js)

```javascript
const PROCESS_META = {
  // ... existing
  miproceso: { name: 'Mi Proceso', section: 'produccion', color: '#10B981' },
};
```

### Step 6: Add to encyclopedia (sop-data.js)

```javascript
// In ENCYCLOPEDIA.sections, add to the relevant section:
{ id: 'miproceso', name: 'Mi Proceso', description: 'Descripción para la card del hub.', steps: 6, status: 'complete' },
```

---

## 4. Hub structure

The hub (`hub.ejs`) uses the `ENCYCLOPEDIA` object from `sop-data.js`:

```javascript
const ENCYCLOPEDIA = {
  sections: [
    {
      id: 'comercial',
      name: 'Procesos Comerciales',
      color: '#D97706',
      bg: '#FFFBEB',
      icon: '💼',
      description: 'Description shown under section header',
      processes: [
        {
          id: 'ventas',               // URL key: /sop/ventas
          name: 'Proceso de Ventas',
          description: 'Card description',
          steps: 10,                  // null for reference pages
          status: 'complete',         // 'complete' | 'reference' | 'wip' | 'planned'
        },
      ],
    },
  ],
};
```

**Status routing:**
- `complete` → links to `/sop/:id` if in FLOW_PROCESSES, else `/sop/ref/:id`
- `reference` → links to `/sop/ref/:id`
- `wip` → card is displayed but not clickable
- `planned` → card shown with "Próximamente"

The left sidebar in hub.ejs auto-generates from `encyclopedia.sections`.

---

## 5. Parallel flows

Parallel edges allow showing concurrent tasks in the swimlane. Steps that originate multiple edges automatically get a fork badge (violet ⋔ symbol in the top-right corner of the card).

### Usage

```javascript
{ from: 'kick_off', to: 'analisis', type: 'normal' },
{ from: 'kick_off', to: 'documentacion', type: 'parallel' },  // fork
```

Steps with `>1 outgoing edges` show the fork badge. The badge is computed dynamically in the EJS template — no extra configuration needed.

**Visual treatment:**
- Parallel edges: dashed slate line (#94A3B8), 6,3 dash pattern, 75% opacity
- Fork badge: violet circle with ⋔ symbol, top-right corner of card
- Legend entry added automatically in the canvas legend

---

## 6. Dual view (Visual / Written)

Each process page has two view modes, toggled by the buttons above the canvas:

- **Flujo Visual** — The swimlane SVG canvas (default)
- **Procedimiento Escrito** — A document-style list of each step with all details inline

The active view is persisted in `localStorage` as `sopView`. On page load, the stored preference is restored.

**Cross-view navigation:**
- Clicking "→ Ver en flujo" from Written view switches to Visual and scrolls + highlights the step card
- The `jumpToVisualStep(stepId)` JS function handles this transition

**Step card IDs:** Each step card uses `id="step-{step.id}"` (important for `jumpToVisualStep` and `selectStep` JS functions).

---

## 7. Organigrama

The interactive org chart lives at `/sop/organigrama`. It renders entirely client-side from JSON data injected by the server.

### Data structure (`ORG_DATA` in sop-data.js)

```javascript
const ORG_DATA = {
  id: 'gabriel',
  name: 'Gabriel Díaz de Bedoya',
  role: 'Presidente del Directorio',
  color: '#1E293B',
  dept: 'directorio',
  children: [
    {
      id: 'rodrigo',
      name: 'Rodrigo Campos',
      role: 'CEO',
      color: '#1E293B',
      dept: 'direccion',
      children: [ /* ... */ ]
    }
  ]
};
```

### Fields

| Field | Description |
|-------|-------------|
| `id` | Unique string identifier |
| `name` | Full name |
| `role` | Job title displayed below name |
| `color` | Department color (used for top border and tooltip accent) |
| `dept` | Department key (used for legend matching) |
| `children` | Array of direct reports (can be empty `[]`) |

### Department colors

| Dept key | Color | Label |
|----------|-------|-------|
| `directorio` | `#1E293B` | Directorio |
| `direccion` | `#1E293B` | Dirección |
| `produccion` | `#8B5CF6` | Producción |
| `funcional` | `#8B5CF6` | Consultor Funcional |
| `contable` | `#10B981` | Consultor Contable |
| `tecnico` | `#3B82F6` | Technical Consultant |
| `finanzas` | `#EC4899` | Finanzas / CFO |

### Layout algorithm

Uses a simplified Reingold-Tilford approach:
1. Leaf nodes get sequential x positions (0, 1*spacing, 2*spacing, ...)
2. Parent nodes center over their children
3. Y position = depth × (NODE_H + V_GAP)
4. Connectors: cubic bezier from parent bottom to child top, meeting at midpoint

### Updating the org chart

Edit `ORG_DATA` in `src/sop-data.js`. The chart recomputes on every page load. No rebuild required.

---

## 8. Design principles

### Color system

| Use | Color |
|-----|-------|
| Comercial / Ventas | `#D97706` (amber) |
| Producción / Implementación | `#8B5CF6` (violet) |
| Soporte | `#10B981` (emerald) |
| Desarrollo | `#EC4899` (pink) |
| Scrum | `#3B82F6` (blue) |
| Tareas | `#8B5CF6` (violet) |
| Handoff edges | `#F59E0B` (amber) |
| Parallel edges | `#94A3B8` (slate) |
| Normal edges | `#CBD5E1` (slate-light) |

### Typography

- Font: Inter (all weights 300–900)
- Card labels: `font-extrabold` (800), 13.5px
- Sublabels: 10.5px, `text-slate-500`
- Time badges: 10px, `text-slate-400`

### Naming conventions

- Process IDs: lowercase, no spaces (e.g., `implementacion`, `catalogo-torus`)
- Step IDs: snake_case (e.g., `kick_off`, `send_proposal`)
- Lane labels: role names in Spanish (e.g., `Ejecutivo Comercial`, `PM`)
- File names: lowercase with hyphens (e.g., `sop-data.js`, `hub.ejs`)

### Node IDs in HTML

Step cards use `id="step-{step.id}"`. The JS functions `selectStep()`, `jumpToVisualStep()`, and checklist mode all rely on this pattern. Do not change to `card-{id}` or any other prefix.

### Accessibility

- All interactive elements have `onclick` handlers
- Tooltips use `title` attributes on fork badges
- Color is never the sole differentiator (badges also show text labels)
