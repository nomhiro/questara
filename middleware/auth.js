'use strict';

const jwtService = require('../services/jwtService');

function authContext(req, res, next) {
  const token = req.cookies?.[jwtService.COOKIE_NAME];
  if (token) {
    const payload = jwtService.verify(token);
    if (payload) {
      req.user = { id: payload.sub, email: payload.email, username: payload.username };
      res.locals.userEmail = payload.email || payload.username;
    }
  }
  if (!res.locals.userEmail) res.locals.userEmail = null;
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  res.redirect('/auth/login');
}

module.exports = { authContext, requireAuth };
