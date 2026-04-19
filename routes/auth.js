'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const userService = require('../services/userService');
const jwtService = require('../services/jwtService');

router.get('/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.render('error', { title: 'GitHub OAuth 未設定', message: 'GITHUB_CLIENT_ID が設定されていません' });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'read:user user:email',
    state: crypto.randomUUID(),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('GitHub からアクセストークンを取得できませんでした');

    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'cert-study-agent' },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'cert-study-agent' },
      }),
    ]);
    const githubUser = await userRes.json();
    const emails = await emailsRes.json();
    const primaryEmail = Array.isArray(emails)
      ? (emails.find((e) => e.primary && e.verified)?.email || emails[0]?.email)
      : null;

    const user = await userService.upsertGithubUser({
      githubId: githubUser.id,
      githubLogin: githubUser.login,
      email: primaryEmail,
      displayName: githubUser.name,
      avatarUrl: githubUser.avatar_url,
      accessToken,
    });

    const token = jwtService.sign({
      userId: user.id,
      email: user.email,
      username: user.username,
    });
    res.cookie(jwtService.COOKIE_NAME, token, jwtService.getCookieOptions());
    res.redirect('/adventure');
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    const key = err.message?.includes('アクセストークン') ? 'token_failed' : 'auth_failed';
    res.redirect(`/?error=${key}`);
  }
});

router.get('/login', (req, res) => {
  res.redirect(301, '/');
});

router.post('/logout', (req, res) => {
  res.clearCookie(jwtService.COOKIE_NAME, jwtService.getClearCookieOptions());
  res.redirect('/');
});

module.exports = router;
