'use strict';

const { parse } = require('node-html-parser');
const OpenAI = require('openai');
const mcpClient = require('./mcpClient');
const { LLM_TIMEOUT_MS, extractJsonArray } = require('./llmClient');
const { validateQuestions } = require('./questionValidator');

/**
 * Microsoft Learn MCP で学習ガイドページを Markdown 取得する
 * 失敗時は null を返す (フォールバック用)。MCP 接続は mcpClient に集約 (D-12)。
 */
async function fetchViaLearnMcp(url) {
  try {
    const text = await mcpClient.callLearnFetch(url);
    return text.trim() || null;
  } catch (err) {
    console.warn('[LearnMCP] fetch failed, falling back to HTML scraping:', err.message);
    return null;
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
 * Markdown の見出し構造からドメインに対応するセクションを切り出す。
 * 見出し行に domainName のキーワード（"Domain N:" を除いた先頭部分）を含む行を探し、
 * 次の同レベル以上の見出しの直前までを返す。見つからなければ null。
 */
function extractDomainSection(markdown, domainName, maxChars = 8000) {
  const keyword = domainName.replace(/Domain \d+:\s*/i, '').trim().substring(0, 40).toLowerCase();
  if (!keyword) return null;
  const lines = String(markdown || '').split('\n');
  const headingRe = /^(#{1,6})\s+(.*)$/;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].toLowerCase().includes(keyword)) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').substring(0, maxChars);
}

/**
 * URL からドメイン関連テキストを取得する共通関数
 * 優先順位: MCP fetch + 見出し抽出 → キーワード位置切り出し → 先頭切り出し → HTML スクレイピング
 */
async function fetchContentForDomain(url, domainName, maxChars = 8000) {
  if (!url) return '';

  const mcpText = await fetchViaLearnMcp(url);
  if (mcpText) {
    const section = extractDomainSection(mcpText, domainName, maxChars);
    if (section) return section;
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
 * Microsoft Learn MCP の検索でドメイン特化の参考資料を集める。
 * 追加のグラウンディングソース扱いのため、失敗してもエラーにせず空文字を返す。
 */
async function fetchSearchContext(certName, domainName, maxPerResult = 2000) {
  try {
    const keyword = domainName.replace(/Domain \d+:\s*/i, '').trim();
    const results = await mcpClient.callLearnSearch(`${certName} ${keyword}`);
    return results
      .slice(0, 3)
      .map((r) => `### ${r.title}${r.url ? ` (${r.url})` : ''}\n${String(r.content).substring(0, maxPerResult)}`)
      .join('\n\n');
  } catch (err) {
    console.warn('[LearnMCP] search failed:', err.message);
    return '';
  }
}

/**
 * OpenAI 互換 API を使って問題を生成する。
 * パイプライン: コンテキスト収集 → LLM 生成 → LLM レビュー（修正/除外）→ 機械検証。
 * llmConfig: { endpointUrl, apiKey, modelName }
 */
async function generateQuestions({ cert, certId, domain, llmConfig, onProgress }) {
  onProgress?.('学習ガイド・コース・関連ドキュメントを取得中...');
  const [guideText, courseText, searchText] = await Promise.all([
    fetchContentForDomain(cert.studyGuideUrl, domain.name),
    fetchContentForDomain(cert.courseUrl, domain.name),
    fetchSearchContext(cert.name || certId, domain.name),
  ]);

  const contextSection = buildContextSection(guideText, courseText, searchText);
  const existing = domain.questions || [];
  const prompt = buildPrompt(domain, contextSection, existing);

  const openai = new OpenAI({
    baseURL: llmConfig.endpointUrl,
    apiKey: llmConfig.apiKey,
    timeout: LLM_TIMEOUT_MS,
  });

  onProgress?.(`LLM (${llmConfig.modelName}) に問題生成をリクエスト中...`);
  let response;
  try {
    response = await openai.chat.completions.create({
      model: llmConfig.modelName,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw mapLlmError(err, llmConfig.modelName);
  }

  const text = response.choices[0]?.message?.content || '';
  const raw = extractRawQuestions(text);

  onProgress?.('生成された問題を参考資料と照合してレビュー中...');
  const reviewed = await reviewQuestions(openai, llmConfig.modelName, raw, contextSection);

  const normalized = normalizeQuestions(reviewed, certId, domain.id, existing.length);
  const { valid, rejected } = validateQuestions(normalized, { existingQuestions: existing });
  if (rejected.length > 0) {
    console.warn(
      `[generation] ${rejected.length}問を機械検証で除外:`,
      rejected.map((r) => r.reason).join(' / ')
    );
  }
  if (valid.length === 0) {
    throw new Error('検証を通過した問題がありません。再度お試しください。');
  }
  return valid;
}

/**
 * 問題生成プロンプトを構築する。
 * グラウンディング・難易度分布・複数選択・誤答肢品質・重複禁止を指示する。
 */
function buildPrompt(domain, contextSection, existingQuestions) {
  const existingList = (existingQuestions || [])
    .slice(0, 30)
    .map((q) => `- ${String(q.question).substring(0, 60)}`)
    .join('\n');

  return `あなたはMicrosoft/GitHub認定資格試験の問題作成専門家です。
以下の参考資料**のみ**に基づいて、「${domain.name}」ドメインの試験問題を10問作成してください。

${contextSection}

## グラウンディング（最重要）
- 参考資料に記載のある機能・仕様・手順だけを出題する。資料に無い事項を推測で出題しない
- 解説には根拠となる具体的な機能名・設定名を含める
- 確信が持てない事項は出題しない（その結果10問未満になっても構わない）

## 難易度分布（厳守）
- basic（基礎理解・用語）: 2問
- applied（実務シナリオ）: 5問 — 「あなたは〜の管理者です。〜という要件があります」のような状況設定を2〜4文で書き、最適な手段を選ばせる
- analytical（分析・判断）: 3問 — 複数の選択肢が部分的に正しい中で、制約条件から最適解を判断させる

## 複数選択問題
- 10問のうち2〜3問は複数正解（"type": "multiple"、correctAnswers に2〜3個のキー）にする
- 複数選択の問題文の末尾には「（該当するものをすべて選択してください）」と明記する
- 残りは "type": "single"（correctAnswers は1個）

## 誤答肢の品質
- 「実在するが要件に合わない」選択肢を使う（明らかなデタラメは禁止）
- 解説には正解の根拠に加え、各誤答肢がなぜ要件に合わないかを1文ずつ書く

## 正解分散
- correctAnswers のキーが A〜D に偏らないように分散させる

## 重複禁止
以下の既存問題と同じ論点の問題は作らない:
${existingList || '（既存問題なし）'}

## few-shot 例（この品質・形式に合わせて作成すること）
[
  {
    "question": "あなたは GitHub Enterprise Cloud の管理者です。全 Organization のリポジトリに対し、main ブランチへの直接 push を禁止し、必ず Pull Request を経由させたいという要件があります。管理コストを最小にする最も適切な方法はどれですか？",
    "options": {
      "A": "各リポジトリの Settings > Branches から個別にブランチ保護ルールを設定する",
      "B": "Organization ごとにリポジトリテンプレートを作成し、保護ルールを含める",
      "C": "Enterprise レベルの ruleset で main への直接 push を禁止する",
      "D": "GitHub Actions で push イベントを検知して revert するワークフローを全リポジトリに配布する"
    },
    "type": "single",
    "correctAnswers": ["C"],
    "explanation": "Enterprise レベルの ruleset は配下の全 Organization・リポジトリに一括適用でき、管理コストが最小です。A は個別設定のため管理コストが高く、B はテンプレート適用後の変更を強制できず、D は push 自体を防げない事後対応です。",
    "difficulty": "applied",
    "tags": ["enterprise", "ruleset", "branch-protection"]
  },
  {
    "question": "GitHub Enterprise で SAML SSO を有効化した際、既存ユーザーが継続して Git 操作を行うために必要な操作はどれですか？（該当するものをすべて選択してください）",
    "options": {
      "A": "既存の Personal Access Token を SSO に対して authorize する",
      "B": "GitHub アカウントを新規作成し直す",
      "C": "SSH キーを SSO に対して authorize する",
      "D": "リポジトリをすべて fork し直す"
    },
    "type": "multiple",
    "correctAnswers": ["A", "C"],
    "explanation": "SAML SSO 有効化後、既存の PAT と SSH キーは SSO セッションに対する authorize が必要です。B はアカウント再作成不要（既存アカウントを IdP にリンク）、D の fork し直しは SSO と無関係です。",
    "difficulty": "applied",
    "tags": ["saml", "sso", "authentication"]
  }
]

## 出力形式
JSON 配列のみを返してください（説明文・コードブロック記号は不要）:
[
  {
    "question": "問題文（日本語）",
    "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
    "type": "single | multiple",
    "correctAnswers": ["A"],
    "explanation": "解説（正解の根拠 + 各誤答がなぜ誤りか）",
    "difficulty": "basic | applied | analytical",
    "tags": ["タグ1", "タグ2"]
  }
]`;
}

function buildContextSection(guideText, courseText, searchText) {
  const parts = [];

  if (guideText) {
    parts.push(`## 学習ガイド（試験出題範囲）\n${guideText}`);
  }

  if (courseText) {
    parts.push(`## コースコンテンツ（学習モジュール）\n${courseText}`);
  }

  if (searchText) {
    parts.push(`## 関連ドキュメント（Microsoft Learn 検索結果）\n${searchText}`);
  }

  return parts.length > 0
    ? parts.join('\n\n')
    : '## 参考資料\n（コンテンツの取得に失敗しました。確実に知っている一般的な知識のみから問題を作成してください）';
}

/**
 * 第2 LLM 呼び出しで生成問題を参考資料と照合し、不正確な問題を修正または除外する。
 * レビューに失敗した場合は原案をそのまま返す（graceful degradation）。
 */
async function reviewQuestions(openai, modelName, rawQuestions, contextSection) {
  const prompt = `あなたはMicrosoft/GitHub認定資格試験問題の校閲者です。
以下の「参考資料」と「問題案」を照合し、次の基準でレビューしてください:

1. **事実誤認**: 参考資料や既知の製品仕様と矛盾する問題は、正しい内容に修正する。修正不能なら配列から除外する
2. **根拠なし**: 参考資料に根拠が無く、確信が持てない問題は除外する
3. **正解の妥当性**: correctAnswers が本当に正解か検証する。誤っていれば修正する
4. **解説の整合性**: 解説が正解と矛盾していれば修正する

問題の新規追加は禁止。修正・除外のみ行い、レビュー済みの JSON 配列のみを返してください（説明文・コードブロック記号は不要）。

${contextSection}

## 問題案
${JSON.stringify(rawQuestions, null, 2)}`;

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.choices[0]?.message?.content || '';
    const json = extractJsonArray(text);
    if (!json) return rawQuestions;
    const reviewed = JSON.parse(json);
    if (!Array.isArray(reviewed) || reviewed.length === 0) return rawQuestions;
    return reviewed;
  } catch (err) {
    console.warn('[generation] レビューパス失敗、原案を使用:', err.message);
    return rawQuestions;
  }
}

/**
 * LLM 呼び出しエラーを利用者向けの分かりやすいメッセージに変換する。
 * GitHub Models で custom ティア（gpt-5系/o系/deepseek-r1 等）を無料枠で使うと
 * unavailable_model になるため、別モデルを選ぶよう案内する。それ以外は原エラーを返す。
 */
function mapLlmError(err, modelName) {
  const code = err?.code || err?.error?.code || '';
  const msg = String(err?.message || '');
  if (code === 'unavailable_model' || /unavailable[_ ]model/i.test(msg)) {
    return new Error(
      `モデル「${modelName}」はお使いの GitHub Models プランでは利用できません。` +
        '別のモデル（openai/gpt-4.1 など「標準」グループのモデル）を選んでください。'
    );
  }
  return err;
}

/** LLM レスポンステキストから問題の生配列（id 付与前）を取り出す */
function extractRawQuestions(text) {
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
  return questions;
}

/**
 * 生問題に id を採番し、type / correctAnswers / correctAnswer を正規化する。
 * correctAnswer は後方互換のため correctAnswers の先頭を入れる。
 */
function normalizeQuestions(rawQuestions, certId, domainId, idOffset = 0) {
  return rawQuestions.map((q, i) => {
    const correctAnswers = Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0
      ? q.correctAnswers
      : (q.correctAnswer ? [q.correctAnswer] : []);
    const type = q.type === 'multiple' || correctAnswers.length > 1 ? 'multiple' : 'single';
    return {
      id: `${certId}-${domainId}-${String(idOffset + i + 1).padStart(3, '0')}-gen`,
      question: q.question || '',
      options: q.options || {},
      type,
      correctAnswers,
      correctAnswer: correctAnswers[0] || '',
      explanation: q.explanation || '',
      difficulty: q.difficulty || 'basic',
      tags: Array.isArray(q.tags) ? q.tags : [],
    };
  });
}

module.exports = {
  generateQuestions,
  extractDomainSection,
  extractRawQuestions,
  normalizeQuestions,
  buildPrompt,
  mapLlmError,
};
