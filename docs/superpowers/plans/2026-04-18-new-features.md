# 新機能追加 Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1（Cosmos DB移行）を前提として、公開SaaS化に必要な新機能を実装する。具体的にはユーザーによる資格追加、公開/非公開、ランキング、学習計画。

**Architecture:** 既存の routes → services → cosmosService の層構造を維持。新規サービス（`rankingService`, `planService`）と新規ルート（`certifications` CRUD、`ranking`、`plans`）を追加。既存ビューに公開資格タブを追加、新規ビュー（`my-certifications.ejs`, `certification-form.ejs`, `ranking.ejs`, `plan.ejs`）を作成。

**Tech Stack:** 既存そのまま（Express + EJS + Cosmos DB + GitHub OAuth）。新規ライブラリなし。

**前提:** Plan 1 完了（`feat/cosmos-db-migration` ブランチまたは merge 後の main）

**参考設計書:** `docs/superpowers/specs/2026-04-16-public-saas-design.md`

---

## スコープ

### 含む（フェーズ別）

**フェーズA: 資格のユーザー追加と公開/非公開**
- `routes/certifications.js` — 資格作成/編集/削除/公開トグル
- `views/my-certifications.ejs` — 自分の資格一覧
- `views/certification-form.ejs` — 資格作成/編集フォーム（URL 入力 → ドメイン抽出）
- `views/index.ejs` 改修 — 「公開資格」タブ追加
- ドメイン構造の自動抽出（Microsoft Learn のスタディガイドページから）

**フェーズB: ランキング**
- `services/rankingService.js` — ランキング集計
- `routes/ranking.js` — ランキング画面
- `views/ranking.ejs` — 週次/月次、資格別ランキング表示
- セッション完了時の `users.stats` 更新ロジック（progressService に組み込み）
- 毎週月曜 00:00 UTC の週次統計リセット（リクエスト時に遅延リセット方式）

**フェーズC: 学習計画**
- `services/planService.js` — スケジュール自動生成
- `routes/plans.js` — 学習計画 CRUD
- `views/plan.ejs` — 学習計画表示・作成フォーム
- ダッシュボードに「今週のタスク」カード追加

### 含まない（将来作業）

- プレミアム/課金機能（フリーミアム区分なし、全機能を全ユーザーに提供）
- メール/プッシュ通知
- リマインド（次回ログイン時のダッシュボードバナーのみ、本プランには含めない）
- 資格の公開申請と管理者承認フロー（ユーザー自身が公開ボタンで即時公開）

---

## ファイル構成

### 新規作成

- `routes/certifications.js` — 資格 CRUD・公開トグル
- `routes/ranking.js` — ランキング
- `routes/plans.js` — 学習計画
- `services/rankingService.js` — ランキング集計
- `services/planService.js` — スケジュール生成
- `services/certificationParser.js` — Microsoft Learn URL からドメイン構造を抽出
- `views/my-certifications.ejs` — 自分の資格一覧
- `views/certification-form.ejs` — 資格作成/編集フォーム
- `views/ranking.ejs` — ランキング画面
- `views/plan.ejs` — 学習計画画面

### 変更

- `app.js` — 新規ルーター登録
- `services/progressService.js` — セッション完了時に `users.stats` を更新
- `services/userService.js` — 統計リセットロジック
- `routes/index.js` — 公開資格タブ + 学習計画カード
- `views/index.ejs` — タブ切替 UI、マイ資格/ランキング/学習計画リンク
- `views/certification.ejs` — 自分が作成者の場合は編集/公開ボタン表示

---

## Task 1: 資格 CRUD ルートと自分の資格一覧

**Files:**
- Create: `routes/certifications.js`
- Create: `views/my-certifications.ejs`
- Modify: `app.js`

- [ ] **Step 1: `routes/certifications.js` を作成**

`/my/certifications` パスで CRUD を提供。

