# 冒険ダンジョンの自由挑戦化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プリセットを選んで冒険を始めたあと、含まれる全ダンジョンを最初から自由に挑戦できるようにする（推奨順は維持）。

**Architecture:** `status` の `locked` 状態を廃止し、新規作成時は全ダンジョンを `in-progress` で生成する。既存データの `locked` は読み取り時の正規化レイヤ（`normalizeAdventure`）で動的に `in-progress` へ変換し、マイグレーションスクリプトは作らない。UI では「最初の未クリアダンジョン」を派生計算して "次のおすすめ" として gold 強調する。

**Tech Stack:** Node.js / Express / EJS / Vitest / Cosmos DB Emulator（テストは実 DB に接続）

**仕様書:** `docs/superpowers/specs/2026-04-26-adventure-free-challenge-design.md`

---

## ファイル構造

| ファイル | 変更内容 |
| --- | --- |
| `services/adventureService.js` | `normalizeAdventure` 新設 / `checkDungeonUnlocks` 簡素化 / `getAdventure`・`listAdventures`・`getActiveAdventure` を normalize 経由に |
| `routes/adventures.js` | `POST /preset` で全ダンジョン `in-progress` 生成 / `GET /:id` で `recommendedIndex` をテンプレへ |
| `views/adventure-detail.ejs` | `locked` 分岐削除・全ダンジョンに「入る」ボタン・最初の未クリアに "次のおすすめ" バッジ |
| `tests/adventureService.test.js` | 既存 5 ケース改修 + `normalizeAdventure` のユニットテスト追加 |
| `tests/routes.adventures.test.mjs` | 統合テスト 3 ケース追加 |

---

## Task 1: `normalizeAdventure` を新設

**Files:**
- Modify: `services/adventureService.js`
- Modify: `tests/adventureService.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/adventureService.test.js` の末尾に追加:

```js
describe('normalizeAdventure', () => {
  it('locked ステータスは in-progress に変換される', () => {
    const adv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't1' },
        { certificationId: 'gh-200', order: 2, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
    };
    const out = adventureService.normalizeAdventure(adv);
    expect(out.dungeons[1].status).toBe('in-progress');
  });

  it('unlockedAt が null のダンジョンは値が補完される', () => {
    const adv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
    };
    const out = adventureService.normalizeAdventure(adv);
    expect(out.dungeons[0].unlockedAt).toBeTruthy();
  });

  it('cleared ステータスはそのまま保持される', () => {
    const adv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't2' },
      ],
    };
    const out = adventureService.normalizeAdventure(adv);
    expect(out.dungeons[0].status).toBe('cleared');
    expect(out.dungeons[0].unlockedAt).toBe('t1');
    expect(out.dungeons[0].clearedAt).toBe('t2');
  });

  it('null や undefined を渡しても落ちない', () => {
    expect(adventureService.normalizeAdventure(null)).toBe(null);
    expect(adventureService.normalizeAdventure(undefined)).toBe(undefined);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- adventureService`
Expected: 4 つの新規テストが失敗（`adventureService.normalizeAdventure is not a function`）

- [ ] **Step 3: `normalizeAdventure` を実装**

`services/adventureService.js` の `isDungeonBClearable` の下、`checkDungeonUnlocks` の上に追加:

```js
function normalizeAdventure(adv) {
  if (!adv) return adv;
  if (!Array.isArray(adv.dungeons)) return adv;
  const dungeons = adv.dungeons.map((d) => {
    const status = d.status === 'locked' ? 'in-progress' : d.status;
    const unlockedAt = d.unlockedAt
      || (d.status === 'cleared' ? d.clearedAt : new Date(0).toISOString());
    return { ...d, status, unlockedAt };
  });
  return { ...adv, dungeons };
}
```

