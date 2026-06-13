'use strict';

const userService = require('../services/userService');
const gamificationService = require('../services/gamificationService');

// リクエストパスから現在地（ナビのアクティブタブ）を判定する。
// hud.ejs が res.locals.activeNav を参照して該当タブをハイライトする。
function resolveActiveNav(p) {
  if (p.startsWith('/home')) return 'home';
  if (p.startsWith('/my/profile')) return 'status';
  if (p.startsWith('/certifications') || p.startsWith('/my/certifications')) return 'certs';
  if (p.startsWith('/ranking')) return 'ranking';
  if (p.startsWith('/plans')) return 'plans';
  return null;
}

async function heroHudMiddleware(req, res, next) {
  res.locals.activeNav = resolveActiveNav(req.path || '');
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
