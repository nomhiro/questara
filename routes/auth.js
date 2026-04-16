'use strict';

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');

// ログイン画面
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { title: 'ログイン', error: null });
});

// ログイン処理
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { title: 'ログイン', error: 'メールアドレスとパスワードを入力してください' });
  }

  const user = userService.verifyUser(email, password);
  if (!user) {
    return res.render('login', { title: 'ログイン', error: 'メールアドレスまたはパスワードが正しくありません' });
  }

  req.session.userId = user.id;
  req.session.userEmail = user.email;
  res.redirect('/');
});

// 登録画面
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { title: 'アカウント登録', error: null });
});

// 登録処理
router.post('/register', (req, res) => {
  const { email, password, passwordConfirm } = req.body;

  if (!email || !password) {
    return res.render('register', { title: 'アカウント登録', error: 'メールアドレスとパスワードを入力してください' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('register', { title: 'アカウント登録', error: '有効なメールアドレスを入力してください' });
  }
  if (password.length < 8) {
    return res.render('register', { title: 'アカウント登録', error: 'パスワードは8文字以上で入力してください' });
  }
  if (password !== passwordConfirm) {
    return res.render('register', { title: 'アカウント登録', error: 'パスワードが一致しません' });
  }

  try {
    const user = userService.createUser(email, password);
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.redirect('/settings?welcome=1');
  } catch (err) {
    res.render('register', { title: 'アカウント登録', error: err.message });
  }
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
