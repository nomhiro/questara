'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

router.post('/start', requireAuth, async (req, res) => {
  const { certId, mode, domainId } = req.body;
  const userId = req.user.id;
  const cert = await questionService.readCertification(certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });

  let questions;
  let domainFilter = null;

  if (mode === 'wrong-only') {
    const wrongIds = await progressService.getWrongQuestionIds(certId, userId);
    if (wrongIds.length === 0) return res.redirect(`/certifications/${certId}?info=no-wrong`);
    questions = await questionService.getQuestionsByIds(certId, wrongIds);
  } else if (mode === 'domain' && domainId) {
    questions = await questionService.getQuestionsByDomain(certId, domainId);
    domainFilter = domainId;
  } else {
    questions = await questionService.getAllQuestions(certId);
  }

  if (questions.length === 0) return res.redirect(`/certifications/${certId}?info=no-questions`);

  questions.sort(() => Math.random() - 0.5);
  const session = await progressService.createSession({ userId, certificationId: certId, domainFilter, mode });
  const questionIds = questions.map((q) => q.id).join(',');
  res.redirect(`/quiz/${session.id}?questions=${encodeURIComponent(questionIds)}&certId=${certId}&idx=0`);
});

router.get('/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { questions: questionIdsStr, certId, idx } = req.query;
  if (!questionIdsStr || !certId) return res.redirect('/');

  const session = await progressService.getSession(sessionId, req.user.id);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const questionIds = questionIdsStr.split(',');
  const currentIdx = parseInt(idx, 10) || 0;
  if (currentIdx >= questionIds.length) {
    await progressService.completeSession(sessionId, req.user.id);
    return res.redirect(`/quiz/${sessionId}/result?certId=${certId}`);
  }

  const allQuestions = await questionService.getAllQuestions(certId);
  const question = allQuestions.find((q) => q.id === questionIds[currentIdx]);
  if (!question) return res.redirect(`/quiz/${sessionId}/result?certId=${certId}`);

  res.render('quiz', {
    title: `問題 ${currentIdx + 1} / ${questionIds.length}`,
    session, question, currentIdx,
    total: questionIds.length,
    questionIds: questionIdsStr, certId, answered: null,
  });
});

router.post('/:sessionId/answer', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { questionId, domainId, selectedAnswer, isCorrect, questionIds, certId, currentIdx } = req.body;
  await progressService.recordAnswer({
    sessionId, userId: req.user.id, questionId, domainId, selectedAnswer,
    isCorrect: isCorrect === 'true',
  });
  const nextIdx = parseInt(currentIdx, 10) + 1;
  res.redirect(
    `/quiz/${sessionId}?questions=${encodeURIComponent(questionIds)}&certId=${certId}&idx=${nextIdx}&lastAnswer=${selectedAnswer}&lastCorrect=${isCorrect}&lastQuestionId=${questionId}`
  );
});

router.get('/:sessionId/result', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { certId } = req.query;
  const session = await progressService.getSession(sessionId, req.user.id);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const cert = await questionService.readCertification(certId);
  const domainScores = progressService.calcSessionDomainScores(session);
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  const overallRate = total > 0 ? Math.round((correct / total) * 100) : 0;

  const domainsWithScores = cert
    ? cert.domains.filter((d) => domainScores[d.id]).map((d) => ({ ...d, score: domainScores[d.id] }))
    : [];
  const weakDomains = domainsWithScores.filter((d) => d.score.rate !== null && d.score.rate < 70);

  res.render('result', {
    title: 'セッション結果', session, cert, overallRate, correct, total,
    domainsWithScores, weakDomains, certId,
  });
});

router.get('/:sessionId/review', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { certId } = req.query;
  const session = await progressService.getSession(sessionId, req.user.id);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const wrongAnswers = session.answers.filter((a) => !a.isCorrect);
  const allQuestions = await questionService.getAllQuestions(certId);
  const wrongQuestions = wrongAnswers.map((a) => {
    const q = allQuestions.find((q) => q.id === a.questionId);
    return q ? { ...q, selectedAnswer: a.selectedAnswer } : null;
  }).filter(Boolean);

  res.render('review', { title: '間違い復習', session, wrongQuestions, certId });
});

module.exports = router;
