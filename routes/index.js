'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const adventureService = require('../services/adventureService');
const achievementService = require('../services/achievementService');
const gamificationService = require('../services/gamificationService');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};

  const activeAdventure = stats.activeAdventureId
    ? await adventureService.getAdventure(stats.activeAdventureId, req.user.id)
    : null;

  if (!activeAdventure) {
    return res.redirect('/adventures/new');
  }

  // dungeons に対応する cert を fully（domains 付き）で取得
  const certEntries = await Promise.all(
    activeAdventure.dungeons.map(async (d) => {
      const c = await questionService.readCertification(d.certificationId);
      return c ? [c.id, c] : null;
    })
  );
  const certById = Object.fromEntries(certEntries.filter(Boolean));

  const masteryRanks = stats.masteryRanks || {};
  const achievementsMaster = achievementService.loadMaster();
  const unlocked = new Set(stats.unlockedAchievements || []);
  const recentAchievements = achievementsMaster.filter((a) => unlocked.has(a.id)).slice(-3).reverse();

  const dailyQuest = stats.dailyQuest || { date: null, completed: [], xpClaimed: 0 };

  res.render('adventure-map', {
    title: '冒険の道',
    userEmail: res.locals.userEmail,
    adventure: activeAdventure,
    certById,
    stats,
    masteryRanks,
    recentAchievements,
    dailyQuest,
  });
});

router.get('/adventure', requireAuth, async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};

  const activeAdventure = stats.activeAdventureId
    ? await adventureService.getAdventure(stats.activeAdventureId, req.user.id)
    : null;

  if (!activeAdventure) {
    return res.redirect('/adventures/new');
  }

  const certEntries = await Promise.all(
    activeAdventure.dungeons.map(async (d) => {
      const c = await questionService.readCertification(d.certificationId);
      return c ? [c.id, c] : null;
    })
  );
  const certById = Object.fromEntries(certEntries.filter(Boolean));

  const masteryRanks = stats.masteryRanks || {};
  const achievementsMaster = achievementService.loadMaster();
  const unlocked = new Set(stats.unlockedAchievements || []);
  const recentAchievements = achievementsMaster.filter((a) => unlocked.has(a.id)).slice(-3).reverse();

  const dailyQuest = stats.dailyQuest || { date: null, completed: [], xpClaimed: 0 };

  res.render('adventure-map', {
    title: '冒険の道',
    userEmail: res.locals.userEmail,
    adventure: activeAdventure,
    certById,
    stats,
    masteryRanks,
    recentAchievements,
    dailyQuest,
  });
});

// 旧ホーム（公開資格一覧）を自由モードとして残す
router.get('/free-mode', requireAuth, async (req, res) => {
  const publicCerts = await questionService.listCertifications({ includePrivate: false });
  const allForUser = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const myCerts = allForUser.filter((c) => c.createdBy === req.user.id && !c.isPublic);
  res.render('index', {
    title: '自由モード - 資格一覧',
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

  const user = await userService.getUserById(req.user.id);
  const rawStats = user?.stats || {};
  const xpBreak = gamificationService.xpBreakdown(rawStats.xp || 0);
  const hudUserName = user?.displayName || user?.username || 'NoName';
  const hudStats = { ...rawStats, ...xpBreak };
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
  });
});

module.exports = router;
