# Torus Dashboard Platform

Multi-dashboard platform for Torus project management control.

**Stack:** Node.js + Express + EJS + Tailwind CSS + Chart.js

## Running

```bash
npm install
npm start
```

Opens on `http://localhost:3511`

## Environment Variables

> **All Odoo credentials are mandatory** — no hardcoded defaults exist.
> If any variable is missing the app exits immediately on startup with a clear error.

```env
PORT=3511
ODOO_URL=https://www.torus.dev
ODOO_DB=rugertek-company-odoo-production-17029773
ODOO_USER=odoo@rugertek.com
ODOO_PASSWORD=<password>

# Optional prewarm tuning
ENABLE_PREWARM=true
PREWARM_INTERVAL_MS=30000
```

## Dashboards

### Control de Equipo (`/equipo`)
- KPIs: horas semana/mes, consultores activos, tareas completadas
- Gráfico de horas por semana
- Tabla de consultores con variación vs semana pasada
- Detección de anomalías:
  - Exceso de horas (>12h/día configurable via `src/config.js`)
  - Horas en fin de semana / feriados (lista configurable)
  - Tareas sin estimación
  - Descripciones mecánicas
  - Consultores inactivos
  - Tareas sin fechas, tareas hijas sin sprint
- Estado de proyectos con filtros Odoo-style

## Architecture

```
src/
  index.js      # Express server
  config.js     # Central config: thresholds, holidays, cache TTL, filter options
  odoo.js       # Odoo XML-RPC connector (env-only credentials)
  cache.js      # In-memory cache, Map-based lookups, filter support
routes/
  equipo.js     # /equipo SSR page (reads ?status & ?tag query params)
  api.js        # /api/equipo/* JSON endpoints (accept ?status & ?tag)
views/
  platform/     # Shell and hub
  dashboards/   # Per-dashboard EJS pages
```

### src/config.js (central config)

All tunable constants in one file — no magic numbers in business logic:

| Key | Purpose |
|-----|---------|
| `CACHE_TTL_MS` | Cache validity (default 5 min) |
| `TIMESHEET_DAYS_BACK` | Days of timesheet history |
| `EXCESSIVE_HOURS_THRESHOLD` | Daily hours → critical anomaly |
| `MECHANICAL_DESC_HOURS` | Hours on mechanical desc → warning |
| `BACKLOG_STAGE_IDS` | Stage IDs counted as backlog |
| `HOLIDAYS` | Set of ISO-date strings for anomaly detection |
| `DAYS_SINCE_UPDATE_WARNING/CRITICAL` | Project staleness thresholds |
| `PROJECT_STATUS_FILTERS` | Odoo-style status filter options |
| `PROJECT_TAG_FILTERS` | Tag/label filter options |

## Project Filters (Odoo-style)

The `/equipo` dashboard supports URL-persisted filters:

```
/equipo                          # all projects, all tags
/equipo?status=active            # in-progress projects only
/equipo?status=on_hold           # stalled projects
/equipo?status=completed         # fully completed projects
/equipo?status=needs_attention   # over-budget or stale projects
/equipo?tag=backlog              # projects with backlog tasks
/equipo?tag=sobreestimado        # projects logged >120% of estimate
/equipo?status=active&tag=backlog&page=2
```

Filter state is reflected in the URL (shareable, bookmarkable). Changing a filter causes a server-side re-render (SSR); pagination within filtered results is handled via AJAX.

All API endpoints also accept `?status=` and `?tag=` query params:

```text
GET /api/equipo/bootstrap?status=active&tag=backlog&page=1&pageSize=20
GET /api/equipo/projects?status=on_hold&page=2
```

## Performance

The `/equipo` page hydrates from a single bootstrap endpoint:

```text
GET /api/equipo/bootstrap
```

The app prewarms `/api/equipo/bootstrap` on startup and every 30 seconds so the first user-facing load usually hits hot cache.

Projects are paginated server-side (default 20 per page):

```text
GET /api/equipo/projects?page=2&pageSize=20
```

The first page is embedded in the bootstrap payload; later pages are loaded on demand from the browser.

If Odoo is temporarily unavailable, the API serves the most recent persisted snapshot:

```text
data/cache/equipo-bootstrap.json
```

## Deployment

Deploy reproducible on the RuBot VM:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Fabrizio-Rugertek/team-dashboard/master/deploy/deploy.sh)
```

The deploy script:

1. runs only on `vm-rugertek-bot` (fails fast on the wrong host)
2. fast-forwards the repo in `/home/openclaw/team-dashboard` without destructive resets
3. installs production dependencies with `npm ci --omit=dev`
4. generates `.env` from `/home/openclaw/.openclaw/workspace/.secrets/credentials.json` using the `odoo_torus` entry
5. installs/restarts `team-dashboard.service`
6. validates the existing nginx vhost for `dashboard.torus.dev` and reloads nginx

Expected public URL:

```text
https://dashboard.torus.dev/equipo
```

## Operations

Operational notes, service commands, cache behavior, and troubleshooting live in:

```text
docs/OPERATIONS.md
```

## Coding Guidelines

### No Emojis in UI
**Do not use emojis anywhere in the UI** — not in tab labels, filter options, empty states, buttons, table cells, or any other rendered HTML.
Use plain text instead. Rationale: emojis render inconsistently across OS/browsers and look unprofessional in a business dashboard.

Bad:
```html
<button>📊 Resumen</button>
<option>👤 Hunter: Todos</option>
<div class="text-4xl">🏹</div>
```

Good:
```html
<button>Resumen</button>
<option>Hunter: Todos</option>
<div class="text-slate-400 text-sm">Sin datos</div>
```

### Filter Pattern
All dashboards use the same filter bar pattern — **no raw `<form>` + `onchange submit()`**.
- Date range: button + dropdown with preset list (left) and info/custom panel (right), using `selectPreset()` / `applyCustomDate()`
- All other filters: `<select onchange="applyFilter('key', this.value)">`
- URL builder: `buildFilterUrl(overrides)` — reads current state from JS vars, applies overrides, navigates via `window.location.href`
- Reference implementation: `views/dashboards/equipo.ejs` and `views/dashboards/crm.ejs`
