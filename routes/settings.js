'use strict';

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');

// API キー設定画面
router.get('/', requireAuth, (req, res) => {
  const hasConfig = userService.hasLlmConfig(req.session.userId);
  const welcome = req.query.welcome === '1';
  res.render('settings', {
    title: 'LLM API 設定',
    hasConfig,
    welcome,
    error: null,
    success: null,
    userEmail: req.session.userEmail,
  });
});

// API キー保存
router.post('/', requireAuth, (req, res) => {
  const { endpointUrl, apiKey, modelName } = req.body;

  if (!apiKey || !modelName) {
    return res.render('settings', {
      title: 'LLM API 設定',
      hasConfig: userService.hasLlmConfig(req.session.userId),
      welcome: false,
      error: 'API キーとモデル名は必須です',
      success: null,
      userEmail: req.session.userEmail,
    });
  }

  try {
    userService.saveLlmConfig(req.session.userId, {
      endpointUrl: endpointUrl || 'https://api.openai.com/v1',
      apiKey,
      modelName,
    });
    res.render('settings', {
      title: 'LLM API 設定',
      hasConfig: true,
      welcome: false,
      error: null,
      success: 'API キーを保存しました',
      userEmail: req.session.userEmail,
    });
  } catch (err) {
    res.render('settings', {
      title: 'LLM API 設定',
      hasConfig: userService.hasLlmConfig(req.session.userId),
      welcome: false,
      error: err.message,
      success: null,
      userEmail: req.session.userEmail,
    });
  }
});

module.exports = router;
