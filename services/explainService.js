'use strict';

const mcpClient = require('./mcpClient');
const llmClient = require('./llmClient');
const { mapLlmError } = require('./generationService');

const MAX_REFS = 3;          // 参考資料に使う検索結果の上限
const MAX_REF_CHARS = 2000;  // 各参考資料の本文切り出し上限

/**
 * 1 問の深掘り解説を、公式 Microsoft Learn ドキュメントにグラウンディングして生成する。
 * パイプライン: MCP 検索（グラウンディング）→ LLM 生成 → 構造化整形 → references フィルタ。
 * 検索失敗は graceful（参考資料なしで継続）、JSON 抽出失敗は summary フォールバック。
 *
 * @param {object} args
 * @param {{ id: string, name: string }} args.cert
 * @param {{ id: string, name: string }} args.domain
 * @param {object} args.question - options/correctAnswers/explanation を含む問題
 * @param {{ apiKey: string, modelName: string }} args.llmConfig
 * @param {(msg: string) => void} [args.onProgress]
 * @returns {Promise<{ summary, whyCorrect, whyIncorrect, deepDive, references }>}
 */
async function explainQuestion({ cert, domain, question, llmConfig, onProgress }) {
  onProgress?.('関連する公式ドキュメントを検索中...');
  const results = await fetchSearchResults(cert, domain, question);

  const contextSection = buildContextSection(results);
  const prompt = buildExplainPrompt({ cert, domain, question, contextSection });

  onProgress?.('AI が解説を生成中...');
  const openai = llmClient.createLlmClient(llmConfig.apiKey);
  let response;
  try {
    response = await openai.chat.completions.create({
      model: llmConfig.modelName,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw mapLlmError(err, llmConfig.modelName);
  }

  const text = response.choices?.[0]?.message?.content || '';
  const parsed = parseExplanation(text);
  return { ...parsed, references: mergeReferences(parsed.references, results) };
}

/** ドメイン特化の検索クエリで公式ドキュメントを集める。失敗時は空配列（graceful）。 */
async function fetchSearchResults(cert, domain, question) {
  const correctTexts = (question.correctAnswers || [])
    .map((k) => question.options?.[k])
    .filter(Boolean)
    .join(' ');
  const query = `${cert.name} ${domain.name} ${String(question.question).substring(0, 120)} ${correctTexts}`.trim();
  try {
    const results = await mcpClient.callLearnSearch(query);
    return (results || []).slice(0, MAX_REFS);
  } catch (err) {
    console.warn('[explain] MCP 検索失敗、参考資料なしで継続:', err.message);
    return [];
  }
}

function buildContextSection(results) {
  if (!results.length) {
    return '## 参考資料\n（公式ドキュメントの取得に失敗しました。確実に知っている公式仕様のみに基づいて解説してください）';
  }
  const body = results
    .map((r) => `### ${r.title}${r.url ? ` (${r.url})` : ''}\n${String(r.content || '').substring(0, MAX_REF_CHARS)}`)
    .join('\n\n');
  return `## 参考資料（Microsoft Learn 検索結果）\n${body}`;
}

function buildExplainPrompt({ cert, domain, question, contextSection }) {
  const optionsList = Object.entries(question.options || {})
    .map(([k, v]) => `${k}. ${v}`)
    .join('\n');
  const correct = (question.correctAnswers && question.correctAnswers.length
    ? question.correctAnswers
    : [question.correctAnswer]).filter(Boolean).join(', ');

  return `あなたは Microsoft/GitHub 認定資格（${cert.name}）の学習をサポートする講師です。
以下の参考資料**と既知の公式仕様**に基づき、この問題の「深掘り解説」を作成してください。

${contextSection}

## 対象の問題（ドメイン: ${domain.name}）
${question.question}

### 選択肢
${optionsList}

### 正解
${correct}

### 既存の簡易解説（参考）
${question.explanation || '（なし）'}

## 指示
- 参考資料に根拠がある場合は、具体的な機能名・設定名を挙げて説明する
- 各誤答が「なぜ要件に合わないか」を 1 文ずつ書く（存在する選択肢のみ）
- 参考資料の URL を references に含める（推測の URL は載せない）

## 出力形式
次の JSON オブジェクト**のみ**を返してください（説明文・コードブロック記号は不要）:
{
  "summary": "この問題が問うている要点（1〜2文）",
  "whyCorrect": "正解が正しい理由（公式仕様の具体的な機能名・設定名を伴う）",
  "whyIncorrect": { "B": "なぜ要件に合わないか", "C": "...", "D": "..." },
  "deepDive": "関連概念・背景の補足説明",
  "references": [ { "title": "...", "url": "https://learn.microsoft.com/..." } ]
}`;
}

/** LLM 出力を構造化オブジェクトに整形する。JSON 抽出/パース失敗時は summary フォールバック。 */
function parseExplanation(text) {
  const json = llmClient.extractJsonObject(text);
  if (json) {
    try {
      const obj = JSON.parse(json);
      return {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        whyCorrect: typeof obj.whyCorrect === 'string' ? obj.whyCorrect : '',
        whyIncorrect: obj.whyIncorrect && typeof obj.whyIncorrect === 'object' ? obj.whyIncorrect : {},
        deepDive: typeof obj.deepDive === 'string' ? obj.deepDive : '',
        references: Array.isArray(obj.references) ? obj.references : [],
      };
    } catch { /* フォールバックへ */ }
  }
  return { summary: String(text).trim(), whyCorrect: '', whyIncorrect: {}, deepDive: '', references: [] };
}

/**
 * LLM が返した references と検索結果 URL をマージする。
 * https:// スキームのみ許可（XSS/危険スキーム防止）、URL で重複排除。
 */
function mergeReferences(llmRefs, searchResults) {
  const out = [];
  const seen = new Set();
  const push = (title, url) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ title: title || url, url });
  };
  for (const r of llmRefs || []) push(r?.title, r?.url);
  for (const s of searchResults || []) push(s?.title, s?.url);
  return out;
}

module.exports = {
  explainQuestion,
  buildExplainPrompt,
  mergeReferences,
  parseExplanation,
};
