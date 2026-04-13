'use strict';
const express = require('express');
const router  = express.Router();
const { requireRole } = require('../middleware/requireAuth');
const userStore = require('../src/users');

// All admin routes require admin role
router.use(requireRole('admin'));

// ── User list ─────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const users = userStore.listUsers();
  res.render('admin/users', {
    title: 'Gestión de Usuarios',
    users,
    currentUser: req.user,
    roles: userStore.VALID_ROLES,
  });
});

// ── Add user ──────────────────────────────────────────────────────────────────
router.post('/users', (req, res) => {
  const { email, role, name } = req.body;
  try {
    userStore.addUser(email, { role, name, addedBy: req.user.email });
    res.redirect('/admin/users?success=added');
  } catch (err) {
    const users = userStore.listUsers();
    res.render('admin/users', {
      title: 'Gestión de Usuarios',
      users,
      currentUser: req.user,
      roles: userStore.VALID_ROLES,
      error: err.message,
    });
  }
});

// ── Update role ───────────────────────────────────────────────────────────────
router.post('/users/:email/role', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const { role } = req.body;
  if (email === req.user.email && role !== 'admin') {
    return res.redirect('/admin/users?error=cant_demote_self');
  }
  try {
    userStore.updateUser(email, { role });
    res.redirect('/admin/users?success=updated');
  } catch (err) {
    res.redirect('/admin/users?error=' + encodeURIComponent(err.message));
  }
});

// ── Remove user ───────────────────────────────────────────────────────────────
router.post('/users/:email/delete', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  if (email === req.user.email) {
    return res.redirect('/admin/users?error=cant_delete_self');
  }
  userStore.removeUser(email);
  res.redirect('/admin/users?success=deleted');
});

module.exports = router;
