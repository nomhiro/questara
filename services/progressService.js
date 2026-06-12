'use strict';

const crypto = require('crypto');
const cosmosService = require('./cosmosService');
const userService = require('./userService');
const gamificationService = require('./gamificationService');
const achievementService = require('./achievementService');
const questionService = require('./questionService');
const { percentRate } = require('./scoreUtil');

async function createSession({ userId, certificationId, domainFilter = null, mode = 'all' }) {
  const session = {
    id: crypto.randomUUID(),
    userId,
    certificationId,
    mode,
    domainFilter,
    startedAt: new Date().toISOString(),
    completedAt: null,
    answers: [],
    score: null,
  };
  await cosmosService.upsert('sessions', session);
  return session;
}

async function getSession(sessionId, userId) {
  if (!userId) throw new Error('getSession requires userId (partition key)');
  return cosmosService.read('sessions', sessionId, userId);
}

async function recordAnswer({ sessionId, userId, questionId, domainId, domainWeight = 0, selectedAnswer, isCorrect }) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const prevCombo = gamificationService.calcCombo(session);
  const combo = isCorrect ? prevCombo + 1 : 1;
  const xpEarned = gamificationService.calcAnswerXp({ isCorrect, combo, domainWeight });

  session.answers.push({
    questionId,
    domainId,
    selectedAnswer,
    isCorrect,
    combo,
    xpEarned,
    answeredAt: new Date().toISOString(),
  });
  await cosmosService.upsert('sessions', session);
  return { combo, xpEarned };
}

async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  // 冪等性ガード(D-18): 既に完了済みのセッションは再集計・再加算しない。
  // 結果ページ直前 URL のリロード/戻るで completeSession が再呼び出しされても
  // XP・セッション数を二重計上しないよう、保存済みの結果をそのまま返す。
  if (session.completedAt) return session;
  session.completedAt = new Date().toISOString();
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  session.score = percentRate(correct, total);

  const xpEarned = session.answers.reduce((sum, a) => sum + (a.xpEarned || 0), 0);
  const maxCombo = session.answers.reduce((m, a) => Math.max(m, a.combo || 1), 1);

  const sessionDomainAgg = {};
  for (const a of session.answers) {
    const d = a.domainId;
    sessionDomainAgg[d] = sessionDomainAgg[d] || { correct: 0, total: 0 };
    sessionDomainAgg[d].total += 1;
    if (a.isCorrect) sessionDomainAgg[d].correct += 1;
  }

  let previousLevel = 1;
  let newLevel = 1;
  let rankUpgrades = [];

  const updatedUser = await userService.updateUserStats(userId, (stats) => {
    stats.totalSessions = (stats.totalSessions || 0) + 1;
    stats.totalAnswered = (stats.totalAnswered || 0) + total;
    stats.totalCorrect = (stats.totalCorrect || 0) + correct;

    const cs = { ...(stats.certStats || {}) };
    const cur = cs[session.certificationId] || { correct: 0, answered: 0, sessionsCount: 0 };
    cur.correct += correct;
    cur.answered += total;
    cur.sessionsCount += 1;
    cur.correctRate = percentRate(cur.correct, cur.answered);
    cs[session.certificationId] = cur;
    stats.certStats = cs;

    const overall = percentRate(stats.totalCorrect, stats.totalAnswered);
    stats.weeklyCorrectRate = overall;
    stats.monthlyCorrectRate = overall;

    previousLevel = gamificationService.recomputeLevel(stats.xp || 0);
    stats.xp = (stats.xp || 0) + xpEarned;
    newLevel = gamificationService.recomputeLevel(stats.xp);
    stats.level = newLevel;

    const prevRanks = { ...(stats.masteryRanks || {}) };
    const nextRanks = { ...prevRanks };
    for (const [domainId, agg] of Object.entries(sessionDomainAgg)) {
      const key = `${session.certificationId}:${domainId}`;
      const prev = prevRanks[key] || { correct: 0, total: 0 };
      const combined = {
        correct: prev.correct + agg.correct,
        total: prev.total + agg.total,
      };
      nextRanks[key] = { ...combined, ...gamificationService.calcMasteryRank(combined) };
    }
    stats.masteryRanks = nextRanks;
    rankUpgrades = gamificationService.diffRankUpgrades(prevRanks, nextRanks);

    const todayISO = new Date().toISOString().slice(0, 10);
    stats.streak = gamificationService.updateStreak(stats.streak, todayISO);

    const questResult = gamificationService.evaluateDailyQuest({
      daily: stats.dailyQuest,
      session,
      todayISODate: todayISO,
    });
    stats.dailyQuest = {
      date: questResult.date,
      completed: questResult.completed,
      xpClaimed: questResult.xpClaimed,
    };
    stats.xp = (stats.xp || 0) + (questResult.bonus || 0);
    stats.level = gamificationService.recomputeLevel(stats.xp);
    session.__questResult = questResult; // used outside updater

    return stats;
  });

  let certDomainCounts = {};
  try {
    certDomainCounts = await questionService.getCertDomainCounts();
  } catch (err) {
    console.warn('[completeSession] getCertDomainCounts failed:', err.message);
  }

  const tentativeGamification = {
    xpEarned,
    maxCombo,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    rankUpgrades,
  };
  const ctxForAchievements = {
    stats: updatedUser?.stats || {},
    session: { ...session, gamification: tentativeGamification },
    certDomainCounts,
  };
  const newlyUnlocked = achievementService.evaluate(ctxForAchievements);

  let achievementXp = 0;
  if (newlyUnlocked.length > 0) {
    achievementXp = newlyUnlocked.reduce((sum, a) => sum + (a.xpReward || 0), 0);
    await userService.updateUserStats(userId, (s) => {
      s.unlockedAchievements = [...(s.unlockedAchievements || []), ...newlyUnlocked.map((a) => a.id)];
      s.xp = (s.xp || 0) + achievementXp;
      s.level = gamificationService.recomputeLevel(s.xp);
      return s;
    });
    // Recompute level after achievement XP so result page shows final level
    newLevel = gamificationService.recomputeLevel((updatedUser?.stats?.xp || 0) + achievementXp);
  }

  const questResult = session.__questResult || { newlyCompleted: [], bonus: 0 };
  delete session.__questResult;

  session.gamification = {
    xpEarned: xpEarned + (questResult.bonus || 0) + achievementXp,
    xpBase: xpEarned,
    xpFromDailyQuest: questResult.bonus || 0,
    xpFromAchievements: achievementXp,
    maxCombo,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    rankUpgrades,
    newAchievements: newlyUnlocked.map((a) => ({ id: a.id, name: a.name, icon: a.icon })),
    dailyQuestsNewlyCompleted: questResult.newlyCompleted || [],
  };

  // Adventure dungeon unlocks (if user has an active adventure)
  try {
    const adventureService = require('./adventureService');
    const activeAdv = await adventureService.getActiveAdventure(userId);
    if (activeAdv) {
      const masteryRanks = (updatedUser?.stats?.masteryRanks) || {};
      const next = adventureService.checkDungeonUnlocks(activeAdv, masteryRanks, certDomainCounts);
      const changed = JSON.stringify(next.dungeons) !== JSON.stringify(activeAdv.dungeons);
      if (changed) {
        await adventureService.saveAdventure(next);
        session.gamification.adventureDungeonChanges = next.dungeons
          .map((d, i) => (d.status !== activeAdv.dungeons[i]?.status ? { certificationId: d.certificationId, from: activeAdv.dungeons[i]?.status, to: d.status } : null))
          .filter(Boolean);
      }
    }
  } catch (err) {
    console.warn('[completeSession] adventure unlock check failed:', err.message);
  }

  await cosmosService.upsert('sessions', session);
  return session;
}

