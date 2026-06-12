'use strict';

const { parse } = require('node-html-parser');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const OpenAI = require('openai');
const { LLM_TIMEOUT_MS, extractJsonArray } = require('./llmClient');

const MICROSOFT_LEARN_MCP_URL = 'https://learn.microsoft.com/api/mcp';

/**
 * Microsoft Learn MCP で学習ガイドページを Markdown 取得する
 * 失敗時は null を返す (フォールバック用)
 */
async function fetchViaLearnMcp(url) {
  const client = new Client({ name: 'questara', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MICROSOFT_LEARN_MCP_URL));
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'microsoft_docs_fetch',
      arguments: { url },
    });
    const text = result?.content?.map((c) => c.text).join('\n') || '';
    return text.trim() || null;
  } catch (err) {
    console.warn('[LearnMCP] fetch failed, falling back to HTML scraping:', err.message);
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * HTML スクレイピングによるフォールバック
 */
async function fetchViaHtmlScraping(studyGuideUrl, domainName) {
  const res = await fetch(studyGuideUrl);
  if (!res.ok) throw new Error(`学習ガイドの取得に失敗しました: ${res.status}`);
  const html = await res.text();
  const root = parse(html);

  const mainContent = root.querySelector('main') || root.querySelector('.content') || root;
  const text = mainContent.structuredText || mainContent.text;

  const domainKeyword = domainName.replace(/Domain \d+: /i, '').trim().substring(0, 30);
  const idx = text.indexOf(domainKeyword);
  if (idx === -1) return text.substring(0, 3000);

  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + 2500);
  return text.substring(start, end);
}

/**
 * URL からドメイン関連テキストを取得する共通関数
 * 優先順位: Microsoft Learn MCP → HTML スクレイピング
 */
async function fetchContentForDomain(url, domainName, maxChars = 4000) {
  if (!url) return '';

  const mcpText = await fetchViaLearnMcp(url);
  if (mcpText) {
    const domainKeyword = domainName.replace(/Domain \d+:\s*/i, '').trim().substring(0, 40);
    const idx = mcpText.indexOf(domainKeyword);
    if (idx !== -1) {
      const start = Math.max(0, idx - 200);
      const end = Math.min(mcpText.length, idx + maxChars);
      return mcpText.substring(start, end);
    }
    return mcpText.substring(0, maxChars);
  }

  return fetchViaHtmlScraping(url, domainName);
}

/**
 * OpenAI 互換 API を使って問題を生成する
 * llmConfig: { endpointUrl, apiKey, modelName }
 */
async function generateQuestions({ cert, certId, domain, llmConfig, onProgress }) {
  onProgress?.('学習ガイドとコースコンテンツを取得中...');
  const [guideText, courseText] = await Promise.all([
    fetchContentForDomain(cert.studyGuideUrl, domain.name),
    fetchContentForDomain(cert.courseUrl, domain.name),
  ]);

  const prompt = buildPrompt(domain, guideText, courseText);

  const openai = new OpenAI({
    baseURL: llmConfig.endpointUrl,
    apiKey: llmConfig.apiKey,
    timeout: LLM_TIMEOUT_MS,
  });

  onProgress?.('LLM に問題生成をリクエスト中...');

  const response = await openai.chat.completions.create({
    model: llmConfig.modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  onProgress?.('レスポンスを解析中...');
  const text = response.choices[0]?.message?.content || '';
  const idOffset = domain.questions?.length || 0;
  return parseQuestionsFromResponse(text, certId, domain.id, idOffset);
}

/**
 * 高品質な問題生成プロンプトを構築する
 */
function buildPrompt(domain, guideText, courseText) {
  const contextSection = buildContextSection(guideText, courseText);

  return `あなたはMicrosoft/GitHub認定資格試験の問題作成専門家です。
以下の参考資料に基づいて、「${domain.name}」ドメインの4択試験問題を10問作成してください。

${contextSection}

## 問題品質の基準
- **難易度分布**: 基礎理解 4問・応用/シナリオ 4問・分析/判断 2問
- **問題形式**: 実務シナリオを含む実践的な問題を優先する
- **誤答肢**: 正解に近い紛らわしい選択肢を用意し、なぜ誤りかを解説に含める
- **正解分散**: A・B・C・D を均等に分散させる
- **日本語**: 問題文・選択肢・解説はすべて日本語で記述する

## few-shot 例（この品質・形式に合わせて作成してください）
{
  "question": "GitHub Enterprise の管理者が、組織内の全リポジトリに対してブランチ保護ルールを一括で強制適用したい。最も適切な手順はどれですか？",
  "options": {
    "A": "各リポジトリの Settings > Branches から個別に設定する",
    "B": "Organization の Settings > Repository defaults でデフォルトブランチ保護を設定する",
    "C": "Enterprise の Settings > Policies でブランチ保護ポリシーを必須化する",
    "D": "GitHub Actions ワークフローでブランチ保護を自動設定するスクリプトを実行する"
  },
  "correctAnswer": "C",
  "explanation": "Enterprise レベルのポリシーは配下の全 Organization・リポジトリに強制適用できます。B は Organization 単位の設定であり Enterprise 全体には適用されません。A は個別設定のため管理コストが高く、D は標準機能ではありません。",
  "difficulty": "applied",
  "tags": ["enterprise", "branch-protection", "policy"]
}

## 出力形式
JSON 配列のみを返してください（説明文・コードブロック記号は不要）:
[
  {
    "question": "問題文（日本語）",
    "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
    "correctAnswer": "A",
    "explanation": "解説（正解理由 + 各誤答がなぜ誤りかを含む）",
    "difficulty": "basic | applied | analytical",
    "tags": ["タグ1", "タグ2"]
  }
]`;
}

function buildContextSection(guideText, courseText) {
  const parts = [];

  if (guideText) {
    parts.push(`## 学習ガイド（試験出題範囲）\n${guideText}`);
  }

  if (courseText) {
    parts.push(`## コースコンテンツ（学習モジュール）\n${courseText}`);
  }

  return parts.length > 0
    ? parts.join('\n\n')
    : '## 参考資料\n（コンテンツの取得に失敗しました。一般的な知識から問題を作成してください）';
}

function parseQuestionsFromResponse(text, certId, domainId, idOffset = 0) {
  const json = extractJsonArray(text);
  if (!json) throw new Error('LLM のレスポンスから JSON を抽出できませんでした');

  let questions;
  try {
    questions = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON のパースに失敗しました: ${e.message}`);
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('問題の配列が空です');
  }

  return questions.map((q, i) => ({
    id: `${certId}-${domainId}-${String(idOffset + i + 1).padStart(3, '0')}-gen`,
    question: q.question || '',
    options: q.options || {},
    correctAnswer: q.correctAnswer || 'A',
    explanation: q.explanation || '',
    difficulty: q.difficulty || 'basic',
    tags: Array.isArray(q.tags) ? q.tags : [],
  }));
}

module.exports = { generateQuestions };
