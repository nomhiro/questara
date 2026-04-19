# ランディングページ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` をサービス説明のランディングページに差し替え、冒険マップを `/adventure` に移し、`/auth/login` をランディングに統合する。

**Architecture:** 3層 `routes → services → data` を維持。ランディング (`views/landing.ejs`) は service 層を呼ばず、`res.locals.userEmail` の有無のみでログイン状態を切替。OAuth エラーは `/?error=<key>` クエリで戻してランディング上部にバナー表示。

**Tech Stack:** Express 4, EJS 3, 既存 `theme.css`（RPG トーン）, vitest, supertest。新規依存は追加しない。

**関連設計書:** `docs/superpowers/specs/2026-04-19-landing-page-design.md`

---

## ファイル構造（新規・変更・削除の全体像）

**新規:**
- `views/landing.ejs` — ランディング本体
- `tests/routes.index.test.mjs` — `GET /` と `GET /adventure` のテスト（`@covers: routes/index.js`）

**変更:**
- `routes/index.js` — `GET /` をランディングに、`GET /adventure` を新設し冒険マップを移動
- `routes/auth.js` — コールバック成功時 `/adventure` へ・失敗時 `/?error=...`・ログアウト後 `/`・`GET /auth/login` を301リダイレクトに
- `middleware/auth.js` — 未認証リダイレクト先 `/auth/login` → `/`
- `views/partials/hud.ejs` — 「🗺️ ホーム」リンクを `/adventure` に
- `tests/smoke.test.mjs` — `/` と `/adventure` の期待値更新
- `tests/routes.auth.test.mjs` — リダイレクト期待値・廃止テスト更新
- `tests/middleware.hud.test.mjs` — リダイレクト先期待値更新
- `tests/routes.profile.test.mjs` — リダイレクト先期待値更新

**削除:**
- `views/login.ejs` — `/auth/login` 廃止（301リダイレクトのみ残す）に伴い不要

---

## Task 1: `/adventure` ルートを新設し、冒険マップを移動

**目的:** 既存の `GET /` の冒険マップ責務をそのまま `GET /adventure` に複製する。この段階では `GET /` は既存のまま（ランディング差し替えは Task 3）。

**Files:**
- Modify: `routes/index.js`
- Modify: `tests/smoke.test.mjs`

- [ ] **Step 1: 失敗するテストを追加**

`tests/smoke.test.mjs` の既存 `describe('smoke', ...)` の中に追記:

```javascript
  test('認証済み GET /adventure は アクティブ冒険なしなら /adventures/new へリダイレクト', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/adventure');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/adventures/new');
  });

  test('未認証 GET /adventure は /auth/login にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/adventure');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });
```

- [ ] **Step 2: テスト実行で fail を確認**

Run: `npm test -- tests/smoke.test.mjs`
Expected: `GET /adventure` の2テストが 404 応答で FAIL

- [ ] **Step 3: `routes/index.js` にハンドラを追加**

既存の `router.get('/', requireAuth, async (req, res) => { ... })` 全体を **そのままコピーして** `router.get('/adventure', requireAuth, async (req, res) => { ... })` として追加する。既存 `GET /` はこの時点では残す（次タスクで差し替え）。

`routes/index.js` の該当箇所に以下を挿入（既存 `router.get('/', ...)` の直後）:

```javascript
router.get('/adventure', requireAuth, async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  const stats = user?.stats || {};

  const activeAdventure = stats.activeAdventureId
    ? await adventureService.getAdventure(stats.activeAdventureId, req.user.id)
    : null;

  if (!activeAdventure) {
    return res.redirect('/adventures/new');
  }

  const certEntries = await Promise.all(
    activeAdventure.dungeons.map(async (d) => {
      const c = await questionService.readCertification(d.certificationId);
      return c ? [c.id, c] : null;
    })
  );
  const certById = Object.fromEntries(certEntries.filter(Boolean));

  const masteryRanks = stats.masteryRanks || {};
  const achievementsMaster = achievementService.loadMaster();
  const unlocked = new Set(stats.unlockedAchievements || []);
  const recentAchievements = achievementsMaster.filter((a) => unlocked.has(a.id)).slice(-3).reverse();

  const dailyQuest = stats.dailyQuest || { date: null, completed: [], xpClaimed: 0 };

  res.render('adventure-map', {
    title: '冒険の道',
    userEmail: res.locals.userEmail,
    adventure: activeAdventure,
    certById,
    stats,
    masteryRanks,
    recentAchievements,
    dailyQuest,
  });
});
```

