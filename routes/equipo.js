const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.render('dashboards/equipo', {
      title: 'Equipo - Torus Dashboard'
    });
  } catch (err) {
    console.error('Error loading equipo:', err.message);
    res.status(500).render('error', {
      message: `Error cargando datos del equipo: ${err.message}`
    });
  }
});

module.exports = router;
