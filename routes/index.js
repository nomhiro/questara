'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');

// ホーム: 資格一覧
router.get('/', (req, res) => {
  const certs = questionService.listCertifications();
  res.render('index', { title: '資格取得学習エージェント', certs });
});

// 資格詳細: ドメイン別正答率
router.get('/certifications/:certId', (req, res) => {
  const cert = questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });

  const domainStats = progressService.calcDomainStats(cert.id);
  const wrongIds = progressService.getWrongQuestionIds(cert.id);

  const domainsWithStats = cert.domains.map((d) => ({
    ...d,
    stats: domainStats[d.id] || { correct: 0, total: 0, rate: null },
    questionCount: d.questions.length,
  }));

  res.render('certification', {
    title: cert.name,
    cert,
    domains: domainsWithStats,
    wrongCount: wrongIds.length,
    totalQuestions: cert.domains.reduce((acc, d) => acc + d.questions.length, 0),
  });
});

module.exports = router;