- [ ] **Step 4: テスト実行で pass を確認**

Run: `npm test -- tests/smoke.test.mjs`
Expected: 全テスト PASS（`/` と `/adventure` が同じ挙動）

- [ ] **Step 5: コミット**

```bash
git add routes/index.js tests/smoke.test.mjs
git commit -m "feat(routes): add /adventure endpoint mirroring current /"
```

---

## Task 2: ランディング用テストを追加（TDD: 失敗から開始）

**目的:** `GET /` がランディング（未認証 200・ログインCTA・説明文）を返すテストを先に書いて失敗させる。実装は Task 3 で行う。

**Files:**
- Create: `tests/routes.index.test.mjs`

- [ ] **Step 1: 新規テストファイルを作成**

`tests/routes.index.test.mjs`:

```javascript
// @covers: routes/index.js
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/index — landing page', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証 GET / は 200 とランディングを返す', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Questara');
    expect(res.text).toContain('クエスターラ');
    expect(res.text).toContain('資格という名のダンジョンへ');
  });

  test('未認証 GET / には GitHub ログイン CTA が含まれる', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/auth/github');
    expect(res.text).toMatch(/GitHub.*ログイン/);
  });

  test('認証済み GET / は 200 と「冒険を再開」CTA を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('冒険を再開');
    expect(res.text).toContain('/adventure');
  });

  test('GET /?error=auth_failed でエラーバナーが表示される', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=auth_failed');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/ログイン.*失敗|認可.*失敗/);
  });

  test('GET / には GitHub Models API の説明と公式リンクが含まれる', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('GitHub Models');
    expect(res.text).toMatch(/rate.?limit/i);
    expect(res.text).toContain('docs.github.com/en/github-models');
  });

  test('GET / の Why セクションに「みんなで資格取得を」の思いが残っている', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('みんなで資格取得');
  });
});
```

- [ ] **Step 2: テスト実行で fail を確認**

Run: `npm test -- tests/routes.index.test.mjs`
Expected: 全テスト FAIL（現状 `/` は requireAuth で 302 リダイレクト）

- [ ] **Step 3: コミット（失敗テストのみ）**

```bash
git add tests/routes.index.test.mjs
git commit -m "test: add failing tests for landing page at /"
```

---

## Task 3: `views/landing.ejs` を作成し `GET /` をランディングに差し替え

**目的:** テスト Task 2 が通るように、ランディングビューと route を実装。

**Files:**
- Create: `views/landing.ejs`
- Modify: `routes/index.js`
- Modify: `tests/smoke.test.mjs`

- [ ] **Step 1: ランディングビュー作成**

