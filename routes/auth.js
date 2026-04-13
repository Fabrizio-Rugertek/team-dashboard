'use strict';
const express  = require('express');
const router   = express.Router();
const passport = require('../src/auth');

// ── Login page ────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/equipo');
  const error = req.query.error;
  const errorMsg = error === 'not_authorized'
    ? 'Tu cuenta de Google no está autorizada. Pedile acceso a un administrador.'
    : error ? 'Error de autenticación. Intentá de nuevo.' : null;
  res.render('auth/login', { errorMsg });
});

// ── Initiate Google OAuth flow ────────────────────────────────────────────────
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })
);

// ── Google OAuth callback ─────────────────────────────────────────────────────
router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/auth/login?error=not_authorized',
    failureMessage:  true,
  }),
  (req, res) => {
    const returnTo = req.session.returnTo || '/equipo';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/auth/login'));
  });
});

module.exports = router;
