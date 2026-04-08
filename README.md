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
routes/
  equipo.js     # /equipo page
  api.js        # /api/equipo/* JSON endpoints
views/
  platform/     # Shell and hub
  dashboards/    # Per-dashboard pages
```

## Deployment

```bash
npm start
# Runs on port 3511 (configured for dashboard.torus.dev via nginx reverse proxy)
```
