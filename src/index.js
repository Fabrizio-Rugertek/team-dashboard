require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3511;
const ENABLE_PREWARM = process.env.ENABLE_PREWARM !== 'false';
const PREWARM_INTERVAL_MS = Number(process.env.PREWARM_INTERVAL_MS || 30000);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Routes
const equipoRoutes = require('../routes/equipo');
const apiRoutes = require('../routes/api');

app.use('/equipo', equipoRoutes);
app.use('/api', apiRoutes);

// Platform hub
app.get('/', (req, res) => {
  res.render('platform/hub', {
    title: 'Torus Dashboards',
    dashboards: [
      {
        id: 'equipo',
        name: 'Equipo',
        description: 'Control de horas, anomalías y estado del equipo',
        icon: '👥',
        color: '#3B82F6',
        href: '/equipo',
        status: 'active'
      }
    ]
  });
});

// 404
app.use((req, res) => {
  res.status(404).render('platform/404');
});

let prewarmInFlight = false;

async function prewarmEquipoBootstrap() {
  if (!ENABLE_PREWARM || prewarmInFlight) {
    return;
  }

  prewarmInFlight = true;
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/equipo/bootstrap`);
    if (!response.ok) {
      console.warn(`[Torus Dashboard] Bootstrap prewarm failed with ${response.status}`);
    }
  } catch (error) {
    console.warn(`[Torus Dashboard] Bootstrap prewarm error: ${error.message}`);
  } finally {
    prewarmInFlight = false;
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Torus Dashboard] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Torus Dashboard] Platform ready at http://dashboard.torus.dev`);

  if (ENABLE_PREWARM) {
    setTimeout(() => {
      prewarmEquipoBootstrap();
      setInterval(prewarmEquipoBootstrap, PREWARM_INTERVAL_MS);
    }, 1500);
  }
});
