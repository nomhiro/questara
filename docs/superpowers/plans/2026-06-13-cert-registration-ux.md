# 資格登録の抽出精度・導線・100%チェック改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI からの資格登録で、gh-500 のような新形式の学習ガイドからもドメイン名・割合を正しく自動抽出し、グローバルナビから登録画面へ到達でき、手動編集時に割合合計100%を UI で検証できるようにする。

**Architecture:** 既存の `certificationParser`（regex 抽出 → LLM フォールバック）の範囲区切り文字クラスを surgical に拡張する。グローバルナビ partial にマイ資格リンクを足す。資格フォームにクライアント側の合計%ライブ表示と正規化ボタンを足す。新規ファイルは作らない。

**Tech Stack:** Node.js 20 / Express 4 / EJS / vitest + supertest

**Spec:** `docs/superpowers/specs/2026-06-13-cert-registration-ux-design.md`（決定事項 D1〜D6 を参照）

**実行前提:**

```bash
docker compose up -d cosmos-emulator   # テスト実行前に必須（全テストが起動時に DB 疎通する）
```

テストは個別実行が速い: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/<file>`

---

### Task 1: 抽出精度 — 範囲区切り文字クラスを拡張（gh-500 対応）

**Files:**
- Modify: `services/certificationParser.js`（`parseDomainsFromMarkdown` 内の `modernRe`）
- Test: `tests/certificationParser.test.mjs`

- [ ] **Step 1: gh-500 形式の失敗するテストを追加**

`tests/certificationParser.test.mjs` の `describe('parseDomainsFromMarkdown', ...)` 内、最後のテストの直後（`});` で閉じる前）に以下を追加する:

```js
  test('gh-500 形式: 全角チルダ ～(U+FF5E) と見出し途中の別名括弧を含む6ドメインを抽出し100%に正規化', () => {
    const md = `
## 2026年7月時点で測定されたスキル
### スキルの概要
- 概要の箇条書きは無視される
### GitHub のセキュリティ スイート、機能、エコシステムについて説明する (15～20%)
#### サブスキル見出し（ウェイト無し・無視される）
### シークレット保護の構成と使用 (以前のシークレット スキャン) (15 ~ 20%)
### サプライ チェーン セキュリティの構成と使用 (旧称 Dependabot) (15 ~ 20%)
### コード セキュリティの構成と使用 (以前の CodeQL) (10 ~ 15%)
### セキュリティ操作: ベスト プラクティス、優先順位付け、修復 (15 ~ 20%)
### GitHub セキュリティ スイートの管理 (10 ~ 15%)
## 学習リソース
### ノイズ (10%)
`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(6);
    // 全角チルダの見出し（ドメイン1）が取りこぼされない
    expect(domains[0].name).toBe('Domain 1: GitHub のセキュリティ スイート、機能、エコシステムについて説明する');
    // 見出し途中の別名括弧は名前に保持され、末尾の割合が拾われる
    expect(domains[1].name).toBe('Domain 2: シークレット保護の構成と使用 (以前のシークレット スキャン)');
    const sum = domains.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBe(100);
  });
```

- [ ] **Step 2: red を確認**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/certificationParser.test.mjs`
Expected: 新テストのみ FAIL（`toHaveLength(6)` が 5 になる。ドメイン1の `～` がマッチせず取りこぼす）

- [ ] **Step 3: 区切り文字クラスを拡張（green）**

`services/certificationParser.js` の `modernRe` を変更する。変更前:

```js
  const modernRe = /^###\s+(.+?)\s*[（(]\s*(\d+)\s*(?:(?:[-–—~〜]|から|to)\s*(\d+))?\s*%?\s*[）)]\s*$/i;
```

変更後（区切り文字クラスに全角チルダ U+FF5E `～`、全角ハイフン U+FF0D `－`、マイナス U+2212 `−` を追加）:

```js
  const modernRe = /^###\s+(.+?)\s*[（(]\s*(\d+)\s*(?:(?:[-–—~〜～－−]|から|to)\s*(\d+))?\s*%?\s*[）)]\s*$/i;
```

