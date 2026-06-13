# 資格お気に入り・合格マーク・ステータス実績 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マイ資格を「お気に入り登録した資格」の一覧にし、資格ごとの手動「合格」マークと、ステータス画面への合格資格表示を追加する。

**Architecture:** お気に入り・合格は `user.stats` の配列（`favoriteCertifications` / `passedCertifications`）に保存。ユーザー状態の更新は `/my/certifications` ルーターに集約し、各ビューは form POST（returnTo 付き）でトグルする。マイ資格は favorites を `questionService.listCertificationsByIds` で解決して表示。既存ユーザー向けに自作資格を一度だけ favorites へ取り込むバックフィルを持つ。

**Tech Stack:** Node.js / Express 4 / EJS / Azure Cosmos DB（エミュレータ） / vitest + supertest。

**前提:** 統合テストは Cosmos エミュレータ稼働が必須（`docker compose up -d cosmos-emulator`）。`user.stats` はスキーマレスで `updateUserStats(id, updater)` で更新できる。`questionService.canAccessCertification(cert, userId)` は公開 or 作成者のみ true。

---

## File Structure

**Modify（実装）:**
- `services/userService.js` — stats 初期化に `favoriteCertifications`/`passedCertifications` を追加。`addFavorite`/`removeFavorite`/`markPassed`/`unmarkPassed`/`initializeFavorites` を追加・export。
- `services/questionService.js` — `listCertificationsByIds(ids, userId)` を追加・export。
- `routes/certifications.js` — `safeReturnTo` ヘルパー、`favorite`/`unfavorite`/`pass`/`unpass` の POST ルート、`GET /` の favorites 化＋バックフィル、`POST /new` の自動お気に入り、`delete` 時の除去。
- `routes/index.js` — `/free-mode` と `/certifications/:certId` の render に `favoriteIds`/`passedIds`（と詳細用 `isFavorite`/`isPassed`）を渡す。
- `routes/profile.js` — `passedCertifications` を解決して `passedCerts` を渡す。
- `views/my-certifications.ejs` — favorites 一覧（トグル・🎓バッジ・自作のみ管理・空状態）。
- `views/index.ejs` — 各カードに ☆/★ トグル＋🎓バッジ。
- `views/certification.ejs` — ヘッダに ☆/★ と 🎓 合格 トグル。
- `views/profile.ejs` — 「🎓 合格資格」セクション。

**Modify（テスト）:**
- `tests/userService.test.mjs`、`tests/routes.certifications.test.mjs`、`tests/routes.index.test.mjs`、`tests/routes.profile.test.mjs`。

`views.test.mjs` はルート経由でレンダリングするため、ルートが新変数を渡せば変更不要。網羅性ハーネスは既存ファイルへの追記のため対応不要。

---

## Task 1: userService — stats フィールドと favorite/passed ミューテータ

**Files:**
- Modify: `services/userService.js`（upsertGithubUser の stats 初期化、関数追加、exports）
- Test: `tests/userService.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/userService.test.mjs` の「新規ユーザーは gamification 用 stats フィールドをすべて持つ」テスト内、`equippedTitle` の assert の直後に追加:

```js
    expect(user.stats.favoriteCertifications).toEqual([]);
    expect(user.stats.passedCertifications).toEqual([]);
```

さらにファイル末尾の最後の `describe` の後に新しい describe を追加:

