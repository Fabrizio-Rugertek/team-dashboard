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

```env
PORT=3511
ODOO_URL=https://www.torus.dev
ODOO_DB=rugertek-company-odoo-production-17029773
ODOO_USER=odoo@rugertek.com
ODOO_PASSWORD=<password>
```

## Dashboards

### Control de Equipo (`/equipo`)
- KPIs: horas semana/mes, consultores activos, tareas completadas
- Grafico de horas por semana
- Tabla de consultores con variacion vs semana pasada
- Deteccion de anomalias:
  - Exceso de horas (>12h/dia)
  - Horas en fin de semana/feriados
  - Tareas sin estimacion
  - Descripciones mecanicas
  - Consultores inactivos
- Estado de todos los proyectos

## Architecture

```text
src/
  index.js      # Express server
  odoo.js       # Odoo XML-RPC connector
  cache.js      # In-memory short-lived cache for Odoo-backed endpoints
routes/
  equipo.js     # /equipo page
  api.js        # /api/equipo/* JSON endpoints
views/
  platform/     # Shell and hub
  dashboards/   # Per-dashboard pages
```

## Performance

The `/equipo` page now hydrates from a single bootstrap endpoint:

```text
GET /api/equipo/bootstrap
```

That endpoint reuses cached Odoo reads to reduce duplicate XML-RPC traffic:

- users cache: 5 minutes
- projects cache: 45 seconds
- timesheets cache by range: 45 seconds
- bootstrap payload: 45 seconds

The app also prewarms `/api/equipo/bootstrap` on startup and every 30 seconds by default so the first user-facing load usually hits hot cache.

Projects are paginated server-side:

```text
GET /api/equipo/projects?page=2&pageSize=20
```

The first page is embedded in the bootstrap payload and later pages are loaded on demand from the browser.

If Odoo is temporarily unavailable, the API can serve the most recent persisted snapshot from:

```text
data/cache/equipo-bootstrap.json
```

Environment flags:

```env
ENABLE_PREWARM=true
PREWARM_INTERVAL_MS=30000
```

## Deployment

Deploy reproducible on the RuBot VM:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Fabrizio-Rugertek/team-dashboard/master/deploy/deploy.sh)
```

The deploy script:

1. clones or updates the repo in `/home/openclaw/team-dashboard`
2. installs production dependencies with `npm ci --omit=dev`
3. generates `.env` from `/home/openclaw/.openclaw/workspace/.secrets/credentials.json` using the `odoo_torus` entry
4. installs/restarts `team-dashboard.service`
5. installs nginx for `dashboard.torus.dev`

Expected public URL:

```text
https://dashboard.torus.dev/equipo
```

## Operations

Operational notes, service commands, cache behavior, and troubleshooting live in:

```text
docs/OPERATIONS.md
```
