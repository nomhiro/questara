'use strict';

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

function validateEnv() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET が未設定または短すぎます（32文字以上必要）');
  }
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    throw new Error('ENCRYPTION_KEY 環境変数が未設定または不正です（64文字の hex 文字列が必要）');
  }
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    throw new Error('GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 環境変数が設定されていません');
  }
  if (!process.env.COSMOS_ENDPOINT || !process.env.COSMOS_KEY) {
    throw new Error('COSMOS_ENDPOINT / COSMOS_KEY 環境変数が設定されていません');
  }
}

function createApp() {
  validateEnv();

  const indexRouter = require('./routes/index');
  const quizRouter = require('./routes/quiz');
  const domainsRouter = require('./routes/domains');
  const apiRouter = require('./routes/api');
  const authRouter = require('./routes/auth');
  const { authContext } = require('./middleware/auth');

  const app = express();

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

  app.use((req, res) => {
    res.status(404).render('error', { title: '404 Not Found', message: 'ページが見つかりません' });
  });

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('error', { title: 'エラー', message: err.message });
  });

  return app;
}

async function startServer() {
  const cosmosService = require('./services/cosmosService');
  const app = createApp();
  const PORT = process.env.PORT || 3000;

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
}

// 直接起動時のみ listen（テスト時は require されるだけ）
if (require.main === module) {
  startServer().catch((err) => {
    console.error('❌ Startup error:', err);
    process.exit(1);
  });
}

module.exports = { createApp, startServer };
