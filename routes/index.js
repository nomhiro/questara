'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

// ホーム: 資格一覧
router.get('/', requireAuth, (req, res) => {
  const certs = questionService.listCertifications();
  res.render('index', { title: '資格取得学習エージェント', certs, userEmail: req.session.userEmail });
});

// 資格詳細: ドメイン別正答率
router.get('/certifications/:certId', requireAuth, (req, res) => {
  const cert = questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });

  const domainStats = progressService.calcDomainStats(cert.id, req.session.userId);
  const wrongIds = progressService.getWrongQuestionIds(cert.id, req.session.userId);

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
    userEmail: req.session.userEmail,
  });
});

module.exports = router;
