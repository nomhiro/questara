'use strict';

function calcAnswerXp({ isCorrect, combo, domainWeight = 0 }) {
  const baseXp = isCorrect ? 10 : 2;
  const weightBonus = Math.floor((domainWeight || 0) / 10);
  const effectiveCombo = isCorrect ? combo : 1;
  const multiplier = Math.min(1.0 + 0.1 * (effectiveCombo - 1), 2.0);
  return Math.round(baseXp * multiplier) + weightBonus;
}

function xpRequiredForLevelUp(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function recomputeLevel(xp) {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpRequiredForLevelUp(level)) {
    remaining -= xpRequiredForLevelUp(level);
    level += 1;
  }
  return level;
}

function xpBreakdown(xp) {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpRequiredForLevelUp(level)) {
    remaining -= xpRequiredForLevelUp(level);
    level += 1;
  }
  return {
    currentLevel: level,
    xpIntoLevel: remaining,
    xpForLevel: xpRequiredForLevelUp(level),
  };
}

/**
 * HUD/詳細表示用に「生 stats + XP 内訳」をマージしたオブジェクトを返す (D-07)。
 * index/quiz/profile の各ルートで重複していた `{ ...stats, ...xpBreakdown(stats.xp) }` を集約。
 */
function buildHudStats(rawStats = {}) {
  return { ...rawStats, ...xpBreakdown(rawStats.xp || 0) };
}

function calcCombo(session) {
  const answers = session?.answers || [];
  if (answers.length === 0) return 1;
  let count = 0;
  for (let i = answers.length - 1; i >= 0; i -= 1) {
    if (answers[i].isCorrect) count += 1;
    else break;
  }
  return Math.max(count, 1);
}

function calcMasteryRank({ correct, total }) {
  if (!total) return { rank: '未挑戦', rate: null, scoreIndex: 0, correct: correct || 0, total: 0 };
  const rate = (correct / total) * 100;
  const scoreIndex = rate * Math.min(total / 30, 1.0);
  let rank;
  if (scoreIndex >= 95 && total >= 50) rank = 'SS';
  else if (scoreIndex >= 85 && total >= 30) rank = 'S';
  else if (scoreIndex >= 75) rank = 'A';
  else if (scoreIndex >= 60) rank = 'B';
  else if (scoreIndex >= 40) rank = 'C';
  else rank = 'D';
  return { rank, rate: Math.round(rate), scoreIndex, correct, total };
}

const RANK_ORDER = ['未挑戦', 'D', 'C', 'B', 'A', 'S', 'SS'];

function compareRanks(a, b) {
  return Math.sign(RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b));
}

function diffRankUpgrades(before, after) {
  const results = [];
  for (const key of Object.keys(after)) {
    const from = before[key]?.rank || '未挑戦';
    const to = after[key].rank;
    if (compareRanks(to, from) > 0) results.push({ key, from, to });
  }
  return results;
}

function daysBetween(dateAISODate, dateBISODate) {
  const a = new Date(dateAISODate + 'T00:00:00Z');
  const b = new Date(dateBISODate + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function updateStreak(streak, todayISODate) {
  const current = streak?.current || 0;
  const longest = streak?.longest || 0;
  const last = streak?.lastStudyDate;
  let freeze = !!streak?.freeze;

  if (!last) {
    const next = 1;
    return {
      current: next,
      longest: Math.max(longest, next),
      lastStudyDate: todayISODate,
      freeze: next >= 7 ? true : freeze,
    };
  }

  const diff = daysBetween(last, todayISODate);
  let nextCount;
  if (diff === 0) {
    nextCount = current;
  } else if (diff === 1) {
    nextCount = current + 1;
  } else if (diff === 2 && freeze) {
    nextCount = current + 1;
    freeze = false;
  } else {
    nextCount = 1;
  }

  if (nextCount >= 7 && !freeze) freeze = true;

  return {
    current: nextCount,
    longest: Math.max(longest, nextCount),
    lastStudyDate: todayISODate,
    freeze,
  };
}

const DAILY_QUEST_REWARDS = {
  'daily-5q':        { xp: 50, name: '今日5問解く' },
  'daily-domain-80': { xp: 80, name: '1ドメインで正答率80%以上' },
  'daily-session':   { xp: 30, name: '1セッション完了' },
};

function evaluateDailyQuest({ daily, session, todayISODate }) {
  const base = (daily && daily.date === todayISODate)
    ? { date: daily.date, completed: [...(daily.completed || [])], xpClaimed: daily.xpClaimed || 0 }
    : { date: todayISODate, completed: [], xpClaimed: 0 };

  const completedSet = new Set(base.completed);
  const newlyCompleted = [];

  if (!completedSet.has('daily-session')) {
    completedSet.add('daily-session');
    newlyCompleted.push('daily-session');
  }

  const correctCount = (session?.answers || []).filter((a) => a.isCorrect).length;
  if (correctCount >= 5 && !completedSet.has('daily-5q')) {
    completedSet.add('daily-5q');
    newlyCompleted.push('daily-5q');
  }

  const byDomain = {};
  for (const a of session?.answers || []) {
    byDomain[a.domainId] = byDomain[a.domainId] || { c: 0, t: 0 };
    byDomain[a.domainId].t += 1;
    if (a.isCorrect) byDomain[a.domainId].c += 1;
  }
  const hit80 = Object.values(byDomain).some((x) => x.t > 0 && (x.c / x.t) >= 0.8);
  if (hit80 && !completedSet.has('daily-domain-80')) {
    completedSet.add('daily-domain-80');
    newlyCompleted.push('daily-domain-80');
  }

  const bonus = newlyCompleted.reduce((sum, id) => sum + (DAILY_QUEST_REWARDS[id]?.xp || 0), 0);

  return {
    date: todayISODate,
    completed: [...completedSet],
    xpClaimed: base.xpClaimed + bonus,
    newlyCompleted,
    bonus,
  };
}

module.exports = {
  calcAnswerXp,
  xpRequiredForLevelUp,
  recomputeLevel,
  xpBreakdown,
  buildHudStats,
  calcCombo,
  calcMasteryRank,
  compareRanks,
  diffRankUpgrades,
  RANK_ORDER,
  updateStreak,
  evaluateDailyQuest,
  DAILY_QUEST_REWARDS,
};