```javascript
'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const all = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const myCerts = all.filter((c) => c.createdBy === req.user.id);
  res.render('my-certifications', {
    title: 'マイ資格',
    certs: myCerts,
    userEmail: res.locals.userEmail,
  });
});

router.get('/new', requireAuth, (req, res) => {
  res.render('certification-form', {
    title: '資格を追加',
    mode: 'new',
    cert: { id: '', name: '', studyGuideUrl: '', courseUrl: '', domains: [] },
    error: null,
    userEmail: res.locals.userEmail,
  });
});

router.post('/new', requireAuth, async (req, res) => {
  const { id, name, studyGuideUrl, courseUrl, domainsJson } = req.body;
  if (!id || !name) {
    return res.status(400).render('certification-form', {
      title: '資格を追加', mode: 'new',
      cert: { id, name, studyGuideUrl, courseUrl, domains: [] },
      error: 'ID と名前は必須です', userEmail: res.locals.userEmail,
    });
  }
  const existing = await questionService.readCertification(id);
  if (existing) {
    return res.status(400).render('certification-form', {
      title: '資格を追加', mode: 'new',
      cert: { id, name, studyGuideUrl, courseUrl, domains: [] },
      error: `資格ID "${id}" は既に使用されています`, userEmail: res.locals.userEmail,
    });
  }
  let domains = [];
  try { domains = JSON.parse(domainsJson || '[]'); } catch { domains = []; }
  const cert = {
    id, name, studyGuideUrl: studyGuideUrl || '', courseUrl: courseUrl || '',
    createdBy: req.user.id,
    creatorName: req.user.username,
    isPublic: false,
    publishedAt: null,
    usedByCount: 0,
    domains: domains.map((d, i) => ({
      id: d.id || `domain-${i + 1}`,
      name: d.name || `Domain ${i + 1}`,
      weight: Number(d.weight) || 0,
      generatedAt: null,
      questions: [],
    })),
  };
  await questionService.writeCertification(cert);
  res.redirect(`/my/certifications`);
});

router.post('/:certId/publish', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ公開できます');
  cert.isPublic = true;
  cert.publishedAt = new Date().toISOString();
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
});

router.post('/:certId/unpublish', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ操作できます');
  cert.isPublic = false;
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
});

router.post('/:certId/delete', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ削除できます');
  await questionService.deleteCertification(cert.id);
  res.redirect('/my/certifications');
});

module.exports = router;
```

- [ ] **Step 2: `questionService.deleteCertification` を追加**

`services/questionService.js` に以下を追加:
```javascript
async function deleteCertification(certId) {
  await cosmosService.remove('certifications', certId, certId);
}
```
`module.exports` にも追加。

- [ ] **Step 3: `views/my-certifications.ejs` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title><%= title %></title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gray-900 text-white px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="/" class="text-lg font-bold">📚 資格学習エージェント</a>
      <span class="text-gray-400">/</span>
      <span class="text-sm">マイ資格</span>
    </div>
    <div class="flex items-center gap-4 text-sm">
      <span class="text-gray-400"><%= userEmail %></span>
      <form method="POST" action="/auth/logout" class="inline">
        <button class="text-gray-400 hover:text-white">ログアウト</button>
      </form>
    </div>
  </nav>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">マイ資格</h1>
      <a href="/my/certifications/new" class="bg-blue-600 text-white px-4 py-2 rounded">＋ 新規追加</a>
    </div>
    <% if (certs.length === 0) { %>
      <p class="text-gray-500">まだ資格を作成していません。</p>
    <% } else { %>
      <div class="space-y-3">
        <% for (const c of certs) { %>
          <div class="bg-white border rounded-xl p-4 flex items-center justify-between">
            <div>
              <h2 class="font-semibold"><%= c.name %></h2>
              <p class="text-xs text-gray-500">
                <%= c.domainCount %> ドメイン · <%= c.questionCount %> 問
                · <%= c.isPublic ? '公開中' : '非公開' %>
              </p>
            </div>
            <div class="flex gap-2">
              <a href="/certifications/<%= c.id %>" class="text-xs bg-gray-100 px-3 py-1.5 rounded">開く</a>
              <% if (c.isPublic) { %>
                <form method="POST" action="/my/certifications/<%= c.id %>/unpublish">
                  <button class="text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded">非公開にする</button>
                </form>
              <% } else { %>
                <form method="POST" action="/my/certifications/<%= c.id %>/publish">
                  <button class="text-xs bg-green-100 text-green-800 px-3 py-1.5 rounded">公開する</button>
                </form>
              <% } %>
              <form method="POST" action="/my/certifications/<%= c.id %>/delete"
                    onsubmit="return confirm('削除しますか？')">
                <button class="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded">削除</button>
              </form>
            </div>
          </div>
        <% } %>
      </div>
    <% } %>
  </main>
</body>
</html>
```

- [ ] **Step 4: `app.js` にルーター登録**

```javascript
const certificationsRouter = require('./routes/certifications');
// ... 既存の app.use 群の後に
app.use('/my/certifications', certificationsRouter);
```

- [ ] **Step 5: Verify**

構文チェック:
```bash
"C:/Program Files/nodejs/node.exe" -c routes/certifications.js
"C:/Program Files/nodejs/node.exe" -c services/questionService.js
"C:/Program Files/nodejs/node.exe" -c app.js
```

ブラウザで `/my/certifications` にアクセス → 空リストが表示される。

- [ ] **Step 6: コミット**

```bash
git add routes/certifications.js services/questionService.js app.js views/my-certifications.ejs
git commit -m "feat: add my certifications CRUD routes and list view"
```

---

## Task 2: 資格作成フォームとドメイン構造抽出

**Files:**
- Create: `services/certificationParser.js`
- Create: `views/certification-form.ejs`

- [ ] **Step 1: `services/certificationParser.js` を作成**

Microsoft Learn URL からドメイン一覧を抽出。既存の `generationService.fetchViaLearnMcp` / `fetchViaHtmlScraping` のロジックを参考に、MCPで取得した Markdown からヘッダレベル 2 のドメインを正規表現で抽出する。

```javascript
'use strict';