`views/landing.ejs` を新規作成:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Questara — 資格という名のダンジョンへ。</title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=M+PLUS+1+Code:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/theme.css">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <nav class="hud">
    <div class="hud-cell">📚 <span class="value">Questara</span></div>
    <div class="hud-spacer"></div>
    <% if (userEmail) { %>
      <span class="hud-cell" style="font-size:11px;"><%= userEmail %></span>
      <form method="POST" action="/auth/logout" style="margin:0;"><button type="submit" class="rpg-btn" style="font-size:11px;padding:6px 12px;">ログアウト</button></form>
    <% } %>
  </nav>

  <main class="main" style="max-width: 960px; margin: 0 auto;">

    <% if (errorMessage) { %>
      <section class="rpg-window is-open" style="background: #3a0a12; border-color: var(--crimson); margin-bottom: 24px;">
        <p style="color: var(--ink); font-family: var(--font-body); font-size: 13px; margin:0;">⚠ <%= errorMessage %></p>
      </section>
    <% } %>

    <!-- Hero -->
    <section class="rpg-window is-open" style="text-align:center; padding: 40px 24px; margin-bottom: 32px;">
      <h1 class="rpg-title" style="font-size: 36px; margin-bottom: 4px; letter-spacing: 0.08em;">⚔ Questara ⚔</h1>
      <p style="font-family: var(--font-body); color: var(--gold); font-size: 14px; margin: 0 0 20px; letter-spacing: 0.2em;">— クエスターラ —</p>
      <p style="font-family: var(--font-display); color: var(--gold); font-size: 20px; margin: 0 0 4px;">資格という名のダンジョンへ。</p>
      <p style="font-family: var(--font-body); color: #8a90aa; font-size: 11px; margin: 0 0 24px; letter-spacing: 0.1em; font-style: italic;">Your certification quest begins.</p>
      <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 13px; line-height: 1.8; margin: 0 0 32px; max-width: 560px; margin-left:auto; margin-right:auto;">
        Microsoft / GitHub 認定資格の学習を、<br>
        みんなで冒険として楽しめる学習エージェント。
      </p>
      <% if (userEmail) { %>
        <a href="/adventure" class="rpg-btn is-gold" style="display:inline-block; font-size: 14px; padding: 12px 28px;">▶ 冒険を再開する</a>
      <% } else { %>
        <a href="/auth/github" class="rpg-btn is-gold" style="display:inline-flex; align-items:center; gap:10px; font-size: 14px; padding: 12px 28px;">
          <svg style="width:18px; height:18px;" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          GitHubでログインして始める
        </a>
      <% } %>
    </section>

    <!-- Why -->
    <h2 class="rpg-title" style="font-size: 18px; margin-bottom: 16px;">✧ このサービスの思い</h2>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 16px;">
      <div class="rpg-window">
        <h3 class="rpg-title" style="font-size: 14px; margin-bottom: 8px;">🗡 冒険として学ぶ</h3>
        <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.7; margin: 0;">ドメインを攻略する冒険として資格学習を楽しむ。単なる暗記ではなく、戦略的に合格ラインを目指す。</p>
      </div>
      <div class="rpg-window">
        <h3 class="rpg-title" style="font-size: 14px; margin-bottom: 8px;">✨ AIで無限に問題生成</h3>
        <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.7; margin: 0;">Microsoft Learn の学習ガイドを元に AI が実務的な4択問題を生成。飽きずに何度でも挑める。</p>
      </div>
      <div class="rpg-window">
        <h3 class="rpg-title" style="font-size: 14px; margin-bottom: 8px;">📊 弱点を自動ドリル</h3>
        <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.7; margin: 0;">正答率 70% 未満のドメインをワンクリックで再練習。苦手を可視化して潰す。</p>
      </div>
    </div>
    <p style="font-family: var(--font-body); color: var(--gold); font-size: 13px; text-align:center; margin: 0 0 32px;">— みんなで資格取得を通して、学びを楽しめるように —</p>

    <!-- 3ステップで始める -->
    <h2 class="rpg-title" style="font-size: 18px; margin-bottom: 16px;">✧ 3ステップで始める</h2>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 32px;">
      <div class="rpg-window">
        <h3 class="rpg-title" style="font-size: 14px; margin-bottom: 8px;">🔑 1. GitHubでログイン</h3>
        <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.7; margin: 0;">認証と問題生成 API の設定を自動で済ませます。</p>
      </div>
      <div class="rpg-window">
        <h3 class="rpg-title" style="font-size: 14px; margin-bottom: 8px;">📚 2. 資格を選ぶ</h3>
        <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.7; margin: 0;">GH-100・AI-102 など公開資格から選択、または独自資格を追加。</p>
      </div>
      <div class="rpg-window">
        <h3 class="rpg-title" style="font-size: 14px; margin-bottom: 8px;">⚔ 3. 冒険スタート</h3>
        <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.7; margin: 0;">各ドメインを攻略し、弱点を潰して合格ラインへ。</p>
      </div>
    </div>

    <!-- 仕組み（透明性） -->
    <h2 class="rpg-title" style="font-size: 18px; margin-bottom: 16px;">✧ 仕組みと API 利用について</h2>
    <div class="rpg-window" style="margin-bottom: 32px;">
      <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 13px; line-height: 1.8; margin: 0 0 12px;">
        本サービスは問題生成に <strong style="color: var(--gold);">GitHub Models API</strong>（既定モデル: <code>gpt-4o-mini</code>）を使います。
        GitHub アカウントでログインするとご自身のアクセストークンが API 呼び出しに使われ、
        お使いの GitHub Copilot プランに紐づく <strong style="color: var(--gold);">rate limit（1分 / 1日あたりのリクエスト数）</strong>を消費します。
      </p>
      <p style="font-family: var(--font-body); color: #c0c6e0; font-size: 13px; line-height: 1.8; margin: 0 0 12px;">
        問題生成1回 = LLM呼び出し1回です。無料プランでも試せますが、頻繁に問題を再生成するとプラン上限に達することがあります。
      </p>
      <ul style="font-family: var(--font-body); color: #c0c6e0; font-size: 12px; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li>プラン別のレート制限一覧: <a href="https://docs.github.com/en/github-models" target="_blank" rel="noopener" style="color: var(--gold);">GitHub Models ドキュメント</a></li>
        <li>Copilot プランの比較: <a href="https://github.com/features/copilot/plans" target="_blank" rel="noopener" style="color: var(--gold);">GitHub Copilot plans &amp; pricing</a></li>
      </ul>
    </div>

    <!-- CTA 再掲 -->
    <section class="rpg-window is-open" style="text-align:center; padding: 32px 24px; margin-bottom: 32px;">
      <h2 class="rpg-title" style="font-size: 20px; margin-bottom: 16px;">さあ、学びの冒険へ</h2>
      <% if (userEmail) { %>
        <a href="/adventure" class="rpg-btn is-gold" style="display:inline-block; font-size: 14px; padding: 12px 28px;">▶ 冒険を再開する</a>
      <% } else { %>
        <a href="/auth/github" class="rpg-btn is-gold" style="display:inline-block; font-size: 14px; padding: 12px 28px;">⚔ GitHubでログインして始める</a>
      <% } %>
      <p style="font-family: var(--font-body); color: #8a90aa; font-size: 11px; margin: 16px 0 0;">※ ログインと問題生成で GitHub Models API の rate limit を消費します</p>
    </section>

  </main>