```js
describe('favorites と passed の操作', () => {
  beforeEach(() => { store.clear(); });

  it('addFavorite は重複せず追加し、removeFavorite は除去する', async () => {
    await userService.upsertGithubUser({ githubId: 10, githubLogin: 'f', email: 'f@e.com', accessToken: 't', displayName: 'F', avatarUrl: null });
    await userService.addFavorite('github-10', 'gh-100');
    await userService.addFavorite('github-10', 'gh-100');
    let u = await userService.getUserById('github-10');
    expect(u.stats.favoriteCertifications).toEqual(['gh-100']);
    await userService.removeFavorite('github-10', 'gh-100');
    u = await userService.getUserById('github-10');
    expect(u.stats.favoriteCertifications).toEqual([]);
  });

  it('markPassed は certId 重複を無視し、unmarkPassed は除去する', async () => {
    await userService.upsertGithubUser({ githubId: 11, githubLogin: 'g', email: 'g@e.com', accessToken: 't', displayName: 'G', avatarUrl: null });
    await userService.markPassed('github-11', 'ai-102', '2026-06-13T00:00:00.000Z');
    await userService.markPassed('github-11', 'ai-102', '2026-06-14T00:00:00.000Z');
    let u = await userService.getUserById('github-11');
    expect(u.stats.passedCertifications).toEqual([{ certId: 'ai-102', passedAt: '2026-06-13T00:00:00.000Z' }]);
    await userService.unmarkPassed('github-11', 'ai-102');
    u = await userService.getUserById('github-11');
    expect(u.stats.passedCertifications).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- userService`
Expected: FAIL（`addFavorite is not a function` 等、および新規 stats フィールドが undefined）

- [ ] **Step 3: 実装する**

`services/userService.js` の `upsertGithubUser` で、`existing.stats` 分岐の `equippedTitle: ... ?? null,` の直後に追加:

```js
          favoriteCertifications: existing.stats.favoriteCertifications ?? [],
          passedCertifications: existing.stats.passedCertifications ?? [],
```

新規ユーザー分岐（else）の `equippedTitle: null,` の直後に追加:

```js
          favoriteCertifications: [],
          passedCertifications: [],
```

`updateUserStats` 関数の直後に以下を追加:

```js
async function addFavorite(userId, certId) {
  return updateUserStats(userId, (s) => {
    const favs = s.favoriteCertifications || [];
    s.favoriteCertifications = favs.includes(certId) ? favs : [...favs, certId];
    return s;
  });
}

async function removeFavorite(userId, certId) {
  return updateUserStats(userId, (s) => {
    s.favoriteCertifications = (s.favoriteCertifications || []).filter((id) => id !== certId);
    return s;
  });
}

async function markPassed(userId, certId, passedAt) {
  return updateUserStats(userId, (s) => {
    const passed = s.passedCertifications || [];
    s.passedCertifications = passed.some((p) => p.certId === certId)
      ? passed
      : [...passed, { certId, passedAt }];
    return s;
  });
}

async function unmarkPassed(userId, certId) {
  return updateUserStats(userId, (s) => {
    s.passedCertifications = (s.passedCertifications || []).filter((p) => p.certId !== certId);
    return s;
  });
}
```

`module.exports` に追加:

```js
  addFavorite,
  removeFavorite,
  markPassed,
  unmarkPassed,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- userService`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add services/userService.js tests/userService.test.mjs
