'use strict';

const OpenAI = require('openai');

// GitHub Models API（OpenAI 互換エンドポイント）。認証はユーザーの GitHub アクセストークン。
// これらの定数・クライアント生成・JSON 抽出は複数サービスで重複していたため一元化する。
const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';
const GITHUB_MODELS_DEFAULT_MODEL = 'gpt-4o-mini';
const LLM_TIMEOUT_MS = 120000;

/**
 * GitHub Models 用の OpenAI クライアントを生成する。
 * タイムアウトを必ず付与し、呼び出しが無期限にハングするのを防ぐ。
 * @param {string} accessToken - GitHub アクセストークン（apiKey として渡す）
 * @param {object} [opts]
 * @param {number} [opts.timeout] - リクエストタイムアウト(ms)。既定 LLM_TIMEOUT_MS
 * @returns {OpenAI}
 */
function createLlmClient(accessToken, { timeout = LLM_TIMEOUT_MS } = {}) {
  return new OpenAI({ baseURL: GITHUB_MODELS_ENDPOINT, apiKey: accessToken, timeout });
}

/** LLM 出力テキストから最初の JSON オブジェクト文字列を取り出す。無ければ null。 */
function extractJsonObject(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/** LLM 出力テキストから最初の JSON 配列文字列を取り出す。無ければ null。 */
function extractJsonArray(text) {
  const match = String(text || '').match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

module.exports = {
  GITHUB_MODELS_ENDPOINT,
  GITHUB_MODELS_DEFAULT_MODEL,
  LLM_TIMEOUT_MS,
  createLlmClient,
  extractJsonObject,
  extractJsonArray,
};