</body>
</html>
```

- [ ] **Step 2: `routes/index.js` の `GET /` をランディングに差し替え**

`routes/index.js` の既存 `router.get('/', requireAuth, async (req, res) => { ... })` ブロック全体（`res.render('adventure-map', ...)` の `});` までの範囲、およびその前の `requireAuth` 含む行） を以下に**置換**する:

```javascript
router.get('/', (req, res) => {
  const errorKey = typeof req.query.error === 'string' ? req.query.error : null;
  const errorMessage = mapAuthError(errorKey);
  res.render('landing', {
    userEmail: res.locals.userEmail,
    errorMessage,
  });
});

function mapAuthError(key) {
  switch (key) {
    case 'auth_failed': return 'GitHub の認可に失敗しました。もう一度お試しください。';
    case 'no_code': return 'GitHub からの応答が不完全でした。もう一度ログインしてください。';
    case 'token_failed': return 'アクセストークンの取得に失敗しました。時間を置いて再度お試しください。';
    default: return null;
  }
}
```

なお Task 1 で追加した `router.get('/adventure', ...)` はそのまま残る（冒険マップは `/adventure` に移動済み）。

- [ ] **Step 3: smoke.test.mjs の `GET /` 期待値を更新**

`tests/smoke.test.mjs` の既存 **2テスト** を置換する（Task 1 で追加した `/adventure` 系テストはそのまま残す）:

**置換対象1:** 既存の `test('未認証で / は /auth/login にリダイレクト', ...)` ブロック全体 → 下記に置き換え

```javascript
  test('未認証で / は 200 とランディングを返す', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Questara');
  });
```

**置換対象2:** 既存の `test('認証済み GET / は アクティブ冒険なしなら /adventures/new へリダイレクト', ...)` ブロック全体 → 下記に置き換え

```javascript
  test('認証済み GET / は 200 とランディング（冒険を再開CTA）を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('冒険を再開');
  });
```

- [ ] **Step 4: テスト実行で pass を確認**

Run: `npm test -- tests/routes.index.test.mjs tests/smoke.test.mjs`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add views/landing.ejs routes/index.js tests/smoke.test.mjs
git commit -m "feat: replace / with landing page, move adventure map to /adventure"
```

---

## Task 4: HUD の「ホーム」リンクを `/adventure` に変更

**目的:** HUD の「🗺️ ホーム」をクリックするとログイン中ユーザーは冒険マップへ戻るようにする（ランディングに戻すと UX 的に後退）。

**Files:**
- Modify: `views/partials/hud.ejs:4`

- [ ] **Step 1: HUD リンク修正**

`views/partials/hud.ejs` の 4 行目:

```html
  <a class="rpg-btn is-gold" href="/" style="font-size:11px;padding:6px 12px;">🗺️ ホーム</a>
```

を以下に変更:

```html
  <a class="rpg-btn is-gold" href="/adventure" style="font-size:11px;padding:6px 12px;">🗺️ ホーム</a>
```

- [ ] **Step 2: テスト実行（既存テストが壊れていないか確認）**

