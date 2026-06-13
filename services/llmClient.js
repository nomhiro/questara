'use strict';

const OpenAI = require('openai');

// GitHub Models API（OpenAI 互換エンドポイント）。認証はユーザーの GitHub アクセストークン。
// これらの定数・クライアント生成・JSON 抽出は複数サービスで重複していたため一元化する。
// モデル ID は {publisher}/{model} 形式（例: openai/gpt-4.1）。
// 既定は無料ティアで推論可能なモデル（カタログ rate_limit_tier = high/low）を使う。
// gpt-5 系・o 系・deepseek-r1（rate_limit_tier = custom）はカタログに載るが
// 無料ティアでは推論できない（unavailable_model）ため既定・フォールバックに含めない。
// temperature 等のサンプリングパラメータは送らない（将来 custom 系を許可しても安全なため統一）。
const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference';
// 補助タスク（資格抽出）用の既定モデル。高速・低レート消費。
const GITHUB_MODELS_DEFAULT_MODEL = 'openai/gpt-4o-mini';
// 問題生成用の既定モデル。品質優先（UI で変更可能）。
const GENERATION_DEFAULT_MODEL = 'openai/gpt-4.1';
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
  GENERATION_DEFAULT_MODEL,
  LLM_TIMEOUT_MS,
  createLlmClient,
  extractJsonObject,
  extractJsonArray,
};
