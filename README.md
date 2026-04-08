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
- Gráfico de horas por semana
- Tabla de consultores con variación vs semana pasada
- Detección de anomalías:
  - Exceso de horas (>12h/día)
  - Horas en fin de semana/feriados
  - Tareas sin estimación
  - Descripciones mecánicas
  - Consultores inactivos
- Estado de todos los proyectos

## Architecture

```
src/
  index.js      # Express server
  odoo.js       # Odoo XML-RPC connector
  cache.js      # In-memory short-lived cache for Odoo-backed endpoints
routes/
  equipo.js     # /equipo page
  api.js        # /api/equipo/* JSON endpoints
views/
  platform/     # Shell and hub
  dashboards/    # Per-dashboard pages
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

This keeps the dashboard responsive while preserving near-real-time data.

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
