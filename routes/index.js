'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const publicCerts = await questionService.listCertifications({ includePrivate: false });
  const allForUser = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const myCerts = allForUser.filter((c) => c.createdBy === req.user.id && !c.isPublic);
  res.render('index', {
    title: '資格取得学習エージェント',
    publicCerts,
    myCerts,
    userEmail: res.locals.userEmail,
  });
});

router.get('/certifications/:certId', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });
  const domainStats = await progressService.calcDomainStats(cert.id, req.user.id);
  const wrongIds = await progressService.getWrongQuestionIds(cert.id, req.user.id);

  const domains = cert.domains.map((d) => ({
    id: d.id,
    name: d.name,
    weight: d.weight,
    generatedAt: d.generatedAt,
    questionCount: d.questions.length,
    stats: domainStats[d.id] || { correct: 0, total: 0, rate: null },
  }));
  const totalQuestions = cert.domains.reduce((acc, d) => acc + d.questions.length, 0);

  res.render('certification', {
    title: cert.name,
    cert,
    domains,
    totalQuestions,
    wrongCount: wrongIds.length,
    info: req.query.info || null,
    userEmail: res.locals.userEmail,
  });
});

module.exports = router;