Run: `npm test`
Expected: 全テスト PASS（HUD を描画する既存テストのスナップショットが文字列として `/adventure` を含むだけなので問題なし）

- [ ] **Step 3: コミット**

```bash
git add views/partials/hud.ejs
git commit -m "refactor(hud): point home link to /adventure (logged-in home)"
```

---

## Task 5: `middleware/auth.js` の未認証リダイレクト先を `/` に変更

**目的:** `requireAuth` で未認証時のリダイレクト先を `/auth/login` から `/`（ランディング）に変える。

**Files:**
- Modify: `middleware/auth.js:20`
- Modify: `tests/routes.profile.test.mjs:14`
- Modify: `tests/middleware.hud.test.mjs:23`
- Modify: `tests/smoke.test.mjs`（Task 1 で追加した `/adventure` 未認証テスト）

- [ ] **Step 1: 失敗するテストに更新**

3ファイルのリダイレクト期待値を先に書き換える。

`tests/routes.profile.test.mjs` の 14 行目:

```javascript
    expect(res.headers.location).toBe('/auth/login');
```

→

```javascript
    expect(res.headers.location).toBe('/');
```

`tests/middleware.hud.test.mjs` の 23 行目:

```javascript
    expect(res.headers.location).toBe('/auth/login');
```

→

```javascript
    expect(res.headers.location).toBe('/');
```

`tests/smoke.test.mjs` の Task 1 で追加した「未認証 GET /adventure は /auth/login にリダイレクト」テスト:

```javascript
  test('未認証 GET /adventure は /auth/login にリダイレクト', async () => {
```

→

```javascript
  test('未認証 GET /adventure は / にリダイレクト', async () => {
```

そしてその中の:

```javascript
    expect(res.headers.location).toBe('/auth/login');
```

→

```javascript
    expect(res.headers.location).toBe('/');
```

- [ ] **Step 2: テスト実行で fail を確認**

Run: `npm test -- tests/routes.profile.test.mjs tests/middleware.hud.test.mjs tests/smoke.test.mjs`
Expected: 上記3件が `Expected '/', Received '/auth/login'` で FAIL

- [ ] **Step 3: `middleware/auth.js` 修正**

`middleware/auth.js` の 20 行目:

```javascript
  res.redirect('/auth/login');
```

を:

```javascript
  res.redirect('/');
```

に変更。

- [ ] **Step 4: テスト実行で pass を確認**

Run: `npm test -- tests/routes.profile.test.mjs tests/middleware.hud.test.mjs tests/smoke.test.mjs`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add middleware/auth.js tests/routes.profile.test.mjs tests/middleware.hud.test.mjs tests/smoke.test.mjs
git commit -m "refactor(auth): redirect unauthenticated users to landing page (/)"
```

---

## Task 6: `routes/auth.js` の更新 — コールバック先・ログアウト先・`/auth/login` を301化

**目的:**
- OAuth コールバック成功時を `/` → `/adventure` に変更
- コールバック失敗時を `/auth/login` → `/?error=<key>` に変更
- ログアウト後のリダイレクトを `/auth/login` → `/` に変更
- `GET /auth/login` を 301 リダイレクトに（ブックマーク保護）

**Files:**
- Modify: `routes/auth.js`
- Modify: `tests/routes.auth.test.mjs`

- [ ] **Step 1: 失敗するテストに更新**

`tests/routes.auth.test.mjs` を全体書き換え。既存の4テストを以下に置換:

```javascript
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/auth', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test('GET /auth/login は / に 301 リダイレクト (legacy互換)', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/login');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/');
  });

  test('GET /auth/github は GitHub の認可URLにリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/github');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('github.com/login/oauth/authorize');
  });

  test('GET /auth/github/callback (codeなし) は /?error=no_code にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/github/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?error=no_code');
  });

  test('POST /auth/logout は cookie をクリアして / にリダイレクト', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.headers['set-cookie']?.[0]).toMatch(/cert_quiz_session_test=;/);
  });
});
```

- [ ] **Step 2: テスト実行で fail を確認**

Run: `npm test -- tests/routes.auth.test.mjs`
Expected: 全テスト FAIL（期待値が新しく実装がまだ古いため）

- [ ] **Step 3: `routes/auth.js` 修正**

以下の4箇所を変更する。

**変更1: `GET /auth/github/callback` の code 欠落時リダイレクト**

`routes/auth.js:24`:

```javascript
    if (!code) return res.redirect('/auth/login');
