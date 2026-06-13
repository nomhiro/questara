'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const gamificationService = require('../services/gamificationService');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/', (req, res) => {
  const errorKey = typeof req.query.error === 'string' ? req.query.error : null;
  const errorMessage = mapAuthError(errorKey);
  res.render('landing', {
    userEmail: res.locals.userEmail,
    errorMessage,
  });
});

function mapAuthError(key) {
  switch (key) {
    case 'auth_failed': return 'GitHub の認可に失敗しました。もう一度お試しください。';
    case 'no_code': return 'GitHub からの応答が不完全でした。もう一度ログインしてください。';
    case 'token_failed': return 'アクセストークンの取得に失敗しました。時間を置いて再度お試しください。';
    default: return null;
  }
}

// 公開資格＋自作資格の一覧（マイ資格からの導線先）
router.get('/free-mode', requireAuth, asyncHandler(async (req, res) => {
  const publicCerts = await questionService.listCertifications({ includePrivate: false });
  const allForUser = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const myCerts = allForUser.filter((c) => c.createdBy === req.user.id && !c.isPublic);
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};
  res.render('index', {
    title: '資格一覧',
    publicCerts,
    myCerts,
    favoriteIds: new Set(stats.favoriteCertifications || []),
    passedIds: new Set((stats.passedCertifications || []).map((p) => p.certId)),
    userEmail: res.locals.userEmail,
  });
}));

router.get('/certifications/:certId', requireAuth, asyncHandler(async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert || !questionService.canAccessCertification(cert, req.user.id)) {
    return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });
  }
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

  const user = await userService.getUserById(req.user.id);
  const rawStats = user?.stats || {};
  const isFavorite = (rawStats.favoriteCertifications || []).includes(cert.id);
  const isPassed = (rawStats.passedCertifications || []).some((p) => p.certId === cert.id);
  const hudUserName = user?.displayName || user?.username || 'NoName';
  const hudStats = gamificationService.buildHudStats(rawStats);
  const masteryRanks = rawStats.masteryRanks || {};

  res.render('certification', {
    title: cert.name,
    cert,
    domains,
    totalQuestions,
    wrongCount: wrongIds.length,
    info: req.query.info || null,
    userEmail: res.locals.userEmail,
    userName: hudUserName,
    hudStats,
    masteryRanks,
    isFavorite,
    isPassed,
  });
}));

module.exports = router;
