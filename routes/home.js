'use strict';

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const questionService = require('../services/questionService');
const gamificationService = require('../services/gamificationService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

// ログイン後の着地点となるダッシュボード。
// 学習中（お気に入り）の資格・進捗サマリ・主要導線を1画面に集約する。
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = await userService.getUserById(userId);
  const stats = user?.stats || {};

  const favorites = await questionService.listCertificationsByIds(stats.favoriteCertifications || [], userId);
  const passedIds = new Set((stats.passedCertifications || []).map((p) => p.certId));
  const certStats = stats.certStats || {};

  // 資格別正答率（certStats）を付与。重いドメイン集計は資格詳細画面に委ねる。
  const learningCerts = favorites.map((c) => ({
    ...c,
    correctRate: certStats[c.id]?.correctRate ?? null,
    passed: passedIds.has(c.id),
  }));

  res.render('home', {
    title: 'ホーム',
    userName: user?.displayName || user?.username || 'NoName',
    heroStats: gamificationService.buildHudStats(stats),
    learningCerts,
    userEmail: res.locals.userEmail,
  });
}));

module.exports = router;