git commit -m "feat(user): add favorite/passed certification stats and mutators"
```

---

## Task 2: userService — initializeFavorites（自作資格の一度きりバックフィル）

**Files:**
- Modify: `services/userService.js`
- Test: `tests/userService.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/userService.test.mjs` の「favorites と passed の操作」describe 内に追加:

```js
  it('initializeFavorites は自作IDを投入してフラグを立て、解除済みは復活させない', async () => {
    await userService.upsertGithubUser({ githubId: 12, githubLogin: 'h', email: 'h@e.com', accessToken: 't', displayName: 'H', avatarUrl: null });
    await userService.initializeFavorites('github-12', ['c1', 'c2']);
    let u = await userService.getUserById('github-12');
    expect(u.stats.favoriteCertifications).toEqual(['c1', 'c2']);
    expect(u.stats.favoritesInitialized).toBe(true);

    await userService.removeFavorite('github-12', 'c1');
    await userService.initializeFavorites('github-12', ['c1', 'c2']);
    u = await userService.getUserById('github-12');
    expect(u.stats.favoriteCertifications).toEqual(['c2']);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- userService`
Expected: FAIL（`initializeFavorites is not a function`）

- [ ] **Step 3: 実装する**

`services/userService.js` の `unmarkPassed` の直後に追加:

```js
async function initializeFavorites(userId, ownCertIds) {
  return updateUserStats(userId, (s) => {
    if (s.favoritesInitialized) return s;
    const merged = [...(s.favoriteCertifications || [])];
    for (const id of ownCertIds) {
      if (!merged.includes(id)) merged.push(id);
    }
    s.favoriteCertifications = merged;
    s.favoritesInitialized = true;
    return s;
  });
}
```

`module.exports` に `initializeFavorites,` を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- userService`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add services/userService.js tests/userService.test.mjs
git commit -m "feat(user): add one-time favorites backfill for own certifications"
```

---

## Task 3: routes/certifications — お気に入り/合格トグルの POST ルート

**Files:**
- Modify: `routes/certifications.js`
- Test: `tests/routes.certifications.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routes.certifications.test.mjs` の先頭 import 群の直後に追加:

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const userService = require('../services/userService');
```

`describe('routes/certifications', ...)` の最後のテストの後に追加:

```js
  test('favorite/unfavorite が stats を更新し returnTo にリダイレクト', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-fav', isPublic: true });
    const agent = await authedAgent(user);

    let res = await agent.post('/my/certifications/pub-fav/favorite').type('form').send({ returnTo: '/free-mode' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/free-mode');
    let u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).toContain('pub-fav');

    res = await agent.post('/my/certifications/pub-fav/unfavorite').type('form').send({ returnTo: '/free-mode' });
    expect(res.status).toBe(302);
    u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).not.toContain('pub-fav');
  });

  test('pass/unpass が stats を更新する', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-pass', isPublic: true });
    const agent = await authedAgent(user);

    await agent.post('/my/certifications/pub-pass/pass').type('form').send({ returnTo: '/certifications/pub-pass' });
    let u = await userService.getUserById(user.id);
    expect(u.stats.passedCertifications.map((p) => p.certId)).toContain('pub-pass');

    await agent.post('/my/certifications/pub-pass/unpass').type('form').send({});
    u = await userService.getUserById(user.id);
    expect(u.stats.passedCertifications.map((p) => p.certId)).not.toContain('pub-pass');
  });

  test('不正な returnTo は /my/certifications にフォールバック', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-rt', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.post('/my/certifications/pub-rt/favorite').type('form').send({ returnTo: 'https://evil.com' });
    expect(res.headers.location).toBe('/my/certifications');
  });

  test('資格作成時に作成者のお気に入りへ自動追加される', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/new').type('form').send({
      id: 'auto-fav', name: '自動お気に入り', studyGuideUrl: '', courseUrl: '',
      domainsJson: JSON.stringify([{ id: 'domain-1', name: 'D1', weight: 100 }]),
    });
    const u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).toContain('auto-fav');
  });

  test('資格削除時にお気に入り/合格から除去される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'del-fav', createdBy: user.id, creatorName: user.username, isPublic: false });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/del-fav/favorite').type('form').send({ returnTo: '/my/certifications' });
    await agent.post('/my/certifications/del-fav/pass').type('form').send({ returnTo: '/my/certifications' });
    await agent.post('/my/certifications/del-fav/delete');
    const u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).not.toContain('del-fav');
    expect(u.stats.passedCertifications.map((p) => p.certId)).not.toContain('del-fav');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- routes.certifications`
Expected: FAIL（favorite/pass ルートが 404、自動お気に入り無し）

- [ ] **Step 3: 実装する**

`routes/certifications.js` の `module.exports = router;` の直前に `safeReturnTo` とトグルルートを追加:

```js
function safeReturnTo(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return '/my/certifications';
}

router.post('/:certId/favorite', requireAuth, asyncHandler(async (req, res) => {
  await userService.addFavorite(req.user.id, req.params.certId);
  res.redirect(safeReturnTo(req.body.returnTo));
}));

router.post('/:certId/unfavorite', requireAuth, asyncHandler(async (req, res) => {
  await userService.removeFavorite(req.user.id, req.params.certId);
  res.redirect(safeReturnTo(req.body.returnTo));
}));

router.post('/:certId/pass', requireAuth, asyncHandler(async (req, res) => {
  await userService.markPassed(req.user.id, req.params.certId, new Date().toISOString());
  res.redirect(safeReturnTo(req.body.returnTo));
}));

router.post('/:certId/unpass', requireAuth, asyncHandler(async (req, res) => {
  await userService.unmarkPassed(req.user.id, req.params.certId);
  res.redirect(safeReturnTo(req.body.returnTo));
}));
```

`POST /new` の `await questionService.writeCertification(cert);` の直後（`res.redirect('/my/certifications');` の直前）に追加:

```js
  await userService.addFavorite(req.user.id, cert.id);
```

`POST /:certId/delete` の `await questionService.deleteCertification(cert.id);` の直後（`res.redirect(...)` の直前）に追加:

```js
  await userService.removeFavorite(req.user.id, cert.id);
  await userService.unmarkPassed(req.user.id, cert.id);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- routes.certifications`
Expected: PASS（既存の publish/delete テストも維持。「空リスト」テストは Task 4 で更新）

- [ ] **Step 5: コミット**

```bash
git add routes/certifications.js tests/routes.certifications.test.mjs
git commit -m "feat(certifications): add favorite/pass toggle endpoints with returnTo"
```

---

## Task 4: マイ資格をお気に入り一覧にする（listCertificationsByIds + GET / + view）

**Files:**
- Modify: `services/questionService.js`
- Modify: `routes/certifications.js`（`GET /`）
- Modify: `views/my-certifications.ejs`
- Test: `tests/routes.certifications.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routes.certifications.test.mjs` の既存テスト「GET /my/certifications → 空リスト」の本文を次に置き換える（期待文言を更新）:

```js
  test('GET /my/certifications → 空状態メッセージ', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('まだお気に入りの資格がありません');
  });
```

さらに describe 末尾に追加:

```js
  test('お気に入り登録した公開資格がマイ資格に表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'gh-seed', name: 'GHシード資格', createdBy: 'system', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/gh-seed/favorite').type('form').send({ returnTo: '/my/certifications' });
    const res = await agent.get('/my/certifications');
    expect(res.text).toContain('GHシード資格');
  });

  test('既存の自作資格は初回ロードでバックフィルされマイ資格に出る', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'own-bf', name: '自作バックフィル資格', createdBy: user.id, creatorName: user.username, isPublic: false });
    const agent = await authedAgent(user);
    const res = await agent.get('/my/certifications');
    expect(res.text).toContain('自作バックフィル資格');
  });

  test('合格済みの資格には🎓バッジが付く', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pass-badge', name: '合格バッジ資格', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/pass-badge/favorite').type('form').send({ returnTo: '/my/certifications' });
    await agent.post('/my/certifications/pass-badge/pass').type('form').send({ returnTo: '/my/certifications' });
    const res = await agent.get('/my/certifications');
    expect(res.text).toContain('🎓');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- routes.certifications`
Expected: FAIL（マイ資格はまだ自作 certs を表示、空状態文言が旧、🎓バッジ無し）

- [ ] **Step 3a: questionService.listCertificationsByIds を実装**

`services/questionService.js` の `listCertifications` 関数の直後に追加:

```js
async function listCertificationsByIds(ids, userId) {
  const out = [];
  for (const id of ids) {
    const cert = await readCertification(id);
    if (!canAccessCertification(cert, userId)) continue;
    out.push({
      id: cert.id,
      name: cert.name,
      domainCount: cert.domains.length,
      questionCount: cert.domains.reduce((acc, d) => acc + d.questions.length, 0),
      createdBy: cert.createdBy,
      creatorName: cert.creatorName,
      isPublic: cert.isPublic,
    });
  }
  return out;
}
```

`module.exports` に `listCertificationsByIds,` を追加。

- [ ] **Step 3b: routes/certifications の GET / を favorites 化**

`routes/certifications.js` の `router.get('/', ...)` ハンドラ本体を次に置き換える:

```js
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = await userService.getUserById(userId);
  let stats = user?.stats || {};

  if (!stats.favoritesInitialized) {
    const all = await questionService.listCertifications({ includePrivate: true, userId });
    const ownIds = all.filter((c) => c.createdBy === userId).map((c) => c.id);
    const updated = await userService.initializeFavorites(userId, ownIds);
    stats = updated?.stats || stats;
  }

  const favorites = await questionService.listCertificationsByIds(stats.favoriteCertifications || [], userId);
  const passedIds = new Set((stats.passedCertifications || []).map((p) => p.certId));

  res.render('my-certifications', {
    title: 'マイ資格',
    favorites,
    passedIds,
    currentUserId: userId,
    userEmail: res.locals.userEmail,
  });
}));
```

- [ ] **Step 3c: views/my-certifications.ejs を favorites 一覧に書き換え**

`views/my-certifications.ejs` の `<% if (certs.length === 0) { %>` から対応する `<% } %>`（リスト全体）までを次に置き換える:

```ejs
    <% if (favorites.length === 0) { %>
      <div class="rpg-window" style="text-align:center;">
        <p style="color:#c0c6e0; font-family: var(--font-body);">まだお気に入りの資格がありません。</p>
        <a href="/free-mode" style="display:inline-block; margin-top:16px; color: var(--gold); font-family: var(--font-body);">
          資格一覧から ★ で登録する →
        </a>
      </div>
    <% } else { %>
      <div style="display:flex; flex-direction:column; gap:12px;">
        <% for (const c of favorites) { const isOwner = c.createdBy === currentUserId; %>
          <div class="rpg-window" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="flex:1; min-width:0;">
              <h2 class="rpg-title" style="font-size: 16px;">
                <%= c.name %>
                <% if (passedIds.has(c.id)) { %><span class="pill" style="color: var(--fern); border-color: var(--fern);">🎓 合格</span><% } %>
              </h2>
              <p style="color:#c0c6e0; font-family: var(--font-body); margin-top:4px; font-size: 12px;">
                <%= c.domainCount %> ドメイン · <%= c.questionCount %> 問
                <% if (isOwner) { %>
                  · <% if (c.isPublic) { %><span style="color: var(--fern);">公開中</span><% } else { %><span style="color:#c0c6e0;">非公開</span><% } %>
                <% } %>
              </p>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <a href="/certifications/<%= c.id %>" class="rpg-btn is-gold">開く</a>
              <% if (isOwner) { %>
                <% if (c.isPublic) { %>
                  <form method="POST" action="/my/certifications/<%= c.id %>/unpublish" style="margin:0;">
                    <button class="rpg-btn">非公開にする</button>
                  </form>
                <% } else { %>
                  <form method="POST" action="/my/certifications/<%= c.id %>/publish" style="margin:0;">
                    <button class="rpg-btn is-fern">公開する</button>
                  </form>
                <% } %>
                <form method="POST" action="/my/certifications/<%= c.id %>/delete" style="margin:0;"
                      onsubmit="return confirm('削除しますか？');">
                  <button class="rpg-btn">削除</button>
                </form>
              <% } %>
              <form method="POST" action="/my/certifications/<%= c.id %>/unfavorite" style="margin:0;">
                <input type="hidden" name="returnTo" value="/my/certifications">
                <button class="rpg-btn" title="お気に入り解除">★ 解除</button>
              </form>
            </div>
          </div>
        <% } %>
      </div>
    <% } %>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- routes.certifications`
Expected: PASS（空状態・お気に入り表示・バックフィル・🎓バッジ、既存 publish/delete も維持）

- [ ] **Step 5: コミット**

```bash
git add services/questionService.js routes/certifications.js views/my-certifications.ejs tests/routes.certifications.test.mjs
git commit -m "feat(certifications): make マイ資格 an お気に入り list with pass badges"
```

---

## Task 5: 資格一覧・資格詳細にトグルとバッジを表示

**Files:**
- Modify: `routes/index.js`（`/free-mode`・`/certifications/:certId`）
- Modify: `views/index.ejs`
- Modify: `views/certification.ejs`
- Test: `tests/routes.index.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routes.index.test.mjs` の最後のテストの後（`describe` 内）に追加:

```js
  test('資格詳細にお気に入り・合格トグルが表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'detail-cert', name: '詳細資格', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.get('/certifications/detail-cert');
    expect(res.status).toBe(200);
    expect(res.text).toContain('☆ お気に入り登録');
    expect(res.text).toContain('🎓 合格した');
  });

  test('お気に入り/合格済みならトグルが解除表示になる', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'detail-cert2', name: '詳細資格2', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/detail-cert2/favorite').type('form').send({ returnTo: '/certifications/detail-cert2' });
    await agent.post('/my/certifications/detail-cert2/pass').type('form').send({ returnTo: '/certifications/detail-cert2' });
    const res = await agent.get('/certifications/detail-cert2');
    expect(res.text).toContain('★ お気に入り解除');
    expect(res.text).toContain('🎓 合格を取り消す');
  });

  test('資格一覧の各カードにお気に入りトグルのフォームがある', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'list-cert', name: '一覧資格', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.get('/free-mode');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/my/certifications/list-cert/favorite');
  });
```

`tests/routes.index.test.mjs` の import で `createTestCertification` が無ければ追加（先頭の fixtures import を確認）:

```js
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- routes.index`
Expected: FAIL（トグル・フォーム未実装）

- [ ] **Step 3a: routes/index.js の `/free-mode` に favoriteIds/passedIds を渡す**

`routes/index.js` の `/free-mode` ハンドラの `res.render('index', {...})` を次に置き換える:

```js
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};
  res.render('index', {
    title: '資格一覧',
    publicCerts,
    myCerts,
    favoriteIds: new Set(stats.favoriteCertifications || []),
    passedIds: new Set((stats.passedCertifications || []).map((p) => p.certId)),
    userEmail: res.locals.userEmail,
  });
```

- [ ] **Step 3b: routes/index.js の `/certifications/:certId` に isFavorite/isPassed を渡す**

`/certifications/:certId` ハンドラ内、`const rawStats = user?.stats || {};` の直後に追加:

```js
  const isFavorite = (rawStats.favoriteCertifications || []).includes(cert.id);
  const isPassed = (rawStats.passedCertifications || []).some((p) => p.certId === cert.id);
```

同ハンドラの `res.render('certification', {` のオブジェクトに追加（`masteryRanks,` の隣など）:

```js
    isFavorite,
    isPassed,
```

- [ ] **Step 3c: views/index.ejs のカードにトグル/バッジを追加**

`views/index.ejs` の公開資格カード（`<a href="/certifications/<%= cert.id %>" class="rpg-window" ...>...</a>`）を次の構造に置き換える:

```ejs
            <div class="rpg-window" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <a href="/certifications/<%= cert.id %>" style="display:block; text-decoration:none; flex:1; min-width:0;">
                <h2 class="rpg-title" style="font-size: 16px;">
                  <%= cert.name %>
                  <% if (passedIds.has(cert.id)) { %><span class="pill" style="color: var(--fern); border-color: var(--fern);">🎓 合格</span><% } %>
                </h2>
                <p style="color:#c0c6e0; font-family: var(--font-body); margin-top:4px; font-size: 13px;">
                  <%= cert.domainCount %> ドメイン &nbsp;·&nbsp; <%= cert.questionCount %> 問
                  <% if (cert.createdBy !== 'system') { %>
                    &nbsp;·&nbsp; 作成者: <%= cert.creatorName %>
                  <% } %>
                </p>
              </a>
              <form method="POST" action="/my/certifications/<%= cert.id %>/<%= favoriteIds.has(cert.id) ? 'unfavorite' : 'favorite' %>" style="margin:0; flex-shrink:0;">
                <input type="hidden" name="returnTo" value="/free-mode">
                <button class="rpg-btn" title="お気に入り"><%= favoriteIds.has(cert.id) ? '★' : '☆' %></button>
              </form>
            </div>
```

同様に「自分の非公開資格」カード（`panel-mine` 内の `<a href="/certifications/<%= cert.id %>" class="rpg-window" ...>...</a>`）を次に置き換える:

```ejs
            <div class="rpg-window" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <a href="/certifications/<%= cert.id %>" style="display:block; text-decoration:none; flex:1; min-width:0;">
                <h2 class="rpg-title" style="font-size: 16px;">
                  <%= cert.name %>
                  <% if (passedIds.has(cert.id)) { %><span class="pill" style="color: var(--fern); border-color: var(--fern);">🎓 合格</span><% } %>
                </h2>
                <p style="color:#c0c6e0; font-family: var(--font-body); margin-top:4px; font-size: 13px;">
                  <%= cert.domainCount %> ドメイン &nbsp;·&nbsp; <%= cert.questionCount %> 問 &nbsp;·&nbsp; 非公開
                </p>
              </a>
              <form method="POST" action="/my/certifications/<%= cert.id %>/<%= favoriteIds.has(cert.id) ? 'unfavorite' : 'favorite' %>" style="margin:0; flex-shrink:0;">
                <input type="hidden" name="returnTo" value="/free-mode">
                <button class="rpg-btn" title="お気に入り"><%= favoriteIds.has(cert.id) ? '★' : '☆' %></button>
              </form>
            </div>
```

- [ ] **Step 3d: views/certification.ejs のヘッダにトグルを追加**

`views/certification.ejs` の `<p ...><span class="pill">...問</span> ...</p>`（ドメイン/問数の pill ブロック、行22-25）の直後に追加:

```ejs
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin: 0 0 22px;">
      <form method="POST" action="/my/certifications/<%= cert.id %>/<%= isFavorite ? 'unfavorite' : 'favorite' %>" style="margin:0;">
        <input type="hidden" name="returnTo" value="/certifications/<%= cert.id %>">
        <button class="rpg-btn"><%= isFavorite ? '★ お気に入り解除' : '☆ お気に入り登録' %></button>
      </form>
      <form method="POST" action="/my/certifications/<%= cert.id %>/<%= isPassed ? 'unpass' : 'pass' %>" style="margin:0;">
        <input type="hidden" name="returnTo" value="/certifications/<%= cert.id %>">
        <button class="rpg-btn <%= isPassed ? 'is-fern' : '' %>"><%= isPassed ? '🎓 合格を取り消す' : '🎓 合格した' %></button>
      </form>
    </div>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- routes.index`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add routes/index.js views/index.ejs views/certification.ejs tests/routes.index.test.mjs
git commit -m "feat(certifications): add favorite/pass toggles to list and detail views"
```

---

## Task 6: ステータスに「🎓 合格資格」セクションを追加

**Files:**
- Modify: `routes/profile.js`
- Modify: `views/profile.ejs`
- Test: `tests/routes.profile.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routes.profile.test.mjs` の import に `createTestCertification` が無ければ追加:

```js
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
```

describe 末尾に追加:

```js
  test('合格した資格がステータスの合格資格セクションに表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'prof-pass', name: '合格資格X', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/prof-pass/pass').type('form').send({ returnTo: '/certifications/prof-pass' });
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
    expect(res.text).toContain('🎓 合格資格');
    expect(res.text).toContain('合格資格X');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- routes.profile`
Expected: FAIL（合格資格セクション未実装）

- [ ] **Step 3a: routes/profile.js で合格資格を解決して渡す**

`routes/profile.js` の import 群に追加:

```js
const questionService = require('../services/questionService');
```

ハンドラ内、`const unlocked = new Set(stats.unlockedAchievements || []);` の直後に追加:

```js
  const passedRaw = stats.passedCertifications || [];
  const passedSummaries = await questionService.listCertificationsByIds(passedRaw.map((p) => p.certId), req.user.id);
  const nameById = Object.fromEntries(passedSummaries.map((s) => [s.id, s.name]));
  const passedCerts = passedRaw
    .filter((p) => nameById[p.certId])
    .map((p) => ({ name: nameById[p.certId], passedAt: p.passedAt.slice(0, 10) }))
    .sort((a, b) => b.passedAt.localeCompare(a.passedAt));
```

`res.render('profile', {...})` のオブジェクトに追加:

```js
    passedCerts,
```

- [ ] **Step 3b: views/profile.ejs に合格資格セクションを追加**

`views/profile.ejs` の `🏅 実績` セクションの `</section>` の直後（`</main>` の手前）に追加:

```ejs
    <% if (passedCerts && passedCerts.length) { %>
    <h2 class="rpg-title" style="font-size: 18px; margin: 24px 0 10px;">🎓 合格資格 (<%= passedCerts.length %>)</h2>
    <section class="rpg-window">
      <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-family: var(--font-display); font-size: 13px;">
        <% for (const c of passedCerts) { %>
          <li style="display:flex; justify-content:space-between; padding:8px 12px; background:#0008; border-left:4px solid var(--fern);">
            <span><%= c.name %></span>
            <span style="color:#c0c6e0;"><%= c.passedAt %></span>
          </li>
        <% } %>
      </ul>
    </section>
    <% } %>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- routes.profile`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add routes/profile.js views/profile.ejs tests/routes.profile.test.mjs
git commit -m "feat(profile): show passed certifications section on status page"
```

---

## Task 7: 全体検証と仕上げ

**Files:** なし（検証のみ）

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: エラー無し（未使用 import が無いこと）

- [ ] **Step 2: 全テスト**

Run: `docker compose up -d cosmos-emulator` → `npm test`
Expected: 全テスト PASS。網羅性ハーネス `spec-coverage` も green。

- [ ] **Step 3: 手動確認（任意）**

Run: `npm run dev`（http://localhost:3000）
- 資格一覧で ☆ を押す → マイ資格に出る。詳細で「🎓 合格した」→ ステータスの「🎓 合格資格」に出る。
- 自作資格を新規作成 → 自動でマイ資格に並ぶ。削除 → マイ資格から消える。

- [ ] **Step 4: ブランチを push して PR（ユーザー合意の上で）**

```bash
git push -u origin feat/cert-favorites-and-pass
gh pr create --base main --title "feat: 資格のお気に入り・合格マーク・ステータス実績" --body "<概要>"
```

---

## Self-Review メモ

- **Spec coverage**: favorites 保存(Task1)、バックフィル(Task2)、トグル endpoints(Task3)、マイ資格=お気に入り＋listCertificationsByIds(Task4)、一覧/詳細トグル・バッジ(Task5)、ステータス合格資格(Task6)、作成時自動お気に入り・削除時除去(Task3) — spec の各要件にタスクが対応。
- **型/名称整合**: `favoriteCertifications`(string[])、`passedCertifications`({certId,passedAt}[])、`favoritesInitialized`(bool)、`listCertificationsByIds(ids,userId)`、view 変数 `favorites`/`passedIds`(Set)/`currentUserId`/`favoriteIds`(Set)/`isFavorite`/`isPassed`/`passedCerts` を全タスクで統一。
- **既存テスト影響**: マイ資格の空状態文言変更（Task4 で更新）。publish/delete テストはバックフィルで own-cert が favorites に入るため維持。
