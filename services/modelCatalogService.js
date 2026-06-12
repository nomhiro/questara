'use strict';

// GitHub Models カタログ API。利用可能なモデル一覧を動的に取得する。
// https://docs.github.com/en/rest/models/catalog
const CATALOG_URL = 'https://models.github.ai/catalog/models';
const CACHE_TTL_MS = 10 * 60 * 1000;

// カタログ取得失敗時のフォールバック（gpt-5 系のみ。4 系へのフォールバックはしない）
const FALLBACK_MODELS = [
  { id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI' },
  { id: 'openai/gpt-5-mini', name: 'OpenAI GPT-5 mini', publisher: 'OpenAI' },
  { id: 'openai/gpt-5-nano', name: 'OpenAI GPT-5 nano', publisher: 'OpenAI' },
];

let cache = { at: 0, models: null };

/** text 入力 → text 出力のチャット系モデルのみ対象にする */
function isChatModel(m) {
  const inputs = m.supported_input_modalities || [];
  const outputs = m.supported_output_modalities || [];
  return inputs.includes('text') && outputs.includes('text');
}

/** openai/gpt-5 系 → openai 系 → その他 の順、同順位は id 昇順 */
function sortModels(models) {
  const score = (m) =>
    m.id.startsWith('openai/gpt-5') ? 0 : m.id.startsWith('openai/') ? 1 : 2;
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
