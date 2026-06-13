'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/:certId/domains/:domainId', requireAuth, asyncHandler(async (req, res) => {
  const { certId, domainId } = req.params;
  const cert = await questionService.readCertification(certId);
  if (!cert || !questionService.canAccessCertification(cert, req.user.id)) {
    return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });
  }

  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).render('error', { title: '404', message: 'ドメインが見つかりません' });

  const domainStats = await progressService.calcDomainStats(certId, req.user.id);
  const stats = domainStats[domainId] || { correct: 0, total: 0, rate: null };

  res.render('domain', {
    title: domain.name,
    cert,
    domain,
    stats,
    generateStatus: req.query.status || null,
  });
}));

module.exports = router;
