'use strict';

const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

// 起動時に必須環境変数をチェック
if (!process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET 環境変数が設定されていません');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  console.error('❌ ENCRYPTION_KEY 環境変数が未設定または不正です（64文字の hex 文字列が必要）');
  process.exit(1);
}
if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
  console.error('❌ GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 環境変数が設定されていません');
  console.error('   https://github.com/settings/developers で OAuth App を作成してください');
  console.error('   Callback URL: http://localhost:3000/auth/github/callback');
  process.exit(1);
}

const indexRouter = require('./routes/index');
const quizRouter = require('./routes/quiz');
const domainsRouter = require('./routes/domains');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7日
  },
}));

// セッション情報を全テンプレートで参照可能にする
app.use((req, res, next) => {
  res.locals.userEmail = req.session.userEmail || null;
  next();
});

app.use('/auth', authRouter);
app.use('/', indexRouter);
app.use('/quiz', quizRouter);
app.use('/certifications', domainsRouter);
app.use('/api', apiRouter);

// 404 ハンドラー
app.use((req, res) => {
  res.status(404).render('error', { title: '404 Not Found', message: 'ページが見つかりません' });
});

// エラーハンドラー
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { title: 'エラー', message: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

module.exports = app;