```

→

```javascript
    if (!code) return res.redirect('/?error=no_code');
```

**変更2: コールバック成功時リダイレクト**

`routes/auth.js:69`:

```javascript
    res.redirect('/');
```

→

```javascript
    res.redirect('/adventure');
```

**変更3: コールバック失敗時（catch 節）のエラー処理を `/?error=auth_failed` へリダイレクトに変更**

`routes/auth.js` の `catch (err) { ... }` ブロック（70-73行あたり）:

```javascript
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.render('error', { title: 'GitHub ログインエラー', message: err.message });
  }
```

→

```javascript
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    const key = err.message?.includes('アクセストークン') ? 'token_failed' : 'auth_failed';
    res.redirect(`/?error=${key}`);
  }
```

**変更4: `GET /auth/login` を 301 リダイレクトに**

`routes/auth.js` の既存 `router.get('/auth/login', ...)` ハンドラ（76-79行）:

```javascript
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'ログイン', error: null });
});
```

→

```javascript
router.get('/login', (req, res) => {
  res.redirect(301, '/');
});
```

**変更5: `POST /auth/logout` のリダイレクト先**

`routes/auth.js:83`:

```javascript
  res.redirect('/auth/login');
```

→

```javascript
  res.redirect('/');
```

- [ ] **Step 4: テスト実行で pass を確認**

Run: `npm test -- tests/routes.auth.test.mjs`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add routes/auth.js tests/routes.auth.test.mjs
git commit -m "refactor(auth): integrate /auth/login into landing, redirect callbacks accordingly"
```

---

## Task 7: `views/login.ejs` を削除

**目的:** `/auth/login` は 301 リダイレクトのみでテンプレートレンダリングしなくなるため削除。

**Files:**
- Delete: `views/login.ejs`

- [ ] **Step 1: ファイル削除**

```bash
git rm views/login.ejs
```

- [ ] **Step 2: テスト実行**

Run: `npm test`
Expected: 全テスト PASS（どのテストも `views/login.ejs` に依存しない）

- [ ] **Step 3: コミット**

```bash
git commit -m "chore: remove obsolete views/login.ejs (now handled by landing)"
```

---

## Task 8: ランディングページのエラーバナーと表示内容の最終確認テスト

**目的:** Task 3 で追加した `tests/routes.index.test.mjs` が、Task 6 で実装した `mapAuthError` とつながって実際にエラーメッセージが描画されることを確認。さらに他のエラーキーも網羅。

**Files:**
- Modify: `tests/routes.index.test.mjs`

- [ ] **Step 1: エラー網羅テストを追加**

`tests/routes.index.test.mjs` に以下のテストを `describe` の末尾に追加:

```javascript
  test('GET /?error=no_code でエラーバナー表示', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=no_code');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/応答が不完全/);
  });

  test('GET /?error=token_failed でエラーバナー表示', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=token_failed');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/アクセストークン.*失敗/);
  });

  test('GET /?error=unknown_key では エラーバナー非表示', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=unknown_key');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/⚠/);
  });
```

- [ ] **Step 2: テスト実行で pass を確認**

Run: `npm test -- tests/routes.index.test.mjs`
Expected: 全テスト PASS（Task 3 の `mapAuthError` 実装と整合）

- [ ] **Step 3: 全テストスイート実行**

Run: `npm test`
Expected: 全テスト PASS（`_harness/spec-coverage.test.mjs` も含む。`views/login.ejs` 削除・`tests/routes.index.test.mjs` 新規追加が spec-coverage で検知されても問題なく通る）

- [ ] **Step 4: コミット**

```bash
git add tests/routes.index.test.mjs
git commit -m "test: cover all auth error keys on landing page"
```

---

## Task 9: 手動検証（ブラウザ確認）

**目的:** ユニットテストだけでなく実際のブラウザで UX を確認する。CLAUDE.md に「UIやフロントエンドの変更は dev server を立てて golden path / edge case を確認する」と明記。

**Files:** なし（検証のみ）

- [ ] **Step 1: dev server 起動**

Run: `npm run dev`
Expected: `Listening on http://localhost:3000`

- [ ] **Step 2: 未ログイン動線の確認**