const { parse } = require('node-html-parser');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const LEARN_MCP_URL = 'https://learn.microsoft.com/api/mcp';

async function fetchMarkdown(url) {
  const client = new Client({ name: 'cert-study-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(LEARN_MCP_URL));
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'microsoft_docs_fetch', arguments: { url } });
    return result?.content?.map((c) => c.text).join('\n') || '';
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Markdown からドメイン一覧を抽出する
 * 「Domain N: タイトル (X%)」または「Skills measured - Domain N: ...」形式を想定
 */
function parseDomainsFromMarkdown(md) {
  const domains = [];
  const lines = md.split('\n');
  const headerRe = /^#+\s*(?:Domain|ドメイン)\s*(\d+)\s*[:：]\s*(.+?)(?:\s*[（(]\s*(\d+)\s*%?\s*[）)])?$/i;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      domains.push({
        id: `domain-${m[1]}`,
        name: `Domain ${m[1]}: ${m[2].trim()}`,
        weight: m[3] ? Number(m[3]) : 0,
      });
    }
  }
  return domains;
}

async function extractDomains(studyGuideUrl) {
  if (!studyGuideUrl) return [];
  const md = await fetchMarkdown(studyGuideUrl);
  const domains = parseDomainsFromMarkdown(md);
  if (domains.length === 0) throw new Error('ドメイン情報を抽出できませんでした。手動で入力してください。');
  return domains;
}

module.exports = { extractDomains, parseDomainsFromMarkdown };
```

- [ ] **Step 2: `routes/certifications.js` に抽出エンドポイントを追加**

`/my/certifications/extract` を POST で受け、JSONで返す:
```javascript
const certificationParser = require('../services/certificationParser');

