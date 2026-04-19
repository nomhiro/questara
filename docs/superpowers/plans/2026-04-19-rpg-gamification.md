# RPGゲーミフィケーション実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仕様書 `docs/superpowers/specs/2026-04-19-rpg-gamification-design.md` に基づき、既存の資格学習アプリを「ドット絵レトロRPG × 成長感」のゲーム体験にリファクタする MVP を段階実装する（M1〜M5）。

**Architecture:** 既存の `routes/ → services/ → Cosmos DB` 構造を温存し、`gamificationService` / `achievementService` / `adventureService` / `adventureGeneratorService` / `mcpClient` を追加する。クイズ回答時とセッション完了時に gamificationService がフックされ、XP/レベル/コンボ/マスタリーランク/ストリーク/実績を算出・保存する。冒険（adventures）は Microsoft Learn MCP で裏取りした LLM 推論で動的生成できる。UI は全面的にドット絵RPGテーマ（`public/theme.css` に集約）に刷新する。

**Tech Stack:**
- Node.js ≥20 / Express 4 / EJS 3
- Cosmos DB (@azure/cosmos v4) / JWT / cookie-parser
- **vitest**（既存devDep）でユニットテスト記述
- `@modelcontextprotocol/sdk`（既存依存、`StreamableHTTPClientTransport` で Microsoft Learn MCP 接続）
- `openai` SDK（既存依存、OpenAI 互換API として GitHub Models を呼ぶ）
- Tailwind CDN 継続（レイアウト用のみ）＋ 新規 `public/theme.css`（ドット絵テーマ一式）

**テスト方針:**
- ユニットテスト: 純粋ロジック（gamificationService の XP/Lv/コンボ/ランク計算、achievementService の判定、adventureService の解放判定、adventureGeneratorService の JSON パース＋フィルタ）は vitest で書く
- Cosmos 依存層は vitest の `vi.mock` で `cosmosService` をモックして書く
- ルート層・EJS ビューは**手動ブラウザ確認**（既存方針を踏襲、自動E2Eは対象外）

**コミット粒度:** 各 Task の末尾で 1 コミット（例外は明記）。コミットメッセージは conventional commits（`feat:` / `refactor:` / `style:` / `test:` / `docs:`）。

---

## 前提セットアップ

### Task 0.1: テスト用ディレクトリ作成

**Files:**
- Create: `tests/.gitkeep`

- [ ] **Step 1: `tests/` ディレクトリを作成**（空ファイル `.gitkeep` を置く）

```
(ファイル内容は空でよい)
```

- [ ] **Step 2: vitest 設定の確認**

`package.json` の `scripts.test` は既に `vitest run`、`devDependencies` に `vitest` があるため追加導入は不要。

- [ ] **Step 3: 動作確認**

```
npm test
```

Expected: `No test files found` で exit 0（テスト0件でも成功）

- [ ] **Step 4: コミット**

```
git add tests/.gitkeep
git commit -m "chore: add tests directory"
```

---

## マイルストーン M1: 基盤ゲーミフィケーション

### Task 1.1: gamificationService 骨組み＋ XP計算のTDD

**Files:**
- Create: `services/gamificationService.js`
- Create: `tests/gamificationService.test.js`

- [ ] **Step 1: 失敗テストを書く**

`tests/gamificationService.test.js`:

```js
import { describe, it, expect } from 'vitest';
import gamificationService from '../services/gamificationService.js';

describe('calcAnswerXp', () => {
  it('正解時 base 10、combo 1 では +weightBonus のみ', () => {
    const xp = gamificationService.calcAnswerXp({ isCorrect: true, combo: 1, domainWeight: 20 });
    expect(xp).toBe(10 + 2); // floor(20/10) = 2
  });

  it('不正解時は base 2、weight ボーナスは付与', () => {
    const xp = gamificationService.calcAnswerXp({ isCorrect: false, combo: 5, domainWeight: 15 });
    expect(xp).toBe(2 + 1);
  });

  it('combo 倍率は 1.0 + 0.1*(combo-1) で上限 2.0', () => {
    const xp = gamificationService.calcAnswerXp({ isCorrect: true, combo: 3, domainWeight: 0 });
    // base 10 * 1.2 = 12, weightBonus 0
    expect(xp).toBe(12);
  });

  it('combo 11 以上は倍率 2.0 に固定', () => {
    const xp = gamificationService.calcAnswerXp({ isCorrect: true, combo: 20, domainWeight: 0 });
    expect(xp).toBe(20);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```
npm test
```

Expected: `Cannot find module '../services/gamificationService.js'` 系のエラー

- [ ] **Step 3: 最小実装**

`services/gamificationService.js`:

```js
'use strict';

function calcAnswerXp({ isCorrect, combo, domainWeight = 0 }) {
  const baseXp = isCorrect ? 10 : 2;
  const weightBonus = Math.floor(domainWeight / 10);
  const effectiveCombo = isCorrect ? combo : 1;
  const multiplier = Math.min(1.0 + 0.1 * (effectiveCombo - 1), 2.0);
  return Math.round(baseXp * multiplier) + weightBonus;
}

module.exports = { calcAnswerXp };
```

**注意:** テストは ESM import、本体は CJS `module.exports`。vitest はどちらも読める（既存プロジェクトが CJS 前提のため本体は CJS で統一）。

- [ ] **Step 4: テストが通ることを確認**

```
npm test
```

Expected: 4 passed

- [ ] **Step 5: コミット**

```
git add services/gamificationService.js tests/gamificationService.test.js
git commit -m "feat(gamification): add calcAnswerXp with combo multiplier"
```

---

### Task 1.2: レベル曲線（recomputeLevel）

**Files:**
- Modify: `services/gamificationService.js`
- Modify: `tests/gamificationService.test.js`

- [ ] **Step 1: 失敗テストを追加**

`tests/gamificationService.test.js` に追記:

```js
describe('recomputeLevel', () => {
  it('XP 0 は Lv.1', () => {
    expect(gamificationService.recomputeLevel(0)).toBe(1);
  });
  it('Lv.1→2 は 100 XP で到達', () => {
    expect(gamificationService.recomputeLevel(99)).toBe(1);
    expect(gamificationService.recomputeLevel(100)).toBe(2);
  });
  it('累積式 100 * N^1.5 に従う', () => {
    // Lv.5到達には 100 + 282 + 519 + 800 ≒ 1701 XP, Lv.5→6 は 1118 必要
    // (floor(100*5^1.5) = 1118 が 5→6 に必要な追加ではなく累積)
    // 仕様: totalXpNeeded(N) = floor(100 * N^1.5) は Lv.N→N+1 に必要 "累積" ではなく "追加" と解釈
    // ここでは「Lv.N→N+1 に必要な追加XP」として扱う
    // Lv.2→3 に必要な追加: floor(100 * 2^1.5) = 282
    // 100 (Lv2到達) + 282 (Lv3到達) = 382
    expect(gamificationService.recomputeLevel(381)).toBe(2);
    expect(gamificationService.recomputeLevel(382)).toBe(3);
  });
});

