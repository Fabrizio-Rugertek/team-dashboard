require('dotenv').config();
const express      = require('express');
const path         = require('path');
const session      = require('express-session');
const { execSync } = require('child_process');
const passport     = require('./auth');
const { requireAuth, requireRole, requireView } = require('../middleware/requireAuth');

// ── App version (git hash + deploy time) ─────────────────────────────────────
function getGitHash() {
  try { return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..') }).toString().trim(); }
  catch { return 'dev'; }
}
const APP_VERSION    = getGitHash();
const APP_DEPLOY_AT  = new Date().toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' });

const app  = express();
const PORT = process.env.PORT || 3511;

// ── Trust reverse proxy (nginx) ───────────────────────────────────────────────
app.set('trust proxy', 1);
const ENABLE_PREWARM      = process.env.ENABLE_PREWARM !== 'false';
const PREWARM_INTERVAL_MS = Number(process.env.PREWARM_INTERVAL_MS || 30000);

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ── Inject version into every template ───────────────────────────────────────
app.locals.appVersion   = APP_VERSION;
app.locals.appDeployAt  = APP_DEPLOY_AT;

// ── Body parser ───────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'torus-dev-secret-change-in-prod',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 days
  },
}));

// ── Passport ──────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Auth routes (public) ──────────────────────────────────────────────────────
app.use('/auth', require('../routes/auth'));

// ── Protected routes ──────────────────────────────────────────────────────────
const equipoRoutes    = require('../routes/equipo');
const finanzasRoutes  = require('../routes/finanzas');
const ejecutivoRoutes = require('../routes/ejecutivo');
const crmRoutes       = require('../routes/crm');
const sopRoutes       = require('../routes/sop');
const apiRoutes       = require('../routes/api');
const adminRoutes     = require('../routes/admin');
const proyectosRoutes = require('../routes/proyectos');

// /equipo — users with equipo view access
app.use('/equipo',    requireView('equipo'),    equipoRoutes);

// /proyectos — users with equipo view access
app.use('/proyectos', requireView('equipo'),    proyectosRoutes);

// /finanzas — users with finanzas view access
app.use('/finanzas',  requireView('finanzas'),  finanzasRoutes);

// /ejecutivo — directors and admins
app.use('/ejecutivo', requireView('ejecutivo'), ejecutivoRoutes);

// /crm — directors and admins
app.use('/crm',       requireView('crm'),       crmRoutes);

// /sop — all authenticated users (open to all roles)
app.use('/sop', requireAuth, sopRoutes);

// /api — authenticated only
app.use('/api', requireAuth, apiRoutes);

// /admin — admins only (middleware applied inside routes/admin.js too)
app.use('/admin', adminRoutes);

// ── Platform hub ──────────────────────────────────────────────────────────────
const { hasViewAccess } = require('../src/users');
app.get('/', requireAuth, (req, res) => {
  const dashboards = [];
  if (hasViewAccess(req.user, 'equipo'))
    dashboards.push({ id: 'equipo', name: 'Control de Equipo',
      description: 'Horas por consultor, anomalías, estado de proyectos',
      icon: '👥', color: '#3B82F6', href: '/equipo', status: 'active' });
  if (hasViewAccess(req.user, 'equipo'))
    dashboards.push({ id: 'proyectos', name: 'Portfolio de Proyectos',
      description: 'Estado, presupuesto de horas y capacidad por proyecto',
      icon: '📋', color: '#0EA5E9', href: '/proyectos', status: 'active' });
  if (hasViewAccess(req.user, 'finanzas'))
    dashboards.push({ id: 'finanzas', name: 'Finanzas',
      description: 'Ingresos, gastos, rentabilidad por proyecto y flujo de caja',
      icon: '📊', color: '#10B981', href: '/finanzas', status: 'active' });
  if (hasViewAccess(req.user, 'ejecutivo'))
    dashboards.push({ id: 'ejecutivo', name: 'Vista Ejecutiva',
      description: 'KPIs del directorio: ingresos, margen, utilización, CXC y salud de proyectos',
      icon: '🎯', color: '#8B5CF6', href: '/ejecutivo', status: 'active' });
  if (hasViewAccess(req.user, 'crm'))
    dashboards.push({ id: 'crm', name: 'CRM',
      description: 'Pipeline, win rate, hunters, tendencia mensual y análisis de fuentes',
      icon: '💼', color: '#D97706', href: '/crm', status: 'active' });
  // SOP is visible to all authenticated users
  dashboards.push({ id: 'sop', name: 'SOPs Interactivos',
    description: 'Procesos estándar con flujo visual: ventas, implementación y soporte',
    icon: '🗺️', color: '#0EA5E9', href: '/sop', status: 'active' });
  if (hasViewAccess(req.user, 'admin'))
    dashboards.push({ id: 'admin', name: 'Administración',
      description: 'Gestión de usuarios, roles y permisos de acceso',
      icon: '🔑', color: '#8B5CF6', href: '/admin/users', status: 'active' });
  res.render('platform/hub', { title: 'Torus Dashboards', user: req.user, dashboards });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('platform/404');
});

// ── Prewarm ───────────────────────────────────────────────────────────────────
let prewarmInFlight = false;
async function prewarmEquipoBootstrap() {
  if (!ENABLE_PREWARM || prewarmInFlight) return;
  prewarmInFlight = true;
  try {
    const response = await fetch('http://127.0.0.1:' + PORT + '/api/equipo/bootstrap');
    if (!response.ok) console.warn('[Torus Dashboard] Bootstrap prewarm failed', response.status);
  } catch (e) {
    console.warn('[Torus Dashboard] Bootstrap prewarm error:', e.message);
  } finally {
    prewarmInFlight = false;
  }
}

app.listen(PORT, '0.0.0.0', function () {
  console.log('[Torus Dashboard] Running on http://0.0.0.0:' + PORT);
  console.log('[Torus Dashboard] Platform ready at https://dashboard.torus.dev');
  if (ENABLE_PREWARM) {
    setTimeout(function () {
      prewarmEquipoBootstrap();
      setInterval(prewarmEquipoBootstrap, PREWARM_INTERVAL_MS);
    }, 1500);
  }
});
