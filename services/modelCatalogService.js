'use strict';

// GitHub Models カタログ API。利用可能なモデル一覧を動的に取得する。
// https://docs.github.com/en/rest/models/catalog
const CATALOG_URL = 'https://models.github.ai/catalog/models';
const CACHE_TTL_MS = 10 * 60 * 1000;

// 無料ティアで推論可能なモデルの rate_limit_tier。custom（gpt-5系/o系/deepseek-r1 等の
// 有料・プレビュー専用。unavailable_model になる）と embeddings は除外する。
const INFERABLE_TIERS = new Set(['high', 'low']);

// カタログ取得失敗時のフォールバック（推論可能=実測200のモデルのみ）
const FALLBACK_MODELS = [
  { id: 'openai/gpt-4.1', name: 'OpenAI GPT-4.1', publisher: 'OpenAI' },
  { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', publisher: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o mini', publisher: 'OpenAI' },
];

let cache = { at: 0, models: null };

/**
 * 無料ティアで推論可能なチャットモデルのみ対象にする。
 * text→text かつ rate_limit_tier が high/low（custom・embeddings を除外）。
 */
function isChatModel(m) {
  const inputs = m.supported_input_modalities || [];
  const outputs = m.supported_output_modalities || [];
  return inputs.includes('text') && outputs.includes('text') && INFERABLE_TIERS.has(m.rate_limit_tier);
}

/** openai/gpt-4.1 系 → openai 系 → その他 の順、同順位は id 昇順 */
function sortModels(models) {
  const score = (m) =>
    m.id.startsWith('openai/gpt-4.1') ? 0 : m.id.startsWith('openai/') ? 1 : 2;
  return [...models].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
}

/**
 * 利用可能なチャットモデル一覧を返す。
 * 成功結果は 10 分メモリキャッシュ。失敗時は FALLBACK_MODELS（UI を止めない）。
 * @param {string} accessToken - GitHub アクセストークン
 * @returns {Promise<Array<{id: string, name: string, publisher: string}>>}
 */
async function listModels(accessToken) {
  if (cache.models && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;
  try {
    const res = await fetch(CATALOG_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`catalog API ${res.status}`);
    const data = await res.json();
    const models = sortModels(
      (Array.isArray(data) ? data : [])
        .filter(isChatModel)
        .map((m) => ({ id: m.id, name: m.name || m.id, publisher: m.publisher || '' }))
    );
    if (models.length === 0) return FALLBACK_MODELS;
    cache = { at: Date.now(), models };
    return models;
  } catch (err) {
    console.warn('[modelCatalog] 取得失敗、フォールバックを使用:', err.message);
    return FALLBACK_MODELS;
  }
}

/** テスト用: キャッシュをリセットする */
function _resetCache() {
  cache = { at: 0, models: null };
}

module.exports = { listModels, FALLBACK_MODELS, _resetCache };
