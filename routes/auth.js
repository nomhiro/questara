'use strict';

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');

const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';
const GITHUB_MODELS_DEFAULT_MODEL = 'gpt-4o-mini';

// ─── GitHub OAuth ────────────────────────────────────────

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
  if (!code) return res.redirect('/auth/login');

  try {
    // code → access token
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

    // ユーザー情報取得
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

    // ユーザー作成または更新
    const user = userService.upsertGithubUser({
      githubId: githubUser.id,
      githubLogin: githubUser.login,
      email: primaryEmail,
    });

    // GitHub Models を llm_config に自動設定（未設定のみ）
    if (!userService.hasLlmConfig(user.id)) {
      userService.saveLlmConfig(user.id, {
        endpointUrl: GITHUB_MODELS_ENDPOINT,
        apiKey: accessToken,
        modelName: GITHUB_MODELS_DEFAULT_MODEL,
      });
    } else {
      // 既存ユーザーのトークンを更新（有効期限のないトークンだが念のため）
      const existing = userService.getLlmConfig(user.id);
      if (existing && existing.endpointUrl === GITHUB_MODELS_ENDPOINT) {
        userService.saveLlmConfig(user.id, {
          endpointUrl: GITHUB_MODELS_ENDPOINT,
          apiKey: accessToken,
          modelName: existing.modelName,
        });
      }
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email || user.githubLogin;
    res.redirect('/');
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.render('error', { title: 'GitHub ログインエラー', message: err.message });
  }
});

// ─── Email/Password ───────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { title: 'ログイン', error: null, githubEnabled: !!process.env.GITHUB_CLIENT_ID });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { title: 'ログイン', error: 'メールアドレスとパスワードを入力してください', githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }

  const user = userService.verifyUser(email, password);
  if (!user) {
    return res.render('login', { title: 'ログイン', error: 'メールアドレスまたはパスワードが正しくありません', githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }

  req.session.userId = user.id;
  req.session.userEmail = user.email;
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { title: 'アカウント登録', error: null, githubEnabled: !!process.env.GITHUB_CLIENT_ID });
});

router.post('/register', (req, res) => {
  const { email, password, passwordConfirm } = req.body;

  if (!email || !password) {
    return res.render('register', { title: 'アカウント登録', error: 'メールアドレスとパスワードを入力してください', githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('register', { title: 'アカウント登録', error: '有効なメールアドレスを入力してください', githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }
  if (password.length < 8) {
    return res.render('register', { title: 'アカウント登録', error: 'パスワードは8文字以上で入力してください', githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }
  if (password !== passwordConfirm) {
    return res.render('register', { title: 'アカウント登録', error: 'パスワードが一致しません', githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }

  try {
    const user = userService.createUser(email, password);
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.redirect('/settings?welcome=1');
  } catch (err) {
    res.render('register', { title: 'アカウント登録', error: err.message, githubEnabled: !!process.env.GITHUB_CLIENT_ID });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
