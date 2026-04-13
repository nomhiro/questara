'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');

// クイズ開始
router.post('/start', (req, res) => {
  const { certId, mode, domainId } = req.body;
  const cert = questionService.readCertification(certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });

  let questions;
  let domainFilter = null;

  if (mode === 'wrong-only') {
    const wrongIds = progressService.getWrongQuestionIds(certId);
    if (wrongIds.length === 0) {
      return res.redirect(`/certifications/${certId}?info=no-wrong`);
    }
    questions = questionService.getQuestionsByIds(certId, wrongIds);
  } else if (mode === 'domain' && domainId) {
    questions = questionService.getQuestionsByDomain(certId, domainId);
    domainFilter = domainId;
  } else {
    questions = questionService.getAllQuestions(certId);
  }

  if (questions.length === 0) {
    return res.redirect(`/certifications/${certId}?info=no-questions`);
  }

  // 問題をシャッフル
  questions.sort(() => Math.random() - 0.5);

  const session = progressService.createSession({ certificationId: certId, domainFilter, mode });

  // セッションデータをクライアントに渡すためにクエリパラメータを使用
  const questionIds = questions.map((q) => q.id).join(',');
  res.redirect(`/quiz/${session.id}?questions=${encodeURIComponent(questionIds)}&certId=${certId}&idx=0`);
});

// 問題表示
router.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { questions: questionIdsStr, certId, idx } = req.query;

  if (!questionIdsStr || !certId) {
    return res.redirect('/');
  }

  const session = progressService.getSession(sessionId);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const questionIds = questionIdsStr.split(',');
  const currentIdx = parseInt(idx, 10) || 0;

  if (currentIdx >= questionIds.length) {
    // 全問完了
    progressService.completeSession(sessionId);
    return res.redirect(`/quiz/${sessionId}/result?certId=${certId}`);
  }

  const allQuestions = questionService.getAllQuestions(certId);
  const question = allQuestions.find((q) => q.id === questionIds[currentIdx]);

  if (!question) {
    return res.redirect(`/quiz/${sessionId}/result?certId=${certId}`);
  }

  res.render('quiz', {
    title: `問題 ${currentIdx + 1} / ${questionIds.length}`,
    session,
    question,
    currentIdx,
    total: questionIds.length,
    questionIds: questionIdsStr,
    certId,
    answered: null,
  });
});

// 回答送信
router.post('/:sessionId/answer', (req, res) => {
  const { sessionId } = req.params;
  const { questionId, domainId, selectedAnswer, isCorrect, questionIds, certId, currentIdx } = req.body;

  progressService.recordAnswer({
    sessionId,
    questionId,
    domainId,
    selectedAnswer,
    isCorrect: isCorrect === 'true',
  });

  const nextIdx = parseInt(currentIdx, 10) + 1;
  res.redirect(
    `/quiz/${sessionId}?questions=${encodeURIComponent(questionIds)}&certId=${certId}&idx=${nextIdx}&lastAnswer=${selectedAnswer}&lastCorrect=${isCorrect}&lastQuestionId=${questionId}`
  );
});

// 結果画面
router.get('/:sessionId/result', (req, res) => {
  const { sessionId } = req.params;
  const { certId } = req.query;

  const session = progressService.getSession(sessionId);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const cert = questionService.readCertification(certId);
  const domainScores = progressService.calcSessionDomainScores(session);
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  const overallRate = total > 0 ? Math.round((correct / total) * 100) : 0;

  // ドメイン名を付加
  const domainsWithScores = cert
    ? cert.domains
        .filter((d) => domainScores[d.id])
        .map((d) => ({
          ...d,
          score: domainScores[d.id],
        }))
    : [];

  // 弱点ドメイン (正答率 < 70%)
  const weakDomains = domainsWithScores.filter((d) => d.score.rate !== null && d.score.rate < 70);

  res.render('result', {
    title: 'セッション結果',
    session,
    cert,
    overallRate,
    correct,
    total,
    domainsWithScores,
    weakDomains,
    certId,
  });
});

// 復習画面
router.get('/:sessionId/review', (req, res) => {
  const { sessionId } = req.params;
  const { certId } = req.query;

  const session = progressService.getSession(sessionId);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const wrongAnswers = session.answers.filter((a) => !a.isCorrect);
  const allQuestions = questionService.getAllQuestions(certId);
  const wrongQuestions = wrongAnswers.map((a) => {
    const q = allQuestions.find((q) => q.id === a.questionId);
    return q ? { ...q, selectedAnswer: a.selectedAnswer } : null;
  }).filter(Boolean);

  res.render('review', {
    title: '間違い復習',
    session,
    wrongQuestions,
    certId,
  });
});

module.exports = router;
