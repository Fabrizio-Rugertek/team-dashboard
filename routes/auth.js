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
  res.render('auth/login', { errorMsg, oauthConfigured: passport.GOOGLE_CONFIGURED });
});

// ── Initiate Google OAuth flow ────────────────────────────────────────────────
router.get('/google', (req, res, next) => {
  if (!passport.GOOGLE_CONFIGURED) return res.redirect('/auth/login?error=oauth_not_configured');
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});

// ── Google OAuth callback ─────────────────────────────────────────────────────
router.get('/google/callback', (req, res, next) => {
  if (!passport.GOOGLE_CONFIGURED) return res.redirect('/auth/login');
  passport.authenticate('google', {
    failureRedirect: '/auth/login?error=not_authorized',
    failureMessage:  true,
  })(req, res, err => {
    if (err) return next(err);
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  });
});

// ── Dev bypass (only when OAuth not configured) ───────────────────────────────
router.get('/dev-login', (req, res) => {
  if (passport.GOOGLE_CONFIGURED) return res.redirect('/auth/login');
  const { getUser } = require('../src/users');
  const email = req.query.as || 'fabrizio@rugertek.com';
  const user  = getUser(email);
  if (!user) return res.status(403).send('User not in users.json: ' + email);
  req.login({ email, name: user.name, picture: null, role: user.role }, err => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/equipo');
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/auth/login'));
  });
});

module.exports = router;