1. ブラウザのシークレットウィンドウで http://localhost:3000/ を開く
2. ランディングページが表示されること（Questara・クエスターラ・資格という名のダンジョンへ・みんなで資格取得（Why末）・3カード・3ステップ・仕組み・CTA 再掲）
3. 「GitHubでログインして始める」ボタンをクリック → GitHub 認可画面に遷移すること
4. GitHub で承認 → `/adventure` に着地すること（アクティブ冒険なしなら `/adventures/new` に自動遷移）

- [ ] **Step 3: ログイン済み動線の確認**

1. http://localhost:3000/ を再度開く
2. CTA が「▶ 冒険を再開する」に変わっていること
3. HUD にログインユーザー名が表示されていること
4. 「🗺️ ホーム」HUD リンクが `/adventure` へ飛ぶこと

- [ ] **Step 4: エラー表示の確認**

1. http://localhost:3000/?error=auth_failed を開く
2. Hero 上部にエラーバナーが表示されること
3. 「GitHub の認可に失敗しました。」のメッセージが読めること

- [ ] **Step 5: ログアウト後の動線**

1. ログイン状態から HUD の「ログアウト」をクリック
2. `/` に戻ってランディングが表示されること
3. CTA が「GitHubでログインして始める」に戻っていること

- [ ] **Step 6: 旧 `/auth/login` リンクの挙動**

1. http://localhost:3000/auth/login を開く
2. 301 リダイレクトで `/` に遷移すること

- [ ] **Step 7: dev server 停止**

`Ctrl+C` で停止。

- [ ] **Step 8: 問題なければコミット不要（変更なし）、または最終的なまとめコミット**

検証で問題が見つかったら修正してから該当 Task のステップに戻る。

---

## Task 10: `views/layout.ejs` の旧表記を Questara に統一

**目的:** 旧称「資格学習エージェント」「資格取得学習エージェント」をサービス正式名 `Questara` に統一する。

**Files:**
- Modify: `views/layout.ejs:6` (title 部分)
- Modify: `views/layout.ejs:11` (HUD ヘッダー部分)

- [ ] **Step 1: 修正前の状態確認**

```bash
grep -n "資格学習エージェント\|資格取得学習エージェント" views/layout.ejs
```
Expected: 2行がヒット（行6: `<title>...` と行11: `<a href="/"...📚 資格学習エージェント</a>`）

- [ ] **Step 2: layout.ejs を修正**

`views/layout.ejs:6`:

```html
  <title><%= title %> | 資格取得学習エージェント</title>
```

→

```html
  <title><%= title %> | Questara</title>
```

`views/layout.ejs:11`:

```html
    <a href="/" class="text-lg font-bold tracking-tight">📚 資格学習エージェント</a>
```

→

```html
    <a href="/adventure" class="text-lg font-bold tracking-tight">📚 Questara</a>
```

（href も Task 4 の方針に合わせて `/adventure` に）

- [ ] **Step 3: テスト実行**

Run: `npm test`
Expected: 全テスト PASS（レイアウトを参照するビューテストは見出し文字列を直接期待していないはず。万が一壊れたらそのテストを修正）

- [ ] **Step 4: コミット**

```bash
git add views/layout.ejs
git commit -m "refactor(views): rename brand to Questara in layout.ejs"
```

注意: `views/login.ejs` にも旧表記があるが、Task 7 でファイルごと削除するので触らない。`views/partials/hud.ejs` には旧表記なし。

---

## Task 11: `package.json` の name と description を Questara に

**目的:** パッケージ識別子とサービス説明文をブランドに合わせる。

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`（npm install で自動更新）

- [ ] **Step 1: package.json の name と description を編集**

`package.json`:

```json
  "name": "cert-study-agent",
  "version": "1.0.0",
  "description": "Microsoft/GitHub認定資格学習AIエージェント",
```

→

```json
  "name": "questara",
  "version": "1.0.0",
  "description": "Questara — Microsoft/GitHub 認定資格の学習を冒険として楽しむエージェント",
```

- [ ] **Step 2: package-lock.json を再生成**

Run: `npm install`
Expected: `package-lock.json` が `"name": "questara"` で更新されるだけで、依存ツリーに変更はない

- [ ] **Step 3: テスト実行**

Run: `npm test`
Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add package.json package-lock.json
git commit -m "chore: rename package to questara"
```

---

## Task 12: 内部識別子 (MCP clientName / UA 等) を questara に

**目的:** ソースコード内のプレースホルダー識別子 `cert-study-agent` を `questara` に統一する。

**Files:**
- Modify: `services/certificationParser.js`
- Modify: `services/mcpClient.js`
- Modify: `services/generationService.js`

