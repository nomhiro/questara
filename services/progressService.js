'use strict';

const { getDb } = require('./dbService');

function createSession({ userId, certificationId, domainFilter = null, mode = 'all' }) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO quiz_sessions (id, user_id, certification_id, mode, domain_filter, started_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, userId, certificationId, mode, domainFilter);
  return { id, userId, certificationId, domainFilter, mode, answers: [] };
}

function recordAnswer({ sessionId, questionId, domainId, selectedAnswer, isCorrect }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO session_answers (session_id, question_id, domain_id, selected_answer, is_correct)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, questionId, domainId, selectedAnswer, isCorrect ? 1 : 0);
}

function completeSession(sessionId) {
  const db = getDb();
  db.prepare(`UPDATE quiz_sessions SET completed_at = datetime('now') WHERE id = ?`).run(sessionId);
  return getSession(sessionId);
}

function getSession(sessionId) {
  const db = getDb();
  const session = db.prepare('SELECT * FROM quiz_sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  const answers = db.prepare('SELECT * FROM session_answers WHERE session_id = ? ORDER BY id').all(sessionId);
  return {
    id: session.id,
    userId: session.user_id,
    certificationId: session.certification_id,
    domainFilter: session.domain_filter,
    mode: session.mode,
    startedAt: session.started_at,
    completedAt: session.completed_at,
    answers: answers.map((a) => ({
      questionId: a.question_id,
      domainId: a.domain_id,
      selectedAnswer: a.selected_answer,
      isCorrect: a.is_correct === 1,
      answeredAt: a.answered_at,
    })),
  };
}

/**
 * 資格ごとのドメイン別累積正答率を計算する（ユーザー別）
 */
function calcDomainStats(certificationId, userId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sa.domain_id, sa.is_correct
    FROM session_answers sa
    JOIN quiz_sessions qs ON sa.session_id = qs.id
    WHERE qs.certification_id = ? AND qs.user_id = ?
  `).all(certificationId, userId);

  const stats = {};
  for (const row of rows) {
    const d = row.domain_id;
    if (!stats[d]) stats[d] = { correct: 0, total: 0 };
    stats[d].total += 1;
    if (row.is_correct) stats[d].correct += 1;
  }
  for (const d of Object.keys(stats)) {
    const { correct, total } = stats[d];
    stats[d].rate = total > 0 ? Math.round((correct / total) * 100) : null;
  }
  return stats;
}

/**
 * 間違えた問題IDリストを返す（ユーザー別、一度でも正解した問題は除外）
 */
function getWrongQuestionIds(certificationId, userId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sa.question_id, sa.is_correct
    FROM session_answers sa
    JOIN quiz_sessions qs ON sa.session_id = qs.id
    WHERE qs.certification_id = ? AND qs.user_id = ?
  `).all(certificationId, userId);

  const wrongSet = new Set();
  const correctSet = new Set();
  for (const row of rows) {
    if (row.is_correct) correctSet.add(row.question_id);
    else wrongSet.add(row.question_id);
  }
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

