const express = require('express');
const router = express.Router();
const odoo = require('../src/odoo');

router.get('/', async (req, res) => {
  try {
    const users = await odoo.fetchUsers();
    res.render('dashboards/equipo', {
      title: 'Equipo — Torus Dashboard',
      users
    });
  } catch (err) {
    console.error('Error loading equipo:', err.message);
    res.status(500).render('error', { message: 'Error cargando datos: ' + err.message });
  }
});

module.exports = router;
