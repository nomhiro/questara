'use strict';

const express = require('express');
const router = express.Router();
const rankingService = require('../services/rankingService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { period = 'weekly', certId = '' } = req.query;
  const ranking = period === 'monthly'
    ? await rankingService.getMonthlyRanking(certId || null)
    : await rankingService.getWeeklyRanking(certId || null);
  const allCerts = await questionService.listCertifications({ includePrivate: false });
  res.render('ranking', {
    title: 'ランキング',
    ranking, period, certId, allCerts,
    userEmail: res.locals.userEmail,
  });
}));

module.exports = router;
