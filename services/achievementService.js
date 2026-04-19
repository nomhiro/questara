'use strict';

const path = require('path');
const fs = require('fs');
const { compareRanks } = require('./gamificationService');

const MASTER_PATH = path.join(__dirname, '..', 'data', 'achievements.json');
let MASTER_CACHE = null;

function loadMaster() {
  if (!MASTER_CACHE) MASTER_CACHE = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  return MASTER_CACHE;
}

function satisfies(master, ctx) {
  const cond = master.condition;
  switch (cond.type) {
    case 'session-count':
      return (ctx.stats.totalSessions || 0) >= cond.value;
    case 'streak-reach':
      return (ctx.stats.streak?.current || 0) >= cond.value;
    case 'level-reach':
      return (ctx.stats.level || 1) >= cond.value;
    case 'combo-reach':
      return (ctx.session?.gamification?.maxCombo || 0) >= cond.value;
    case 'rank-reach': {
      const target = cond.value;
      return Object.values(ctx.stats.masteryRanks || {})
        .some((r) => compareRanks(r.rank, target) >= 0);
    }
    case 'dungeon-clear': {
      const certId = ctx.session?.certificationId;
      if (!certId) return false;
      const need = ctx.certDomainCounts?.[certId];
      if (!need) return false;
      const count = Object.entries(ctx.stats.masteryRanks || {})
        .filter(([k, r]) => k.startsWith(certId + ':') && compareRanks(r.rank, 'B') >= 0)
        .length;
      return count >= need;
    }
    default:
      return false;
  }
}

function evaluate(ctx) {
  const master = loadMaster();
  const already = new Set(ctx.stats.unlockedAchievements || []);
  return master.filter((m) => !already.has(m.id) && satisfies(m, ctx));
}

module.exports = { evaluate, loadMaster };
