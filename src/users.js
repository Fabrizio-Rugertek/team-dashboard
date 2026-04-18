'use strict';
/**
 * Simple file-based user store.
 * data/users.json schema:
 *   { "email": { "name", "role", "addedAt", "addedBy" } }
 *
 * Roles:
 *   admin      — full access + user management
 *   director   — /equipo + /finanzas, no admin
 *   consultant — /equipo only
 */

const fs   = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '../data/users.json');

function _load() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function _save(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const VALID_ROLES = ['admin', 'director', 'consultant'];
const VALID_VIEWS = ['equipo', 'finanzas', 'ejecutivo', 'crm', 'admin'];

// Default views when allowedViews not explicitly set
function getDefaultViews(role) {
  if (role === 'admin')     return ['equipo', 'finanzas', 'ejecutivo', 'crm', 'admin'];
  if (role === 'director')  return ['equipo', 'finanzas', 'ejecutivo', 'crm'];
  return ['equipo'];
}

function hasViewAccess(user, view) {
  if (!user) return false;
  const views = Array.isArray(user.allowedViews) ? user.allowedViews : getDefaultViews(user.role);
  return views.includes(view);
}

function getUser(email) {
  if (!email) return null;
  const users = _load();
  const data  = users[email.toLowerCase()];
  return data ? { email: email.toLowerCase(), ...data } : null;
}

function listUsers() {
  const users = _load();
  return Object.entries(users)
    .map(([email, data]) => ({ email, ...data }))
    .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
}

function addUser(email, { role = 'consultant', name = '', addedBy = 'system' } = {}) {
  if (!email) throw new Error('Email required');
  if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const key   = email.toLowerCase().trim();
  const users = _load();
  users[key]  = { name: name || '', role, addedAt: new Date().toISOString(), addedBy };
  _save(users);
  return { email: key, ...users[key] };
}

function updateUser(email, updates) {
  const key   = email.toLowerCase();
  const users = _load();
  if (!users[key]) throw new Error(`User not found: ${email}`);
  if (updates.role && !VALID_ROLES.includes(updates.role)) throw new Error(`Invalid role: ${updates.role}`);
  users[key] = { ...users[key], ...updates };
  _save(users);
  return { email: key, ...users[key] };
}

function removeUser(email) {
  const key   = email.toLowerCase();
  const users = _load();
  delete users[key];
  _save(users);
}

const ROLE_HIERARCHY = { admin: 3, director: 2, consultant: 1 };

function canAccess(userRole, requiredRole) {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 99);
}

module.exports = { getUser, listUsers, addUser, updateUser, removeUser, canAccess, hasViewAccess, VALID_ROLES, VALID_VIEWS, getDefaultViews };
