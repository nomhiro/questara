'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  res.render('index', { title: '資格取得学習エージェント', certs, userEmail: res.locals.userEmail });
});

router.get('/certifications/:certId', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });
  const domainStats = await progressService.calcDomainStats(cert.id, req.user.id);
  const wrongIds = await progressService.getWrongQuestionIds(cert.id, req.user.id);
  res.render('certification', {
    title: cert.name,
    cert,
    domainStats,
    wrongCount: wrongIds.length,
    info: req.query.info || null,
    userEmail: res.locals.userEmail,
  });
});

module.exports = router;
