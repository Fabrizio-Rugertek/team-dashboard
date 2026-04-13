'use strict';
/**
 * Passport.js configuration — Google OAuth 2.0.
 * Env vars required:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_CALLBACK_URL   (default: http://localhost:3511/auth/google/callback)
 *   SESSION_SECRET        (required in production)
 */

const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getUser }    = require('./users');

const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3511/auth/google/callback';

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL,
  },
  (_accessToken, _refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) return done(null, false, { message: 'No email in Google profile' });

    const user = getUser(email);
    if (!user) {
      console.warn(`[Auth] Unauthorized login attempt: ${email}`);
      return done(null, false, { message: 'not_authorized' });
    }

    const sessionUser = {
      email,
      name:    profile.displayName || user.name || email,
      picture: profile.photos?.[0]?.value || null,
      role:    user.role,
    };
    console.log(`[Auth] Login: ${email} (${user.role})`);
    return done(null, sessionUser);
  }
));

passport.serializeUser((user, done) => done(null, user.email));

passport.deserializeUser((email, done) => {
  const stored = getUser(email);
  if (!stored) return done(null, false); // user was removed
  done(null, { email, name: stored.name, picture: null, role: stored.role });
});

module.exports = passport;