`module.exports` の中に `normalizeAdventure,` を追加。

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test -- adventureService`
Expected: 全テストが PASS

- [ ] **Step 5: コミット**

```bash
git add services/adventureService.js tests/adventureService.test.js
git commit -m "feat(adventure): normalizeAdventure を追加して locked を in-progress に動的変換"
```

---

## Task 2: read 系メソッドを normalize 経由に

**Files:**
- Modify: `services/adventureService.js`
- Modify: `tests/adventureService.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/adventureService.test.js` の末尾に追加:

```js
describe('read methods normalize', () => {
  it('getAdventure は locked を含むドキュメントを正規化して返す', async () => {
    const cosmosService = (await import('../services/cosmosService.js')).default;
    cosmosService.read.mockResolvedValueOnce({
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't1' },
        { certificationId: 'gh-200', order: 2, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
    });
    const out = await adventureService.getAdventure('adv1', 'u1');
    expect(out.dungeons[1].status).toBe('in-progress');
    expect(out.dungeons[1].unlockedAt).toBeTruthy();
  });

  it('listAdventures は配列の各要素を正規化する', async () => {
    const cosmosService = (await import('../services/cosmosService.js')).default;
    cosmosService.query.mockResolvedValueOnce([
      {
        id: 'adv1', userId: 'u1',
        dungeons: [{ certificationId: 'gh-100', order: 1, status: 'locked', unlockedAt: null, clearedAt: null }],
      },
    ]);
    const out = await adventureService.listAdventures('u1');
    expect(out[0].dungeons[0].status).toBe('in-progress');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- adventureService`
Expected: 2 つの新規テストが失敗（locked のままになっている）

- [ ] **Step 3: `getAdventure` / `listAdventures` / `getActiveAdventure` を改修**

`services/adventureService.js` の該当 3 関数を以下に置換:

```js
async function listAdventures(userId) {
  const items = await cosmosService.query('adventures', {
    query: 'SELECT * FROM c WHERE c.userId = @u',
    parameters: [{ name: '@u', value: userId }],
  }, { partitionKey: userId });
  return items.map(normalizeAdventure);
}

async function getAdventure(id, userId) {
  const adv = await cosmosService.read('adventures', id, userId);
  return normalizeAdventure(adv);
}

async function getActiveAdventure(userId) {
  const userService = require('./userService');
  const user = await userService.getUserById(userId);
  const id = user?.stats?.activeAdventureId;
  if (!id) return null;
  return getAdventure(id, userId);
}
```

（`getActiveAdventure` は内部で `getAdventure` を呼ぶので追加変更不要）

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test -- adventureService`
Expected: 全テストが PASS

- [ ] **Step 5: コミット**

```bash
git add services/adventureService.js tests/adventureService.test.js
git commit -m "refactor(adventure): getAdventure/listAdventures の戻り値を normalize 経由に"
```

---

## Task 3: `checkDungeonUnlocks` を簡素化

**Files:**
- Modify: `services/adventureService.js`
- Modify: `tests/adventureService.test.js`

- [ ] **Step 1: 既存テストを新仕様に合わせて改修**

`tests/adventureService.test.js` の `describe('checkDungeonUnlocks', ...)` を以下に置換:

```js
describe('checkDungeonUnlocks', () => {
  const baseAdv = {
    id: 'adv1', userId: 'u1', isActive: true,
    dungeons: [
      { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 'x', clearedAt: 'x' },
      { certificationId: 'gh-200', order: 2, status: 'in-progress', unlockedAt: 'y', clearedAt: null },
      { certificationId: 'ai-102', order: 3, status: 'in-progress', unlockedAt: 'z', clearedAt: null },
    ],
  };
  const domainCounts = { 'gh-100': 3, 'gh-200': 2, 'ai-102': 3 };

  it('B 以上のダンジョンを cleared に遷移させる（次の自動 unlock は行わない）', () => {
    const ranks = {
      'gh-200:d1': { rank: 'B' },
      'gh-200:d2': { rank: 'A' },
    };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('cleared');
    expect(next.dungeons[1].clearedAt).not.toBeNull();
    expect(next.dungeons[2].status).toBe('in-progress');
  });

  it('未達ランクなら状態変化なし', () => {
    const ranks = { 'gh-200:d1': { rank: 'C' }, 'gh-200:d2': { rank: 'A' } };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('in-progress');
    expect(next.dungeons[2].status).toBe('in-progress');
  });

  it('ドメインカウントに無い cert は false 扱い', () => {
    const ranks = { 'gh-200:d1': { rank: 'A' }, 'gh-200:d2': { rank: 'A' } };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, {});
    expect(next.dungeons[1].status).toBe('in-progress');
  });

  it('既に cleared の前ダンジョンには影響しない', () => {
    const ranks = {};
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[0].status).toBe('cleared');
  });

  it('全 in-progress ダンジョンが条件を満たせば全て cleared に遷移する', () => {
    const ranks = {
      'gh-200:d1': { rank: 'A' }, 'gh-200:d2': { rank: 'A' },
      'ai-102:d1': { rank: 'B' }, 'ai-102:d2': { rank: 'B' }, 'ai-102:d3': { rank: 'A' },
    };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('cleared');
    expect(next.dungeons[2].status).toBe('cleared');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- adventureService`
Expected: 「全 in-progress ダンジョンが条件を満たせば全て cleared に遷移する」が失敗（現実装はループの順番依存で次のダンジョンを `in-progress` に上書きするため、後続の判定が乱れる）

- [ ] **Step 3: `checkDungeonUnlocks` を新仕様で実装**

`services/adventureService.js` の `checkDungeonUnlocks` を以下に置換:

```js
function checkDungeonUnlocks(adventure, ranks, domainCounts) {
  const dungeons = adventure.dungeons.map((d) => {
    if (d.status === 'in-progress' && isDungeonBClearable(d, ranks, domainCounts)) {
      return { ...d, status: 'cleared', clearedAt: new Date().toISOString() };
    }
    return d;
  });
  return { ...adventure, dungeons };
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test -- adventureService`
Expected: 全テストが PASS

- [ ] **Step 5: コミット**

```bash
git add services/adventureService.js tests/adventureService.test.js
git commit -m "refactor(adventure): checkDungeonUnlocks をクリア判定のみに簡素化"
```

---

## Task 4: 新規冒険作成時に全ダンジョンを in-progress で生成

**Files:**
- Modify: `routes/adventures.js`
- Modify: `tests/routes.adventures.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routes.adventures.test.mjs` の `describe('routes/adventures', ...)` の末尾に追加:

```js
test('POST /preset で作成された冒険の全ダンジョンが in-progress で unlockedAt がセットされる', async () => {
  const user = await createTestUser();
  await seedAvailableCerts();
  const agent = await authedAgent(user);
  const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
  const id = created.headers.location.replace('/adventures/', '');

  const cosmosService = (await import('../services/cosmosService.js')).default;
  const adv = await cosmosService.read('adventures', id, user.id);
  expect(adv.dungeons.length).toBeGreaterThan(1);
  for (const d of adv.dungeons) {
    expect(d.status).toBe('in-progress');
    expect(d.unlockedAt).toBeTruthy();
    expect(d.clearedAt).toBeNull();
  }
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- routes.adventures`
Expected: 新規テストが失敗（2 番目以降のダンジョンが `locked` になる）

- [ ] **Step 3: `POST /preset` のダンジョン生成を変更**

`routes/adventures.js` の 128-134 行目あたりの `dungeons:` を以下に置換:

```js
    dungeons: availableDungeons.map((d, i) => ({
      certificationId: d.certId,
      order: i + 1,
      status: 'in-progress',
      unlockedAt: new Date().toISOString(),
      clearedAt: null,
    })),
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test -- routes.adventures`
Expected: 全テストが PASS

- [ ] **Step 5: コミット**

```bash
git add routes/adventures.js tests/routes.adventures.test.mjs
git commit -m "feat(adventure): 新規冒険作成時に全ダンジョンを in-progress で開始"
```

---

## Task 5: `GET /:id` で `recommendedIndex` をテンプレに渡す

**Files:**
- Modify: `routes/adventures.js`

- [ ] **Step 1: `GET /:id` を改修**

`routes/adventures.js` の 144-155 行目あたりを以下に置換:

```js
router.get('/:id', requireAuth, async (req, res) => {
  const adv = await adventureService.getAdventure(req.params.id, req.user.id);
  if (!adv) return res.status(404).render('error', { title: '404', message: '冒険が見つかりません' });

  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const certById = Object.fromEntries(certs.map((c) => [c.id, c]));
  const recommendedIndex = adv.dungeons.findIndex((d) => d.status === 'in-progress');
  res.render('adventure-detail', {
    title: adv.name,
    adventure: adv,
    certById,
    recommendedIndex,
  });
});
```

- [ ] **Step 2: 既存テストが壊れていないか確認**

Run: `npm test -- routes.adventures`
Expected: 既存テスト全 PASS（テンプレ側は次タスクで `recommendedIndex` を使い始めるため、まだ参照しない）

- [ ] **Step 3: コミット**

```bash
git add routes/adventures.js
git commit -m "feat(adventure): GET /:id で recommendedIndex をテンプレに渡す"
```

---

## Task 6: UI から locked 表示を撤去し「次のおすすめ」を強調

**Files:**
- Modify: `views/adventure-detail.ejs`
- Modify: `tests/routes.adventures.test.mjs`

- [ ] **Step 1: 統合テストを 2 ケース追加**

`tests/routes.adventures.test.mjs` の末尾に追加:

```js
test('GET /:id で全ダンジョンに「入る」ボタンが表示される（🔒 が出ない）', async () => {
  const user = await createTestUser();
  await seedAvailableCerts();
  const agent = await authedAgent(user);
  const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
  const id = created.headers.location.replace('/adventures/', '');

  const detail = await agent.get(`/adventures/${id}`);
  expect(detail.status).toBe(200);
  expect(detail.text).not.toContain('🔒');
  // gh-100 と gh-200 の両方の「入る」リンクが存在
  expect(detail.text).toContain('href="/certifications/gh-100"');
  expect(detail.text).toContain('href="/certifications/gh-200"');
});

test('既存の locked ステータスを持つドキュメントも GET 時に正規化されて表示される', async () => {
  const user = await createTestUser();
  await seedAvailableCerts();
  const agent = await authedAgent(user);

  const cosmosService = (await import('../services/cosmosService.js')).default;
  const advId = `adv-${crypto.randomUUID()}`;
  await cosmosService.upsert('adventures', {
    id: advId,
    userId: user.id,
    name: 'レガシー冒険',
    description: '',
    source: 'preset',
    presetId: 'developer',
    dungeons: [
      { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't1' },
      { certificationId: 'gh-200', order: 2, status: 'locked', unlockedAt: null, clearedAt: null },
    ],
    rationale: '',
    citations: [],
    verificationStatus: 'verified',
    isActive: true,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });

  const detail = await agent.get(`/adventures/${advId}`);
  expect(detail.status).toBe(200);
  expect(detail.text).not.toContain('🔒');
  expect(detail.text).toContain('href="/certifications/gh-200"');
});
```

ファイル先頭に `import crypto from 'node:crypto';` を追加（既に無ければ）。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- routes.adventures`
Expected: 2 つの新規テストが失敗（🔒 が出る／locked の「入る」リンクが出ない）

- [ ] **Step 3: `views/adventure-detail.ejs` を改修**

44-69 行目あたりの `<section class="rpg-window">` ブロックを以下に置換:

```ejs
    <section class="rpg-window">
      <h2 class="rpg-title" style="font-size: 16px;">🗡 ダンジョン（推奨順）</h2>
      <ol style="list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 8px;">
        <% for (let i = 0; i < adventure.dungeons.length; i += 1) {
             const d = adventure.dungeons[i];
             const cert = certById[d.certificationId];
             const label = cert ? cert.name : d.certificationId;
             const statusColor = d.status === 'cleared' ? 'var(--fern)' : 'var(--gold)';
             const statusText = d.status === 'cleared' ? '踏破済み' : '挑戦中';
             const isRecommended = (typeof recommendedIndex !== 'undefined') && i === recommendedIndex;
             const itemBorder = isRecommended ? '2px solid var(--gold)' : '4px solid ' + statusColor;
             const itemPadding = isRecommended ? '9px 11px' : '10px 12px';
        %>
          <li style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: <%= itemPadding %>; background: #0008; border-left: <%= itemBorder %>;<% if (isRecommended) { %> box-shadow: 0 0 0 1px var(--gold) inset;<% } %>">
            <div style="display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
              <span style="font-family: var(--font-display); color: <%= statusColor %>;">#<%= d.order %></span>
              <span style="font-family: var(--font-display); color: var(--ink);"><%= label %></span>
              <span class="pill" style="color: <%= statusColor %>; border-color: <%= statusColor %>; font-size:10px;"><%= statusText %></span>
              <% if (isRecommended) { %>
                <span class="pill" style="color: var(--gold); border-color: var(--gold); font-size:10px;">▶ 次のおすすめ</span>
              <% } %>
            </div>
            <div>
              <a href="/certifications/<%= d.certificationId %>" class="rpg-btn is-gold" style="font-size:11px;padding:5px 12px;">入る</a>
            </div>
          </li>
        <% } %>
      </ol>
    </section>
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npm test -- routes.adventures`
Expected: 全テストが PASS

- [ ] **Step 5: コミット**

```bash
git add views/adventure-detail.ejs tests/routes.adventures.test.mjs
git commit -m "feat(adventure): UI から 🔒 を撤去し全ダンジョンに「入る」ボタンを表示"
```

---

## Task 7: 全体テスト・lint で回帰確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: 全テストが PASS。`tests/_harness/spec-coverage.test.mjs` も green。

- [ ] **Step 2: lint を実行**

Run: `npm run lint`
Expected: エラーなし

- [ ] **Step 3: 開発サーバを起動して手動確認**

Run: `npm run dev`（別シェルで）
- ブラウザで `/adventures/new` にアクセスしプリセットを選択
- 作成された冒険の詳細ページで:
  - 🔒 が出ていないこと
  - 全ダンジョンに「入る」ボタンが出ていること
  - #1 ダンジョンに「▶ 次のおすすめ」バッジと gold 強調が出ていること
- 「入る」をクリックして 2 番目以降のダンジョンに直接移動できること

- [ ] **Step 4: 必要なら最終コミット**

該当なし（既に各タスクでコミット済み）

---

## Self-Review チェック

- **Spec coverage**: 仕様書の全セクション（データモデル / サービス層 / ルート層 / UI / テスト / 互換性）が Task 1-6 でカバーされている。互換性は Task 2（read 系正規化）+ Task 6 のレガシー検証テストで担保。
- **Placeholder scan**: TBD/TODO なし。全コードブロックが完成形。
- **Type consistency**: `normalizeAdventure` / `checkDungeonUnlocks` / `recommendedIndex` の名前と引数は全タスクで一貫。
