'use strict';

const mcpClient = require('./mcpClient');
const questionService = require('./questionService');
const { createLlmClient, GITHUB_MODELS_DEFAULT_MODEL, extractJsonObject } = require('./llmClient');

const MAX_USER_PROMPT_LEN = 500;

function sanitizePrompt(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').slice(0, MAX_USER_PROMPT_LEN).trim();
}

function parseAndValidate({ raw, knownCertIds }) {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let data;
  try { data = JSON.parse(json); } catch { return null; }
  const dungeons = (data.dungeons || [])
    .map((id) => String(id || '').toLowerCase().trim())
    .filter((id) => knownCertIds.has(id));
  if (dungeons.length === 0) return null;

  const citations = Array.isArray(data.citations)
    ? data.citations.filter((c) => c && c.url).map((c) => ({ url: String(c.url), title: String(c.title || c.url) }))
    : [];

  return {
    name: String(data.name || '無名の冒険').slice(0, 80),
    description: String(data.description || '').slice(0, 500),
    rationale: String(data.rationale || '').slice(0, 1500),
    dungeons,
    citations: citations.slice(0, 10),
    verificationStatus: citations.length > 0 ? 'verified' : 'warning-no-citations',
  };
}

/**
 * ユーザープロンプトから冒険を生成する
 * @param {object} opts
 * @param {string} opts.userPrompt - ユーザーの自然文入力
 * @param {string} opts.accessToken - GitHub Models API に使う GitHub access token
 * @param {(msg:string)=>void} [opts.onProgress]
 */
async function generateFromPrompt({ userPrompt, accessToken, onProgress = () => {} }) {
  const prompt = sanitizePrompt(userPrompt);
  if (!prompt) throw new Error('userPrompt が空です');
  if (!accessToken) throw new Error('accessToken が必要です');

  onProgress('公式資料を検索中...');
  let searchResults = [];
  try {
    searchResults = await mcpClient.callLearnSearch(`${prompt} certification learning path role based`);
  } catch (err) {
    console.warn('[adventureGenerator] MCP search failed:', err.message);
    searchResults = [];
  }

  onProgress('冒険を組み立て中...');
  const certs = await questionService.listCertifications({ includePrivate: true });
  const knownCertIds = new Set(certs.map((c) => c.id));
  if (knownCertIds.size === 0) throw new Error('システムに利用可能な資格がありません');

  const excerpts = searchResults.slice(0, 6).map((r, i) =>
    `(${i + 1}) ${r.title}\n出典: ${r.url}\n${(r.content || '').slice(0, 800)}`
  ).join('\n\n');

  const systemPrompt = [
    'あなたは資格取得コーチ。',
    'ユーザーの希望に基づき、システム内の利用可能な資格から最適な順序で学習の「冒険」を構築してください。',
    '',
    '## 利用可能な資格 (dungeons に使えるのはこの中の ID のみ)',
    certs.map((c) => `- ${c.id}: ${c.name}`).join('\n'),
    '',
    '## Microsoft Learn 公式情報（検索結果抜粋）',
    excerpts || '(取得失敗)',
    '',
    '## 出力ルール',
    '- 必ず JSON のみを返す（前後の説明・コードフェンス禁止）',
    '- dungeons は `利用可能な資格` の ID からのみ選択（存在しない ID は禁止）',
    '- 初心者向けから上位順へ並べる',
    '- citations には Microsoft Learn 公式の URL を 2〜5 件含める',
    '',
    '## 出力スキーマ',
    '{"name":"","description":"","rationale":"","dungeons":[],"citations":[{"url":"","title":""}]}',
  ].join('\n');

  const openai = createLlmClient(accessToken);
  let response;
  try {
    response = await openai.chat.completions.create({
      model: GITHUB_MODELS_DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
    });
  } catch (err) {
    throw new Error(`LLM 呼び出しに失敗: ${err.message}`);
  }

  onProgress('検証中...');
  const raw = response.choices?.[0]?.message?.content || '';
  const validated = parseAndValidate({ raw, knownCertIds });
  if (!validated) {
    throw new Error('冒険を構築できませんでした。別の言い回しでお試しください。');
  }

  validated.source = 'llm';
  validated.userPrompt = prompt;
  return validated;
}

module.exports = { generateFromPrompt, parseAndValidate };
