# 問題生成の品質改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 問題生成の品質改善 — グラウンディング強化・レビューパス・機械検証でハルシネーションを減らし、シナリオ型難問と複数選択（複数正解）問題を出題可能にし、gpt-5 系を含むモデルを UI から動的に選択できるようにする。

**Architecture:** GitHub Models 新エンドポイント（`https://models.github.ai/inference`、モデル ID `openai/gpt-5` 形式）へ移行し、カタログ API でモデル一覧を動的取得。生成は「コンテキスト収集（MCP fetch 見出し抽出 + MCP search）→ LLM 生成 → LLM レビュー → 機械検証」の多段パイプラインに刷新。問題スキーマに `type` / `correctAnswers` を追加し、クイズ UI で複数選択に対応する。

**Tech Stack:** Node.js 20 / Express 4 / EJS / openai SDK（GitHub Models 互換）/ @modelcontextprotocol/sdk / vitest + supertest

**Spec:** `docs/superpowers/specs/2026-06-13-question-generation-quality-design.md`（必読。決定事項 D1〜D9 とリスクゲートを参照）

**実行前提:**

```bash
docker compose up -d cosmos-emulator   # テスト実行前に必須
```

テストは `npm test`（全件）または `npx vitest run tests/<file>`（個別）。シリアル実行のため個別実行が速い。

---

### Task 1: スパイク — 新 GitHub Models API がユーザーの OAuth トークンで使えるか検証

**⚠️ これはリスクゲートです。このタスクの結果が NG ならば Task 2 以降を実行せず、ユーザーに報告して中断すること。**

新エンドポイント（catalog / inference）は `models:read` 権限を要求する。GitHub OAuth App のアクセストークン（本アプリのログインで得るもの）で通るかは未確認。

**Files:**
- Create: `scripts/check-models-api.js`

- [ ] **Step 1: スパイクスクリプトを作成**

```js
'use strict';

/**
 * スパイク: GitHub Models の新 API（catalog + inference）が
 * 手元のトークンで使えるかを確認する使い捨てスクリプト。
 *
 * 使い方:
 *   node scripts/check-models-api.js <トークン>     # PAT などを直接渡す
 *   node scripts/check-models-api.js db:            # Cosmos の users 一覧を表示
 *   node scripts/check-models-api.js db:<userId>    # ログイン済みユーザーの OAuth トークンで検証
 *
 * 判定基準（スペックのリスクゲート）:
 *   - db:<userId>（OAuth App トークン）で catalog / inference の両方が 200 → 実装続行 OK
 *   - PAT では通るが OAuth トークンで 401/403 → 実装を中断してユーザーに報告
 */

require('dotenv').config();

const CATALOG_URL = 'https://models.github.ai/catalog/models';
const INFERENCE_URL = 'https://models.github.ai/inference/chat/completions';

async function resolveToken(arg) {
  if (!arg || !arg.startsWith('db:')) return arg;
  const cosmosService = require('../services/cosmosService');
  await cosmosService.init();
  const userId = arg.slice(3);
  if (!userId) {
    const users = await cosmosService.query('users', { query: 'SELECT c.id, c.githubLogin FROM c' });
    console.log('users コンテナのユーザー一覧:');
    for (const u of users) console.log(`  db:${u.id}  (${u.githubLogin})`);
    process.exit(0);
  }
  const userService = require('../services/userService');
  const token = await userService.getGithubAccessToken(userId);
  if (!token) {
    console.error(`ユーザー ${userId} のアクセストークンが取得できませんでした`);
    process.exit(1);
  }
  return token;
}

async function main() {
  const token = await resolveToken(process.argv[2] || process.env.GITHUB_TOKEN);
  if (!token) {
    console.error('使い方: node scripts/check-models-api.js <token | db: | db:userId>');
    process.exit(1);
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 1) カタログ API
  const catRes = await fetch(CATALOG_URL, { headers });
  console.log(`[catalog]   GET ${CATALOG_URL} -> ${catRes.status}`);
  if (catRes.ok) {
    const models = await catRes.json();
    console.log(`[catalog]   モデル数: ${models.length}, 例: ${models.slice(0, 5).map((m) => m.id).join(', ')}`);
    const gpt5 = models.filter((m) => m.id.startsWith('openai/gpt-5')).map((m) => m.id);
    console.log(`[catalog]   gpt-5 系: ${gpt5.join(', ') || '(なし)'}`);
  } else {
    console.log(`[catalog]   body: ${(await catRes.text()).slice(0, 300)}`);
  }

  // 2) inference API（gpt-5-mini で最小呼び出し）
  const infRes = await fetch(INFERENCE_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: '1+1の答えを数字のみで返してください' }],
    }),
  });
  console.log(`[inference] POST ${INFERENCE_URL} -> ${infRes.status}`);
  const body = await infRes.text();
  console.log(`[inference] body: ${body.slice(0, 300)}`);

  console.log(catRes.ok && infRes.ok ? '\n✅ 両方 OK — 実装続行可能' : '\n❌ NG — 実装を中断して報告すること');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: ユーザーに実行を依頼（CHECKPOINT — 停止して確認）**

ユーザーに以下を依頼し、**出力の貼り付けを待つ**:

```bash
# ローカルでアプリにログイン済みであること（Cosmos エミュレータ起動 + npm run dev で GitHub ログイン）
node scripts/check-models-api.js db:        # ユーザー ID を確認
node scripts/check-models-api.js db:<上で表示された自分のID>
```

判定:
- `✅ 両方 OK` → Step 3 へ
- `❌ NG`（401/403 等）→ **ここで中断**。「OAuth App トークンでは新 GitHub Models API を呼べないため、fine-grained PAT 登録機能の設計が先に必要」とユーザーに報告して終了

- [ ] **Step 3: コミット**

```bash
git add scripts/check-models-api.js
git commit -m "chore(spike): GitHub Models 新 API の疎通確認スクリプトを追加"
```

---

### Task 2: llmClient を新エンドポイント・gpt-5 系デフォルトへ移行（TDD）

**Files:**
- Modify: `services/llmClient.js`
- Test: `tests/llmClient.test.mjs`

- [ ] **Step 1: 既存テストの定数 assert を先に更新（red）**

`tests/llmClient.test.mjs` の `describe('llmClient 定数')` ブロックを以下に置き換える。
import 部の分割代入に `GENERATION_DEFAULT_MODEL` を追加する:

```js
const {
  GITHUB_MODELS_ENDPOINT,
  GITHUB_MODELS_DEFAULT_MODEL,
  GENERATION_DEFAULT_MODEL,
  LLM_TIMEOUT_MS,
  createLlmClient,
  extractJsonObject,
  extractJsonArray,
} = llmClient;

