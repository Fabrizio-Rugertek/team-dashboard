'use strict';
const express = require('express');
const router  = express.Router();
const { requireView } = require('../middleware/requireAuth');
const userStore = require('../src/users');

// All admin routes require admin view access
router.use(requireView('admin'));

// ── Index redirect ────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.redirect('/admin/users'));

// ── User list ─────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const users = userStore.listUsers().map(u => ({
    ...u,
    effectiveViews: Array.isArray(u.allowedViews) ? u.allowedViews : userStore.getDefaultViews(u.role),
  }));
  res.render('admin/users', {
    title: 'Administración — Torus Dashboard',
    users,
    currentUser: req.user,
    roles:       userStore.VALID_ROLES,
    validViews:  userStore.VALID_VIEWS,
  });
});

// ── Add user ──────────────────────────────────────────────────────────────────
router.post('/users', (req, res) => {
  const { email, name } = req.body;
  // views checkboxes → array; role derived from views for backwards compat
  const views = [].concat(req.body.views || []).filter(v => userStore.VALID_VIEWS.includes(v));
  const role  = views.includes('admin') ? 'admin' : views.includes('finanzas') ? 'director' : 'consultant';
  try {
    userStore.addUser(email, { role, name, addedBy: req.user.email });
    userStore.updateUser(email.toLowerCase().trim(), { allowedViews: views });
    res.redirect('/admin/users?success=added');
  } catch (err) {
    const users = userStore.listUsers().map(u => ({
      ...u, effectiveViews: Array.isArray(u.allowedViews) ? u.allowedViews : userStore.getDefaultViews(u.role),
    }));
    res.render('admin/users', {
      title: 'Administración — Torus Dashboard',
      users,
      currentUser: req.user,
      roles:      userStore.VALID_ROLES,
      validViews: userStore.VALID_VIEWS,
      error:      err.message,
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

// ── Toggle view access ────────────────────────────────────────────────────────
router.post('/users/:email/views', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  if (email === req.user.email) {
    return res.redirect('/admin/users?error=cant_edit_own_views');
  }
  try {
    // req.body.views is an array (checkboxes) or undefined if all unchecked
    const views = [].concat(req.body.views || []).filter(v => userStore.VALID_VIEWS.includes(v));
    userStore.updateUser(email, { allowedViews: views });
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