async function calcDomainStats(certificationId, userId) {
  const sessions = await cosmosService.query('sessions', {
    query: 'SELECT * FROM c WHERE c.userId = @userId AND c.certificationId = @certId',
    parameters: [
      { name: '@userId', value: userId },
      { name: '@certId', value: certificationId },
    ],
  }, { partitionKey: userId });

  const stats = {};
  for (const sess of sessions) {
    for (const a of sess.answers) {
      const d = a.domainId;
      if (!stats[d]) stats[d] = { correct: 0, total: 0 };
      stats[d].total += 1;
      if (a.isCorrect) stats[d].correct += 1;
    }
  }
  for (const d of Object.keys(stats)) {
    const { correct, total } = stats[d];
    stats[d].rate = percentRate(correct, total, null);
  }
  return stats;
}

async function getWrongQuestionIds(certificationId, userId) {
  const sessions = await cosmosService.query('sessions', {
    query: 'SELECT * FROM c WHERE c.userId = @userId AND c.certificationId = @certId',
    parameters: [
      { name: '@userId', value: userId },
      { name: '@certId', value: certificationId },
    ],
  }, { partitionKey: userId });

  const wrongSet = new Set();
  const correctSet = new Set();
  for (const sess of sessions) {
    for (const a of sess.answers) {
      if (a.isCorrect) correctSet.add(a.questionId);
      else wrongSet.add(a.questionId);
    }
  }
  return [...wrongSet].filter((id) => !correctSet.has(id));
}

function calcSessionDomainScores(session) {
  const scores = {};
  for (const answer of session.answers) {
    const d = answer.domainId;
    if (!scores[d]) scores[d] = { correct: 0, total: 0 };
    scores[d].total += 1;
    if (answer.isCorrect) scores[d].correct += 1;
  }
  for (const d of Object.keys(scores)) {
    const { correct, total } = scores[d];
    scores[d].rate = percentRate(correct, total, null);
  }
  return scores;
}

module.exports = {
  createSession,
  recordAnswer,
  completeSession,
  getSession,
  calcDomainStats,
  getWrongQuestionIds,
  calcSessionDomainScores,
};
