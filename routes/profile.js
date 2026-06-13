'use strict';

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const achievementService = require('../services/achievementService');
const gamificationService = require('../services/gamificationService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};
  const master = achievementService.loadMaster();
  const unlocked = new Set(stats.unlockedAchievements || []);

  const passedRaw = stats.passedCertifications || [];
  const passedSummaries = await questionService.listCertificationsByIds(passedRaw.map((p) => p.certId), req.user.id);
  const nameById = Object.fromEntries(passedSummaries.map((s) => [s.id, s.name]));
  const passedCerts = passedRaw
    .filter((p) => nameById[p.certId])
    .map((p) => ({ name: nameById[p.certId], passedAt: p.passedAt.slice(0, 10) }))
    .sort((a, b) => b.passedAt.localeCompare(a.passedAt));

  res.render('profile', {
    title: '勇者プロフィール',
    userEmail: res.locals.userEmail,
    profileUser: {
      name: user?.displayName || user?.username || 'NoName',
      avatarUrl: user?.avatarUrl || null,
    },
    stats: gamificationService.buildHudStats(stats),
    achievementsMaster: master,
    unlocked,
    passedCerts,
  });
}));

module.exports = router;
