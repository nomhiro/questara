'use strict';

const userService = require('../services/userService');
const gamificationService = require('../services/gamificationService');

async function heroHudMiddleware(req, res, next) {
  if (!req.user) return next();
  try {
    const user = await userService.getUserById(req.user.id);
    if (user) {
      const stats = user.stats || {};
      const xpBreak = gamificationService.xpBreakdown(stats.xp || 0);
      res.locals.heroHud = {
        userName: user.displayName || user.username || 'NoName',
        level: stats.level || 1,
        xp: stats.xp || 0,
        xpIntoLevel: xpBreak.xpIntoLevel,
        xpForLevel: xpBreak.xpForLevel,
        streakCurrent: stats.streak?.current || 0,
        achievementsCount: (stats.unlockedAchievements || []).length,
      };
    }
  } catch (err) {
    console.warn('[heroHud]', err.message);
  }
  next();
}

module.exports = { heroHudMiddleware };
