'use strict';

const express = require('express');
const router = express.Router();
const generationService = require('../services/generationService');
const questionService = require('../services/questionService');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');

// SSE: ドメインの問題を再生成
router.post('/certifications/:certId/domains/:domainId/generate', requireAuth, async (req, res) => {
  const { certId, domainId } = req.params;

  const cert = questionService.readCertification(certId);
  if (!cert) return res.status(404).json({ error: '資格が見つかりません' });

  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).json({ error: 'ドメインが見つかりません' });

  // ユーザーの LLM 設定を取得
  const llmConfig = userService.getLlmConfig(req.session.userId);
  if (!llmConfig) {
    return res.status(400).json({ error: 'LLM API キーが設定されていません。設定画面で登録してください。' });
  }

  // SSE レスポンスを開始
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('progress', { message: '学習ガイドとコースコンテンツを取得中...' });
    const questions = await generationService.generateQuestions({
      cert,
      certId,
      domain,
      llmConfig,
      onProgress: (msg) => send('progress', { message: msg }),
    });

    questionService.replaceDomainQuestions(certId, domainId, questions);
    send('done', { message: `${questions.length}問を生成しました`, count: questions.length });
  } catch (err) {
    console.error('Generation error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
