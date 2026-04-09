const express = require('express');
const router = express.Router();
const { getDashboardCached } = require('../src/cache');

router.get('/equipo/summary', async (req, res) => {
  try {
    const data = await getDashboardCached();
    res.json(data.summary);
  } catch (e) {
    console.error('[/api/equipo/summary]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/equipo/consultants', async (req, res) => {
  try {
    const data = await getDashboardCached();
    res.json(data.consultants);
  } catch (e) {
    console.error('[/api/equipo/consultants]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/equipo/anomalies', async (req, res) => {
  try {
    const data = await getDashboardCached();
    res.json(data.anomalies);
  } catch (e) {
    console.error('[/api/equipo/anomalies]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/equipo/projects', async (req, res) => {
  try {
    const data = await getDashboardCached();
    res.json(data.projectStatuses);
  } catch (e) {
    console.error('[/api/equipo/projects]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/equipo/weekly', async (req, res) => {
  try {
    const data = await getDashboardCached();
    res.json(data.weeklyData || []);
  } catch (e) {
    console.error('[/api/equipo/weekly]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
