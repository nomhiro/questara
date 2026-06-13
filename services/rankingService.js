'use strict';

const cosmosService = require('./cosmosService');
const { percentRate } = require('./scoreUtil');

function weekStart(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString();
}

function monthStart(date = new Date()) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

// ランキング掲載の最低回答数。これ未満のユーザーは集計から除外する。
// （planService.MIN_QUESTIONS_PER_WEEK は「週あたりの最低出題数」で別概念。統合しないこと）
const MIN_QUESTIONS = 10;

async function getRanking({ certificationId, since }) {
  const querySpec = certificationId
    ? {
        query: 'SELECT * FROM c WHERE c.certificationId = @certId AND c.completedAt >= @since',
        parameters: [
          { name: '@certId', value: certificationId },
          { name: '@since', value: since },
        ],
      }
    : {
        query: 'SELECT * FROM c WHERE c.completedAt >= @since',
        parameters: [{ name: '@since', value: since }],
      };
  const sessions = await cosmosService.query('sessions', querySpec);

  const agg = {};
  for (const s of sessions) {
    const key = `${s.userId}|${s.certificationId}`;
    if (!agg[key]) agg[key] = { userId: s.userId, certificationId: s.certificationId, correct: 0, total: 0, sessions: 0 };
    const correct = s.answers.filter((a) => a.isCorrect).length;
    agg[key].correct += correct;
    agg[key].total += s.answers.length;
    agg[key].sessions += 1;
  }

  const userIds = [...new Set(Object.values(agg).map((a) => a.userId))];
  const users = {};
  for (const uid of userIds) {
    const u = await cosmosService.read('users', uid, uid);
    users[uid] = u ? { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl } : null;
  }

  return Object.values(agg)
    .filter((a) => a.total >= MIN_QUESTIONS)
    .map((a) => ({
      ...a,
      rate: percentRate(a.correct, a.total),
      user: users[a.userId],
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
}

async function getWeeklyRanking(certificationId = null) {
  return getRanking({ certificationId, since: weekStart() });
}

async function getMonthlyRanking(certificationId = null) {
  return getRanking({ certificationId, since: monthStart() });
}

module.exports = { getWeeklyRanking, getMonthlyRanking, getRanking, weekStart, monthStart, MIN_QUESTIONS };
