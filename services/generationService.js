'use strict';

const { parse } = require('node-html-parser');
const { CopilotClient, approveAll } = require('@github/copilot-sdk');

/**
 * 学習ガイドURLから特定ドメインのテキストを抽出する
 */
async function fetchDomainContent(studyGuideUrl, domainName) {
  const res = await fetch(studyGuideUrl);
  if (!res.ok) throw new Error(`学習ガイドの取得に失敗しました: ${res.status}`);
  const html = await res.text();
  const root = parse(html);

  // メインコンテンツ領域を取得
  const mainContent = root.querySelector('main') || root.querySelector('.content') || root;
  const text = mainContent.structuredText || mainContent.text;

  // ドメイン名でセクションを抽出 (前後2000文字を抜粋)
  const domainKeyword = domainName.replace(/Domain \d+: /i, '').trim().substring(0, 30);
  const idx = text.indexOf(domainKeyword);
  if (idx === -1) {
    // キーワードが見つからない場合は全文の最初3000文字を返す
    return text.substring(0, 3000);
  }

  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + 2500);
  return text.substring(start, end);
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
以下の学習ガイドのテキストに基づいて、「${domain.name}」ドメインの4択試験問題を5問作成してください。

## 学習ガイドのテキスト
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
- 問題は実際の試験を想定した実践的な内容にしてください
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
