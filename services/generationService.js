'use strict';

const { parse } = require('node-html-parser');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { CopilotClient, approveAll } = require('@github/copilot-sdk');

const MICROSOFT_LEARN_MCP_URL = 'https://learn.microsoft.com/api/mcp';

/**
 * Microsoft Learn MCP で学習ガイドページを Markdown 取得する
 * 失敗時は null を返す (フォールバック用)
 */
async function fetchViaLearnMcp(url) {
  const client = new Client({ name: 'cert-study-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MICROSOFT_LEARN_MCP_URL));
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'microsoft_docs_fetch',
      arguments: { url },
    });
    // content は { type: 'text', text: '...' }[] 形式
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
 * 学習ガイドURLからドメインのテキストを取得する
 * 優先順位: Microsoft Learn MCP → HTML スクレイピング
 */
async function fetchDomainContent(studyGuideUrl, domainName) {
  // MCP で全ページを Markdown として取得
  const mcpText = await fetchViaLearnMcp(studyGuideUrl);
  if (mcpText) {
    // ドメインキーワードでセクションを抽出
    const domainKeyword = domainName.replace(/Domain \d+: /i, '').trim().substring(0, 30);
    const idx = mcpText.indexOf(domainKeyword);
    if (idx !== -1) {
      const start = Math.max(0, idx - 100);
      const end = Math.min(mcpText.length, idx + 3000);
      return mcpText.substring(start, end);
    }
    // キーワードが見つからなければ全文の最初4000文字
    return mcpText.substring(0, 4000);
  }

  // フォールバック: HTML スクレイピング
  return fetchViaHtmlScraping(studyGuideUrl, domainName);
}

/**
 * GitHub Copilot SDK を使って問題を生成する
 */
async function generateQuestions({ certId, domain, docText, onProgress }) {
  const client = new CopilotClient({ autoStart: true });

  const prompt = buildPrompt(domain, docText);

  let session;
  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workspacePath: process.cwd(),
    });

    onProgress?.('Copilot セッション開始...');

    const result = await session.sendAndWait({ prompt }, 120_000);
    const text = result?.data?.message || result?.message || '';
    onProgress?.('レスポンスを解析中...');

    return parseQuestionsFromResponse(text, certId, domain.id);
  } finally {
    session?.destroy();
    client.stop().catch(() => {});
  }
}

function buildPrompt(domain, docText) {
  return `あなたはMicrosoft/GitHub認定資格試験の問題作成専門家です。
以下は Microsoft Learn の公式学習ガイドから取得した「${domain.name}」ドメインのテキストです。
このテキストに基づいて、実際の試験を想定した4択試験問題を5問作成してください。

## Microsoft Learn 学習ガイド (${domain.name})
${docText}

## 出力形式
以下の JSON 配列のみを返してください（説明文やコードブロックは不要）:
[
  {
    "question": "問題文（日本語）",
    "options": {
      "A": "選択肢A",
      "B": "選択肢B",
      "C": "選択肢C",
      "D": "選択肢D"
    },
    "correctAnswer": "A",
    "explanation": "正解の解説（なぜその答えが正解なのか、他の選択肢がなぜ間違いかを含む）",
    "tags": ["タグ1", "タグ2"]
  }
]

## 注意事項
- 学習ガイドに記載されたトピックとスキルを正確に反映した問題にしてください
- 解説は学習に役立つ詳細な内容にしてください
- 正解は A〜D の中からランダムに分散させてください
- 必ず valid な JSON のみを返してください`;
}

/**
 * Copilot のレスポンスから問題 JSON を抽出する
 */
function parseQuestionsFromResponse(text, certId, domainId) {
  // JSON 配列部分を抽出
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Copilot のレスポンスから JSON を抽出できませんでした');

  let questions;
  try {
    questions = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`JSON のパースに失敗しました: ${e.message}`);
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('問題の配列が空です');
  }

  // ID を付与して正規化
  return questions.map((q, i) => ({
    id: `${certId}-${domainId}-${String(i + 1).padStart(3, '0')}-gen`,
    question: q.question || '',
    options: q.options || {},
    correctAnswer: q.correctAnswer || 'A',
    explanation: q.explanation || '',
    tags: Array.isArray(q.tags) ? q.tags : [],
  }));
}

module.exports = { fetchDomainContent, generateQuestions };
