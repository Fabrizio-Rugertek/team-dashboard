'use strict';
const { canAccess } = require('../src/users');

/**
 * Require authentication. Redirects to /auth/login if not logged in.
 */
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

/**
 * Require a minimum role.
 * Usage: router.use(requireRole('admin'))
 *        router.get('/path', requireRole('director'), handler)
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }
    if (!canAccess(req.user.role, minRole)) {
      return res.status(403).render('auth/forbidden', {
        user: req.user,
        requiredRole: minRole,
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
