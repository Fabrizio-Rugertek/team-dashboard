/**
 * Central configuration for Torus Dashboard.
 * All tunable constants, thresholds, and static data live here.
 * No secrets — use environment variables for credentials.
 */
'use strict';

module.exports = {

  // ── Cache ────────────────────────────────────────────────────────────────
  CACHE_TTL_MS:          5 * 60 * 1000,   // 5 minutes

  // ── Odoo ────────────────────────────────────────────────────────────────
  ODOO_URL:             process.env.ODOO_URL,
  ODOO_DB:              process.env.ODOO_DB,
  ODOO_USER:            process.env.ODOO_USER,
  ODOO_PASSWORD:        process.env.ODOO_PASSWORD,

  // Job IDs for production consultants (Funcional=1, Técnico=2)
  PRODUCTION_JOB_IDS:   [1, 2],

  // ── Timesheet ────────────────────────────────────────────────────────────
  TIMESHEET_DAYS_BACK:  60,
  EXCESSIVE_HOURS_THRESHOLD: 12,   // hours in a single day → critical anomaly
  MECHANICAL_DESC_HOURS: 3,       // hours with a mechanical description → warning anomaly

  // ── Anomaly categories ───────────────────────────────────────────────────
  LOG_HISTORY_BUSINESS_DAYS: 10,
  LOG_COMPLIANCE_BUSINESS_DAYS: 20,
  LOG_MIN_DESC_LENGTH: 8,
  LATE_LOG_DAYS_THRESHOLD: 1,
  SUSPICIOUS_LOG_SCORE_WARNING: 40,
  SUSPICIOUS_LOG_SCORE_CRITICAL: 70,

  BACKLOG_STAGE_IDS: new Set([8, 20, 249]),
  BACKLOG_KEYWORDS:  ['backlog', 'lista de tarea', 'bandeja', 'internal'],

  // ── Project attention thresholds ─────────────────────────────────────────
  DAYS_SINCE_UPDATE_WARNING:  7,
  DAYS_SINCE_UPDATE_CRITICAL: 14,
  LOG_OVER_ALLOC_PCT:         120,   // 120% of allocated hours

  // ── Holidays (ISO 8601) ─────────────────────────────────────────────────
  HOLIDAYS: new Set([
    '2026-04-01', '2026-04-02', '2026-04-03',
    '2026-05-01', '2026-05-25',
    '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
    '2026-07-09', '2026-07-10',
    '2026-08-17',
    '2026-10-12',
    '2026-11-20',
    '2026-12-08', '2026-12-25',
    '2027-01-01', '2027-04-02', '2027-04-03',
  ]),

  // ── Project status filter options (Odoo-style stages) ─────────────────
  PROJECT_STATUS_FILTERS: [
    { value: 'all',          label: 'Todos' },
    { value: 'active',      label: 'En Curso' },
    { value: 'on_hold',     label: 'En Pausa' },
    { value: 'completed',   label: 'Completados' },
    { value: 'needs_attention', label: 'Requieren Atención' },
  ],

  // ── Project tags/label filter (static list — extend as needed) ──────────
  PROJECT_TAG_FILTERS: [
    { value: 'all',       label: 'Todas' },
    { value: 'sin_asignar', label: 'Sin Asignar' },
    { value: 'backlog',  label: 'Con Backlog' },
    { value: 'sobreestimado', label: 'Sobreestimado' },
  ],
};