describe('llmClient 定数', () => {
  it('GitHub Models のエンドポイント・モデル・タイムアウトを公開する', () => {
    expect(GITHUB_MODELS_ENDPOINT).toBe('https://models.github.ai/inference');
    expect(GITHUB_MODELS_DEFAULT_MODEL).toBe('openai/gpt-5-mini');
    expect(GENERATION_DEFAULT_MODEL).toBe('openai/gpt-5');
    expect(LLM_TIMEOUT_MS).toBe(120000);
  });
});
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/llmClient.test.mjs`
Expected: FAIL（旧エンドポイント `models.inference.ai.azure.com` のまま / `GENERATION_DEFAULT_MODEL` undefined）

- [ ] **Step 3: llmClient.js を更新（green）**

`services/llmClient.js` の定数定義とコメント・exports を以下に変更:

```js
// GitHub Models API（OpenAI 互換エンドポイント）。認証はユーザーの GitHub アクセストークン。
// モデル ID は {publisher}/{model} 形式（例: openai/gpt-5）。
// 呼び出し規約は gpt-5 系をベースとする: temperature 等のサンプリングパラメータは送らない
// （gpt-5 系は非対応）。トークン上限を指定する場合は max_tokens ではなく max_completion_tokens。
// gpt-4 系はサポート対象外（フォールバックにも含めない）。
const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference';
// 補助タスク（資格抽出・アドベンチャー生成）用の既定モデル。高速・低レート消費。
const GITHUB_MODELS_DEFAULT_MODEL = 'openai/gpt-5-mini';
// 問題生成用の既定モデル。品質優先（UI で変更可能）。
const GENERATION_DEFAULT_MODEL = 'openai/gpt-5';
const LLM_TIMEOUT_MS = 120000;
```

`module.exports` に `GENERATION_DEFAULT_MODEL` を追加:

```js
module.exports = {
  GITHUB_MODELS_ENDPOINT,
  GITHUB_MODELS_DEFAULT_MODEL,
  GENERATION_DEFAULT_MODEL,
  LLM_TIMEOUT_MS,
  createLlmClient,
  extractJsonObject,
  extractJsonArray,
};
```

- [ ] **Step 4: green を確認**

Run: `npx vitest run tests/llmClient.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add services/llmClient.js tests/llmClient.test.mjs
git commit -m "feat(llm): GitHub Models 新エンドポイントと gpt-5 系既定モデルへ移行"
```

---

### Task 3: temperature パラメータを削除（gpt-5 系は非対応）

**Files:**
- Modify: `services/certificationParser.js:109`
- Modify: `services/adventureGeneratorService.js:96`

（`services/generationService.js` の temperature は Task 6 の全面書き換えで消えるためここでは触らない）

- [ ] **Step 1: certificationParser.js から temperature を削除**

`services/certificationParser.js` の chat.completions.create 呼び出しから `temperature: 0.1,` の行を削除:

```js
  const response = await openai.chat.completions.create({
    model: GITHUB_MODELS_DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
```

- [ ] **Step 2: adventureGeneratorService.js から temperature を削除**

`services/adventureGeneratorService.js` の chat.completions.create 呼び出しから `temperature: 0.4,` の行を削除:

```js
    response = await openai.chat.completions.create({
      model: GITHUB_MODELS_DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });
```

- [ ] **Step 3: 既存テストが通ることを確認**

Run: `npx vitest run tests/certificationParser.test.mjs tests/adventureGeneratorService.test.mjs`
Expected: PASS（LLM はモックされているため挙動不変）

- [ ] **Step 4: コミット**

```bash
git add services/certificationParser.js services/adventureGeneratorService.js
git commit -m "fix(llm): gpt-5 系非対応の temperature パラメータを削除"
```

---

### Task 4: questionValidator — 生成問題の機械検証（TDD・新規サービス）

**Files:**
- Create: `services/questionValidator.js`
- Test: `tests/questionValidator.test.mjs`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`tests/questionValidator.test.mjs` を新規作成:

```js
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { validateQuestions } = _require('../services/questionValidator');

function validQuestion(overrides = {}) {
  return {
    question: 'GitHub Enterprise の監査ログをエクスポートする最適な方法はどれですか？',
    options: { A: '選択肢Aの内容', B: '選択肢Bの内容', C: '選択肢Cの内容', D: '選択肢Dの内容' },
    type: 'single',
    correctAnswers: ['A'],
    correctAnswer: 'A',
    explanation: '監査ログ API を使うと外部ストレージへの定期エクスポートが可能です。B/C/D は要件に合いません。',
    ...overrides,
  };
}

describe('validateQuestions', () => {
  test('正常な問題は valid に入る', () => {
    const { valid, rejected } = validateQuestions([validQuestion()]);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  test('選択肢が4つ（A〜D）でなければ除外', () => {
    const q = validQuestion({ options: { A: 'a', B: 'b', C: 'c' } });
    const { valid, rejected } = validateQuestions([q]);
    expect(valid).toHaveLength(0);
    expect(rejected[0].reason).toContain('選択肢');
  });

  test('空の選択肢があれば除外', () => {
    const q = validQuestion({ options: { A: 'a', B: '', C: 'c', D: 'd' } });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('選択肢のテキストが重複していれば除外', () => {
    const q = validQuestion({ options: { A: '同じ', B: '同じ', C: 'c', D: 'd' } });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('正解キーが A〜D 以外なら除外', () => {
    const q = validQuestion({ correctAnswers: ['E'] });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('multiple なのに正解が1つなら除外', () => {
    const q = validQuestion({ type: 'multiple', correctAnswers: ['A'] });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('single なのに正解が複数なら除外', () => {
    const q = validQuestion({ type: 'single', correctAnswers: ['A', 'B'] });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('multiple で正解2〜3個は valid', () => {
    const q = validQuestion({ type: 'multiple', correctAnswers: ['A', 'C'] });
    expect(validateQuestions([q]).valid).toHaveLength(1);
  });

  test('解説が20文字未満なら除外', () => {
    const q = validQuestion({ explanation: '短い' });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('既存問題と問題文が重複していれば除外（空白・大小文字無視）', () => {
    const existing = [{ question: 'GitHub  Enterprise の監査ログをエクスポートする最適な方法はどれですか？' }];
    const { valid, rejected } = validateQuestions([validQuestion()], { existingQuestions: existing });
    expect(valid).toHaveLength(0);
    expect(rejected[0].reason).toContain('重複');
  });

  test('同一バッチ内の重複も2問目以降を除外', () => {
    const { valid } = validateQuestions([validQuestion(), validQuestion()]);
    expect(valid).toHaveLength(1);
  });

  test('correctAnswers が無く correctAnswer のみでも検証できる（後方互換）', () => {
    const q = validQuestion();
    delete q.correctAnswers;
    expect(validateQuestions([q]).valid).toHaveLength(1);
  });
});
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/questionValidator.test.mjs`
Expected: FAIL（`Cannot find module '../services/questionValidator'`）

- [ ] **Step 3: services/questionValidator.js を実装**

```js
'use strict';

const VALID_KEYS = ['A', 'B', 'C', 'D'];

/** 問題文の比較用正規化（空白除去 + 小文字化） */
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * 1問を検証し、不正なら除外理由（文字列）を返す。正常なら null。
 */
function checkQuestion(q, seen) {
  if (!q || typeof q.question !== 'string' || q.question.trim().length < 10) return '問題文が短すぎる';
  const optionKeys = Object.keys(q.options || {});
  if (optionKeys.length !== 4 || VALID_KEYS.some((k) => !optionKeys.includes(k))) return '選択肢が A〜D の4つではない';
  if (VALID_KEYS.some((k) => !String(q.options[k] || '').trim())) return '空の選択肢がある';
  const texts = VALID_KEYS.map((k) => normalizeText(q.options[k]));
  if (new Set(texts).size !== 4) return '選択肢のテキストが重複している';
  const answers = Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0
    ? q.correctAnswers
    : (q.correctAnswer ? [q.correctAnswer] : []);
  if (answers.length === 0 || answers.some((a) => !VALID_KEYS.includes(a))) return '正解キーが不正';
  if (q.type === 'multiple' && answers.length < 2) return 'multiple なのに正解が1つ';
  if (q.type !== 'multiple' && answers.length > 1) return 'single なのに正解が複数';
  if (typeof q.explanation !== 'string' || q.explanation.trim().length < 20) return '解説が不足（20文字以上必要）';
  if (seen.has(normalizeText(q.question))) return '既存問題と重複';
  return null;
}

/**
 * LLM が生成した問題の機械検証。不正な問題を除外し、
 * { valid, rejected: [{ question, reason }] } を返す。
 * existingQuestions（既存の問題配列）との重複もここで弾く。
 */
function validateQuestions(questions, { existingQuestions = [] } = {}) {
  const valid = [];
  const rejected = [];
  const seen = new Set(existingQuestions.map((q) => normalizeText(q.question)));

  for (const q of questions || []) {
    const reason = checkQuestion(q, seen);
    if (reason) {
      rejected.push({ question: q, reason });
    } else {
      seen.add(normalizeText(q.question));
      valid.push(q);
    }
  }
  return { valid, rejected };
}

module.exports = { validateQuestions };
```

- [ ] **Step 4: green を確認**

Run: `npx vitest run tests/questionValidator.test.mjs`
Expected: PASS（12 tests）

- [ ] **Step 5: spec-coverage ハーネスが green であることを確認**

Run: `npx vitest run tests/_harness/spec-coverage.test.mjs`
Expected: PASS（`questionValidator.js` はテストファイル名で検出される）

- [ ] **Step 6: コミット**

```bash
git add services/questionValidator.js tests/questionValidator.test.mjs
git commit -m "feat(generation): 生成問題の機械検証 questionValidator を追加"
```

---

### Task 5: questionService.getCorrectAnswers — 正解キーの正規化ヘルパー（TDD）

**Files:**
- Modify: `services/questionService.js`
- Test: `tests/questionService.helpers.test.mjs`（新規・standalone）

- [ ] **Step 1: 失敗するテストを書く**

`tests/questionService.helpers.test.mjs` を新規作成:

```js
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { getCorrectAnswers } = _require('../services/questionService');

describe('getCorrectAnswers', () => {
  test('correctAnswers 配列があればそれを返す', () => {
    expect(getCorrectAnswers({ correctAnswers: ['A', 'C'], correctAnswer: 'A' })).toEqual(['A', 'C']);
  });

  test('correctAnswers が無ければ correctAnswer を配列化して返す（既存データ互換）', () => {
    expect(getCorrectAnswers({ correctAnswer: 'B' })).toEqual(['B']);
  });

  test('correctAnswers が空配列なら correctAnswer にフォールバック', () => {
    expect(getCorrectAnswers({ correctAnswers: [], correctAnswer: 'D' })).toEqual(['D']);
  });

  test('どちらも無ければ空配列', () => {
    expect(getCorrectAnswers({})).toEqual([]);
    expect(getCorrectAnswers(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/questionService.helpers.test.mjs`
Expected: FAIL（`getCorrectAnswers is not a function`）

- [ ] **Step 3: questionService.js にヘルパーを実装**

`services/questionService.js` の `shuffle` 関数の直後に追加し、`module.exports` に `getCorrectAnswers` を追加する:

```js
/**
 * 問題の正解キー配列を返す（複数選択対応の正規化ヘルパー）。
 * correctAnswers 配列があればそれを、なければ既存データ互換で
 * correctAnswer 単一キーを配列化して返す。
 */
function getCorrectAnswers(question) {
  if (Array.isArray(question?.correctAnswers) && question.correctAnswers.length > 0) {
    return question.correctAnswers;
  }
  return question?.correctAnswer ? [question.correctAnswer] : [];
}
```

- [ ] **Step 4: green を確認**

Run: `npx vitest run tests/questionService.helpers.test.mjs tests/questionService.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add services/questionService.js tests/questionService.helpers.test.mjs
git commit -m "feat(quiz): 複数正解を正規化する getCorrectAnswers ヘルパーを追加"
```

---

### Task 6: generationService 刷新 — グラウンディング強化・プロンプト刷新・レビューパス・検証統合

**Files:**
- Modify: `services/generationService.js`（全面書き換え）
- Modify: `tests/_harness/spec-coverage.test.mjs`（ALLOWED_UNTESTED から generationService を除去）
- Test: `tests/generationService.test.mjs`（新規）

- [ ] **Step 1: 純粋関数の失敗するテストを書く**

`tests/generationService.test.mjs` を新規作成:

```js
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { extractDomainSection, normalizeQuestions, buildPrompt } = _require('../services/generationService');

describe('extractDomainSection', () => {
  const markdown = [
    '# 学習ガイド',
    'はじめに',
    '## Domain 1: Support GitHub Enterprise for users',
    'ドメイン1の本文です。',
    '### サブセクション',
    'サブ本文。',
    '## Domain 2: Manage user identities',
    'ドメイン2の本文です。',
  ].join('\n');

  test('ドメイン見出しから次の同レベル見出しまでを切り出す', () => {
    const section = extractDomainSection(markdown, 'Domain 1: Support GitHub Enterprise for users');
    expect(section).toContain('ドメイン1の本文です。');
    expect(section).toContain('サブ本文。');
    expect(section).not.toContain('ドメイン2の本文です。');
  });

  test('見出しが見つからなければ null', () => {
    expect(extractDomainSection(markdown, 'Domain 9: 存在しないドメイン')).toBe(null);
  });

  test('空入力でも落ちない', () => {
    expect(extractDomainSection('', 'Domain 1: x')).toBe(null);
    expect(extractDomainSection(null, 'Domain 1: x')).toBe(null);
  });
});

describe('normalizeQuestions', () => {
  test('correctAnswers が複数なら type=multiple、id は連番 -gen 形式', () => {
    const raw = [{
      question: 'Q1', options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      correctAnswers: ['A', 'C'], explanation: 'E1', difficulty: 'applied', tags: ['t'],
    }];
    const [q] = normalizeQuestions(raw, 'gh-100', 'domain-1', 2);
    expect(q.id).toBe('gh-100-domain-1-003-gen');
    expect(q.type).toBe('multiple');
    expect(q.correctAnswers).toEqual(['A', 'C']);
    expect(q.correctAnswer).toBe('A'); // 後方互換: 先頭の正解
  });

  test('correctAnswer 単一文字列のみでも正規化される（type=single）', () => {
    const raw = [{ question: 'Q', options: {}, correctAnswer: 'B', explanation: 'E' }];
    const [q] = normalizeQuestions(raw, 'c', 'd', 0);
    expect(q.type).toBe('single');
    expect(q.correctAnswers).toEqual(['B']);
    expect(q.correctAnswer).toBe('B');
  });
});

describe('buildPrompt', () => {
  const domain = { id: 'domain-1', name: 'Domain 1: Support GitHub Enterprise' };

  test('ドメイン名・難易度分布・複数選択・グラウンディング指示を含む', () => {
    const prompt = buildPrompt(domain, '## 学習ガイド\n本文', []);
    expect(prompt).toContain(domain.name);
    expect(prompt).toContain('basic');
    expect(prompt).toContain('multiple');
    expect(prompt).toContain('参考資料');
  });

  test('既存問題のリストが重複禁止セクションに入る', () => {
    const existing = [{ question: '既存問題ですよこれは' }];
    const prompt = buildPrompt(domain, 'ctx', existing);
    expect(prompt).toContain('既存問題ですよこれは');
  });
});
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/generationService.test.mjs`
Expected: FAIL（`extractDomainSection is not a function` 等）

- [ ] **Step 3: services/generationService.js を全面書き換え**

ファイル全体を以下の内容に置き換える:

```js
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
  const response = await openai.chat.completions.create({
    model: llmConfig.modelName,
    messages: [{ role: 'user', content: prompt }],
  });

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
};
```

- [ ] **Step 4: green を確認**

Run: `npx vitest run tests/generationService.test.mjs`
Expected: PASS

- [ ] **Step 5: spec-coverage ハーネスから generationService の除外エントリを削除**

`tests/_harness/spec-coverage.test.mjs` の `ALLOWED_UNTESTED` から以下の 3 行（コメント 2 行 + エントリ 1 行）を削除する:

```js
  // 問題生成（Copilot/OpenAI + Microsoft Learn MCP）は外部 IO が重く、
  // ユニット化しにくい。上位 routes/api.js 経由で手動確認。
  ['services/generationService.js', 'heavy external IO (LLM + MCP), manual verification'],
```

- [ ] **Step 6: ハーネスと関連テストが green であることを確認**

Run: `npx vitest run tests/_harness/spec-coverage.test.mjs tests/routes.api.test.mjs`
Expected: PASS（generationService はテストファイル名で検出される）

- [ ] **Step 7: コミット**

```bash
git add services/generationService.js tests/generationService.test.mjs tests/_harness/spec-coverage.test.mjs
git commit -m "feat(generation): グラウンディング強化・レビューパス・機械検証の多段パイプラインに刷新"
```

---

### Task 7: modelCatalogService — モデル一覧の動的取得（TDD・新規サービス）

**Files:**
- Create: `services/modelCatalogService.js`
- Test: `tests/modelCatalogService.test.mjs`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`tests/modelCatalogService.test.mjs` を新規作成:

```js
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const modelCatalogService = _require('../services/modelCatalogService');

const CATALOG_RESPONSE = [
  {
    id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', publisher: 'DeepSeek',
    supported_input_modalities: ['text'], supported_output_modalities: ['text'],
  },
  {
    id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI',
    supported_input_modalities: ['text', 'image'], supported_output_modalities: ['text'],
  },
  {
    id: 'openai/text-embedding-3-small', name: 'Embedding', publisher: 'OpenAI',
    supported_input_modalities: ['text'], supported_output_modalities: ['embeddings'],
  },
];

describe('modelCatalogService.listModels', () => {
  beforeEach(() => {
    modelCatalogService._resetCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('text→text のチャットモデルのみ返し、openai/gpt-5 系を先頭にソートする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => CATALOG_RESPONSE })));
    const models = await modelCatalogService.listModels('token');
    expect(models.map((m) => m.id)).toEqual(['openai/gpt-5', 'deepseek/deepseek-r1']);
  });

  test('カタログ取得失敗（非2xx）時はフォールバック一覧を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    const models = await modelCatalogService.listModels('token');
    expect(models).toEqual(modelCatalogService.FALLBACK_MODELS);
  });

  test('fetch が throw してもフォールバック一覧を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const models = await modelCatalogService.listModels('token');
    expect(models).toEqual(modelCatalogService.FALLBACK_MODELS);
  });

  test('成功結果はキャッシュされ 2 回目の fetch は発生しない', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG_RESPONSE }));
    vi.stubGlobal('fetch', fetchMock);
    await modelCatalogService.listModels('token');
    await modelCatalogService.listModels('token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/modelCatalogService.test.mjs`
Expected: FAIL（`Cannot find module '../services/modelCatalogService'`）

- [ ] **Step 3: services/modelCatalogService.js を実装**

```js
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
```

- [ ] **Step 4: green を確認**

Run: `npx vitest run tests/modelCatalogService.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add services/modelCatalogService.js tests/modelCatalogService.test.mjs
git commit -m "feat(models): GitHub Models カタログからモデル一覧を動的取得する modelCatalogService を追加"
```

---

### Task 8: routes/api.js — GET /api/models 追加と generate の model パラメータ（TDD）

**Files:**
- Modify: `routes/api.js`
- Test: `tests/routes.api.test.mjs`

- [ ] **Step 1: 失敗するテストを追加（red）**

`tests/routes.api.test.mjs` に以下の変更を加える。

(1) import 直後のスパイ準備に modelCatalogService を追加（`const _orig = {...}` を以下に変更）:

```js
const generationService = _require('../services/generationService');
const userService = _require('../services/userService');
const modelCatalogService = _require('../services/modelCatalogService');
const _orig = {
  generateQuestions: generationService.generateQuestions,
  getGithubAccessToken: userService.getGithubAccessToken,
  listModels: modelCatalogService.listModels,
};
```

(2) `beforeAll` / `afterAll` / `beforeEach` にスパイを追加:

```js
beforeAll(async () => {
  await setupTestDb();
  generationService.generateQuestions = vi.fn(async () => []);
  userService.getGithubAccessToken = vi.fn(async () => 'fake-token');
  modelCatalogService.listModels = vi.fn(async () => [
    { id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI' },
  ]);
});
afterAll(() => {
  generationService.generateQuestions = _orig.generateQuestions;
  userService.getGithubAccessToken = _orig.getGithubAccessToken;
  modelCatalogService.listModels = _orig.listModels;
});
beforeEach(async () => {
  await truncateAll();
  generationService.generateQuestions.mockImplementation(async () => []);
  userService.getGithubAccessToken.mockImplementation(async () => 'fake-token');
  modelCatalogService.listModels.mockImplementation(async () => [
    { id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI' },
  ]);
});
```

(3) ファイル末尾に describe を 2 つ追加:

```js
describe('routes/api モデル選択', () => {
  test('POST generate: body.model が llmConfig.modelName に渡る', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-model-1' });
    const agent = await authedAgent(user);
    const res = await agent
      .post(`/api/certifications/${cert.id}/domains/domain-1/generate`)
      .send({ model: 'openai/gpt-5-mini' });
    expect(res.status).toBe(200);
    const callArg = generationService.generateQuestions.mock.calls.at(-1)[0];
    expect(callArg.llmConfig.modelName).toBe('openai/gpt-5-mini');
  });

  test('POST generate: model 未指定なら既定モデル openai/gpt-5', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-model-2' });
    const agent = await authedAgent(user);
    const res = await agent.post(`/api/certifications/${cert.id}/domains/domain-1/generate`);
    expect(res.status).toBe(200);
    const callArg = generationService.generateQuestions.mock.calls.at(-1)[0];
    expect(callArg.llmConfig.modelName).toBe('openai/gpt-5');
  });

  test('POST generate: model 形式不正は 400', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-model-3' });
    const agent = await authedAgent(user);
    const res = await agent
      .post(`/api/certifications/${cert.id}/domains/domain-1/generate`)
      .send({ model: 'bad model!!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('モデル');
  });
});

describe('routes/api GET /api/models', () => {
  test('未認証は / にリダイレクト', async () => {
    const res = await (await anonAgent()).get('/api/models');
    expect(res.status).toBe(302);
  });

  test('認証済みならモデル一覧 JSON を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([
      { id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI' },
    ]);
  });

  test('GitHub トークンが無ければ 400', async () => {
    const user = await createTestUser();
    userService.getGithubAccessToken.mockResolvedValueOnce(null);
    const agent = await authedAgent(user);
    const res = await agent.get('/api/models');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/routes.api.test.mjs`
Expected: FAIL（GET /api/models が 404、model パラメータ未対応）

- [ ] **Step 3: routes/api.js を更新（green）**

ファイル全体を以下の内容に置き換える:

```js
'use strict';

const express = require('express');
const router = express.Router();
const generationService = require('../services/generationService');
const questionService = require('../services/questionService');
const userService = require('../services/userService');
const modelCatalogService = require('../services/modelCatalogService');
const { requireAuth } = require('../middleware/auth');
const { initSse } = require('../middleware/sse');
const { GITHUB_MODELS_ENDPOINT, GENERATION_DEFAULT_MODEL } = require('../services/llmClient');

// GitHub Models のモデル ID 形式（{publisher}/{model}）。それ以外の入力は弾く。
const MODEL_ID_RE = /^[\w.-]+\/[\w.-]+$/;

// 利用可能なチャットモデル一覧（ドメインページのモデル選択ドロップダウン用）
router.get('/models', requireAuth, async (req, res) => {
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'GitHubトークンが見つかりません。再ログインしてください。' });
  }
  const models = await modelCatalogService.listModels(accessToken);
  res.json({ models });
});

// SSE: ドメインの問題を再生成
router.post('/certifications/:certId/domains/:domainId/generate', requireAuth, async (req, res) => {
  const { certId, domainId } = req.params;

  const cert = await questionService.readCertification(certId);
  if (!cert || !questionService.canAccessCertification(cert, req.user.id)) {
    return res.status(404).json({ error: '資格が見つかりません' });
  }

  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).json({ error: 'ドメインが見つかりません' });

  // UI から指定された生成モデル（任意）。形式不正は 400。
  const requestedModel = req.body?.model;
  if (requestedModel !== undefined && !MODEL_ID_RE.test(String(requestedModel))) {
    return res.status(400).json({ error: 'モデル ID の形式が不正です' });
  }

  // GitHub アクセストークンを取得
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'GitHubトークンが見つかりません。再ログインしてください。' });
  }

  const llmConfig = {
    endpointUrl: GITHUB_MODELS_ENDPOINT,
    apiKey: accessToken,
    modelName: requestedModel || GENERATION_DEFAULT_MODEL,
  };

  // SSE レスポンスを開始（切断耐性のある send を取得）
  const { send } = initSse(res);

  try {
    send('progress', { message: '学習ガイドとコースコンテンツを取得中...' });
    const questions = await generationService.generateQuestions({
      cert,
      certId,
      domain,
      llmConfig,
      onProgress: (msg) => send('progress', { message: msg }),
    });

    const result = await questionService.appendDomainQuestions(certId, domainId, questions);
    send('done', {
      message: `${result.appended}問を追加しました（重複スキップ: ${result.skipped}問）`,
      count: result.appended,
    });
  } catch (err) {
    console.error('Generation error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
```

- [ ] **Step 4: green を確認**

Run: `npx vitest run tests/routes.api.test.mjs`
Expected: PASS（既存 6 + 新規 6 tests）

- [ ] **Step 5: コミット**

```bash
git add routes/api.js tests/routes.api.test.mjs
git commit -m "feat(api): GET /api/models と問題生成の model パラメータを追加"
```

---

### Task 9: domain.ejs — モデル選択ドロップダウン

**Files:**
- Modify: `views/domain.ejs`

- [ ] **Step 1: 生成セクションにドロップダウンを追加**

`views/domain.ejs` の「問題追加生成」セクション内、`<button id="generateBtn"` の**直前**に以下を挿入する:

```html
      <div style="margin-bottom: 12px;">
        <label for="modelSelect" style="font-family: var(--font-display); color: var(--gold); font-size: 12px; display: block; margin-bottom: 6px;">生成モデル</label>
        <select id="modelSelect"
                style="font-family: var(--font-body); font-size: 13px; padding: 8px 12px; background: var(--window); color: var(--ink); border: 2px solid var(--gold); min-width: 240px;">
          <option value="openai/gpt-5">openai/gpt-5</option>
        </select>
      </div>
```

- [ ] **Step 2: モデル一覧のロードと送信処理を追加**

`views/domain.ejs` のインライン `<script>` 内、`async function startGeneration(...)` の**前**に以下を追加する:

```js
    async function loadModels() {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return; // フォールバック表示（openai/gpt-5）のまま
        const data = await res.json();
        const select = document.getElementById('modelSelect');
        select.innerHTML = '';
        for (const m of data.models) {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.id;
          if (m.id === 'openai/gpt-5') opt.selected = true;
          select.appendChild(opt);
        }
      } catch { /* ネットワークエラー時はフォールバック表示のまま */ }
    }
    loadModels();
```

さらに `startGeneration` 内の fetch 呼び出しに body を追加する。変更前:

```js
        const res = await fetch(`/api/certifications/${certId}/domains/${domainId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
```

変更後:

```js
        const res = await fetch(`/api/certifications/${certId}/domains/${domainId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: document.getElementById('modelSelect').value }),
        });
```

- [ ] **Step 3: ビューのレンダリングテストが通ることを確認**

Run: `npx vitest run tests/views.test.mjs tests/routes.domains.test.mjs`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add views/domain.ejs
git commit -m "feat(ui): ドメインページに問題生成モデルの選択ドロップダウンを追加"
```

---

### Task 10: 複数選択問題 — クイズ UI・採点・正解表示の対応

**Files:**
- Modify: `views/quiz.ejs`（全面書き換え）
- Modify: `views/domain.ejs:99`（正解表示の複数対応）
- Modify: `views/review.ejs:52`（正解表示の複数対応）
- Test: `tests/views.test.mjs`

- [ ] **Step 1: 複数選択クイズの失敗するレンダリングテストを追加（red)**

`tests/views.test.mjs` の `views/quiz.ejs` テストの直後に追加:

```js
  test('views/quiz.ejs（複数選択問題は回答ボタンと正解配列を埋め込む）', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'v-quiz-multi',
      domains: [
        {
          id: 'domain-1', name: 'D1', weight: 100, generatedAt: null,
          questions: [{
            id: 'qm1',
            question: '複数選択のテスト問題です（該当するものをすべて選択してください）',
            options: { A: 'a', B: 'b', C: 'c', D: 'd' },
            type: 'multiple',
            correctAnswers: ['A', 'C'],
            correctAnswer: 'A',
            explanation: 'テスト解説',
          }],
        },
      ],
    });
    const agent = await authedAgent(user);
    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const quizRes = await agent.get(startRes.headers.location);
    expect(quizRes.status).toBe(200);
    expect(quizRes.text).toContain('回答する');
    expect(quizRes.text).toContain('["A","C"]');
  });
```

- [ ] **Step 2: red を確認**

Run: `npx vitest run tests/views.test.mjs`
Expected: 新テストのみ FAIL（「回答する」が無い）

- [ ] **Step 3: views/quiz.ejs を全面書き換え（green）**

ファイル全体を以下の内容に置き換える:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %></title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=M+PLUS+1+Code:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/theme.css">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <% const s = stats || {}; const streak = (s.streak && s.streak.current) || 0;
     const lv = s.level || 1;
     const xpInto = s.xpIntoLevel || 0; const xpFor = s.xpForLevel || 100;
     const xpPct = Math.min(100, Math.round((xpInto / xpFor) * 100));
     const combo = currentCombo || 1;
     const correctAnswers = (Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0)
       ? question.correctAnswers
       : (question.correctAnswer ? [question.correctAnswer] : []);
     const isMultiple = question.type === 'multiple' || correctAnswers.length > 1;
  %>
  <%- include('partials/hud', { userEmail: typeof userEmail !== 'undefined' ? userEmail : null, heroHud: typeof heroHud !== 'undefined' ? heroHud : null, combo: typeof currentCombo !== 'undefined' ? currentCombo : null }) %>

  <main class="main">
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; font-family: var(--font-display); color: var(--ink);">
      <span>問題 <%= currentIdx + 1 %> / <%= total %></span>
      <% if (question.domainName) { %><span class="pill"><%= question.domainName %></span><% } %>
    </div>
    <div style="height: 10px; background: #000; border: 2px solid var(--ink); margin-bottom: 20px;">
      <div style="height: 100%; background: repeating-linear-gradient(90deg, var(--gold) 0 6px, #a87a00 6px 8px); width: <%= Math.round(((currentIdx) / total) * 100) %>%;"></div>
    </div>

    <section class="rpg-window is-open">
      <p style="font-family: var(--font-body); font-size: 16px; line-height: 1.6; color: var(--ink); margin: 0 0 20px;"><%= question.question %></p>
      <% if (isMultiple) { %>
        <p style="font-family: var(--font-display); font-size: 12px; color: var(--gold); margin: 0 0 12px;">☑ 複数選択 — 該当するものをすべて選んで「回答する」を押してください</p>
      <% } %>

      <form id="answerForm" method="POST" action="/quiz/<%= session.id %>/answer">
        <input type="hidden" name="questionId" value="<%= question.id %>">
        <input type="hidden" name="domainId" value="<%= question.domainId %>">
        <input type="hidden" name="questionIds" value="<%= questionIds %>">
        <input type="hidden" name="certId" value="<%= certId %>">
        <input type="hidden" name="currentIdx" value="<%= currentIdx %>">
        <input type="hidden" name="isCorrect" id="isCorrectInput" value="">
        <input type="hidden" name="selectedAnswer" id="selectedAnswerInput" value="">

        <div id="optionsContainer" style="display: flex; flex-direction: column; gap: 10px;">
          <% for (const [key, val] of Object.entries(question.options)) { %>
            <button type="button"
                    data-key="<%= key %>"
                    onclick="onOptionClick('<%= key %>')"
                    class="option-btn rpg-btn"
                    style="text-align: left; text-transform: none; letter-spacing: 0; padding: 10px 14px; font-family: var(--font-body);">
              <strong style="font-family: var(--font-display); color: var(--gold); margin-right: 8px;"><%= key %>.</strong><%= val %>
            </button>
          <% } %>
        </div>

        <% if (isMultiple) { %>
          <button type="button" id="submitMultiple" class="rpg-btn is-gold" style="margin-top: 14px;" onclick="gradeMultiple()">⚔ 回答する</button>
        <% } %>
      </form>

      <div id="explanationBox" style="display: none; margin-top: 22px; padding-top: 18px; border-top: 2px dashed var(--gold);">
        <div id="resultBadge" style="font-family: var(--font-display); font-size: 20px; margin-bottom: 10px;"></div>
        <p style="font-family: var(--font-body); color: var(--ink); line-height: 1.6;"><%= question.explanation %></p>
        <div style="margin-top: 16px;">
          <button onclick="document.getElementById('answerForm').submit()" class="rpg-btn is-gold">
            次の問題 →
          </button>
        </div>
      </div>
    </section>
  </main>

  <script>
    const CORRECT = <%- JSON.stringify(correctAnswers) %>;
    const IS_MULTIPLE = <%- JSON.stringify(isMultiple) %>;
    let answered = false;
    const selected = new Set();

    function onOptionClick(key) {
      if (answered) return;
      if (!IS_MULTIPLE) return grade([key]);
      // 複数選択: トグルで選択状態を切り替える
      const btn = document.querySelector('.option-btn[data-key="' + key + '"]');
      if (selected.has(key)) {
        selected.delete(key);
        btn.classList.remove('is-gold');
      } else {
        selected.add(key);
        btn.classList.add('is-gold');
      }
    }

    function gradeMultiple() {
      if (answered || selected.size === 0) return;
      grade([...selected].sort());
    }

    // keys: ソート済みの選択キー配列。正解集合との完全一致で採点する。
    function grade(keys) {
      answered = true;
      const correctSorted = [...CORRECT].sort();
      const isCorrect = keys.length === correctSorted.length && keys.every((k, i) => k === correctSorted[i]);
      document.getElementById('isCorrectInput').value = isCorrect;
      document.getElementById('selectedAnswerInput').value = keys.join(',');

      document.querySelectorAll('.option-btn').forEach(btn => {
        const btnKey = btn.dataset.key;
        btn.disabled = true;
        btn.classList.remove('is-gold');
        if (CORRECT.includes(btnKey)) {
          btn.classList.add('is-fern');
        } else if (keys.includes(btnKey)) {
          // 誤って選んだ選択肢: crimson のまま少し暗く
          btn.style.opacity = '0.85';
        } else {
          btn.style.opacity = '0.5';
        }
      });
      const submitBtn = document.getElementById('submitMultiple');
      if (submitBtn) submitBtn.style.display = 'none';

      const badge = document.getElementById('resultBadge');
      if (isCorrect) {
        badge.textContent = '✅ 正解！';
        badge.style.color = 'var(--fern)';
      } else {
        badge.textContent = '❌ 不正解（正解: ' + CORRECT.join(', ') + '）';
        badge.style.color = 'var(--crimson)';
      }
      document.getElementById('explanationBox').style.display = 'block';
    }
  </script>
</body>
</html>
```

- [ ] **Step 4: domain.ejs の正解表示を複数対応にする**

`views/domain.ejs` の問題一覧内、変更前:

```html
              <% const isAns = key === q.correctAnswer; %>
```

変更後:

```html
              <% const answerKeys = (Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0) ? q.correctAnswers : [q.correctAnswer]; %>
              <% const isAns = answerKeys.includes(key); %>
```

- [ ] **Step 5: review.ejs の正解表示を複数対応にする**

`views/review.ejs` の変更前:

```html
              <% const isCorrect = key === q.correctAnswer; %>
```

変更後:

```html
              <% const answerKeys = (Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0) ? q.correctAnswers : [q.correctAnswer]; %>
              <% const isCorrect = answerKeys.includes(key); %>
```

- [ ] **Step 6: green を確認（クイズ関連を一括実行）**

Run: `npx vitest run tests/views.test.mjs tests/routes.quiz.test.mjs`
Expected: PASS（既存テスト含む。既存の単一選択フローは挙動不変）

- [ ] **Step 7: コミット**

```bash
git add views/quiz.ejs views/domain.ejs views/review.ejs tests/views.test.mjs
git commit -m "feat(quiz): 複数選択（複数正解）問題の出題・採点・正解表示に対応"
```

---

### Task 11: CLAUDE.md のドキュメント更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: AI スタックの記述を更新**

「Tech Stack」セクションの変更前:

```
  - `openai` — OpenAI SDK を GitHub Models API（`https://models.inference.ai.azure.com`、既定モデル `gpt-4o-mini`、認証はユーザーの GitHub アクセストークン）に向けて使用。問題生成・資格抽出・アドベンチャー生成
```

変更後:

```
  - `openai` — OpenAI SDK を GitHub Models API（`https://models.github.ai/inference`、モデル ID は `openai/gpt-5` 形式、認証はユーザーの GitHub アクセストークン）に向けて使用。問題生成（既定 `openai/gpt-5`、UI で変更可）・資格抽出・アドベンチャー生成（既定 `openai/gpt-5-mini`）。呼び出し規約は gpt-5 系ベース: `temperature` 等のサンプリングパラメータは送らない、トークン上限は `max_completion_tokens`。gpt-4 系は不使用（フォールバックも gpt-5 系のみ）。モデル一覧は `modelCatalogService` がカタログ API から動的取得
```

- [ ] **Step 2: 主な機能 4 の記述を更新**

変更前:

```
4. **AI 問題再生成** — WebUI から「問題を再生成」→ Microsoft Learn MCP でガイドを fetch → OpenAI SDK 経由で GitHub Models API（`gpt-4o-mini`）が問題生成
```

変更後:

```
4. **AI 問題再生成** — WebUI から「問題を追加生成」→ Microsoft Learn MCP でガイド fetch + ドメイン特化検索 → GitHub Models API（既定 `openai/gpt-5`、UI でモデル選択可）で生成 → LLM レビューパス → `questionValidator` で機械検証
```

- [ ] **Step 3: サービス層一覧に新規サービスを追加**

`services/` のディレクトリ構成リスト内、`generationService.js` の行の直後に追加:

```
│   ├── modelCatalogService.js      # GitHub Models カタログ API からモデル一覧を動的取得（10分キャッシュ）
│   ├── questionValidator.js        # 生成問題の機械検証（選択肢・正解キー・解説・重複）
```

- [ ] **Step 4: 問題スキーマの記述を更新**

「資格ドキュメント `certifications`」の questions 例の変更前:

```jsonc
        {
          "id": "gh-100-d1-001",  // {certId}-{domainId}-{3桁連番}
          "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "correctAnswer": "A",
          "explanation": "..."
        }
```

変更後:

```jsonc
        {
          "id": "gh-100-d1-001",       // {certId}-{domainId}-{3桁連番}
          "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "type": "single",            // "single" | "multiple"（省略時 single）
          "correctAnswers": ["A"],     // 正解キー配列（multiple は 2〜3 個）
          "correctAnswer": "A",        // 後方互換: correctAnswers[0]。旧データはこれのみ
          "explanation": "...",
          "difficulty": "basic"        // "basic" | "applied" | "analytical"
        }
```

- [ ] **Step 5: 問題生成フローの記述を更新**

「問題生成フロー（`generationService.js`）」セクションの変更前:

```
1. `mcpClient.fetchViaLearnMcp(studyGuideUrl)` で Microsoft Learn MCP から Markdown 取得
2. 失敗時は `fetch` + `node-html-parser` でスクレイピングにフォールバック
3. ドメイン名キーワードで前後 2500 文字を切り出してプロンプトに埋め込む
4. `openai.chat.completions.create()` で問題 JSON を生成
5. レスポンスから `[...]` を regex で抽出してパース → `questionService.replaceDomainQuestions()` で Cosmos を更新
6. 呼び出し元の `routes/api.js` が SSE でクライアントに進捗ストリーミング
```

変更後:

```
1. MCP fetch で学習ガイド/コースの Markdown を取得し、見出し構造からドメインセクションを抽出
   （見出し不一致時はキーワード位置切り出し → 先頭 8000 文字 → HTML スクレイピングへフォールバック）
2. `mcpClient.callLearnSearch` でドメイン特化の関連ドキュメントを追加取得（失敗時は無視）
3. プロンプト（難易度分布 basic2/applied5/analytical3・複数選択 2〜3 問・グラウンディング指示・既存問題の重複禁止リスト）で生成
4. 第2 LLM 呼び出し（レビューパス）が参考資料と照合して不正確問題を修正/除外（失敗時は原案のまま）
5. `questionValidator.validateQuestions` で機械検証（選択肢 4 つ・正解キー妥当・解説 20 字以上・重複）→ 不正問題を除外
6. `questionService.appendDomainQuestions()` で Cosmos に追記。`routes/api.js` が SSE で進捗ストリーミング
```

- [ ] **Step 6: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: 問題生成パイプライン刷新・gpt-5 系移行・複数選択対応を CLAUDE.md に反映"
```

---

### Task 12: 最終検証（全テスト + lint + 手動確認）

- [ ] **Step 1: 全テストを実行**

```bash
docker compose up -d cosmos-emulator
npm test
```

Expected: 全 PASS（spec-coverage ハーネス含む）

- [ ] **Step 2: lint を実行**

```bash
npm run lint
```

Expected: エラー 0

- [ ] **Step 3: 手動確認（ユーザーに依頼してもよい）**

```bash
npm run dev
```

1. GitHub ログイン → 任意の資格 → ドメインページを開く
2. 「生成モデル」ドロップダウンにカタログ取得したモデル一覧が表示される（先頭は openai/gpt-5 系）
3. 「✨ 問題を追加生成する」→ SSE 進捗に「レビュー中...」が出て、問題が追加される
4. 追加された問題に applied/analytical のシナリオ型と、複数選択（「すべて選択してください」）が含まれる
5. クイズで複数選択問題が出題されたら、トグル選択 → 「⚔ 回答する」→ 集合一致で正誤判定される
6. 既存の単一選択問題は従来どおり即時判定される

- [ ] **Step 4: 結果報告**

テスト・lint の結果と、機械検証で除外された問題数（サーバーログ `[generation] N問を機械検証で除外`）を含めてユーザーに報告する。

---

## Self-Review チェック済み事項

- スペック D1〜D9 はすべてタスクに対応（D1/D2→Task 2, D3→Task 7/8/9, D4→Task 3/6, D5/D6/D7→Task 6, D8→Task 6/5, D9→Task 10）
- リスクゲート（OAuth トークン検証）は Task 1 で最初に実施。NG なら中断
- `GENERATION_DEFAULT_MODEL` は Task 2 で定義し Task 8 で使用（型整合）
- `validateQuestions` のシグネチャは Task 4 定義と Task 6 使用で一致
- `getCorrectAnswers` は Task 5 で追加（ビューでは EJS 内でインライン正規化しているため未使用だが、今後のサーバーサイド利用に備えた公開ヘルパー。YAGNI 違反ではなく D8 の正規化方針の単一実装点）
- 旧 `parseQuestionsFromResponse` は `extractRawQuestions` + `normalizeQuestions` に分割（レビューパスを id 採番前に挟むため）
