'use strict';

const fs = require('fs');
const path = require('path');

const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'progress.json');

function readProgress() {
  const raw = fs.readFileSync(PROGRESS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function createSession({ certificationId, domainFilter = null, mode = 'all' }) {
  const data = readProgress();
  const session = {
    id: crypto.randomUUID(),
    certificationId,
    domainFilter,
    mode,
    startedAt: new Date().toISOString(),
    completedAt: null,
    answers: [],
  };
  data.sessions.push(session);
  writeProgress(data);
  return session;
}

function recordAnswer({ sessionId, questionId, domainId, selectedAnswer, isCorrect }) {
  const data = readProgress();
  const session = data.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.answers.push({
    questionId,
    domainId,
    selectedAnswer,
    isCorrect,
    answeredAt: new Date().toISOString(),
  });
  writeProgress(data);
}

function completeSession(sessionId) {
  const data = readProgress();
  const session = data.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.completedAt = new Date().toISOString();
  writeProgress(data);
  return session;
}

function getSession(sessionId) {
  const { sessions } = readProgress();
  return sessions.find((s) => s.id === sessionId) || null;
}

/**
 * 資格ごとのドメイン別累積正答率を計算する
 * @returns {{ [domainId]: { correct: number, total: number, rate: number } }}
 */
function calcDomainStats(certificationId) {
  const { sessions } = readProgress();
  const stats = {};
  for (const session of sessions) {
    if (session.certificationId !== certificationId) continue;
    for (const answer of session.answers) {
      const d = answer.domainId;
      if (!stats[d]) stats[d] = { correct: 0, total: 0 };
      stats[d].total += 1;
      if (answer.isCorrect) stats[d].correct += 1;
    }
  }
  for (const d of Object.keys(stats)) {
    const { correct, total } = stats[d];
    stats[d].rate = total > 0 ? Math.round((correct / total) * 100) : null;
  }
  return stats;
}

/**
 * 間違えた問題IDリストを返す
 */
function getWrongQuestionIds(certificationId) {
  const { sessions } = readProgress();
  const wrongSet = new Set();
  const correctSet = new Set();
  for (const session of sessions) {
    if (session.certificationId !== certificationId) continue;
    for (const answer of session.answers) {
      if (answer.isCorrect) correctSet.add(answer.questionId);
      else wrongSet.add(answer.questionId);
    }
  }
  // 一度でも正解した問題は除外
  return [...wrongSet].filter((id) => !correctSet.has(id));
}

/**
 * セッション内のドメイン別スコアを返す
 */
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
