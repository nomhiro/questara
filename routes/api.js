'use strict';

const express = require('express');
const router = express.Router();
const generationService = require('../services/generationService');
const explainService = require('../services/explainService');
const questionService = require('../services/questionService');
const userService = require('../services/userService');
const modelCatalogService = require('../services/modelCatalogService');
const { requireAuth } = require('../middleware/auth');
const { initSse } = require('../middleware/sse');
const { GITHUB_MODELS_ENDPOINT, GENERATION_DEFAULT_MODEL } = require('../services/llmClient');

// GitHub Models のモデル ID 形式（{publisher}/{model}）。それ以外の入力は弾く。
const MODEL_ID_RE = /^[\w.-]+\/[\w.-]+$/;

// 利用可能なチャットモデル一覧（ドメインページのモデル選択ドロップダウン用）
router.get('/models', requireAuth, async (req, res) => {
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'GitHubトークンが見つかりません。再ログインしてください。' });
  }
  const models = await modelCatalogService.listModels(accessToken);
  res.json({ models });
});

// SSE: ドメインの問題を再生成
router.post('/certifications/:certId/domains/:domainId/generate', requireAuth, async (req, res) => {
  const { certId, domainId } = req.params;

  const cert = await questionService.readCertification(certId);
  if (!cert || !questionService.canAccessCertification(cert, req.user.id)) {
    return res.status(404).json({ error: '資格が見つかりません' });
  }

  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).json({ error: 'ドメインが見つかりません' });

  // UI から指定された生成モデル（任意）。形式不正は 400。
  const requestedModel = req.body?.model;
  if (requestedModel !== undefined && !MODEL_ID_RE.test(String(requestedModel))) {
    return res.status(400).json({ error: 'モデル ID の形式が不正です' });
  }

  // GitHub アクセストークンを取得
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'GitHubトークンが見つかりません。再ログインしてください。' });
  }

  const llmConfig = {
    endpointUrl: GITHUB_MODELS_ENDPOINT,
    apiKey: accessToken,
    modelName: requestedModel || GENERATION_DEFAULT_MODEL,
  };

  // SSE レスポンスを開始（切断耐性のある send を取得）
  const { send } = initSse(res);

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

// SSE: 1 問の深掘り解説（公式ドキュメントにグラウンディング）。既定モデル固定・モデル指定なし。
router.post(
  '/certifications/:certId/domains/:domainId/questions/:questionId/explain',
  requireAuth,
  async (req, res) => {
    const { certId, domainId, questionId } = req.params;

    const cert = await questionService.readCertification(certId);
    if (!cert || !questionService.canAccessCertification(cert, req.user.id)) {
      return res.status(404).json({ error: '資格が見つかりません' });
    }

    const domain = cert.domains.find((d) => d.id === domainId);
    if (!domain) return res.status(404).json({ error: 'ドメインが見つかりません' });

    const question = (domain.questions || []).find((q) => q.id === questionId);
    if (!question) return res.status(404).json({ error: '問題が見つかりません' });

    const accessToken = await userService.getGithubAccessToken(req.user.id);
    if (!accessToken) {
      return res.status(400).json({ error: 'GitHubトークンが見つかりません。再ログインしてください。' });
    }

    const llmConfig = {
      endpointUrl: GITHUB_MODELS_ENDPOINT,
      apiKey: accessToken,
      modelName: GENERATION_DEFAULT_MODEL,
    };

    const { send } = initSse(res);
    try {
      send('progress', { message: '関連する公式ドキュメントを検索中...' });
      const explanation = await explainService.explainQuestion({
        cert,
        domain,
        question,
        llmConfig,
        onProgress: (msg) => send('progress', { message: msg }),
      });
      send('done', { explanation });
    } catch (err) {
      console.error('Explain error:', err);
      send('error', { message: err.message });
    } finally {
      res.end();
    }
  }
);

module.exports = router;