- [ ] **Step 4: green を確認（既存テストの非回帰も同時に確認）**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/certificationParser.test.mjs`
Expected: PASS（既存 AZ-305「から」/ SC-400「–」/ 単一値 / レガシー優先 / 学習リソース無視 + 新規 gh-500 すべて緑）

- [ ] **Step 5: コミット**

```bash
git add services/certificationParser.js tests/certificationParser.test.mjs
git commit -m "fix(cert-parser): 全角チルダ等の範囲区切りに対応し gh-500 形式の取りこぼしを解消"
```

---

### Task 2: 導線 — グローバルナビに「マイ資格」リンクを追加

**Files:**
- Modify: `views/partials/hud.ejs`
- Test: `tests/views.test.mjs`

- [ ] **Step 1: ナビリンク存在の失敗するテストを追加**

`tests/views.test.mjs` の `describe('views render without 500', ...)` 内、`test('views/certification.ejs（統計なし）', ...)` の直後に追加する:

```js
  test('グローバルナビに「マイ資格」リンクがある', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'v-nav-1' });
    const agent = await authedAgent(user);
    const res = await agent.get(`/certifications/${cert.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/my/certifications"');
    expect(res.text).toContain('マイ資格');
  });
```

- [ ] **Step 2: red を確認**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/views.test.mjs`
Expected: 新テストのみ FAIL（`href="/my/certifications"` が無い）

- [ ] **Step 3: hud.ejs にリンクを追加（green）**

`views/partials/hud.ejs` の「ステータス」リンクの直後に「マイ資格」リンクを追加する。変更前:

```html
  <a class="rpg-btn is-gold" href="/adventure" style="font-size:11px;padding:6px 12px;">🗺️ ホーム</a>
  <a class="rpg-btn" href="/my/profile" style="font-size:11px;padding:6px 12px;">🧙 ステータス</a>
```

変更後:

```html
  <a class="rpg-btn is-gold" href="/adventure" style="font-size:11px;padding:6px 12px;">🗺️ ホーム</a>
  <a class="rpg-btn" href="/my/profile" style="font-size:11px;padding:6px 12px;">🧙 ステータス</a>
  <a class="rpg-btn" href="/my/certifications" style="font-size:11px;padding:6px 12px;">📚 マイ資格</a>
```

- [ ] **Step 4: green を確認**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/views.test.mjs`
Expected: PASS（全ビュースモーク + 新規ナビリンクテスト）

- [ ] **Step 5: コミット**

```bash
git add views/partials/hud.ejs tests/views.test.mjs
git commit -m "feat(ui): グローバルナビに「マイ資格」リンクを追加し登録画面への動線を確保"
```

---

### Task 3: 100%チェック — フォームに合計%ライブ表示と正規化ボタンを追加

**Files:**
- Modify: `views/certification-form.ejs`
- Test: `tests/views.test.mjs`

クライアント側 JS のロジックはユニットテスト対象外（ブラウザ DOM 依存）。ビューが 500 にならないことと、合計表示要素・正規化ボタンが描画されることを smoke でアサートする。

- [ ] **Step 1: フォーム描画の失敗するテストを追加**

`tests/views.test.mjs` の `describe('views render without 500', ...)` 内、Task 2 で追加した「グローバルナビに「マイ資格」リンクがある」テストの直後に追加する:

```js
  test('資格フォームに合計%表示と正規化ボタンがある', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/certifications/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="weightTotal"');
    expect(res.text).toContain('id="normalizeBtn"');
  });
```

- [ ] **Step 2: red を確認**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/views.test.mjs`
Expected: 新テストのみ FAIL（`id="weightTotal"` / `id="normalizeBtn"` が無い）

- [ ] **Step 3: フォームのドメイン一覧セクションに合計表示・正規化ボタンの要素を追加**

`views/certification-form.ejs` のドメイン一覧 section を変更する。変更前:

```html
      <section class="rpg-window is-open">
        <label class="rpg-label" style="font-size: 14px;">🗺 ドメイン一覧</label>
        <div id="domainsList" style="display:flex; flex-direction:column; gap: 6px; margin-top: 8px;"></div>
        <input type="hidden" name="domainsJson" id="domainsJson" value="<%- JSON.stringify(cert.domains) %>">
        <div style="margin-top: 10px;">
          <button type="button" id="addDomainBtn" class="rpg-btn" style="font-size: 11px; padding: 6px 12px;">＋ ドメインを手動追加</button>
        </div>
      </section>
```

変更後:

```html
      <section class="rpg-window is-open">
        <label class="rpg-label" style="font-size: 14px;">🗺 ドメイン一覧</label>
        <div id="domainsList" style="display:flex; flex-direction:column; gap: 6px; margin-top: 8px;"></div>
        <input type="hidden" name="domainsJson" id="domainsJson" value="<%- JSON.stringify(cert.domains) %>">
        <div style="margin-top: 10px; display:flex; align-items:center; gap: 12px; flex-wrap:wrap;">
          <button type="button" id="addDomainBtn" class="rpg-btn" style="font-size: 11px; padding: 6px 12px;">＋ ドメインを手動追加</button>
          <button type="button" id="normalizeBtn" class="rpg-btn" style="font-size: 11px; padding: 6px 12px;">⚖ 100%に正規化</button>
          <span id="weightTotal" style="font-family: var(--font-display); font-size: 12px;"></span>
        </div>
      </section>
```

- [ ] **Step 4: クライアント JS に合計計算・正規化を追加**

`views/certification-form.ejs` の `<script>` 内を変更する。

(4-1) `sync()` 関数に合計表示の更新を追加する。変更前:

```js
      function sync() {
        document.getElementById('domainsJson').value = JSON.stringify(domains);
      }
```

変更後:

```js
      function sync() {
        document.getElementById('domainsJson').value = JSON.stringify(domains);
        renderWeightTotal();
      }

      // ドメイン割合の合計を表示する。100% なら緑、それ以外は警告色。
      function renderWeightTotal() {
        const el = document.getElementById('weightTotal');
        if (domains.length === 0) { el.textContent = ''; return; }
        const total = domains.reduce((a, d) => a + (Number(d.weight) || 0), 0);
        if (total === 100) {
          el.textContent = '合計: 100% ✓';
          el.style.color = 'var(--fern)';
        } else {
          el.textContent = `⚠ 合計: ${total}%（100% になっていません）`;
          el.style.color = 'var(--crimson)';
        }
      }

      // normalizeWeightsToSum100（サーバー側）と同じロジックをクライアントで適用する。
      // 合計0なら均等配分、それ以外は比例配分して余剰/不足を最大ウェイトのドメインで調整。
      function normalizeWeights() {
        if (domains.length === 0) return;
        const sum = domains.reduce((a, d) => a + (Number(d.weight) || 0), 0);
        if (sum === 0) {
          const base = Math.floor(100 / domains.length);
          const remainder = 100 - base * domains.length;
          domains = domains.map((d, i) => ({ ...d, weight: base + (i < remainder ? 1 : 0) }));
        } else {
          domains = domains.map((d) => ({ ...d, weight: Math.round(((Number(d.weight) || 0) * 100) / sum) }));
          const newSum = domains.reduce((a, d) => a + d.weight, 0);
          const diff = 100 - newSum;
          if (diff !== 0) {
            let maxIdx = 0;
            for (let i = 1; i < domains.length; i++) {
              if (domains[i].weight > domains[maxIdx].weight) maxIdx = i;
            }
            domains[maxIdx].weight += diff;
          }
        }
        renderDomains(); sync();
      }
```

(4-2) 正規化ボタンのイベントハンドラを追加する。`document.getElementById('addDomainBtn').addEventListener(...)` ブロックの直後に追加する:

```js
      document.getElementById('normalizeBtn').addEventListener('click', normalizeWeights);
```

(4-3) 初期表示で合計も描画されるよう、ファイル末尾の `renderDomains();` を変更する。変更前:

```js
      renderDomains();
```

変更後:

```js
      renderDomains();
      renderWeightTotal();
```

- [ ] **Step 5: green を確認**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx vitest run tests/views.test.mjs`
Expected: PASS（フォーム描画テスト含む）

- [ ] **Step 6: コミット**

```bash
git add views/certification-form.ejs tests/views.test.mjs
git commit -m "feat(cert-form): ドメイン割合の合計%ライブ表示と100%正規化ボタンを追加"
```

---

### Task 4: 最終検証（全テスト + lint）

- [ ] **Step 1: 全テストを実行**

```bash
docker compose up -d cosmos-emulator
NODE_TLS_REJECT_UNAUTHORIZED=0 npm test
```

Expected: 全 PASS（spec-coverage ハーネス含む）

- [ ] **Step 2: lint を実行**

```bash
npm run lint
```

Expected: エラー 0

- [ ] **Step 3: 手動確認（任意・ユーザー依頼可）**

```bash
npm run dev
```

1. 任意のページでグローバルナビに「📚 マイ資格」が表示され、クリックで `/my/certifications` に遷移する
2. 「＋ 新規追加」→ フォームで study guide URL に gh-500 のガイド URL を入力 →「🔮 URL からドメイン構造を自動抽出」
   （`https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/gh-500`）
3. **6 ドメイン**が抽出され、各割合が入り、合計%表示が「合計: 100% ✓」（緑）になる
4. いずれかの weight を手動で変えると合計表示が赤い警告に変わり、「⚖ 100%に正規化」で 100% に戻る

   注: 抽出ボタンは LLM フォールスルー時に GitHub トークンを使う。regex で6件取れる gh-500 では LLM 不要のため、新エンドポイントのリスクゲート（別スペック）に依存せず動作する。

- [ ] **Step 4: 結果報告**

テスト・lint 結果と、手動確認の結果（gh-500 で6ドメイン取得・合計100%）をユーザーに報告する。

---

## Self-Review チェック済み事項

- スペック D1〜D6 のタスク対応: D1/D2→Task 1、D3→Task 2、D4→Task 3、D5（保存時不変）→全タスクでサーバー保存ロジック未変更、D6（2つ目URLスコープ外）→触れない
- プレースホルダ無し（全ステップに実コード・実コマンド・期待結果）
- 型/識別子整合: `weightTotal` / `normalizeBtn` / `renderWeightTotal` / `normalizeWeights` は Task 3 内で定義・参照が一致。区切り文字クラスは Task 1 で1箇所のみ変更
- gh-500 回帰テストは regex パス（LLM 不要）を検証するため、外部 IO・トークン・新エンドポイントに非依存
