'use strict';

const jwt = require('jsonwebtoken');

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return secret;
}

function sign({ userId, email, username }) {
  return jwt.sign(
    { sub: userId, email, username },
    getSecret(),
    { expiresIn: SEVEN_DAYS_SEC }
  );
}

function verify(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SEVEN_DAYS_SEC * 1000,
  };
}

/**
 * res.clearCookie 用のオプション（maxAge は含めない）
 */
function getClearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  };
}

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'cert_quiz_session';

module.exports = { sign, verify, getCookieOptions, getClearCookieOptions, COOKIE_NAME, SEVEN_DAYS_SEC };
