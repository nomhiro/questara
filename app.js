'use strict';

const express = require('express');
const path = require('path');

const indexRouter = require('./routes/index');
const quizRouter = require('./routes/quiz');
const domainsRouter = require('./routes/domains');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

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
