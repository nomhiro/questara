'use strict';

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const achievementService = require('../services/achievementService');
const gamificationService = require('../services/gamificationService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};
  const xpBreak = gamificationService.xpBreakdown(stats.xp || 0);
  const master = achievementService.loadMaster();
  const unlocked = new Set(stats.unlockedAchievements || []);

  res.render('profile', {
    title: '勇者プロフィール',
    userEmail: res.locals.userEmail,
    profileUser: {
      name: user?.displayName || user?.username || 'NoName',
      avatarUrl: user?.avatarUrl || null,
    },
    stats: { ...stats, ...xpBreak },
    achievementsMaster: master,
    unlocked,
  });
});

module.exports = router;
