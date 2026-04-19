'use strict';

const express = require('express');
const router = express.Router();

const userService = require('../services/userService');
const adventureService = require('../services/adventureService');
const adventureGenerator = require('../services/adventureGeneratorService');
const { requireAuth } = require('../middleware/auth');

router.post('/generate', requireAuth, async (req, res) => {
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'GitHub のアクセストークンが見つかりません。再ログインしてください。' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  let finished = false;

  try {
    const userPrompt = req.body?.userPrompt;
    send('progress', { message: '入力を受け取りました。' });

    const validated = await adventureGenerator.generateFromPrompt({
      userPrompt,
      accessToken,
      onProgress: (msg) => send('progress', { message: msg }),
    });

    send('progress', { message: '冒険を保存中...' });

    const adv = await adventureService.createAdventure({
      userId: req.user.id,
      name: validated.name,
      description: validated.description,
      source: 'llm',
      presetId: null,
      userPrompt: validated.userPrompt,
      dungeons: validated.dungeons.map((certId, i) => ({
        certificationId: certId,
        order: i + 1,
        status: i === 0 ? 'in-progress' : 'locked',
        unlockedAt: i === 0 ? new Date().toISOString() : null,
        clearedAt: null,
      })),
      rationale: validated.rationale,
      citations: validated.citations,
      verificationStatus: validated.verificationStatus,
      isActive: true,
    });
    await adventureService.setActive(req.user.id, adv.id);

    send('done', { adventureId: adv.id });
    finished = true;
  } catch (err) {
    console.error('[adventureGenerate]', err);
    send('error', { error: err.message || String(err) });
    finished = true;
  } finally {
    if (!finished) send('error', { error: '不明なエラー' });
    res.end();
  }
});

module.exports = router;
