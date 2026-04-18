'use strict';

const crypto = require('crypto');
const cosmosService = require('./cosmosService');

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
  if (!userId) {
    // userIdが分からない場合は全パーティション検索（非効率、回避推奨）
    const results = await cosmosService.query('sessions', {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: sessionId }],
    });
    return results[0] || null;
  }
  return cosmosService.read('sessions', sessionId, userId);
}

async function recordAnswer({ sessionId, userId, questionId, domainId, selectedAnswer, isCorrect }) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.answers.push({
    questionId,
    domainId,
    selectedAnswer,
    isCorrect,
    answeredAt: new Date().toISOString(),
  });
  await cosmosService.upsert('sessions', session);
}

async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.completedAt = new Date().toISOString();
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  session.score = total > 0 ? Math.round((correct / total) * 100) : 0;
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
    stats[d].rate = total > 0 ? Math.round((correct / total) * 100) : null;
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
    scores[d].rate = total > 0 ? Math.round((correct / total) * 100) : null;
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