describe('xpForNextLevel / xpProgressInLevel', () => {
  it('Lv.1 で XP 50 のときの内訳', () => {
    const { currentLevel, xpIntoLevel, xpForLevel } = gamificationService.xpBreakdown(50);
    expect(currentLevel).toBe(1);
    expect(xpIntoLevel).toBe(50);
    expect(xpForLevel).toBe(100);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```
npm test
```

Expected: `recomputeLevel is not a function` / `xpBreakdown is not a function`

- [ ] **Step 3: 実装**

`services/gamificationService.js` に追記:

```js
function xpRequiredForLevelUp(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function recomputeLevel(xp) {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpRequiredForLevelUp(level)) {
    remaining -= xpRequiredForLevelUp(level);
    level += 1;
  }
  return level;
}

function xpBreakdown(xp) {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpRequiredForLevelUp(level)) {
    remaining -= xpRequiredForLevelUp(level);
    level += 1;
  }
  return {
    currentLevel: level,
    xpIntoLevel: remaining,
    xpForLevel: xpRequiredForLevelUp(level),
  };
}

module.exports = { calcAnswerXp, recomputeLevel, xpBreakdown, xpRequiredForLevelUp };
```

- [ ] **Step 4: テスト成功確認**

```
npm test
```

Expected: all passed

- [ ] **Step 5: コミット**

```
git add services/gamificationService.js tests/gamificationService.test.js
git commit -m "feat(gamification): add level curve (xpBreakdown/recomputeLevel)"
```

---

### Task 1.3: コンボ算出（calcCombo）

**Files:**
- Modify: `services/gamificationService.js`
- Modify: `tests/gamificationService.test.js`

- [ ] **Step 1: テスト追加**

```js
describe('calcCombo', () => {
  it('空の answers は combo 1', () => {
    expect(gamificationService.calcCombo({ answers: [] })).toBe(1);
  });
  it('末尾から連続正解数を返す（最後が不正解なら 1）', () => {
    const session = { answers: [
      { isCorrect: true }, { isCorrect: true }, { isCorrect: false },
    ]};
    expect(gamificationService.calcCombo(session)).toBe(1);
  });
  it('末尾が連続正解なら 連続回数+1', () => {
    const session = { answers: [
      { isCorrect: false }, { isCorrect: true }, { isCorrect: true }, { isCorrect: true },
    ]};
    expect(gamificationService.calcCombo(session)).toBe(4);
  });
});
```

**注:** 「コンボ値」は「次の回答を処理するときに使う直前までの連続正解数 + 1（今回も正解ならその分）」ではなく、「末尾の連続正解数そのもの（= 最新回答時点の combo 値）」で定義する。calcAnswerXp の引数 combo は「今回答時点の combo 値（正解すれば +1 されたもの）」として扱う。**呼び出し順:** recordAnswer 時、answers に push する**前**に `calcCombo(session)` で前のコンボを取り、正解なら `combo + 1`、不正解なら `1` をリセット後の combo として calcAnswerXp に渡す。

- [ ] **Step 2: 失敗確認**

```
npm test
```

- [ ] **Step 3: 実装**

```js
function calcCombo(session) {
  const answers = session?.answers || [];
  if (answers.length === 0) return 1;
  let count = 0;
  for (let i = answers.length - 1; i >= 0; i -= 1) {
    if (answers[i].isCorrect) count += 1;
    else break;
  }
  return Math.max(count, 1);
}

module.exports = { calcAnswerXp, recomputeLevel, xpBreakdown, xpRequiredForLevelUp, calcCombo };
```

- [ ] **Step 4: テスト成功確認**

```
npm test
```

- [ ] **Step 5: コミット**

```
git commit -am "feat(gamification): add calcCombo from session answers"
```

---

### Task 1.4: マスタリーランク算出（calcMasteryRank）

**Files:**
- Modify: `services/gamificationService.js`
- Modify: `tests/gamificationService.test.js`

- [ ] **Step 1: テスト追加**

```js
describe('calcMasteryRank', () => {
  it('attempts 0 は 未挑戦', () => {
    expect(gamificationService.calcMasteryRank({ correct: 0, total: 0 }).rank).toBe('未挑戦');
  });
  it('rate 100%, attempts 10 は scoreIndex = 100 * 10/30 ≒ 33.3 で D', () => {
    const r = gamificationService.calcMasteryRank({ correct: 10, total: 10 });
    expect(r.rank).toBe('D');
    expect(r.scoreIndex).toBeCloseTo(33.33, 1);
  });
  it('rate 80%, attempts 30 は scoreIndex 80 で A', () => {
    expect(gamificationService.calcMasteryRank({ correct: 24, total: 30 }).rank).toBe('A');
  });
  it('rate 90%, attempts 30 は S', () => {
    expect(gamificationService.calcMasteryRank({ correct: 27, total: 30 }).rank).toBe('S');
  });
  it('rate 100%, attempts 50 は SS', () => {
    expect(gamificationService.calcMasteryRank({ correct: 50, total: 50 }).rank).toBe('SS');
  });
});
```

- [ ] **Step 2: 失敗確認**

```
npm test
```

- [ ] **Step 3: 実装**

```js
function calcMasteryRank({ correct, total }) {
  if (!total) return { rank: '未挑戦', rate: null, scoreIndex: 0 };
  const rate = (correct / total) * 100;
  const scoreIndex = rate * Math.min(total / 30, 1.0);
  let rank;
  if (scoreIndex >= 95 && total >= 50) rank = 'SS';
  else if (scoreIndex >= 85 && total >= 30) rank = 'S';
  else if (scoreIndex >= 75) rank = 'A';
  else if (scoreIndex >= 60) rank = 'B';
  else if (scoreIndex >= 40) rank = 'C';
  else rank = 'D';
  return { rank, rate: Math.round(rate), scoreIndex, correct, total };
}

module.exports = { calcAnswerXp, recomputeLevel, xpBreakdown, xpRequiredForLevelUp, calcCombo, calcMasteryRank };
```

- [ ] **Step 4: テスト成功確認**

- [ ] **Step 5: コミット**

```
git commit -am "feat(gamification): add calcMasteryRank with scoreIndex"
```

---

### Task 1.5: ランク比較・昇格判定（compareRanks, diffRankUpgrades）

**Files:**
- Modify: `services/gamificationService.js`
- Modify: `tests/gamificationService.test.js`

- [ ] **Step 1: テスト追加**

```js
describe('compareRanks', () => {
  it('D < C < B < A < S < SS', () => {
    expect(gamificationService.compareRanks('C', 'B')).toBe(-1);
    expect(gamificationService.compareRanks('S', 'A')).toBe(1);
    expect(gamificationService.compareRanks('B', 'B')).toBe(0);
  });
  it('未挑戦 は最も低い', () => {
    expect(gamificationService.compareRanks('未挑戦', 'D')).toBe(-1);
  });
});

describe('diffRankUpgrades', () => {
  it('ランクが上がったドメインのみを返す', () => {
    const before = { 'c:d1': { rank: 'C' }, 'c:d2': { rank: 'B' } };
    const after  = { 'c:d1': { rank: 'B' }, 'c:d2': { rank: 'B' } };
    const diff = gamificationService.diffRankUpgrades(before, after);
    expect(diff).toEqual([{ key: 'c:d1', from: 'C', to: 'B' }]);
  });
  it('新規ドメイン（beforeに無い）は未挑戦→新ランクとして扱う', () => {
    const before = {};
    const after  = { 'c:d1': { rank: 'D' } };
    expect(gamificationService.diffRankUpgrades(before, after)).toEqual([
      { key: 'c:d1', from: '未挑戦', to: 'D' }
    ]);
  });
});
```

- [ ] **Step 2: 失敗確認**

- [ ] **Step 3: 実装**

```js
const RANK_ORDER = ['未挑戦', 'D', 'C', 'B', 'A', 'S', 'SS'];
function compareRanks(a, b) {
  return Math.sign(RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b));
}
function diffRankUpgrades(before, after) {
  const results = [];
  for (const key of Object.keys(after)) {
    const from = before[key]?.rank || '未挑戦';
    const to = after[key].rank;
    if (compareRanks(to, from) > 0) results.push({ key, from, to });
  }
  return results;
}
module.exports = { calcAnswerXp, recomputeLevel, xpBreakdown, xpRequiredForLevelUp, calcCombo, calcMasteryRank, compareRanks, diffRankUpgrades, RANK_ORDER };
```

- [ ] **Step 4: テスト成功確認**

- [ ] **Step 5: コミット**

```
git commit -am "feat(gamification): add rank comparison and upgrade diff"
```

---

### Task 1.6: users.stats 初期化の拡張

**Files:**
- Modify: `services/userService.js` (関数 `upsertGithubUser` 内 `stats` 初期化ブロック)

- [ ] **Step 1: 既存の stats 初期化を読む**

`services/userService.js` の 53〜60行目付近:

```js
stats: existing?.stats || {
  totalSessions: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  weeklyCorrectRate: null,
  monthlyCorrectRate: null,
  certStats: {},
},
```

- [ ] **Step 2: 拡張**

```js
stats: existing?.stats
  ? {
      // 既存 stats に新フィールドをマージ（既存値は温存、欠損時のみ初期化）
      totalSessions: existing.stats.totalSessions || 0,
      totalCorrect: existing.stats.totalCorrect || 0,
      totalAnswered: existing.stats.totalAnswered || 0,
      weeklyCorrectRate: existing.stats.weeklyCorrectRate ?? null,
      monthlyCorrectRate: existing.stats.monthlyCorrectRate ?? null,
      certStats: existing.stats.certStats || {},
      xp: existing.stats.xp || 0,
      level: existing.stats.level || 1,
      streak: existing.stats.streak || { current: 0, longest: 0, lastStudyDate: null, freeze: false },
      masteryRanks: existing.stats.masteryRanks || {},
      unlockedAchievements: existing.stats.unlockedAchievements || [],
      equippedTitle: existing.stats.equippedTitle ?? null,
      activeAdventureId: existing.stats.activeAdventureId ?? null,
    }
  : {
      totalSessions: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      weeklyCorrectRate: null,
      monthlyCorrectRate: null,
      certStats: {},
      xp: 0,
      level: 1,
      streak: { current: 0, longest: 0, lastStudyDate: null, freeze: false },
      masteryRanks: {},
      unlockedAchievements: [],
      equippedTitle: null,
      activeAdventureId: null,
    },
```

- [ ] **Step 3: 動作確認（ログインして既存ユーザーがエラーにならないこと）**

```
npm run dev
```

ブラウザで http://localhost:3000 にログイン。エラー無し＆セッション維持を確認。Cosmos DB の users ドキュメントに新フィールドが追加されていることを `az cosmosdb` か Data Explorer で確認。

- [ ] **Step 4: コミット**

```
git add services/userService.js
git commit -m "feat(user): extend stats with xp/level/streak/masteryRanks/activeAdventureId"
```

---

### Task 1.7: progressService.recordAnswer に gamification 連携を追加

**Files:**
- Modify: `services/progressService.js`
- Create: `tests/progressService.gamification.test.js`

- [ ] **Step 1: テスト追加（cosmosService をモック）**

`tests/progressService.gamification.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../services/cosmosService.js', () => ({
  default: { upsert: vi.fn(), read: vi.fn(), query: vi.fn() },
  upsert: vi.fn(), read: vi.fn(), query: vi.fn(),
}));
vi.mock('../services/userService.js', () => ({
  default: { updateUserStats: vi.fn() },
  updateUserStats: vi.fn(),
}));

import cosmos from '../services/cosmosService.js';
import progressService from '../services/progressService.js';

describe('recordAnswer with gamification', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('正解ごとに sessionのanswersにxpEarnedを含める', async () => {
    const session = { id: 's1', userId: 'u1', answers: [] };
    cosmos.read.mockResolvedValue(session);
    await progressService.recordAnswer({
      sessionId: 's1', userId: 'u1',
      questionId: 'q1', domainId: 'd1', domainWeight: 20,
      selectedAnswer: 'A', isCorrect: true,
    });
    expect(cosmos.upsert).toHaveBeenCalled();
    const saved = cosmos.upsert.mock.calls[0][1];
    expect(saved.answers[0].isCorrect).toBe(true);
    expect(saved.answers[0].xpEarned).toBeGreaterThan(0);
    expect(saved.answers[0].combo).toBe(2); // 空状態での初回正解 → combo 2 (1+1)
  });
});
```

**注:** 初回正解時の combo 値の扱いは「calcCombo(session) は空で 1 を返す → 正解なら +1 して 2 → これが今回の combo として calcAnswerXp に渡る」と統一する。

- [ ] **Step 2: 失敗確認**

```
npm test
```

Expected: `xpEarned` / `combo` フィールドが無い等

- [ ] **Step 3: `recordAnswer` を拡張**

`services/progressService.js` の `recordAnswer`:

```js
const gamificationService = require('./gamificationService');

async function recordAnswer({ sessionId, userId, questionId, domainId, domainWeight = 0, selectedAnswer, isCorrect }) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const prevCombo = gamificationService.calcCombo(session);
  const combo = isCorrect ? prevCombo + 1 : 1;
  const xpEarned = gamificationService.calcAnswerXp({ isCorrect, combo, domainWeight });

  session.answers.push({
    questionId, domainId, selectedAnswer, isCorrect,
    combo, xpEarned,
    answeredAt: new Date().toISOString(),
  });
  await cosmosService.upsert('sessions', session);
  return { combo, xpEarned };
}
```

**注:** 呼び出し側（routes/quiz.js）は `domainWeight` を渡せるように要変更（次タスクで扱う）。

- [ ] **Step 4: テスト成功確認**

```
npm test
```

- [ ] **Step 5: コミット**

```
git add services/progressService.js tests/progressService.gamification.test.js
git commit -m "feat(progress): record combo and xpEarned per answer"
```

---

### Task 1.8: progressService.completeSession に gamification 集計を追加

**Files:**
- Modify: `services/progressService.js`
- Modify: `tests/progressService.gamification.test.js`

- [ ] **Step 1: テスト追加**

```js
import userService from '../services/userService.js';

describe('completeSession with gamification', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('セッション完了時に xpEarned/maxCombo/levelUp/rankUpgrades を格納', async () => {
    const session = {
      id: 's1', userId: 'u1', certificationId: 'c1',
      answers: [
        { questionId: 'q1', domainId: 'd1', isCorrect: true,  combo: 2, xpEarned: 12 },
        { questionId: 'q2', domainId: 'd1', isCorrect: true,  combo: 3, xpEarned: 14 },
        { questionId: 'q3', domainId: 'd2', isCorrect: false, combo: 1, xpEarned: 2 },
      ],
      startedAt: '2026-04-19T00:00:00Z',
    };
    cosmos.read.mockResolvedValue(session);

    // userService.updateUserStats は (id, updater) → updater(stats) を呼び、更新後 stats を返す動きをシミュレート
    userService.updateUserStats.mockImplementation(async (_id, updater) => {
      const stats = {
        totalSessions: 0, totalCorrect: 0, totalAnswered: 0, certStats: {},
        xp: 0, level: 1, masteryRanks: {},
        streak: { current: 0, longest: 0, lastStudyDate: null, freeze: false },
        unlockedAchievements: [],
      };
      return { stats: updater(stats) };
    });

    const completed = await progressService.completeSession('s1', 'u1');
    expect(completed.gamification.xpEarned).toBe(12 + 14 + 2);
    expect(completed.gamification.maxCombo).toBe(3);
    expect(completed.gamification).toHaveProperty('previousLevel');
    expect(completed.gamification).toHaveProperty('newLevel');
    expect(Array.isArray(completed.gamification.rankUpgrades)).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗確認**

- [ ] **Step 3: `completeSession` を拡張**

```js
async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.completedAt = new Date().toISOString();
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  session.score = total > 0 ? Math.round((correct / total) * 100) : 0;

  const xpEarned = session.answers.reduce((sum, a) => sum + (a.xpEarned || 0), 0);
  const maxCombo = session.answers.reduce((m, a) => Math.max(m, a.combo || 1), 1);

  // ドメイン別 session内集計
  const sessionDomainAgg = {};
  for (const a of session.answers) {
    const d = a.domainId;
    sessionDomainAgg[d] = sessionDomainAgg[d] || { correct: 0, total: 0 };
    sessionDomainAgg[d].total += 1;
    if (a.isCorrect) sessionDomainAgg[d].correct += 1;
  }

  let previousLevel = 1;
  let newLevel = 1;
  let rankUpgrades = [];

  const updated = await userService.updateUserStats(userId, (stats) => {
    stats.totalSessions = (stats.totalSessions || 0) + 1;
    stats.totalAnswered = (stats.totalAnswered || 0) + total;
    stats.totalCorrect = (stats.totalCorrect || 0) + correct;

    const cs = { ...(stats.certStats || {}) };
    const cur = cs[session.certificationId] || { correct: 0, answered: 0, sessionsCount: 0 };
    cur.correct += correct;
    cur.answered += total;
    cur.sessionsCount += 1;
    cur.correctRate = cur.answered > 0 ? Math.round((cur.correct / cur.answered) * 100) : 0;
    cs[session.certificationId] = cur;
    stats.certStats = cs;

    const overall = stats.totalAnswered > 0
      ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
      : 0;
    stats.weeklyCorrectRate = overall;
    stats.monthlyCorrectRate = overall;

    // XP / Level
    previousLevel = gamificationService.recomputeLevel(stats.xp || 0);
    stats.xp = (stats.xp || 0) + xpEarned;
    newLevel = gamificationService.recomputeLevel(stats.xp);
    stats.level = newLevel;

    // マスタリーランク再計算（このセッション分を加算、ランク差分算出）
    const prevRanks = { ...(stats.masteryRanks || {}) };
    const nextRanks = { ...prevRanks };
    for (const [domainId, agg] of Object.entries(sessionDomainAgg)) {
      const key = `${session.certificationId}:${domainId}`;
      const prev = prevRanks[key] || { correct: 0, total: 0 };
      const combined = {
        correct: prev.correct + agg.correct,
        total: prev.total + agg.total,
      };
      nextRanks[key] = { ...combined, ...gamificationService.calcMasteryRank(combined) };
    }
    stats.masteryRanks = nextRanks;
    rankUpgrades = gamificationService.diffRankUpgrades(prevRanks, nextRanks);

    return stats;
  });

  session.gamification = {
    xpEarned,
    maxCombo,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    rankUpgrades,
    newAchievements: [], // M2 で実績判定を差し込む
  };

  await cosmosService.upsert('sessions', session);
  return session;
}
```

- [ ] **Step 4: テスト成功確認**

- [ ] **Step 5: routes/quiz.js で domainWeight を渡す**

`routes/quiz.js` の recordAnswer 呼び出し箇所（要確認）:

```js
// 該当ドメインの weight を cert.domains から取得して渡す
const domain = cert.domains.find((d) => d.id === domainId);
await progressService.recordAnswer({
  sessionId, userId: req.user.id,
  questionId, domainId,
  domainWeight: domain?.weight || 0,
  selectedAnswer, isCorrect,
});
```

**注:** 現行の `routes/quiz.js` の実装を Read してから正確な差分を当てる。

- [ ] **Step 6: 手動確認**

```
npm run dev
```

クイズを1セッション回し、結果画面エラー無し＆Cosmos DB の sessions ドキュメントに `gamification` フィールドが付与されていること、users.stats.xp/level/masteryRanks が更新されることを確認。

- [ ] **Step 7: コミット**

```
git add services/progressService.js routes/quiz.js tests/progressService.gamification.test.js
git commit -m "feat(progress): compute xp/level/rankUpgrades on completeSession"
```

---

### Task 1.9: public/theme.css（ドット絵RPGテーマ一式）

**Files:**
- Create: `public/theme.css`

- [ ] **Step 1: CSS を作成**

モック `public/mocks/adventure-map.html` に書いた CSS を汎用化して `public/theme.css` に抽出する。**既に決定済みスタイル**（仕様書 §6.1〜6.8 参照）。

`public/theme.css`:

```css
:root {
  --bg-void:   #0a0a0a;
  --window:    #1a2a6e;
  --window-lt: #2a4ab3;
  --ink:       #f4f4f4;
  --gold:      #ffc425;
  --crimson:   #e63946;
  --fern:      #7ac74f;
  --shadow:    #000000;
  --font-display: 'DotGothic16', monospace;
  --font-body:    'M PLUS 1 Code', ui-monospace, monospace;
}

* { box-sizing: border-box; }

html, body {
  background:
    repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,0.04) 2px 3px),
    radial-gradient(ellipse at top, #0f1530 0%, var(--bg-void) 70%);
  color: var(--ink);
  font-family: var(--font-body);
  font-feature-settings: "tnum";
  image-rendering: pixelated;
  min-height: 100vh;
}

body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image: radial-gradient(#fff 1px, transparent 1px);
  background-size: 120px 120px; opacity: 0.15;
  animation: theme-twinkle 3s steps(2) infinite;
}
@keyframes theme-twinkle { 0%,100% { opacity: 0.18; } 50% { opacity: 0.08; } }

.rpg-window {
  background: var(--window); color: var(--ink);
  border: 3px solid var(--ink); border-radius: 0;
  box-shadow:
    inset 0 0 0 3px var(--window),
    inset 0 0 0 6px var(--window-lt),
    4px 4px 0 var(--shadow);
  padding: 16px 20px;
  font-family: var(--font-display);
}

.rpg-btn {
  font-family: var(--font-display);
  padding: 8px 18px;
  background: var(--crimson); color: var(--ink);
  border: 2px solid var(--ink); border-radius: 0;
  box-shadow: inset 0 0 0 2px #b01e2b, 3px 3px 0 var(--shadow);
  cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em;
  transition: transform 0s, box-shadow 0s;
}
.rpg-btn:hover { background: #f5475b; }
.rpg-btn:active { transform: translate(2px, 2px); box-shadow: inset 0 0 0 2px #b01e2b, 1px 1px 0 var(--shadow); }
.rpg-btn.is-gold { background: var(--gold); color: var(--shadow); box-shadow: inset 0 0 0 2px #b38c17, 3px 3px 0 var(--shadow); }
.rpg-btn.is-fern { background: var(--fern); color: var(--shadow); box-shadow: inset 0 0 0 2px #4e7f33, 3px 3px 0 var(--shadow); }

.rpg-title {
  font-family: var(--font-display); color: var(--gold);
  text-shadow: 3px 3px 0 var(--shadow);
  letter-spacing: 0.04em;
}

.xp-bar {
  display: inline-block; width: 120px; height: 12px;
  background: #000; border: 1px solid var(--ink); position: relative;
}
.xp-bar > i {
  position: absolute; left: 0; top: 0; bottom: 0; display: block;
  background: repeating-linear-gradient(90deg, var(--gold) 0 6px, #a87a00 6px 8px);
}

.hud {
  position: sticky; top: 0; z-index: 50;
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  padding: 10px 16px;
  background: rgba(0,0,0,0.85);
  border-bottom: 3px solid var(--gold);
  font-family: var(--font-display); font-size: 14px;
}
.hud-cell {
  padding: 6px 12px; background: var(--window);
  border: 2px solid var(--ink);
  box-shadow: inset 0 0 0 2px var(--window-lt), 3px 3px 0 var(--shadow);
  white-space: nowrap;
}
.hud-cell .label { color: var(--gold); margin-right: 6px; }
.hud-cell .value { color: var(--ink); text-shadow: 2px 2px 0 var(--shadow); }
.hud-spacer { flex: 1; }

/* コンボ演出 */
.combo-badge {
  font-family: var(--font-display); font-size: 16px;
  padding: 4px 10px; border: 2px solid var(--ink);
  background: var(--crimson); color: var(--ink);
  display: inline-block;
}
.combo-badge.is-shake { animation: combo-shake .2s steps(4); }
@keyframes combo-shake {
  0%   { transform: translate(0,0); }
  25%  { transform: translate(2px,-2px); }
  50%  { transform: translate(-2px,2px); }
  75%  { transform: translate(2px,2px); }
  100% { transform: translate(0,0); }
}

/* LEVEL UP フラッシュ */
.level-up-flash {
  position: fixed; inset: 0; display: grid; place-items: center;
  background: rgba(0,0,0,0.7); z-index: 100;
  font-family: var(--font-display); font-size: 64px; color: var(--gold);
  text-shadow: 4px 4px 0 var(--shadow);
  animation: level-up-blink 0.5s steps(2) 4, level-up-fade 0.4s steps(2) forwards;
  animation-delay: 0s, 2s;
}
@keyframes level-up-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes level-up-fade  { to { opacity: 0; visibility: hidden; } }

/* タイプライター */
.typewriter {
  display: inline-block; overflow: hidden; white-space: nowrap;
  border-right: 4px solid var(--gold);
  animation: type 2s steps(24), blink 0.7s steps(2) infinite;
}
@keyframes type { from { width: 0; } to { width: 100%; } }
@keyframes blink { 50% { border-color: transparent; } }

/* フォーカス */
a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
  outline: 2px dashed var(--gold); outline-offset: 2px;
}

/* ボタン内リンクのリセット */
a.rpg-btn { text-decoration: none; display: inline-block; }
```

- [ ] **Step 2: Google Fonts の link を各 ejs view に追加するための共通方針**

各 ejs で以下の 2 行を `<head>` に追加（本計画では各 view のタスクで追加）:

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=M+PLUS+1+Code:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/theme.css">
```

共通化したいが、既存方針は「各ファイルが完全な HTML を持つ」で layout 分離なし。**各 ejs に 3 行を都度追加する**。

- [ ] **Step 3: コミット**

```
git add public/theme.css
git commit -m "style(theme): add retro RPG pixel theme css"
```

---

### Task 1.10: views/quiz.ejs に HUD とコンボ表示を追加

**Files:**
- Modify: `views/quiz.ejs`

- [ ] **Step 1: 既存を Read**

- [ ] **Step 2: `<head>` に theme.css リンクを追加**

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=M+PLUS+1+Code:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/theme.css">
```

- [ ] **Step 3: 既存ナビを HUD に置換**

```html
<nav class="hud">
  <div class="hud-cell">🛡️ <span class="value"><%= userName || 'NoName' %></span></div>
  <div class="hud-cell"><span class="label">Lv.</span><span class="value"><%= stats.level || 1 %></span></div>
  <div class="hud-cell"><span class="label">EXP</span>
    <span class="xp-bar" aria-label="EXP"><i style="width: <%= Math.round((stats.xpIntoLevel / stats.xpForLevel) * 100) %>%"></i></span>
    <span class="value"><%= stats.xpIntoLevel %>/<%= stats.xpForLevel %></span>
  </div>
  <div class="hud-cell"><span class="label">🔥</span><span class="value"><%= stats.streak?.current || 0 %>日</span></div>
  <div class="hud-spacer"></div>
  <div class="hud-cell"><span class="value"><%= currentCombo > 1 ? '×' + currentCombo : '-' %></span></div>
  <form method="POST" action="/auth/logout"><button class="rpg-btn">ログアウト</button></form>
</nav>
```

- [ ] **Step 4: routes/quiz.js の GET ハンドラで HUD 用の変数を供給**

```js
const user = await userService.getUserById(req.user.id);
const stats = user.stats || {};
const xpBreak = gamificationService.xpBreakdown(stats.xp || 0);
const currentCombo = gamificationService.calcCombo(session);

res.render('quiz', {
  ...既存の変数,
  userName: user.displayName || user.username,
  stats: { ...stats, ...xpBreak },
  currentCombo,
});
```

- [ ] **Step 5: 動作確認**

```
npm run dev
```

ブラウザで /quiz/xxxx を表示、HUD が表示され、連続正解でコンボ値が増えることを確認。

- [ ] **Step 6: コミット**

```
git add views/quiz.ejs routes/quiz.js
git commit -m "style(quiz): add HUD with level/xp/streak/combo"
```

---

### Task 1.11: views/result.ejs の演出（LEVEL UP・ランク昇格）

**Files:**
- Modify: `views/result.ejs`
- Modify: `routes/quiz.js`（result 描画時に `session.gamification` を渡す）

- [ ] **Step 1: routes/quiz.js の result ハンドラで gamification を渡す**

`res.render('result', { ..., gamification: session.gamification })`。

- [ ] **Step 2: views/result.ejs を刷新**

既存の「全体スコア」ウィンドウを `.rpg-window` に置換し、上部に LEVEL UP フラッシュ、昇格ランクセクション、実績トースト、XPサマリーを追加。

主要な追加要素:

```html
<% if (gamification?.leveledUp) { %>
<div class="level-up-flash">LEVEL UP!</div>
<% } %>

<section class="rpg-window">
  <h1 class="rpg-title">セッション結果</h1>
  <div>取得EXP: <%= gamification?.xpEarned || 0 %> ／ 最大コンボ: ×<%= gamification?.maxCombo || 1 %></div>
  <div>Lv. <%= gamification?.previousLevel || 1 %> → Lv. <%= gamification?.newLevel || 1 %></div>
</section>

<% if (gamification?.rankUpgrades?.length) { %>
<section class="rpg-window">
  <h2 class="rpg-title">⚔ ランク昇格</h2>
  <ul>
    <% for (const up of gamification.rankUpgrades) { %>
      <li><%= up.key %>: <%= up.from %> → <strong><%= up.to %></strong></li>
    <% } %>
  </ul>
</section>
<% } %>

<% if (gamification?.newAchievements?.length) { %>
<section class="rpg-window">
  <h2 class="rpg-title">🏅 新しい報い</h2>
  <ul>
    <% for (const a of gamification.newAchievements) { %>
      <li><%= a.name %></li>
    <% } %>
  </ul>
</section>
<% } %>
```

- [ ] **Step 3: 手動確認**

```
npm run dev
```

クイズ1セッションを完走し、`LEVEL UP!` ブリンク、ランク昇格行、XP/コンボサマリーが表示されるか確認（レベル閾値未到達の場合は LEVEL UP が出ないことも確認）。

- [ ] **Step 4: コミット**

```
git add views/result.ejs routes/quiz.js
git commit -m "style(result): render level-up, rank upgrades, xp summary"
```

---

### Task 1.12: views/certification.ejs にマスタリーランク章を追加

**Files:**
- Modify: `views/certification.ejs`
- Modify: `routes/*`（certification 画面のハンドラ、`services/questionService` を参照する場所）で `masteryRanks` を渡す

- [ ] **Step 1: Read 既存**

- [ ] **Step 2: routes で `user.stats.masteryRanks` を取得して view に渡す**

```js
const user = await userService.getUserById(req.user.id);
const masteryRanks = user?.stats?.masteryRanks || {};
res.render('certification', { ..., masteryRanks });
```

- [ ] **Step 3: EJS の各ドメインカードにランク章を追加**

`views/certification.ejs` のドメインループ内（既存「ドメイン別正答率」セクション内）:

```html
<% const rankEntry = masteryRanks[cert.id + ':' + domain.id] || { rank: '未挑戦' }; %>
<span class="rpg-window" style="display:inline-block;padding:4px 10px;font-size:12px;">
  マスタリー: <strong><%= rankEntry.rank %></strong>
</span>
```

- [ ] **Step 4: テーマCSSの読み込み**

`<head>` に theme.css と Google Fonts を追加（Task 1.10 と同じ 3 行）。

- [ ] **Step 5: 手動確認**

ブラウザで資格詳細ページ。各ドメインカードに「マスタリー: B」等が表示されること確認。

- [ ] **Step 6: コミット**

```
git add views/certification.ejs routes/*
git commit -m "style(certification): show mastery rank badge per domain"
```

---

### M1 完了確認

- [ ] M1 全タスクのテスト (`npm test`) がパスすること
- [ ] 1セッション完走で XP / Lv / コンボ / ランク / 結果画面演出が動作すること
- [ ] 既存ユーザーがログインしてもエラー無く stats 新フィールドがマージされること

**M1 終了コミット:**

```
git commit --allow-empty -m "milestone: M1 foundation gamification complete"
```

---

## マイルストーン M2: 継続仕掛け

### Task 2.1: data/achievements.json（実績10個）

**Files:**
- Create: `data/achievements.json`

- [ ] **Step 1: JSONを書く**

`data/achievements.json`:

```json
[
  { "id": "first-quest", "name": "旅立ち", "description": "初セッション完了", "icon": "🗡", "category": "milestone", "condition": { "type": "session-count", "value": 1 }, "xpReward": 50 },
  { "id": "streak-3", "name": "三日修行", "description": "3日連続学習", "icon": "🔥", "category": "streak", "condition": { "type": "streak-reach", "value": 3 }, "xpReward": 100 },
  { "id": "streak-7", "name": "七日修行", "description": "7日連続学習", "icon": "⚔️", "category": "streak", "condition": { "type": "streak-reach", "value": 7 }, "xpReward": 300 },
  { "id": "streak-30", "name": "三十日修行", "description": "30日連続学習", "icon": "🛡", "category": "streak", "condition": { "type": "streak-reach", "value": 30 }, "xpReward": 1000 },
  { "id": "level-5", "name": "見習い卒業", "description": "Lv.5 到達", "icon": "🎖", "category": "level", "condition": { "type": "level-reach", "value": 5 }, "xpReward": 200 },
  { "id": "level-10", "name": "一人前", "description": "Lv.10 到達", "icon": "🏅", "category": "level", "condition": { "type": "level-reach", "value": 10 }, "xpReward": 500 },
  { "id": "mastery-first-b", "name": "初段昇格", "description": "任意ドメインで B 達成", "icon": "🥉", "category": "mastery", "condition": { "type": "rank-reach", "value": "B" }, "xpReward": 100 },
  { "id": "mastery-first-s", "name": "達人への扉", "description": "任意ドメインで S 達成", "icon": "🥇", "category": "mastery", "condition": { "type": "rank-reach", "value": "S" }, "xpReward": 500 },
  { "id": "combo-10", "name": "連撃の極意", "description": "コンボ 10 達成", "icon": "💥", "category": "combo", "condition": { "type": "combo-reach", "value": 10 }, "xpReward": 200 },
  { "id": "dungeon-cleared", "name": "ダンジョン踏破", "description": "1 資格の全ドメインを B 以上に", "icon": "🏰", "category": "milestone", "condition": { "type": "dungeon-clear" }, "xpReward": 1000 }
]
```

- [ ] **Step 2: コミット**

```
git add data/achievements.json
git commit -m "feat(achievements): add MVP achievement master data"
```

---

### Task 2.2: achievementService（実績判定 + 付与）

**Files:**
- Create: `services/achievementService.js`
- Create: `tests/achievementService.test.js`

- [ ] **Step 1: テスト**

```js
import { describe, it, expect } from 'vitest';
import achievementService from '../services/achievementService.js';

describe('evaluate', () => {
  it('streak-7 は streak 7 到達で解放', () => {
    const ctx = {
      stats: { streak: { current: 7 }, level: 2, masteryRanks: {}, unlockedAchievements: [] },
      session: { gamification: { maxCombo: 3 } },
      certDomainCounts: {},
    };
    const list = achievementService.evaluate(ctx);
    expect(list.map((a) => a.id)).toContain('streak-7');
  });

  it('既に解放済みの実績は再解放しない', () => {
    const ctx = {
      stats: { streak: { current: 7 }, level: 1, masteryRanks: {}, unlockedAchievements: ['streak-7'] },
      session: { gamification: { maxCombo: 1 } },
      certDomainCounts: {},
    };
    const list = achievementService.evaluate(ctx);
    expect(list.map((a) => a.id)).not.toContain('streak-7');
  });

  it('combo-10 は maxCombo 10 で解放', () => {
    const ctx = {
      stats: { streak: { current: 0 }, level: 1, masteryRanks: {}, unlockedAchievements: [] },
      session: { gamification: { maxCombo: 10 } },
      certDomainCounts: {},
    };
    expect(achievementService.evaluate(ctx).map((a) => a.id)).toContain('combo-10');
  });

  it('dungeon-clear は 1資格の全ドメインがB以上', () => {
    const ctx = {
      stats: {
        streak: { current: 0 }, level: 1,
        masteryRanks: {
          'gh-100:d1': { rank: 'B' },
          'gh-100:d2': { rank: 'A' },
          'gh-100:d3': { rank: 'S' },
        },
        unlockedAchievements: [],
      },
      session: { gamification: { maxCombo: 1 }, certificationId: 'gh-100' },
      certDomainCounts: { 'gh-100': 3 },
    };
    expect(achievementService.evaluate(ctx).map((a) => a.id)).toContain('dungeon-cleared');
  });
});
```

- [ ] **Step 2: 失敗確認**

- [ ] **Step 3: 実装**

```js
'use strict';

const path = require('path');
const fs = require('fs');
const { compareRanks } = require('./gamificationService');

const MASTER_PATH = path.join(__dirname, '..', 'data', 'achievements.json');
let MASTER_CACHE = null;

function loadMaster() {
  if (!MASTER_CACHE) MASTER_CACHE = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  return MASTER_CACHE;
}

function satisfies(master, ctx) {
  const cond = master.condition;
  switch (cond.type) {
    case 'session-count':  return (ctx.stats.totalSessions || 0) >= cond.value;
    case 'streak-reach':   return (ctx.stats.streak?.current || 0) >= cond.value;
    case 'level-reach':    return (ctx.stats.level || 1) >= cond.value;
    case 'combo-reach':    return (ctx.session.gamification?.maxCombo || 0) >= cond.value;
    case 'rank-reach': {
      const target = cond.value;
      return Object.values(ctx.stats.masteryRanks || {}).some((r) => compareRanks(r.rank, target) >= 0);
    }
    case 'dungeon-clear': {
      const certId = ctx.session?.certificationId;
      if (!certId) return false;
      const need = ctx.certDomainCounts?.[certId];
      if (!need) return false;
      const count = Object.entries(ctx.stats.masteryRanks || {})
        .filter(([k, r]) => k.startsWith(certId + ':') && compareRanks(r.rank, 'B') >= 0)
        .length;
      return count >= need;
    }
    default: return false;
  }
}

function evaluate(ctx) {
  const master = loadMaster();
  const already = new Set(ctx.stats.unlockedAchievements || []);
  return master.filter((m) => !already.has(m.id) && satisfies(m, ctx));
}

module.exports = { evaluate, loadMaster };
```

- [ ] **Step 4: テスト成功確認**

- [ ] **Step 5: コミット**

```
git add services/achievementService.js tests/achievementService.test.js
git commit -m "feat(achievement): add evaluator for 10 MVP achievements"
```

---

### Task 2.3: ストリーク更新（gamificationService.updateStreak）

**Files:**
- Modify: `services/gamificationService.js`
- Modify: `tests/gamificationService.test.js`

- [ ] **Step 1: テスト追加**

```js
describe('updateStreak', () => {
  const today = '2026-04-19';
  it('初回は current 1', () => {
    const s = gamificationService.updateStreak({ current: 0, longest: 0, lastStudyDate: null, freeze: false }, today);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
    expect(s.lastStudyDate).toBe(today);
  });
  it('連続1日は +1', () => {
    const s = gamificationService.updateStreak({ current: 2, longest: 2, lastStudyDate: '2026-04-18', freeze: false }, today);
    expect(s.current).toBe(3);
  });
  it('2日空白で freeze false はリセット', () => {
    const s = gamificationService.updateStreak({ current: 5, longest: 5, lastStudyDate: '2026-04-16', freeze: false }, today);
    expect(s.current).toBe(1);
  });
  it('2日空白で freeze true はセーフ（1日分のみ消費）', () => {
    const s = gamificationService.updateStreak({ current: 5, longest: 5, lastStudyDate: '2026-04-17', freeze: true }, today);
    expect(s.current).toBe(6);
    expect(s.freeze).toBe(false);
  });
  it('同日2セッションは current 維持', () => {
    const s = gamificationService.updateStreak({ current: 3, longest: 3, lastStudyDate: today, freeze: false }, today);
    expect(s.current).toBe(3);
  });
  it('7日到達で freeze 付与', () => {
    const s = gamificationService.updateStreak({ current: 6, longest: 6, lastStudyDate: '2026-04-18', freeze: false }, today);
    expect(s.current).toBe(7);
    expect(s.freeze).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗確認**

- [ ] **Step 3: 実装**

```js
function daysBetween(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00Z');
  const b = new Date(dateB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function updateStreak(streak, todayISODate) {
  const current = streak.current || 0;
  const longest = streak.longest || 0;
  const last = streak.lastStudyDate;
  let freeze = !!streak.freeze;

  if (!last) {
    const next = 1;
    return { current: next, longest: Math.max(longest, next), lastStudyDate: todayISODate, freeze: next >= 7 ? true : freeze };
  }

  const diff = daysBetween(last, todayISODate);
  let nextCount;
  if (diff === 0) {
    nextCount = current;
  } else if (diff === 1) {
    nextCount = current + 1;
  } else if (diff === 2 && freeze) {
    nextCount = current + 1;
    freeze = false;
  } else {
    nextCount = 1;
  }

  if (nextCount >= 7 && !freeze) freeze = true;

  return {
    current: nextCount,
    longest: Math.max(longest, nextCount),
    lastStudyDate: todayISODate,
    freeze,
  };
}

module.exports = { ... /* 既存 */, updateStreak };
```

- [ ] **Step 4: テスト成功確認**

- [ ] **Step 5: コミット**

```
git commit -am "feat(gamification): add streak update logic with freeze grace"
```

---

### Task 2.4: completeSession からストリーク/実績を統合

**Files:**
- Modify: `services/progressService.js`
- Modify: `tests/progressService.gamification.test.js`
- Modify: `services/questionService.js`（`getCertDomainCounts` を追加）

- [ ] **Step 1: questionService に補助関数追加**

```js
async function getCertDomainCounts() {
  const certs = await listCertifications();
  const map = {};
  for (const c of certs) map[c.id] = c.domains.length;
  return map;
}
module.exports = { ... /* 既存 */, getCertDomainCounts };
```

- [ ] **Step 2: progressService.completeSession に統合**

`updateUserStats` updater の末尾（return stats の前）に追記:

```js
const todayISO = new Date().toISOString().slice(0, 10);
stats.streak = gamificationService.updateStreak(stats.streak, todayISO);

// 実績評価は Cosmos 保存後にやるため、ctx だけ準備しておく
```

`completeSession` 関数末尾（session 保存前）に:

```js
const certDomainCounts = await questionService.getCertDomainCounts();
const ctx = {
  stats: updated.stats,
  session,
  certDomainCounts,
};
const newlyUnlocked = achievementService.evaluate(ctx);

if (newlyUnlocked.length) {
  const bonus = newlyUnlocked.reduce((sum, a) => sum + (a.xpReward || 0), 0);
  await userService.updateUserStats(userId, (s) => {
    s.unlockedAchievements = [...(s.unlockedAchievements || []), ...newlyUnlocked.map((a) => a.id)];
    s.xp = (s.xp || 0) + bonus;
    s.level = gamificationService.recomputeLevel(s.xp);
    return s;
  });
  session.gamification.newAchievements = newlyUnlocked.map((a) => ({ id: a.id, name: a.name, icon: a.icon }));
  session.gamification.achievementXp = bonus;
}
```

- [ ] **Step 3: 既存テストが通るか確認**

```
npm test
```

Expected: 既存テストは mock 側で achievementService/questionService を無視する必要あり → mock 追加:

```js
vi.mock('../services/achievementService.js', () => ({
  default: { evaluate: vi.fn().mockReturnValue([]) },
  evaluate: vi.fn().mockReturnValue([]),
}));
vi.mock('../services/questionService.js', () => ({
  default: { getCertDomainCounts: vi.fn().mockResolvedValue({}) },
  getCertDomainCounts: vi.fn().mockResolvedValue({}),
}));
```

- [ ] **Step 4: 新テストを追加**

```js
import achievementService from '../services/achievementService.js';

describe('completeSession fires achievements', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('newAchievements に評価結果をコピーし、xpReward を加算する', async () => {
    const session = {
      id: 's1', userId: 'u1', certificationId: 'c1',
      answers: [
        { questionId: 'q1', domainId: 'd1', isCorrect: true, combo: 2, xpEarned: 12 },
      ],
      startedAt: '2026-04-19T00:00:00Z',
    };
    cosmos.read.mockResolvedValue(session);

    const statsAfterFirst = {
      totalSessions: 1, totalCorrect: 1, totalAnswered: 1, certStats: {},
      xp: 12, level: 1, masteryRanks: {},
      streak: { current: 7, longest: 7, lastStudyDate: '2026-04-19', freeze: true },
      unlockedAchievements: [],
    };
    userService.updateUserStats
      .mockImplementationOnce(async (_id, updater) => ({ stats: updater({
        totalSessions: 0, totalCorrect: 0, totalAnswered: 0, certStats: {},
        xp: 0, level: 1, masteryRanks: {},
        streak: { current: 6, longest: 6, lastStudyDate: '2026-04-18', freeze: false },
        unlockedAchievements: [],
      }) }))
      .mockImplementationOnce(async (_id, updater) => ({ stats: updater(statsAfterFirst) }));

    achievementService.evaluate.mockReturnValue([
      { id: 'streak-7', name: '七日修行', icon: '⚔️', xpReward: 300 },
    ]);

    const completed = await progressService.completeSession('s1', 'u1');
    expect(completed.gamification.newAchievements).toEqual([
      { id: 'streak-7', name: '七日修行', icon: '⚔️' }
    ]);
    expect(completed.gamification.achievementXp).toBe(300);
  });
});
```

- [ ] **Step 5: コミット**

```
git commit -am "feat(progress): integrate streak update and achievement evaluation on completeSession"
```

---

### Task 2.4b: 日次クエスト（gamificationService.evaluateDailyQuest）

**Files:**
- Modify: `services/gamificationService.js`
- Modify: `tests/gamificationService.test.js`
- Modify: `services/progressService.js`

- [ ] **Step 1: テスト追加**

```js
describe('evaluateDailyQuest', () => {
  const today = '2026-04-19';
  const emptyDaily = { date: today, completed: [], xpClaimed: 0 };

  it('セッションで正答5問以上 → daily-5q 達成', () => {
    const answers = Array.from({ length: 5 }, () => ({ isCorrect: true, domainId: 'd1' }));
    const result = gamificationService.evaluateDailyQuest({ daily: emptyDaily, session: { answers }, todayISODate: today });
    expect(result.completed).toContain('daily-5q');
    expect(result.xpClaimed).toBeGreaterThanOrEqual(50);
  });

  it('session完了で daily-session 必ず達成', () => {
    const result = gamificationService.evaluateDailyQuest({ daily: emptyDaily, session: { answers: [{ isCorrect: false, domainId: 'd1' }] }, todayISODate: today });
    expect(result.completed).toContain('daily-session');
  });

  it('1ドメインで正答率80%以上 → daily-domain-80', () => {
    const answers = [
      { isCorrect: true, domainId: 'd1' }, { isCorrect: true, domainId: 'd1' },
      { isCorrect: true, domainId: 'd1' }, { isCorrect: true, domainId: 'd1' },
      { isCorrect: false, domainId: 'd1' },
    ];
    const result = gamificationService.evaluateDailyQuest({ daily: emptyDaily, session: { answers }, todayISODate: today });
    expect(result.completed).toContain('daily-domain-80');
  });

  it('日付が異なる場合は daily をリセットしてから評価', () => {
    const staleDaily = { date: '2026-04-18', completed: ['daily-5q', 'daily-session'], xpClaimed: 80 };
    const result = gamificationService.evaluateDailyQuest({
      daily: staleDaily,
      session: { answers: [{ isCorrect: false, domainId: 'd1' }] },
      todayISODate: today,
    });
    expect(result.date).toBe(today);
    expect(result.completed).toEqual(['daily-session']);
    expect(result.xpClaimed).toBe(30);
  });

  it('既に達成済みのクエストは xpClaimed を追加しない', () => {
    const daily = { date: today, completed: ['daily-session'], xpClaimed: 30 };
    const result = gamificationService.evaluateDailyQuest({
      daily,
      session: { answers: [{ isCorrect: false, domainId: 'd1' }] },
      todayISODate: today,
    });
    expect(result.xpClaimed).toBe(30);
    expect(result.newlyCompleted).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗確認**

```
npm test
```

- [ ] **Step 3: 実装**

`services/gamificationService.js` に追記:

```js
const DAILY_QUEST_REWARDS = {
  'daily-5q':         { xp: 50,  name: '今日5問解く' },
  'daily-domain-80':  { xp: 80,  name: '1ドメインで正答率80%以上' },
  'daily-session':    { xp: 30,  name: '1セッション完了' },
};

function evaluateDailyQuest({ daily, session, todayISODate }) {
  const base = (daily && daily.date === todayISODate)
    ? { date: daily.date, completed: [...(daily.completed || [])], xpClaimed: daily.xpClaimed || 0 }
    : { date: todayISODate, completed: [], xpClaimed: 0 };

  const completedSet = new Set(base.completed);
  const newlyCompleted = [];

  // daily-session: セッションが完了するたびに達成
  if (!completedSet.has('daily-session')) {
    completedSet.add('daily-session');
    newlyCompleted.push('daily-session');
  }

  // daily-5q: セッション内の正答が5問以上
  const correctCount = (session.answers || []).filter((a) => a.isCorrect).length;
  if (correctCount >= 5 && !completedSet.has('daily-5q')) {
    completedSet.add('daily-5q');
    newlyCompleted.push('daily-5q');
  }

  // daily-domain-80: セッション内の任意ドメインで 80% 以上
  const byDomain = {};
  for (const a of session.answers || []) {
    byDomain[a.domainId] = byDomain[a.domainId] || { c: 0, t: 0 };
    byDomain[a.domainId].t += 1;
    if (a.isCorrect) byDomain[a.domainId].c += 1;
  }
  const hit80 = Object.values(byDomain).some((x) => x.t > 0 && (x.c / x.t) >= 0.8);
  if (hit80 && !completedSet.has('daily-domain-80')) {
    completedSet.add('daily-domain-80');
    newlyCompleted.push('daily-domain-80');
  }

  const bonus = newlyCompleted.reduce((sum, id) => sum + (DAILY_QUEST_REWARDS[id]?.xp || 0), 0);

  return {
    date: todayISODate,
    completed: [...completedSet],
    xpClaimed: base.xpClaimed + bonus,
    newlyCompleted,
    bonus,
  };
}

module.exports = { ... /* 既存 */, evaluateDailyQuest, DAILY_QUEST_REWARDS };
```

- [ ] **Step 4: users.stats に dailyQuest を追加**

`services/userService.js` の stats 初期化の両分岐に追記:

```js
dailyQuest: existing?.stats?.dailyQuest || { date: null, completed: [], xpClaimed: 0 },
```

新規ユーザー側も同様に `dailyQuest: { date: null, completed: [], xpClaimed: 0 }` を追加。

- [ ] **Step 5: progressService.completeSession で呼び出し**

`updateUserStats` の updater 内（ストリーク更新の直後）に追加:

```js
const todayISO = new Date().toISOString().slice(0, 10);
stats.streak = gamificationService.updateStreak(stats.streak, todayISO);
const questResult = gamificationService.evaluateDailyQuest({
  daily: stats.dailyQuest,
  session,
  todayISODate: todayISO,
});
stats.dailyQuest = {
  date: questResult.date,
  completed: questResult.completed,
  xpClaimed: questResult.xpClaimed,
};
stats.xp = (stats.xp || 0) + (questResult.bonus || 0);
```

session.gamification にも newlyCompleted を含める:

```js
session.gamification.dailyQuestsNewlyCompleted = questResult.newlyCompleted || [];
session.gamification.dailyQuestXp = questResult.bonus || 0;
```

- [ ] **Step 6: テスト成功確認**

```
npm test
```

- [ ] **Step 7: コミット**

```
git add services/gamificationService.js services/userService.js services/progressService.js tests/gamificationService.test.js
git commit -m "feat(gamification): add daily quest evaluation and xp reward"
```

---

### Task 2.5: プロフィール画面（routes/profile.js + views/profile.ejs）

**Files:**
- Create: `routes/profile.js`
- Create: `views/profile.ejs`
- Modify: `app.js`

- [ ] **Step 1: routes/profile.js**

```js
'use strict';
const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const gamificationService = require('../services/gamificationService');
const achievementService = require('../services/achievementService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user.stats || {};
  const xpBreak = gamificationService.xpBreakdown(stats.xp || 0);
  const master = achievementService.loadMaster();
  res.render('profile', {
    title: '勇者プロフィール',
    userEmail: user.email,
    userName: user.displayName || user.username,
    avatarUrl: user.avatarUrl,
    stats: { ...stats, ...xpBreak },
    achievementsMaster: master,
    unlocked: new Set(stats.unlockedAchievements || []),
  });
});

module.exports = router;
```

- [ ] **Step 2: views/profile.ejs（ドット絵RPGテーマのステータス画面風）**

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
</head>
<body>
  <nav class="hud">
    <div class="hud-cell">🛡️ <span class="value"><%= userName %></span></div>
    <div class="hud-cell"><span class="label">Lv.</span><span class="value"><%= stats.level %></span></div>
    <div class="hud-cell"><span class="label">EXP</span>
      <span class="xp-bar"><i style="width: <%= Math.round((stats.xpIntoLevel / stats.xpForLevel)*100) %>%"></i></span>
      <span class="value"><%= stats.xpIntoLevel %>/<%= stats.xpForLevel %></span>
    </div>
    <div class="hud-spacer"></div>
    <a class="rpg-btn is-gold" href="/">冒険マップ</a>
  </nav>
  <main style="padding:24px;">
    <div class="rpg-window" style="display:grid;grid-template-columns:120px 1fr;gap:24px;">
      <% if (avatarUrl) { %><img src="<%= avatarUrl %>" style="width:100px;height:100px;image-rendering:pixelated;"><% } %>
      <div>
        <h1 class="rpg-title" style="font-size:24px;"><%= userName %></h1>
        <p>Lv. <%= stats.level %> ／ 総XP <%= stats.xp || 0 %></p>
        <p>🔥 連続 <%= stats.streak?.current || 0 %>日（最長 <%= stats.streak?.longest || 0 %>日）</p>
        <p>称号: <%= stats.equippedTitle || '(未装備)' %></p>
      </div>
    </div>

    <section class="rpg-window" style="margin-top:24px;">
      <h2 class="rpg-title">🏅 実績</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-top:12px;">
        <% for (const a of achievementsMaster) {
             const ok = unlocked.has(a.id); %>
          <div style="text-align:center;padding:8px;background:#0005;<%= ok ? '' : 'filter:grayscale(1) opacity(.35);' %>">
            <div style="font-size:32px;"><%= a.icon %></div>
            <div style="font-family:var(--font-display);font-size:12px;"><%= a.name %></div>
            <div style="font-size:10px;"><%= a.description %></div>
          </div>
        <% } %>
      </div>
    </section>
  </main>
</body>
</html>
```

- [ ] **Step 3: app.js にルート登録**

```js
const profileRouter = require('./routes/profile');
// ...
app.use('/my/profile', profileRouter);
```

- [ ] **Step 4: 手動確認**

```
npm run dev
```

`/my/profile` で勇者プロフィールが表示される。未取得バッジがグレーアウト。

- [ ] **Step 5: コミット**

```
git add routes/profile.js views/profile.ejs app.js
git commit -m "feat(profile): add hero profile page with achievements grid"
```

---

### M2 完了確認

- [ ] ストリーク3日連続で streak-3 が解放される
- [ ] Lv.5 到達で level-5 が解放される
- [ ] プロフィール画面に実績グリッドが表示される

**M2 終了コミット:**

```
git commit --allow-empty -m "milestone: M2 persistence features complete"
```

---

## マイルストーン M3: 冒険基盤

### Task 3.1: data/adventure-presets.json

**Files:**
- Create: `data/adventure-presets.json`

- [ ] **Step 1: 書く**

```json
[
  { "id": "developer",   "name": "開発者の道",        "icon": "💻", "tagline": "コードで世界を動かす戦士",   "description": "Web開発・API設計を軸にしたエンジニア像", "dungeons": ["gh-100","gh-200"] },
  { "id": "infra",       "name": "インフラ魔導士の道", "icon": "🏰", "tagline": "クラウドを支配する守護者", "description": "インフラ・クラウド基盤の専門家",       "dungeons": ["az-104"] },
  { "id": "ai-engineer", "name": "AI賢者の道",        "icon": "🔮", "tagline": "知能を召喚する研究者",     "description": "AI/機械学習を活用するエンジニア",     "dungeons": ["ai-102","ai-900"] }
]
```

- [ ] **Step 2: コミット**

```
git add data/adventure-presets.json
git commit -m "feat(adventure): add preset adventures"
```

---

### Task 3.2: adventureService（CRUD + アクティブ切替 + 解放判定）

**Files:**
- Create: `services/adventureService.js`
- Create: `tests/adventureService.test.js`

- [ ] **Step 1: テスト（純粋ロジック部分）**

```js
import { describe, it, expect, vi } from 'vitest';
vi.mock('../services/cosmosService.js', () => ({ default: { upsert: vi.fn(), read: vi.fn(), query: vi.fn(), remove: vi.fn() } }));
import adventureService from '../services/adventureService.js';

describe('checkDungeonUnlocks', () => {
  const adv = {
    id: 'adv1', userId: 'u1', isActive: true,
    dungeons: [
      { certificationId: 'gh-100', order: 1, status: 'cleared' },
      { certificationId: 'gh-200', order: 2, status: 'in-progress' },
      { certificationId: 'ai-102', order: 3, status: 'locked' },
    ],
  };
  it('現在のダンジョン全ドメインB以上で次をunlock', () => {
    const ranks = {
      'gh-200:d1': { rank: 'B' },
      'gh-200:d2': { rank: 'A' },
    };
    const domainCounts = { 'gh-200': 2, 'ai-102': 3 };
    const next = adventureService.checkDungeonUnlocks(adv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('cleared');
    expect(next.dungeons[2].status).toBe('in-progress');
  });
  it('未達なら状態変化なし', () => {
    const ranks = { 'gh-200:d1': { rank: 'C' } };
    const domainCounts = { 'gh-200': 2, 'ai-102': 3 };
    const next = adventureService.checkDungeonUnlocks(adv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('in-progress');
    expect(next.dungeons[2].status).toBe('locked');
  });
});
```

- [ ] **Step 2: 実装**

```js
'use strict';
const crypto = require('crypto');
const cosmosService = require('./cosmosService');
const { compareRanks } = require('./gamificationService');

function isDungeonBClearable(cert, ranks, domainCounts) {
  const need = domainCounts[cert.certificationId];
  if (!need) return false;
  let ok = 0;
  for (const [k, r] of Object.entries(ranks)) {
    if (k.startsWith(cert.certificationId + ':') && compareRanks(r.rank, 'B') >= 0) ok += 1;
  }
  return ok >= need;
}

function checkDungeonUnlocks(adventure, ranks, domainCounts) {
  const dungeons = adventure.dungeons.map((d) => ({ ...d }));
  for (let i = 0; i < dungeons.length; i += 1) {
    const d = dungeons[i];
    if (d.status === 'in-progress' && isDungeonBClearable(d, ranks, domainCounts)) {
      d.status = 'cleared';
      d.clearedAt = new Date().toISOString();
      const next = dungeons[i + 1];
      if (next && next.status === 'locked') {
        next.status = 'in-progress';
        next.unlockedAt = new Date().toISOString();
      }
    }
  }
  return { ...adventure, dungeons };
}

async function listAdventures(userId) {
  return cosmosService.query('adventures', {
    query: 'SELECT * FROM c WHERE c.userId = @u',
    parameters: [{ name: '@u', value: userId }],
  }, { partitionKey: userId });
}

async function getAdventure(id, userId) {
  return cosmosService.read('adventures', id, userId);
}

async function createAdventure(payload) {
  const adv = {
    id: `adv-${crypto.randomUUID()}`,
    ...payload,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  await cosmosService.upsert('adventures', adv);
  return adv;
}

async function setActive(userId, adventureId) {
  const all = await listAdventures(userId);
  for (const a of all) {
    const next = { ...a, isActive: a.id === adventureId };
    await cosmosService.upsert('adventures', next);
  }
  const userService = require('./userService');
  await userService.updateUserStats(userId, (s) => { s.activeAdventureId = adventureId; return s; });
}

async function deleteAdventure(id, userId) {
  await cosmosService.remove('adventures', id, userId);
}

module.exports = {
  checkDungeonUnlocks, listAdventures, getAdventure, createAdventure, setActive, deleteAdventure,
};
```

- [ ] **Step 3: テスト成功確認**

- [ ] **Step 4: コミット**

```
git add services/adventureService.js tests/adventureService.test.js
git commit -m "feat(adventure): add CRUD and dungeon unlock logic"
```

---

### Task 3.3: routes/adventures.js（一覧・詳細・作成・削除・アクティブ切替）

**Files:**
- Create: `routes/adventures.js`
- Modify: `app.js`

- [ ] **Step 1: ルート実装**

```js
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const adventureService = require('../services/adventureService');
const userService = require('../services/userService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');

const PRESETS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'adventure-presets.json'), 'utf8'));

router.get('/new', requireAuth, async (req, res) => {
  const certs = await questionService.listCertifications();
  const certIds = new Set(certs.map((c) => c.id));
  const presets = PRESETS.map((p) => ({ ...p, dungeons: p.dungeons.filter((d) => certIds.has(d)) })).filter((p) => p.dungeons.length > 0);
  res.render('adventure-new', { title: '冒険を始める', userEmail: req.user.email, presets, certs });
});

router.post('/preset', requireAuth, async (req, res) => {
  const preset = PRESETS.find((p) => p.id === req.body.presetId);
  if (!preset) return res.status(400).send('preset not found');
  const adv = await adventureService.createAdventure({
    userId: req.user.id,
    name: preset.name,
    description: preset.description,
    source: 'preset',
    presetId: preset.id,
    userPrompt: null,
    dungeons: preset.dungeons.map((certId, i) => ({
      certificationId: certId,
      order: i + 1,
      status: i === 0 ? 'in-progress' : 'locked',
      unlockedAt: i === 0 ? new Date().toISOString() : null,
      clearedAt: null,
    })),
    rationale: null, citations: [], verificationStatus: 'verified', isActive: true,
  });
  await adventureService.setActive(req.user.id, adv.id);
  res.redirect(`/adventures/${adv.id}`);
});

router.get('/:id', requireAuth, async (req, res) => {
  const adv = await adventureService.getAdventure(req.params.id, req.user.id);
  if (!adv) return res.status(404).render('error', { title: '404', message: '冒険が見つかりません' });
  const certs = await questionService.listCertifications();
  const certById = Object.fromEntries(certs.map((c) => [c.id, c]));
  res.render('adventure-detail', { title: adv.name, userEmail: req.user.email, adventure: adv, certById });
});

router.post('/:id/activate', requireAuth, async (req, res) => {
  await adventureService.setActive(req.user.id, req.params.id);
  res.redirect(`/adventures/${req.params.id}`);
});

router.post('/:id/delete', requireAuth, async (req, res) => {
  await adventureService.deleteAdventure(req.params.id, req.user.id);
  res.redirect('/');
});

module.exports = router;
```

- [ ] **Step 2: app.js 登録**

```js
const adventuresRouter = require('./routes/adventures');
app.use('/adventures', adventuresRouter);
```

- [ ] **Step 3: コミット**

```
git add routes/adventures.js app.js
git commit -m "feat(adventure): add routes for preset creation/listing/activation"
```

---

### Task 3.4: views/adventure-detail.ejs

**Files:**
- Create: `views/adventure-detail.ejs`

- [ ] **Step 1: 書く**

```html
<!DOCTYPE html>
<html lang="ja"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %></title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=M+PLUS+1+Code:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/theme.css">
</head><body>
  <nav class="hud">
    <a class="rpg-btn is-gold" href="/">冒険マップ</a>
    <div class="hud-spacer"></div>
    <span class="hud-cell"><%= userEmail %></span>
  </nav>
  <main style="padding:24px;">
    <h1 class="rpg-title" style="font-size:24px;"><%= adventure.name %></h1>
    <% if (adventure.verificationStatus === 'warning-no-citations') { %>
      <div class="rpg-window" style="border-color:var(--crimson);color:var(--crimson);margin:12px 0;">
        ⚠️ 公式確認不足: LLM の推論のみで、公式引用が取得できていません。
      </div>
    <% } %>
    <p style="font-family:var(--font-body);margin:12px 0;"><%= adventure.description %></p>

    <section class="rpg-window">
      <h2 class="rpg-title">🗡 ダンジョン順</h2>
      <ol>
        <% for (const d of adventure.dungeons) {
             const cert = certById[d.certificationId]; %>
          <li style="margin:8px 0;">
            <strong><%= cert?.name || d.certificationId %></strong>
            — 状態: <%= d.status %>
            <% if (d.status !== 'locked') { %>
              <a class="rpg-btn" href="/certifications/<%= d.certificationId %>">入る</a>
            <% } else { %>
              🔒 未解放
            <% } %>
          </li>
        <% } %>
      </ol>
    </section>

    <% if (adventure.rationale) { %>
    <section class="rpg-window" style="margin-top:16px;">
      <h2 class="rpg-title">📜 この道を選んだ理由</h2>
      <p style="font-family:var(--font-body);"><%= adventure.rationale %></p>
    </section>
    <% } %>

    <% if (adventure.citations?.length) { %>
    <section class="rpg-window" style="margin-top:16px;">
      <h2 class="rpg-title">📖 公式出典</h2>
      <ul>
        <% for (const c of adventure.citations) { %>
          <li><a href="<%= c.url %>" target="_blank" rel="noopener"><%= c.title || c.url %></a></li>
        <% } %>
      </ul>
    </section>
    <% } %>

    <form method="POST" action="/adventures/<%= adventure.id %>/delete" style="margin-top:16px;">
      <button class="rpg-btn">この冒険を削除</button>
    </form>
  </main>
</body></html>
```

- [ ] **Step 2: 手動確認**

`/adventures/new` でプリセットを1つ選択 → `/adventures/:id` が表示される。

- [ ] **Step 3: コミット**

```
git add views/adventure-detail.ejs
git commit -m "feat(adventure): add adventure detail view"
```

---

### Task 3.5: progressService で冒険の解放判定をフック

**Files:**
- Modify: `services/progressService.js`

- [ ] **Step 1: completeSession 末尾（実績判定の後）に追加**

```js
const adventureService = require('./adventureService');
// ...
const activeAdvId = updated.stats.activeAdventureId;
if (activeAdvId) {
  const adv = await adventureService.getAdventure(activeAdvId, userId);
  if (adv && adv.isActive) {
    const certDomainCounts = await questionService.getCertDomainCounts();
    const nextAdv = adventureService.checkDungeonUnlocks(adv, updated.stats.masteryRanks || {}, certDomainCounts);
    if (JSON.stringify(nextAdv.dungeons) !== JSON.stringify(adv.dungeons)) {
      await cosmosService.upsert('adventures', nextAdv);
    }
  }
}
```

- [ ] **Step 2: 手動確認**

gh-100 の全ドメインを B ランクまで上げ、冒険詳細で gh-200 が in-progress に遷移していること確認。

- [ ] **Step 3: コミット**

```
git commit -am "feat(progress): trigger adventure dungeon unlock on completeSession"
```

---

### M3 完了確認

- [ ] プリセットで冒険を作成できる
- [ ] 冒険詳細画面が正しく表示される
- [ ] ダンジョン解放が動作する

**M3 終了コミット:**

```
git commit --allow-empty -m "milestone: M3 adventure foundation complete"
```

---

## マイルストーン M4: LLM 冒険生成

### Task 4.1: services/mcpClient.js（Microsoft Learn MCP ラッパー）

**Files:**
- Create: `services/mcpClient.js`
- Create: `tests/mcpClient.test.js`（接続は統合テスト扱い、ユニットでは薄め）

- [ ] **Step 1: 実装（既存 generationService.js のパターン準拠）**

```js
'use strict';
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const DEFAULT_URL = process.env.MS_LEARN_MCP_URL || 'https://learn.microsoft.com/api/mcp';

async function withClient(fn) {
  const client = new Client({ name: 'cert-study-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(DEFAULT_URL));
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function callLearnSearch(question) {
  return withClient(async (client) => {
    const r = await client.callTool({
      name: 'microsoft_docs_search',
      arguments: { question },
    });
    const text = r?.content?.map((c) => c.text).join('\n') || '';
    return text;
  });
}

async function callLearnFetch(url) {
  return withClient(async (client) => {
    const r = await client.callTool({ name: 'microsoft_docs_fetch', arguments: { url } });
    return r?.content?.map((c) => c.text).join('\n') || '';
  });
}

module.exports = { callLearnSearch, callLearnFetch };
```

- [ ] **Step 2: コミット**

```
git add services/mcpClient.js
git commit -m "feat(mcp): add Microsoft Learn MCP client wrapper"
```

---

### Task 4.2: adventureGeneratorService

**Files:**
- Create: `services/adventureGeneratorService.js`
- Create: `tests/adventureGeneratorService.test.js`

- [ ] **Step 1: テスト**

```js
import { describe, it, expect, vi } from 'vitest';
vi.mock('../services/mcpClient.js', () => ({ callLearnSearch: vi.fn().mockResolvedValue('MOCK_SEARCH_TEXT') }));
vi.mock('../services/questionService.js', () => ({ listCertifications: vi.fn().mockResolvedValue([{ id: 'gh-100', name: 'GH-100', description: 'Foundations' }, { id: 'ai-102', name: 'AI-102', description: 'AI Engineer' }]) }));
import adventureGenerator from '../services/adventureGeneratorService.js';

describe('parseAndValidate', () => {
  it('未知のcertIdを除外', () => {
    const known = new Set(['gh-100', 'ai-102']);
    const out = adventureGenerator.parseAndValidate({
      raw: JSON.stringify({ name: 'X', description: '...', dungeons: ['gh-100', 'unknown', 'ai-102'], citations: [{ url: 'https://...', title: 'T' }] }),
      knownCertIds: known,
    });
    expect(out.dungeons).toEqual(['gh-100', 'ai-102']);
    expect(out.verificationStatus).toBe('verified');
  });

  it('citations ゼロは warning-no-citations', () => {
    const out = adventureGenerator.parseAndValidate({
      raw: JSON.stringify({ name: 'X', description: '...', dungeons: ['gh-100'], citations: [] }),
      knownCertIds: new Set(['gh-100']),
    });
    expect(out.verificationStatus).toBe('warning-no-citations');
  });

  it('dungeonsが空になったら null を返す（失敗）', () => {
    const out = adventureGenerator.parseAndValidate({
      raw: JSON.stringify({ name: 'X', dungeons: ['unknown'], citations: [] }),
      knownCertIds: new Set(['gh-100']),
    });
    expect(out).toBe(null);
  });
});
```

- [ ] **Step 2: 実装**

```js
'use strict';
const OpenAI = require('openai');
const mcpClient = require('./mcpClient');
const questionService = require('./questionService');

const MAX_USER_PROMPT_LEN = 500;
const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';
const GITHUB_MODELS_DEFAULT_MODEL = 'gpt-4o-mini';

function sanitizePrompt(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').slice(0, MAX_USER_PROMPT_LEN).trim();
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

function parseAndValidate({ raw, knownCertIds }) {
  const json = extractJson(raw);
  if (!json) return null;
  let data;
  try { data = JSON.parse(json); } catch { return null; }
  const dungeons = (data.dungeons || []).filter((id) => knownCertIds.has(id));
  if (dungeons.length === 0) return null;
  const citations = Array.isArray(data.citations) ? data.citations.filter((c) => c.url) : [];
  return {
    name: String(data.name || '無名の冒険').slice(0, 80),
    description: String(data.description || '').slice(0, 500),
    rationale: String(data.rationale || '').slice(0, 1000),
    dungeons,
    citations: citations.slice(0, 10),
    verificationStatus: citations.length > 0 ? 'verified' : 'warning-no-citations',
  };
}

async function generateFromPrompt({ userPrompt, accessToken, onProgress = () => {} }) {
  const prompt = sanitizePrompt(userPrompt);
  if (!prompt) throw new Error('userPrompt が空です');

  onProgress('公式資料を検索中...');
  let searchText = '';
  try {
    searchText = await mcpClient.callLearnSearch(`${prompt} certification learning path`);
  } catch (err) {
    console.warn('[LearnMCP] search failed:', err.message);
  }

  onProgress('冒険を組み立て中...');
  const certs = await questionService.listCertifications();
  const knownCertIds = new Set(certs.map((c) => c.id));

  const sysPrompt = [
    'あなたは資格取得コーチ。ユーザーの希望に基づき、システム内の利用可能な資格から最適な順序で学習「冒険」を構築してください。',
    '',
    '## 利用可能な資格 (dungeons に使えるのはこの中のみ)',
    certs.map((c) => `- ${c.id}: ${c.name}`).join('\n'),
    '',
    '## Microsoft Learn 公式情報抜粋',
    (searchText || '(取得失敗)').slice(0, 4000),
    '',
    '## 出力（JSONのみ、コードフェンス不要）',
    '{"name":"","description":"","rationale":"","dungeons":[],"citations":[{"url":"","title":""}]}',
  ].join('\n');

  const openai = new OpenAI({ baseURL: GITHUB_MODELS_ENDPOINT, apiKey: accessToken });
  const response = await openai.chat.completions.create({
    model: GITHUB_MODELS_DEFAULT_MODEL,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
  });

  onProgress('検証中...');
  const raw = response.choices[0]?.message?.content || '';
  const validated = parseAndValidate({ raw, knownCertIds });
  if (!validated) throw new Error('冒険を構築できませんでした。別の表現でお試しください。');

  validated.source = 'llm';
  validated.userPrompt = prompt;
  return validated;
}

module.exports = { generateFromPrompt, parseAndValidate };
```

- [ ] **Step 3: テスト成功確認**

- [ ] **Step 4: コミット**

```
git add services/adventureGeneratorService.js tests/adventureGeneratorService.test.js
git commit -m "feat(adventure): add LLM-based generation with MS Learn MCP citations"
```

---

### Task 4.3: routes/api-adventure.js（SSE 生成エンドポイント）

**Files:**
- Create: `routes/api-adventure.js`
- Modify: `app.js`

- [ ] **Step 1: 実装**

```js
'use strict';
const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const adventureService = require('../services/adventureService');
const adventureGenerator = require('../services/adventureGeneratorService');
const { requireAuth } = require('../middleware/auth');

router.post('/generate', requireAuth, async (req, res) => {
  const accessToken = await userService.getGithubAccessToken(req.user.id);
  if (!accessToken) return res.status(400).json({ error: 'GitHubトークンが無効です。再ログインしてください。' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const validated = await adventureGenerator.generateFromPrompt({
      userPrompt: req.body.userPrompt,
      accessToken,
      onProgress: (msg) => send('progress', { message: msg }),
    });
    const adv = await adventureService.createAdventure({
      userId: req.user.id,
      ...validated,
      dungeons: validated.dungeons.map((cid, i) => ({
        certificationId: cid,
        order: i + 1,
        status: i === 0 ? 'in-progress' : 'locked',
        unlockedAt: i === 0 ? new Date().toISOString() : null,
        clearedAt: null,
      })),
      isActive: true,
    });
    await adventureService.setActive(req.user.id, adv.id);
    send('done', { adventureId: adv.id });
  } catch (err) {
    console.error('[adventureGenerate]', err);
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
```

- [ ] **Step 2: app.js に登録**

```js
const apiAdventureRouter = require('./routes/api-adventure');
app.use('/api/adventures', apiAdventureRouter);
```

- [ ] **Step 3: コミット**

```
git add routes/api-adventure.js app.js
git commit -m "feat(adventure): add SSE endpoint for LLM generation"
```

---

### Task 4.4: views/adventure-new.ejs（プリセット + LLM生成フォーム）

**Files:**
- Create: `views/adventure-new.ejs`

- [ ] **Step 1: 書く**

```html
<!DOCTYPE html>
<html lang="ja"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %></title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=M+PLUS+1+Code:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/theme.css">
</head><body>
  <nav class="hud">
    <a class="rpg-btn is-gold" href="/">← 戻る</a>
    <div class="hud-spacer"></div>
    <span class="hud-cell"><%= userEmail %></span>
  </nav>
  <main style="padding:32px;max-width:860px;margin:0 auto;">
    <h1 class="rpg-title" style="font-size:28px;">🔮 冒険を始める</h1>

    <section class="rpg-window" style="margin-top:20px;">
      <h2 class="rpg-title">💬 自由入力</h2>
      <p style="font-family:var(--font-body);">どんな勇者を目指したい？</p>
      <form id="llmForm">
        <textarea name="userPrompt" rows="4" required
          style="width:100%;background:#000;color:var(--ink);border:2px solid var(--ink);font-family:var(--font-body);padding:8px;"
          placeholder="例: バックエンドとAIに強いエンジニアになりたい"></textarea>
        <button class="rpg-btn is-gold" style="margin-top:10px;" type="submit">水晶玉に問う</button>
      </form>
      <pre id="llmLog" style="margin-top:12px;color:var(--gold);font-family:var(--font-display);white-space:pre-wrap;"></pre>
    </section>

    <h2 class="rpg-title" style="margin-top:32px;">⛩ プリセットから選ぶ</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;">
      <% for (const p of presets) { %>
        <form method="POST" action="/adventures/preset">
          <input type="hidden" name="presetId" value="<%= p.id %>">
          <button class="rpg-window" style="width:100%;text-align:left;cursor:pointer;">
            <div style="font-size:32px;"><%= p.icon %></div>
            <div style="font-family:var(--font-display);font-size:14px;color:var(--gold);"><%= p.name %></div>
            <div style="font-family:var(--font-body);font-size:12px;opacity:.85;"><%= p.tagline %></div>
            <div style="font-family:var(--font-body);font-size:11px;margin-top:6px;">ダンジョン: <%= p.dungeons.join(' → ') %></div>
          </button>
        </form>
      <% } %>
    </div>
  </main>

<script>
document.getElementById('llmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const log = document.getElementById('llmLog');
  log.textContent = '▸ 水晶玉に問いかけています...';
  const form = new FormData(e.target);
  const res = await fetch('/api/adventures/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userPrompt: form.get('userPrompt') }),
  });
  if (!res.body) { log.textContent = 'ストリーム開始失敗'; return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n\n'); buf = lines.pop();
    for (const line of lines) {
      const evMatch = line.match(/^event:\s*(\w+)/m);
      const daMatch = line.match(/^data:\s*(.+)$/m);
      if (!evMatch || !daMatch) continue;
      const data = JSON.parse(daMatch[1]);
      if (evMatch[1] === 'progress') log.textContent += '\n' + data.message;
      else if (evMatch[1] === 'done') { location.href = '/adventures/' + data.adventureId; return; }
      else if (evMatch[1] === 'error') { log.textContent += '\n❌ ' + data.error; return; }
    }
  }
});
</script>
</body></html>
```

- [ ] **Step 2: 手動確認**

`/adventures/new` でテキスト入力 → 水晶玉に問う → プログレス → 完了後に詳細画面へ遷移。

- [ ] **Step 3: コミット**

```
git add views/adventure-new.ejs
git commit -m "feat(adventure): add adventure creation page with SSE progress"
```

---

### Task 4.5: .env.example を更新

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 追記**

```
# Microsoft Learn MCP (optional, defaults to https://learn.microsoft.com/api/mcp)
MS_LEARN_MCP_URL=https://learn.microsoft.com/api/mcp
```

- [ ] **Step 2: コミット**

```
git add .env.example
git commit -m "docs(env): document MS_LEARN_MCP_URL"
```

---

### M4 完了確認

- [ ] 「バックエンドとAIに強く…」で冒険が生成され、citations が表示される
- [ ] MCP 到達不可時は warning-no-citations で生成される

**M4 終了コミット:**

```
git commit --allow-empty -m "milestone: M4 LLM adventure generation complete"
```

---

## マイルストーン M5: ホーム再構築

### Task 5.1: routes/index.js を冒険マップ対応に

**Files:**
- Modify: `routes/index.js`

- [ ] **Step 1: 既存を Read**

- [ ] **Step 2: 差し替え方針**

```js
router.get('/', requireAuth, async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user.stats || {};
  const xpBreak = gamificationService.xpBreakdown(stats.xp || 0);

  let activeAdventure = null;
  if (stats.activeAdventureId) {
    activeAdventure = await adventureService.getAdventure(stats.activeAdventureId, req.user.id);
  }

  if (!activeAdventure) {
    return res.redirect('/adventures/new');
  }

  const certs = await questionService.listCertifications();
  const certById = Object.fromEntries(certs.map((c) => [c.id, c]));

  res.render('adventure-map', {
    title: '冒険マップ',
    userEmail: user.email,
    userName: user.displayName || user.username,
    stats: { ...stats, ...xpBreak },
    adventure: activeAdventure,
    certById,
  });
});
```

既存の「公開資格一覧」は `/free-mode` などに移設、もしくは `/my/certifications` から到達できれば削除でもよい（本タスクでは `/free-mode` に移設する）。

- [ ] **Step 3: `/free-mode` に旧一覧を移設**

旧ロジックをほぼそのまま `/free-mode` に貼り替え（ビューは `views/index.ejs` を残して使う）。

- [ ] **Step 4: コミット**

```
git commit -am "refactor(index): redirect home to adventure-map, move legacy list to /free-mode"
```

---

### Task 5.2: views/adventure-map.ejs（モックの EJS化）

**Files:**
- Create: `views/adventure-map.ejs`

- [ ] **Step 1: モック `public/mocks/adventure-map.html` をベースに EJS 化**

- ハードコード `🏰 / 🗼 / 👹` のノードを `adventure.dungeons` から動的生成
- 各ノードの `status` に応じて `cleared / current / locked` クラスを切替
- `certById[d.certificationId].name` を表示
- マスタリーランクを `stats.masteryRanks` から引いて各ノードに表示

主要ループ:

```html
<% const W = 100; const step = adventure.dungeons.length > 1 ? (W - 12) / (adventure.dungeons.length - 1) : 0; %>
<% adventure.dungeons.forEach((d, i) => {
     const left = 6 + step * i;
     const cert = certById[d.certificationId];
     const rankSummary = (() => {
       if (!cert) return '';
       const ranks = cert.domains.map((dm) => stats.masteryRanks[cert.id + ':' + dm.id]?.rank || '?');
       return ranks.join(' ');
     })();
     const cls = d.status === 'cleared' ? 'cleared' : d.status === 'in-progress' ? 'current' : 'locked';
     const sprite = d.status === 'cleared' ? '🏰' : d.status === 'in-progress' ? '🗼' : '🔒';
%>
  <a class="node <%= cls %>" href="/certifications/<%= d.certificationId %>" style="left: <%= left %>%; top: <%= 40 + (i % 2) * 8 %>%;">
    <div class="sprite"><%= sprite %></div>
    <div class="name"><%= cert?.name || d.certificationId %></div>
    <div class="rank"><%= rankSummary %></div>
  </a>
<% }); %>
```

- 画面全体の HTML 構造と CSS はモックから抽出。CSS はインラインではなく **`/theme.css` と `style` 属性のみ** にし、重複は `theme.css` へ移す。

- [ ] **Step 2: モック独自の CSS（.node, .path, .map）を theme.css に移管**

`public/theme.css` 末尾に追加:

```css
.adv-map { position: relative; height: 420px; margin: 20px 0 40px; background:
  repeating-linear-gradient(0deg, transparent 0 30px, rgba(122,199,79,0.06) 30px 32px),
  repeating-linear-gradient(90deg, transparent 0 30px, rgba(122,199,79,0.06) 30px 32px),
  linear-gradient(180deg, #0b1734 0%, #071025 100%);
  border: 3px solid var(--gold); box-shadow: inset 0 0 0 3px #b8891a, 4px 4px 0 var(--shadow); overflow: hidden; }
.adv-map .path { position: absolute; left: 0; right: 0; top: 55%; height: 26px;
  background: repeating-linear-gradient(90deg, #a87a00 0 12px, #7a5a00 12px 14px);
  border-top: 3px solid #d9a733; border-bottom: 3px solid #5a4400; transform: skewY(-2deg); transform-origin: left; }
.node { position: absolute; width: 88px; height: 96px; display: flex; flex-direction: column; align-items: center; text-align: center; cursor: pointer; text-decoration: none; color: var(--ink); }
.node .sprite { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; font-size: 44px; background: var(--window); border: 3px solid var(--ink); box-shadow: inset 0 0 0 3px var(--window-lt), 4px 4px 0 var(--shadow); }
.node.cleared .sprite { background: #3a6017; border-color: var(--fern); box-shadow: inset 0 0 0 3px #255010, 4px 4px 0 var(--shadow); }
.node.current .sprite { background: #b8891a; border-color: var(--gold); box-shadow: inset 0 0 0 3px #6b5012, 4px 4px 0 var(--shadow); animation: node-glow 1.4s steps(2) infinite; }
.node.locked .sprite { background: #2a2a2a; border-color: #555; filter: grayscale(1) brightness(0.7); }
.node .name { margin-top: 6px; font-family: var(--font-display); font-size: 11px; text-shadow: 1px 1px 0 var(--shadow); white-space: nowrap; }
.node .rank { margin-top: 2px; font-family: var(--font-display); font-size: 10px; padding: 1px 6px; background: #000a; }
@keyframes node-glow { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
```

- [ ] **Step 3: 手動確認**

ブラウザで `/` にアクセス、冒険マップが表示され、各ノードが status に応じた色で描画される。クリックで `/certifications/:id` に遷移する。

- [ ] **Step 4: コミット**

```
git add views/adventure-map.ejs public/theme.css
git commit -m "feat(home): render adventure map as homepage"
```

---

### M5 完了確認

- [ ] ホーム (`/`) がアクティブ冒険のマップで表示される
- [ ] アクティブ冒険が無いユーザーは `/adventures/new` にリダイレクトされる
- [ ] ダンジョンをクリアすると次のノードが点滅して解放される

**M5 終了コミット:**

```
git commit --allow-empty -m "milestone: M5 adventure map home complete"
```

---

## 最終確認

- [ ] `npm test` がすべてパス
- [ ] `npm run dev` でアプリが起動し、以下 E2E 手動シナリオが動く:
  1. ログイン → `/` → `/adventures/new` へリダイレクト
  2. プリセット「AI賢者の道」を選択 → 冒険詳細
  3. `/` に戻る → 冒険マップに AI-102 が in-progress、AI-900 が locked で描画
  4. AI-102 のクイズを全ドメイン B 以上まで回す
  5. 結果画面で LEVEL UP / ランク昇格 / 実績 (streak-3, level-5 等) が演出
  6. `/` に戻る → AI-102 が cleared、AI-900 が in-progress に変化
  7. `/my/profile` で取得実績・Lv・ストリークが表示される
- [ ] 「バックエンドとAIに強いエンジニア」で LLM 生成を実行 → citations 付きの冒険が生成される

**最終コミット:**

```
git commit --allow-empty -m "milestone: RPG gamification MVP complete (M1-M5)"
```
