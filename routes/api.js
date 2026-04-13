'use strict';

const express = require('express');
const router = express.Router();
const generationService = require('../services/generationService');
const questionService = require('../services/questionService');

// SSE: ドメインの問題を再生成
router.post('/certifications/:certId/domains/:domainId/generate', async (req, res) => {
  const { certId, domainId } = req.params;

  const cert = questionService.readCertification(certId);
  if (!cert) return res.status(404).json({ error: '資格が見つかりません' });

  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).json({ error: 'ドメインが見つかりません' });

  // SSE レスポンスを開始
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('progress', { message: `Microsoft Learn MCP でドキュメントを取得中...` });
    const docText = await generationService.fetchDomainContent(cert.studyGuideUrl, domain.name);

    send('progress', { message: 'GitHub Copilot に問題生成を依頼中...' });
    const questions = await generationService.generateQuestions({
      certId,
      domain,
      docText,
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