router.post('/extract', requireAuth, async (req, res) => {
  try {
    const { studyGuideUrl } = req.body;
    const domains = await certificationParser.extractDomains(studyGuideUrl);
    res.json({ domains });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

- [ ] **Step 3: `views/certification-form.ejs` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title><%= title %></title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gray-900 text-white px-6 py-3">
    <a href="/my/certifications" class="text-gray-200 text-sm">← マイ資格に戻る</a>
  </nav>
  <main class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6"><%= title %></h1>
    <% if (error) { %>
      <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4"><%= error %></div>
    <% } %>
    <form method="POST" action="/my/certifications/new" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1">資格ID <span class="text-red-500">*</span></label>
        <input name="id" required pattern="[a-z0-9-]+" value="<%= cert.id %>"
               placeholder="例: az-900" class="w-full border rounded px-3 py-2">
        <p class="text-xs text-gray-500 mt-1">小文字・数字・ハイフンのみ</p>
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">資格名 <span class="text-red-500">*</span></label>
        <input name="name" required value="<%= cert.name %>"
               placeholder="例: Microsoft Azure Fundamentals (AZ-900)" class="w-full border rounded px-3 py-2">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">スタディガイド URL</label>
        <input name="studyGuideUrl" type="url" id="studyGuideUrl" value="<%= cert.studyGuideUrl %>"
               placeholder="https://learn.microsoft.com/..." class="w-full border rounded px-3 py-2">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">コース URL（任意）</label>
        <input name="courseUrl" type="url" value="<%= cert.courseUrl %>"
               placeholder="https://learn.microsoft.com/..." class="w-full border rounded px-3 py-2">
      </div>

      <div>
        <button type="button" id="extractBtn"
                class="text-sm bg-amber-100 text-amber-800 px-4 py-2 rounded">
          🤖 URL からドメイン構造を自動抽出
        </button>
        <span id="extractStatus" class="text-sm text-gray-500 ml-2"></span>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">ドメイン一覧</label>
        <div id="domainsList" class="space-y-2">
          <!-- JS で構築 -->
        </div>
        <input type="hidden" name="domainsJson" id="domainsJson" value="<%- JSON.stringify(cert.domains) %>">
        <button type="button" id="addDomainBtn"
                class="text-xs bg-gray-100 px-3 py-1.5 rounded mt-2">＋ ドメインを手動追加</button>
      </div>

      <button class="bg-blue-600 text-white font-semibold px-6 py-2 rounded">保存</button>
    </form>

    <script>
      let domains = JSON.parse(document.getElementById('domainsJson').value || '[]');

      function renderDomains() {
        const container = document.getElementById('domainsList');
        container.innerHTML = domains.map((d, i) => `
          <div class="flex gap-2 bg-white border rounded p-2 items-center">
            <input value="${d.id}" onchange="domains[${i}].id=this.value;sync()"
                   placeholder="domain-1" class="border rounded px-2 py-1 text-sm w-28">
            <input value="${d.name}" onchange="domains[${i}].name=this.value;sync()"
                   placeholder="ドメイン名" class="border rounded px-2 py-1 text-sm flex-1">
            <input value="${d.weight}" onchange="domains[${i}].weight=Number(this.value);sync()"
                   type="number" class="border rounded px-2 py-1 text-sm w-16" min="0" max="100">
            <span class="text-xs text-gray-400">%</span>
            <button type="button" onclick="domains.splice(${i},1);renderDomains();sync()"
                    class="text-red-500 text-xs">削除</button>
          </div>
        `).join('');
      }
      function sync() {
        document.getElementById('domainsJson').value = JSON.stringify(domains);
      }
      document.getElementById('addDomainBtn').onclick = () => {
        domains.push({ id: `domain-${domains.length + 1}`, name: '', weight: 0 });
        renderDomains(); sync();
      };
      document.getElementById('extractBtn').onclick = async () => {
        const url = document.getElementById('studyGuideUrl').value;
        if (!url) return alert('スタディガイド URL を入力してください');
        const status = document.getElementById('extractStatus');
        status.textContent = '抽出中...';
        try {
          const res = await fetch('/my/certifications/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studyGuideUrl: url }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          domains = data.domains;
          renderDomains(); sync();
          status.textContent = `${domains.length} 個のドメインを抽出しました`;
        } catch (e) {
          status.textContent = 'エラー: ' + e.message;
        }
      };
      renderDomains();
    </script>
  </main>
</body>
</html>
```

- [ ] **Step 4: Verify**

```bash
"C:/Program Files/nodejs/node.exe" -c services/certificationParser.js
"C:/Program Files/nodejs/node.exe" -c routes/certifications.js
```

ブラウザで `/my/certifications/new` → スタディガイド URL（例: `https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/az-900`）を入力 → 「自動抽出」クリック → ドメイン一覧が埋まる → 保存 → `/my/certifications` に戻り新規資格が表示される。

- [ ] **Step 5: コミット**

```bash
git add services/certificationParser.js routes/certifications.js views/certification-form.ejs
git commit -m "feat: add certification form with auto domain extraction"
```

---

## Task 3: ホーム画面に公開資格タブとナビ追加

**Files:**
- Modify: `routes/index.js`
- Modify: `views/index.ejs`

- [ ] **Step 1: `routes/index.js` を改修**

現在の `listCertifications({ includePrivate: true, userId })` は `isPublic OR createdBy === userId` を返す。これを「システム + 公開資格 + 自分が作った非公開資格」としてタブ分けするため2回クエリする:

```javascript
router.get('/', requireAuth, async (req, res) => {
  const publicCerts = await questionService.listCertifications({ includePrivate: false });
  const myCerts = (await questionService.listCertifications({ includePrivate: true, userId: req.user.id }))
    .filter((c) => c.createdBy === req.user.id && !c.isPublic);
  res.render('index', {
    title: '資格取得学習エージェント',
    publicCerts,
    myCerts,
    userEmail: res.locals.userEmail,
  });
});
```

- [ ] **Step 2: `views/index.ejs` を改修**

既存ビューを Read してから、以下のようにタブとナビゲーションを追加:

```html
<nav>  <!-- 既存のヘッダーはそのまま -->
  ...
</nav>
<main>
  <!-- 追加: ナビリンク -->
  <div class="flex gap-4 mb-6 text-sm">
    <a href="/my/certifications" class="text-blue-600 hover:underline">マイ資格</a>
    <a href="/ranking" class="text-blue-600 hover:underline">ランキング</a>
    <a href="/plans" class="text-blue-600 hover:underline">学習計画</a>
  </div>

  <!-- タブ切替: 公開資格 / 自分の非公開 -->
  <div class="mb-4 border-b">
    <button onclick="showTab('public')" id="tab-public"
            class="px-4 py-2 border-b-2 border-blue-600 font-semibold">
      公開資格 (<%= publicCerts.length %>)
    </button>
    <button onclick="showTab('mine')" id="tab-mine"
            class="px-4 py-2 border-b-2 border-transparent text-gray-500">
      自分の非公開資格 (<%= myCerts.length %>)
    </button>
  </div>

  <div id="panel-public">
    <% for (const c of publicCerts) { %>
      <!-- 既存の resource card デザインを踏襲 -->
      <a href="/certifications/<%= c.id %>" class="block bg-white rounded-xl border p-4 mb-3 hover:shadow">
        <h2 class="text-xl font-semibold"><%= c.name %></h2>
        <p class="text-sm text-gray-500 mt-1">
          <%= c.domainCount %> ドメイン · <%= c.questionCount %> 問
          <% if (c.createdBy !== 'system') { %>
            · 作成者: <%= c.creatorName %>
          <% } %>
        </p>
      </a>
    <% } %>
  </div>

  <div id="panel-mine" class="hidden">
    <% if (myCerts.length === 0) { %>
      <p class="text-gray-500">非公開資格はありません。<a href="/my/certifications/new" class="text-blue-600">新規作成</a></p>
    <% } else { %>
      <% for (const c of myCerts) { %>
        <a href="/certifications/<%= c.id %>" class="block bg-white rounded-xl border p-4 mb-3 hover:shadow">
          <h2 class="text-xl font-semibold"><%= c.name %></h2>
          <p class="text-sm text-gray-500 mt-1">
            <%= c.domainCount %> ドメイン · <%= c.questionCount %> 問 · 非公開
          </p>
        </a>
      <% } %>
    <% } %>
  </div>

  <script>
    function showTab(key) {
      const tabs = ['public', 'mine'];
      for (const t of tabs) {
        const btn = document.getElementById('tab-' + t);
        const panel = document.getElementById('panel-' + t);
        if (t === key) {
          btn.classList.add('border-blue-600', 'font-semibold');
          btn.classList.remove('border-transparent', 'text-gray-500');
          panel.classList.remove('hidden');
        } else {
          btn.classList.remove('border-blue-600', 'font-semibold');
          btn.classList.add('border-transparent', 'text-gray-500');
          panel.classList.add('hidden');
        }
      }
    }
  </script>
</main>
```

既存の「テンプレートで追加できる」説明エリアは削除する（UIで追加できるようになったため）。

- [ ] **Step 2: Verify**

ブラウザで `/` にアクセス → 公開資格タブ・自分の非公開タブが切替可能、ナビリンクも表示される。

- [ ] **Step 3: コミット**

```bash
git add routes/index.js views/index.ejs
git commit -m "feat: add public certs tab and nav links on home"
```

---

## Task 4: セッション完了時の統計更新

**Files:**
- Modify: `services/progressService.js`

- [ ] **Step 1: `progressService.completeSession` でユーザー統計を更新**

現在の `completeSession` を以下に置換:

```javascript
const userService = require('./userService');

async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.completedAt = new Date().toISOString();
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  session.score = total > 0 ? Math.round((correct / total) * 100) : 0;
  await cosmosService.upsert('sessions', session);

  // ユーザー統計を更新
  await userService.updateUserStats(userId, (stats) => {
    stats.totalSessions = (stats.totalSessions || 0) + 1;
    stats.totalAnswered = (stats.totalAnswered || 0) + total;
    stats.totalCorrect = (stats.totalCorrect || 0) + correct;

    const cs = stats.certStats || {};
    const cur = cs[session.certificationId] || { correct: 0, answered: 0, sessionsCount: 0 };
    cur.correct += correct;
    cur.answered += total;
    cur.sessionsCount += 1;
    cur.correctRate = cur.answered > 0 ? Math.round((cur.correct / cur.answered) * 100) : 0;
    cs[session.certificationId] = cur;
    stats.certStats = cs;

    // 週次・月次は集計時にも計算するため、ここでは最終正答率を概算で更新
    const overall = stats.totalAnswered > 0
      ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
      : 0;
    stats.weeklyCorrectRate = overall;
    stats.monthlyCorrectRate = overall;
    return stats;
  });

  return session;
}
```

注: 週次/月次の正確な値は Task 5 の rankingService で別途計算する（ユーザー stats は簡易キャッシュ）。

- [ ] **Step 2: Verify**

ブラウザで1セッション完了 → Cosmos DB の users コンテナで該当ユーザーの `stats.totalSessions` 等が増えていることを確認:

```bash
"C:/Program Files/nodejs/node.exe" --env-file=".env" -e "const {CosmosClient}=require('@azure/cosmos');(async()=>{const c=new CosmosClient({endpoint:process.env.COSMOS_ENDPOINT,key:process.env.COSMOS_KEY});const {resources}=await c.database('cert-quiz').container('users').items.query('SELECT c.id, c.stats FROM c').fetchAll();console.log(JSON.stringify(resources, null, 2));})()"
```

- [ ] **Step 3: コミット**

```bash
git add services/progressService.js
git commit -m "feat: update user stats on session completion"
```

---

## Task 5: ランキングサービスとルート

**Files:**
- Create: `services/rankingService.js`
- Create: `routes/ranking.js`
- Create: `views/ranking.ejs`
- Modify: `app.js`

- [ ] **Step 1: `services/rankingService.js` を作成**

```javascript
'use strict';

const cosmosService = require('./cosmosService');

function weekStart(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun
  const mondayOffset = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString();
}

function monthStart(date = new Date()) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * 指定期間のセッションをユーザー×資格で集計してランキング化
 */
async function getRanking({ certificationId, since }) {
  const querySpec = certificationId
    ? {
        query: 'SELECT * FROM c WHERE c.certificationId = @certId AND c.completedAt >= @since',
        parameters: [
          { name: '@certId', value: certificationId },
          { name: '@since', value: since },
        ],
      }
    : {
        query: 'SELECT * FROM c WHERE c.completedAt >= @since',
        parameters: [{ name: '@since', value: since }],
      };
  const sessions = await cosmosService.query('sessions', querySpec);

  // ユーザー×資格で集計
  const agg = {};
  for (const s of sessions) {
    const key = `${s.userId}|${s.certificationId}`;
    if (!agg[key]) agg[key] = { userId: s.userId, certificationId: s.certificationId, correct: 0, total: 0, sessions: 0 };
    const correct = s.answers.filter((a) => a.isCorrect).length;
    agg[key].correct += correct;
    agg[key].total += s.answers.length;
    agg[key].sessions += 1;
  }

  // ユーザー情報を付与
  const userIds = [...new Set(Object.values(agg).map((a) => a.userId))];
  const users = {};
  for (const uid of userIds) {
    const u = await cosmosService.read('users', uid, uid);
    users[uid] = u ? { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl } : null;
  }

  const ranking = Object.values(agg)
    .filter((a) => a.total >= 10) // 最低10問を条件とする
    .map((a) => ({
      ...a,
      rate: Math.round((a.correct / a.total) * 100),
      user: users[a.userId],
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);

  return ranking;
}

async function getWeeklyRanking(certificationId = null) {
  return getRanking({ certificationId, since: weekStart() });
}
async function getMonthlyRanking(certificationId = null) {
  return getRanking({ certificationId, since: monthStart() });
}

module.exports = { getWeeklyRanking, getMonthlyRanking, weekStart, monthStart };
```

- [ ] **Step 2: `routes/ranking.js` を作成**

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const rankingService = require('../services/rankingService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const { period = 'weekly', certId = '' } = req.query;
  const ranking = period === 'monthly'
    ? await rankingService.getMonthlyRanking(certId || null)
    : await rankingService.getWeeklyRanking(certId || null);
  const allCerts = await questionService.listCertifications({ includePrivate: false });
  res.render('ranking', {
    title: 'ランキング',
    ranking, period, certId, allCerts,
    userEmail: res.locals.userEmail,
  });
});

module.exports = router;
```

- [ ] **Step 3: `views/ranking.ejs` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title><%= title %></title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gray-900 text-white px-6 py-3">
    <a href="/" class="text-lg font-bold">📚 資格学習エージェント</a>
  </nav>
  <main class="max-w-3xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6">🏆 ランキング</h1>
    <form method="GET" class="flex gap-3 mb-6 text-sm">
      <select name="period" class="border rounded px-2 py-1">
        <option value="weekly" <%= period === 'weekly' ? 'selected' : '' %>>週次</option>
        <option value="monthly" <%= period === 'monthly' ? 'selected' : '' %>>月次</option>
      </select>
      <select name="certId" class="border rounded px-2 py-1">
        <option value="">全資格</option>
        <% for (const c of allCerts) { %>
          <option value="<%= c.id %>" <%= c.id === certId ? 'selected' : '' %>><%= c.name %></option>
        <% } %>
      </select>
      <button class="bg-blue-600 text-white px-3 py-1 rounded">表示</button>
    </form>
    <% if (ranking.length === 0) { %>
      <p class="text-gray-500">まだランキングを表示できるデータがありません（最低10問の回答が必要）。</p>
    <% } else { %>
      <table class="w-full bg-white border rounded">
        <thead class="bg-gray-100 text-sm">
          <tr>
            <th class="px-3 py-2 text-left">順位</th>
            <th class="px-3 py-2 text-left">ユーザー</th>
            <th class="px-3 py-2 text-left">資格</th>
            <th class="px-3 py-2 text-right">正答率</th>
            <th class="px-3 py-2 text-right">回答数</th>
          </tr>
        </thead>
        <tbody>
          <% ranking.forEach((r, i) => { %>
            <tr class="border-t text-sm">
              <td class="px-3 py-2 font-bold"><%= i + 1 %></td>
              <td class="px-3 py-2"><%= r.user?.displayName || r.user?.username || 'unknown' %></td>
              <td class="px-3 py-2"><%= r.certificationId %></td>
              <td class="px-3 py-2 text-right <%= r.rate >= 70 ? 'text-green-600' : 'text-red-500' %>">
                <%= r.rate %>%
              </td>
              <td class="px-3 py-2 text-right text-gray-500"><%= r.correct %>/<%= r.total %></td>
            </tr>
          <% }) %>
        </tbody>
      </table>
    <% } %>
  </main>
</body>
</html>
```

- [ ] **Step 4: `app.js` に登録**

```javascript
const rankingRouter = require('./routes/ranking');
app.use('/ranking', rankingRouter);
```

- [ ] **Step 5: Verify**

構文チェック + ブラウザで `/ranking` にアクセス → 週次ランキングが表示される（データがない場合はメッセージ）。

- [ ] **Step 6: コミット**

```bash
git add services/rankingService.js routes/ranking.js views/ranking.ejs app.js
git commit -m "feat: add ranking service and view"
```

---

## Task 6: 学習計画サービスとルート

**Files:**
- Create: `services/planService.js`
- Create: `routes/plans.js`
- Create: `views/plan.ejs`
- Modify: `app.js`

- [ ] **Step 1: `services/planService.js` を作成**

```javascript
'use strict';

const crypto = require('crypto');
const cosmosService = require('./cosmosService');
const questionService = require('./questionService');
const progressService = require('./progressService');

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MIN_QUESTIONS_PER_WEEK = 10;

/**
 * 試験日・資格・ユーザー統計から週次スケジュールを生成
 */
async function generateSchedule({ certificationId, examDate, userId }) {
  const cert = await questionService.readCertification(certificationId);
  if (!cert) throw new Error(`Certification not found: ${certificationId}`);

  const now = new Date();
  const exam = new Date(examDate);
  const weeksLeft = Math.max(1, Math.ceil((exam - now) / MS_PER_WEEK));

  const stats = await progressService.calcDomainStats(certificationId, userId);

  // 各ドメインの優先度 = weight × (1 - correctRate)
  const priorities = cert.domains.map((d) => {
    const rate = (stats[d.id]?.rate ?? 0) / 100;
    return { id: d.id, name: d.name, priority: d.weight * (1 - rate) };
  });
  priorities.sort((a, b) => b.priority - a.priority);

  const totalQuestions = cert.domains.reduce((acc, d) => acc + d.questions.length, 0);
  const perWeek = Math.max(MIN_QUESTIONS_PER_WEEK, Math.ceil(totalQuestions / weeksLeft));

  // 週ごとに優先度順にドメインをローテーション
  const schedule = [];
  for (let w = 1; w <= weeksLeft; w++) {
    const idx = (w - 1) % priorities.length;
    const primary = priorities[idx];
    const secondary = priorities[(idx + 1) % priorities.length];
    schedule.push({
      week: w,
      domains: [primary.id, secondary.id].filter(Boolean),
      targetQuestions: perWeek,
    });
  }
  return schedule;
}

async function upsertPlan({ userId, certificationId, examDate }) {
  const schedule = await generateSchedule({ certificationId, examDate, userId });
  const plan = {
    id: `${userId}-${certificationId}`, // 1ユーザー1資格1計画
    userId, certificationId, examDate,
    schedule,
    createdAt: new Date().toISOString(),
  };
  await cosmosService.upsert('studyPlans', plan);
  return plan;
}

async function listPlans(userId) {
  return cosmosService.query('studyPlans', {
    query: 'SELECT * FROM c WHERE c.userId = @userId',
    parameters: [{ name: '@userId', value: userId }],
  }, { partitionKey: userId });
}

async function getPlan(userId, certificationId) {
  return cosmosService.read('studyPlans', `${userId}-${certificationId}`, userId);
}

async function deletePlan(userId, certificationId) {
  await cosmosService.remove('studyPlans', `${userId}-${certificationId}`, userId);
}

function currentWeek(plan) {
  if (!plan) return null;
  const created = new Date(plan.createdAt);
  const now = new Date();
  const weeksElapsed = Math.floor((now - created) / MS_PER_WEEK) + 1;
  return plan.schedule.find((s) => s.week === weeksElapsed) || plan.schedule[plan.schedule.length - 1];
}

module.exports = { generateSchedule, upsertPlan, listPlans, getPlan, deletePlan, currentWeek };
```

- [ ] **Step 2: `routes/plans.js` を作成**

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const planService = require('../services/planService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const plans = await planService.listPlans(req.user.id);
  const allCerts = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const plansWithCert = plans.map((p) => ({
    ...p,
    cert: allCerts.find((c) => c.id === p.certificationId) || null,
    currentWeek: planService.currentWeek(p),
  }));
  res.render('plan', {
    title: '学習計画',
    plans: plansWithCert,
    allCerts,
    userEmail: res.locals.userEmail,
  });
});

router.post('/', requireAuth, async (req, res) => {
  const { certificationId, examDate } = req.body;
  if (!certificationId || !examDate) return res.status(400).send('資格と試験日は必須です');
  await planService.upsertPlan({ userId: req.user.id, certificationId, examDate });
  res.redirect('/plans');
});

router.post('/:certId/delete', requireAuth, async (req, res) => {
  await planService.deletePlan(req.user.id, req.params.certId);
  res.redirect('/plans');
});

module.exports = router;
```

- [ ] **Step 3: `views/plan.ejs` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title><%= title %></title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gray-900 text-white px-6 py-3">
    <a href="/" class="text-lg font-bold">📚 資格学習エージェント</a>
  </nav>
  <main class="max-w-3xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6">📅 学習計画</h1>

    <div class="bg-white border rounded-xl p-4 mb-6">
      <h2 class="font-semibold mb-3">新しい計画を作成</h2>
      <form method="POST" action="/plans" class="flex gap-2 text-sm items-end flex-wrap">
        <div>
          <label class="block text-xs text-gray-500">資格</label>
          <select name="certificationId" required class="border rounded px-2 py-1">
            <% for (const c of allCerts) { %>
              <option value="<%= c.id %>"><%= c.name %></option>
            <% } %>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500">試験予定日</label>
          <input name="examDate" type="date" required class="border rounded px-2 py-1">
        </div>
        <button class="bg-blue-600 text-white px-4 py-1.5 rounded">作成</button>
      </form>
    </div>

    <% if (plans.length === 0) { %>
      <p class="text-gray-500">学習計画がまだありません。</p>
    <% } else { %>
      <% for (const p of plans) { %>
        <div class="bg-white border rounded-xl p-5 mb-4">
          <div class="flex items-start justify-between mb-3">
            <div>
              <h2 class="text-xl font-semibold"><%= p.cert?.name || p.certificationId %></h2>
              <p class="text-xs text-gray-500">試験予定日: <%= p.examDate %> · 全 <%= p.schedule.length %> 週</p>
            </div>
            <form method="POST" action="/plans/<%= p.certificationId %>/delete"
                  onsubmit="return confirm('削除しますか？')">
              <button class="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded">削除</button>
            </form>
          </div>
          <% if (p.currentWeek) { %>
            <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
              <p class="text-sm text-blue-800">
                <strong>今週のタスク (Week <%= p.currentWeek.week %>)</strong>:
                <%= p.currentWeek.domains.join(', ') %> を <%= p.currentWeek.targetQuestions %> 問
              </p>
            </div>
          <% } %>
          <details class="text-sm">
            <summary class="cursor-pointer text-gray-600">全週スケジュール</summary>
            <ul class="mt-2 space-y-1">
              <% for (const s of p.schedule) { %>
                <li>Week <%= s.week %>: <%= s.domains.join(', ') %> (<%= s.targetQuestions %> 問)</li>
              <% } %>
            </ul>
          </details>
        </div>
      <% } %>
    <% } %>
  </main>
</body>
</html>
```

- [ ] **Step 4: `app.js` に登録**

```javascript
const plansRouter = require('./routes/plans');
app.use('/plans', plansRouter);
```

- [ ] **Step 5: Verify**

構文チェック + ブラウザで `/plans` にアクセス → 計画作成フォーム表示 → 資格選択・試験日入力 → 作成 → スケジュールが生成表示される。

- [ ] **Step 6: コミット**

```bash
git add services/planService.js routes/plans.js views/plan.ejs app.js
git commit -m "feat: add study plans service and view"
```

---

## Task 7: 最終動作確認とコミット整理

- [ ] **Step 1: E2E動作確認**

以下のフローを順に確認:

1. ホーム画面 → 「公開資格」「自分の非公開資格」タブが切り替わる、ナビリンクが機能する
2. マイ資格 → 空リスト → 新規追加 → スタディガイドURL入力 → 自動抽出 → 保存 → 一覧に表示
3. 追加した資格で「公開する」ボタン → 公開状態に変わる → ホームの公開資格タブに登場
4. クイズ実行 → 完了 → users.stats が更新される
5. ランキング画面 → 自分の集計が出る
6. 学習計画 → 資格選択 + 試験日 → 作成 → 週次スケジュール表示

- [ ] **Step 2: 全ファイル構文チェック**

```bash
for f in routes/*.js services/*.js middleware/*.js app.js; do
  "C:/Program Files/nodejs/node.exe" -c $f || echo "FAIL: $f"
done
```

- [ ] **Step 3: 残存 TODO/FIXME 検索**

```bash
grep -rn "TODO\|FIXME" --include="*.js" .
```
致命的なものがあれば追加で修正コミット。

---

## 完了条件

- [ ] ユーザーが資格を追加・編集・削除・公開/非公開切替できる
- [ ] Microsoft Learn URL からドメイン構造を自動抽出できる
- [ ] ホーム画面で公開資格と自分の非公開資格をタブで切り替えられる
- [ ] セッション完了時に `users.stats` が正しく更新される
- [ ] 週次/月次ランキングが資格別に表示される
- [ ] 学習計画が作成でき、週次スケジュールと「今週のタスク」が表示される

## 未解決事項

なし。実装開始時点で不明点があれば、その場で質問する。
