'use strict';

const express = require('express');
const router = express.Router();
const generationService = require('../services/generationService');
const questionService = require('../services/questionService');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');

const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';
const GITHUB_MODELS_DEFAULT_MODEL = 'gpt-4o-mini';

// SSE: ドメインの問題を再生成
router.post('/certifications/:certId/domains/:domainId/generate', requireAuth, async (req, res) => {
  const { certId, domainId } = req.params;

  const cert = await questionService.readCertification(certId);
  if (!cert) return res.status(404).json({ error: '資格が見つかりません' });

  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).json({ error: 'ドメインが見つかりません' });

  // GitHub アクセストークンを取得
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'GitHubトークンが見つかりません。再ログインしてください。' });
  }

  const llmConfig = {
    endpointUrl: GITHUB_MODELS_ENDPOINT,
    apiKey: accessToken,
    modelName: GITHUB_MODELS_DEFAULT_MODEL,
  };

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

    const result = await questionService.appendDomainQuestions(certId, domainId, questions);
    send('done', {
      message: `${result.appended}問を追加しました（重複スキップ: ${result.skipped}問）`,
      count: result.appended,
    });
  } catch (err) {
    console.error('Generation error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