- [ ] **Step 1: 現出箇所の確認**

Run: `grep -n "cert-study-agent" services/*.js`
Expected: 3ファイルでヒット

- [ ] **Step 2: 置換実行**

各ファイルで `'cert-study-agent'` を `'questara'` に置換する。具体的には:

- `services/certificationParser.js`: `new Client({ name: 'cert-study-agent', ... })` → `new Client({ name: 'questara', ... })`
- `services/mcpClient.js`: 同様の MCP Client 名文字列
- `services/generationService.js:15`: `new Client({ name: 'cert-study-agent', version: '1.0.0' })` → `new Client({ name: 'questara', version: '1.0.0' })`

User-Agent ヘッダーとして使われている `'User-Agent': 'cert-study-agent'` があれば（`routes/auth.js` に存在）、それも `'questara'` に置換する。

- [ ] **Step 3: 確認**

Run: `grep -rn "cert-study-agent" . --include="*.js" --include="*.mjs"`
Expected: ヒットゼロ（docs 配下は対象外、grep は `.` ルートから実行）

- [ ] **Step 4: テスト実行**

Run: `npm test`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add services/certificationParser.js services/mcpClient.js services/generationService.js routes/auth.js
git commit -m "refactor: use 'questara' as internal service identifier (MCP client / UA)"
```

---

## Task 13: Cookie / セッション名を `questara_session` に変更

**目的:** JWT セッション Cookie の名前を `cert_quiz_session` から `questara_session` に変更し、Questara ブランドで統一する。

**副作用:** 既存ユーザーのログインセッションは全て無効化される（次回アクセス時に再ログインが必要）。

**Files:**
- Modify: `services/jwtService.js:51`
- Modify: `.env.example`
- Modify: `.env.test`
- Modify: `tests/routes.auth.test.mjs`

- [ ] **Step 1: 失敗するテストに更新**

`tests/routes.auth.test.mjs` の `POST /auth/logout` テストで、cookie クリアのアサーションを更新する。

```javascript
    expect(res.headers['set-cookie']?.[0]).toMatch(/cert_quiz_session_test=;/);
```

→

```javascript
    expect(res.headers['set-cookie']?.[0]).toMatch(/questara_session_test=;/);
```

- [ ] **Step 2: テスト実行で fail を確認**

Run: `npm test -- tests/routes.auth.test.mjs`
Expected: ログアウトテストが cookie 名不一致で FAIL

- [ ] **Step 3: jwtService.js のデフォルト cookie 名を更新**

`services/jwtService.js:51`:

```javascript
const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'cert_quiz_session';
```

→

```javascript
const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'questara_session';
```

- [ ] **Step 4: .env.example を更新**

```
JWT_COOKIE_NAME=cert_quiz_session
```

→

```
JWT_COOKIE_NAME=questara_session
```

- [ ] **Step 5: .env.test を更新**

```
JWT_COOKIE_NAME=cert_quiz_session_test
```

→

```
JWT_COOKIE_NAME=questara_session_test
```

- [ ] **Step 6: テスト実行で pass を確認**

Run: `npm test`
Expected: 全テスト PASS（テスト環境の env ファイルが questara_session_test を返し、テスト期待と一致）

- [ ] **Step 7: コミット**

```bash
git add services/jwtService.js .env.example .env.test tests/routes.auth.test.mjs
git commit -m "refactor(auth): rename session cookie to questara_session

既存ユーザーの JWT セッション cookie は無効化されるため、デプロイ後は
全ユーザーに再ログインが必要になる。ローカル .env を持つ開発者も
.env の JWT_COOKIE_NAME を新しい値に書き換えること。"
```

- [ ] **Step 8: ローカル `.env` の更新案内**

ローカル開発者は手元の `.env`（git 管理外）の `JWT_COOKIE_NAME` を `questara_session` に書き換えてから開発サーバーを起動する必要がある。このタスクのコミットメッセージに含めて周知する。

---

## 完成基準

- すべての Task の PASS テストと手動検証が完了
- `npm test` が full green（既存の `_harness/spec-coverage.test.mjs` 含む）
- git log に各タスクのコミットがひとつずつ並んでいること
- ブラウザで未ログイン・ログイン済み・エラー時の3動線が想定通り動くこと

## 関連設計ドキュメント

- `docs/superpowers/specs/2026-04-19-landing-page-design.md` — 本実装の設計書（意思決定の根拠はこちら）
