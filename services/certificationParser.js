'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const OpenAI = require('openai');

const LEARN_MCP_URL = 'https://learn.microsoft.com/api/mcp';
const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';
const GITHUB_MODELS_DEFAULT_MODEL = 'gpt-4o-mini';

async function fetchMarkdown(url) {
  const client = new Client({ name: 'cert-study-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(LEARN_MCP_URL));
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'microsoft_docs_fetch', arguments: { url } });
    return result?.content?.map((c) => c.text).join('\n') || '';
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Markdown からドメイン一覧を正規表現で抽出する（速い・API不要）
 */
function parseDomainsFromMarkdown(md) {
  const domains = [];
  const lines = md.split('\n');
  const headerRe = /^#+\s*(?:Domain|ドメイン)\s*(\d+)\s*[:：]\s*(.+?)(?:\s*[（(]\s*(\d+)\s*%?\s*[）)])?\s*$/i;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      domains.push({
        id: `domain-${m[1]}`,
        name: `Domain ${m[1]}: ${m[2].trim()}`,
        weight: m[3] ? Number(m[3]) : 0,
      });
    }
  }
  return domains;
}

/**
 * LLM（GitHub Models）でドメイン構造を抽出する（regex が失敗した場合のフォールバック）
 */
async function parseDomainsWithLlm(md, accessToken) {
  const openai = new OpenAI({
    baseURL: GITHUB_MODELS_ENDPOINT,
    apiKey: accessToken,
  });

  const truncated = md.length > 12000 ? md.slice(0, 12000) : md;
  const prompt = `あなたは Microsoft/GitHub 認定資格の学習ガイドを解析する専門家です。
以下の Markdown テキストから試験ドメイン（出題範囲のセクション）を抽出してください。

## 抽出ルール
- 各ドメインの「名前」と「試験ウェイト（%）」を特定する
- セクション見出しは「Skills measured」「Study these skills」「試験の対象となるスキル」「評価されるスキル」など多様な表現がある
- ウェイト表記は「20%」「約20%」「(20%)」など多様
- ドメイン名は日本語/英語そのままの表記を維持
- ウェイトが明記されていない場合は 0 を設定

## 出力形式
JSON 配列のみを返してください（説明文・コードブロック記号は不要）:
[
  { "id": "domain-1", "name": "ドメイン1の名前", "weight": 25 },
  { "id": "domain-2", "name": "ドメイン2の名前", "weight": 30 }
]

## 学習ガイド本文

${truncated}`;

  const response = await openai.chat.completions.create({
    model: GITHUB_MODELS_DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const text = response.choices[0]?.message?.content || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM のレスポンスから JSON を抽出できませんでした');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('LLM が有効なドメイン一覧を返しませんでした');
  }

  return parsed.map((d, i) => ({
    id: d.id || `domain-${i + 1}`,
    name: d.name || `Domain ${i + 1}`,
    weight: Number(d.weight) || 0,
  }));
}

/**
 * URL からドメイン構造を抽出する。
 * まず regex で試し、失敗したら LLM（GitHub Models）にフォールバックする。
 * @param {string} studyGuideUrl
 * @param {object} [options]
 * @param {string} [options.accessToken] - GitHub アクセストークン（LLM フォールバック用）
 */
async function extractDomains(studyGuideUrl, { accessToken } = {}) {
  if (!studyGuideUrl) return [];
  const md = await fetchMarkdown(studyGuideUrl);
  if (!md) throw new Error('学習ガイドのコンテンツを取得できませんでした');

  const regexDomains = parseDomainsFromMarkdown(md);
  if (regexDomains.length > 0) return regexDomains;

  if (!accessToken) {
    throw new Error('ドメイン情報を正規表現では抽出できません。LLM フォールバックには GitHub トークンが必要です。');
  }

  return parseDomainsWithLlm(md, accessToken);
}

module.exports = { extractDomains, parseDomainsFromMarkdown, parseDomainsWithLlm };
