'use strict';

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// 起動時に必須環境変数をチェック
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET が未設定または短すぎます（32文字以上必要）');
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
if (!process.env.COSMOS_ENDPOINT || !process.env.COSMOS_KEY) {
  console.error('❌ COSMOS_ENDPOINT / COSMOS_KEY 環境変数が設定されていません');
  process.exit(1);
}

const indexRouter = require('./routes/index');
const quizRouter = require('./routes/quiz');
const domainsRouter = require('./routes/domains');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const { authContext } = require('./middleware/auth');
const cosmosService = require('./services/cosmosService');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(authContext);
app.use(express.static(path.join(__dirname, 'public')));

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

(async () => {
  try {
    await cosmosService.init();
    console.log('✅ Cosmos DB initialized');
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Cosmos DB init failed:', err);
    process.exit(1);
  }
})();

module.exports = app;
