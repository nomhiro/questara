# CLAUDE.md

## 基本行動指針

- **日本語対応**: すべての回答を日本語で行うこと
- **簡潔性**: 挨拶や過剰な丁寧語（「恐れ入りますが」「よろしければ」等）は省略し、情報の密度を高めること
- **安全性**: セキュリティリスクのあるコード（SQLインジェクション、XSS等）は絶対に提案しないこと
- **品質**: 可読性が高く、保守しやすいコード（Clean Code）を優先すること

## プロセス

- 実装前に必ず要件を確認し、不明点があれば質問すること
- 複雑なロジックは、擬似コードやステップごとの解説を行ってから実装コードを提示すること

## サービス概要

**Questara（クエスターラ）** — Microsoft/GitHub 認定資格（GH-100, AI-102 等）の学習を RPG のアドベンチャーとして楽しめる Web アプリ。
Node.js + Express + EJS による SSR で、ストレージは **Azure Cosmos DB**（ローカル開発は `vnext-preview` エミュレータ）。
GitHub OAuth でログインし、ユーザー単位で学習セッション・ランク・アドベンチャー・アチーブメントを記録する。

### 主な機能

1. **GitHub OAuth ログイン** — JWT を HTTP-only Cookie に載せる（`jwtService` + `middleware/auth.js`）
2. **複数資格対応** — `data/certifications/{id}.json` を追加 → `npm run seed` で Cosmos に投入。UI から追加も可能（`routes/certifications.js`）
3. **ドメイン別問題管理** — 問題は学習ガイドのドメイン単位で格納・再生成できる
4. **AI 問題再生成** — WebUI から「問題を追加生成」→ Microsoft Learn MCP でガイド fetch + ドメイン特化検索 → GitHub Models API（既定 `openai/gpt-4.1`、UI でモデル選択可）で生成 → LLM レビューパス → `questionValidator` で機械検証
5. **クイズモード** — 全問 / 間違えた問題のみ / ドメイン指定
6. **即時フィードバック** — 回答後に正誤と解説を表示
7. **ドメイン別統計 & 弱点ドリル** — 正答率 < 70% のドメインをワンクリックで再練習
8. **ゲーミフィケーション** — ランク（`gamificationService`）、アチーブメント（`achievementService`）、ランキング（`rankingService`）
9. **アドベンチャー** — 資格を「ダンジョン」に見立てた攻略マップ（`adventureService` + `adventureGeneratorService`）
10. **学習プラン** — 目標日に向けたプラン作成・管理（`planService`）

## 開発コマンド

```bash
# 初期セットアップ（.env を自動生成）
npm run setup

# Cosmos DB エミュレータ起動（必須：Express 起動前 & テスト前）
docker compose up -d cosmos-emulator

# Cosmos にシードデータ（data/certifications/*.json）を投入
npm run seed

# 開発サーバー（ホットリロード、http://localhost:3000）
npm run dev

# 本番起動
npm start

# テスト
npm test                              # vitest run
npm run test:watch                    # vitest watch
npm run test:ui                       # vitest --ui

# Lint
npm run lint                          # eslint .
npm run lint:fix                      # eslint . --fix
```

### 環境変数（`.env`）

`npm run setup` で雛形が作成される。必須項目:

| 変数 | 用途 |
| --- | --- |
| `ENCRYPTION_KEY` | API キー等の暗号化（64 文字 hex = 32 バイト） |
| `JWT_SECRET` | Cookie 用 JWT 署名鍵（32 文字以上） |
| `JWT_COOKIE_NAME` | Cookie 名（デフォルト `questara_session`） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App |
| `COSMOS_ENDPOINT` / `COSMOS_KEY` / `COSMOS_DATABASE` | Cosmos DB 接続 |
| `MS_LEARN_MCP_URL` | 省略可。Microsoft Learn MCP のエンドポイント |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | **ローカル限定**。Cosmos Emulator の自己署名証明書を通すため |

## テスト方針（仕様駆動開発）

- **テストは仕様（`docs/superpowers/specs/*.md`）の実行可能なスナップショット**。仕様を変えたら必ず既存テストを先に更新し、赤→緑の順で実装を追随させる。詳細は `docs/TESTING.md`。
- **Cosmos DB エミュレータへの実接続が前提**。`tests/_setup/global.mjs` が起動時に `getDatabaseAccount()` で疎通確認する。`.env.test` に別 DB（`cert-quiz-test`）を向ける。
- テストはシリアル実行（`vitest.config.js` で `singleFork: true`）。並列は DB 状態競合を起こすため不可。
- **網羅性ハーネス**: `tests/_harness/spec-coverage.test.mjs` が `services/` `routes/` `middleware/` の全ファイルにテストがあるかを自動検証。新規ファイル追加時、対応テストが無いと red になる。
- 例外は `ALLOWED_UNTESTED` マップに **理由付き** で登録する（Cosmos の薄いラッパー、JWT の E2E カバー等）。

## アーキテクチャ

```
routes/ → services/ → cosmosService → Cosmos DB containers
                    ↘ data/*.json（achievements 等のマスターデータ）
```

### ディレクトリ構成

```
資格取得/
├── app.js                          # Express エントリ。validateEnv → 11 router mount
├── package.json
├── docker-compose.yml              # cosmos-emulator 定義
├── middleware/
│   ├── auth.js                     # JWT Cookie → req.user。authContext / requireAuth
│   └── hud.js                      # HUD（HP/Rank 等）を res.locals に載せる
├── routes/
│   ├── auth.js                     # GET /auth/github, /auth/github/callback
│   ├── index.js                    # GET /（ランディング / ホーム）
│   ├── quiz.js                     # クイズフロー（開始・回答・結果・復習）
│   ├── domains.js                  # GET /certifications/:certId/domains/:domainId
│   ├── certifications.js           # /my/certifications（自作/所有資格の管理・編集）
│   ├── api.js                      # POST /api/certifications/:certId/domains/:domainId/generate (SSE)
│   ├── ranking.js                  # /ranking
│   ├── plans.js                    # /plans（学習プラン）
│   ├── profile.js                  # /my/profile
│   ├── adventures.js               # /adventures（アドベンチャーマップ）
│   └── api-adventure.js            # /api/adventures（JSON API）
├── services/
│   ├── cosmosService.js            # Cosmos CRUD 基盤。init() で DB と container を作成
│   ├── userService.js              # ユーザー作成・参照
│   ├── jwtService.js               # JWT 署名・検証（Cookie 名を定数化）
│   ├── questionService.js          # certifications コンテナの問題 CRUD / フィルタ
│   ├── progressService.js          # sessions 記録、正答率・ランクアップ計算
│   ├── gamificationService.js      # ランク（S〜F）・HP・経験値ロジック
│   ├── achievementService.js       # data/achievements.json をマスターに進行判定
│   ├── rankingService.js           # ランキング集計
│   ├── planService.js              # 学習プラン CRUD
│   ├── adventureService.js         # adventures コンテナ。ダンジョン進行・アンロック
│   ├── adventureGeneratorService.js # OpenAI でアドベンチャーフレーバー生成
│   ├── certificationParser.js     # 学習ガイド URL から資格定義を OpenAI で抽出
│   ├── generationService.js        # MCP fetch + OpenAI で問題再生成
│   ├── modelCatalogService.js      # GitHub Models カタログ API からモデル一覧を動的取得（10分キャッシュ）
│   ├── questionValidator.js        # 生成問題の機械検証（選択肢・正解キー・解説・重複）
│   └── mcpClient.js                # Microsoft Learn MCP 呼び出し共通ラッパー
├── views/                          # EJS（layout.ejs を partials で include）
│   ├── index.ejs / landing.ejs
│   ├── certification.ejs / certification-form.ejs / my-certifications.ejs
│   ├── quiz.ejs / result.ejs / review.ejs
│   ├── domain.ejs
│   ├── adventure-map.ejs / adventure-detail.ejs / adventure-new.ejs
│   ├── plan.ejs / ranking.ejs / profile.ejs / error.ejs
│   └── partials/                   # 共通 HUD・ナビ等
├── public/
│   ├── theme.css                   # RPG テーマのカスタム CSS
│   └── mocks/                      # 開発用モック画像
├── scripts/
│   ├── seed-certifications.js      # data/certifications/*.json を Cosmos に投入
│   ├── add-cert.js                 # CLI から 1 件追加
│   └── bulk-import-certs.js        # URL 一覧から一括インポート
├── data/
│   ├── certifications/             # シードデータ (gh-100.json, gh-200.json …)
│   ├── achievements.json           # アチーブメントマスター
│   ├── adventure-presets.json     # アドベンチャーテンプレ
│   └── certification-positions.json# マップ座標マスター
├── tests/
│   ├── _setup/                     # global.mjs, db.mjs, fixtures.mjs, http.mjs
│   ├── _harness/spec-coverage.test.mjs # 網羅性ハーネス
│   ├── routes.*.test.mjs           # ルート層の integration
│   ├── views.*.test.mjs            # EJS smoke
│   └── *.test.{js,mjs}             # 各 service の unit
├── docs/
│   ├── TESTING.md
│   └── superpowers/specs/, plans/
└── .github/workflows/ci.yml        # lint-and-test（Cosmos Emulator を service container で起動）
```

### レイヤー間の依存関係

- `routes/*` → `services/*` のみ参照（routes から直接 Cosmos を叩かない）
- `services/*` → `cosmosService` 経由で Cosmos DB、または `data/*.json` マスター
- `middleware/auth.js` は全 route に先立って `req.user` を解決

### サービス層

各 service の 1 行責務は上記ディレクトリ構成のコメントを参照。`cosmosService.init()` がアプリ/テスト起動時に DB とコンテナを自動作成する。

### ビュー層

EJS。共通ヘッダ/ナビ/HUD は `views/partials/` に切り出し、各 view から `<%- include('partials/...') %>` で取り込む。`public/theme.css` が RPG 風のスタイル。Tailwind 非使用。

## Tech Stack

- **Runtime**: Node.js >= 20
- **Framework**: Express 4
- **Template engine**: EJS 3（SSR）
- **Storage**: Azure Cosmos DB（ローカル: `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview`）
- **AI**:
  - `openai` — OpenAI SDK を GitHub Models API（`https://models.github.ai/inference`、モデル ID は `openai/gpt-4.1` 形式、認証はユーザーの GitHub アクセストークン）に向けて使用。問題生成（既定 `openai/gpt-4.1`、UI で変更可）・資格抽出・アドベンチャー生成（既定 `openai/gpt-4o-mini`）。`temperature` 等のサンプリングパラメータは送らない。モデル一覧は `modelCatalogService` がカタログ API から動的取得し、**無料ティアで推論可能なモデル（`rate_limit_tier` = high/low）のみ**を返す。gpt-5 系・o 系・deepseek-r1 は `rate_limit_tier` = custom でカタログに載るが無料ティアでは推論不可（`unavailable_model`）のため除外
  - `@modelcontextprotocol/sdk` — Microsoft Learn MCP サーバーへの接続（学習ガイド取得）
- **Auth**: `jsonwebtoken`（JWT） + `cookie-parser`（HTTP-only Cookie） + GitHub OAuth
- **HTML parsing**: `node-html-parser` — MCP 失敗時のフォールバック用に Microsoft Learn ページをスクレイピング
- **Test**: `vitest` + `supertest`。並列なし（`singleFork`）
- **Lint**: ESLint 9（flat config）
- セッション/エンティティ ID は `crypto.randomUUID()`

## データ構造

### Cosmos DB コンテナ（`services/cosmosService.js`）

| Container | Partition Key | 主な用途 |
| --- | --- | --- |
| `users` | `/id` | ユーザー基本情報（GitHub プロフィール、HP、経験値、ランク履歴） |
| `certifications` | `/id` | 資格定義 + ドメイン + 問題（下記スキーマ） |
| `sessions` | `/userId` | クイズセッション（回答履歴・スコア） |
| `studyPlans` | `/userId` | 学習プラン |
| `adventures` | `/userId` | アドベンチャー進行状態 |

DB 名はデフォルト `cert-quiz`（テストは `cert-quiz-test`）。

### 資格ドキュメント `certifications`

```jsonc
{
  "id": "gh-100",
  "studyGuideUrl": "https://learn.microsoft.com/...",
  "createdBy": "system",
  "isPublic": true,
  "domains": [
    {
      "id": "domain-1",           // "domain-N" 形式
      "name": "Domain 1: ...",
      "weight": 15,               // 試験ウェイト(%)
      "generatedAt": null,        // AI 生成時に ISO8601 更新
      "questions": [
        {
          "id": "gh-100-d1-001",       // {certId}-{domainId}-{3桁連番}
          "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "type": "single",            // "single" | "multiple"（省略時 single）
          "correctAnswers": ["A"],     // 正解キー配列（multiple は 2〜3 個）
          "correctAnswer": "A",        // 後方互換: correctAnswers[0]。旧データはこれのみ
          "explanation": "...",
          "difficulty": "basic"        // "basic" | "applied" | "analytical"
        }
      ]
    }
  ]
}
```

AI 生成問題の ID は末尾に `-gen`（例: `gh-100-domain-1-001-gen`）。

### セッションドキュメント `sessions`

```jsonc
{
  "id": "uuid",
  "userId": "github-user-id",
  "certificationId": "gh-100",
  "mode": "all | wrong-only | domain",
  "domainFilter": "domain-1 | null",
  "startedAt": "ISO8601",
  "completedAt": "ISO8601 | null",
  "answers": [{ "questionId": "...", "domainId": "...", "isCorrect": true }],
  "score": 0.85
}
```

`progressService.getWrongQuestionIds(userId, certId)` は「一度でも正解した問題は除外」するロジック（累積セッション横断）。

### マスターデータ `data/*.json`

- `achievements.json` — アチーブメント定義（トリガー条件・バッジ画像）
- `adventure-presets.json` — アドベンチャーテンプレ
- `certification-positions.json` — マップ上の資格アイコン座標
- `certifications/*.json` — 新規セットアップ時のシード（`npm run seed` で Cosmos へ投入）

## 主要な実装パターン

### 新しい資格の追加

- **方法 A**: `data/certifications/{新ID}.json` を用意 → `npm run seed` で Cosmos に投入
- **方法 B**: UI の `/my/certifications/new` から URL を入力 → `certificationParser` が OpenAI で資格定義を抽出 → Cosmos へ保存
- **方法 C（CLI）**: `node scripts/add-cert.js <URL>` または `node scripts/bulk-import-certs.js urls.txt`

### 認証フロー

1. `/auth/github` → GitHub OAuth 認可画面にリダイレクト
2. `/auth/github/callback` で `code` を access_token に交換 → GitHub API から user/email 取得
3. `userService.upsertUser()` で Cosmos `users` に upsert
4. `jwtService.sign({ sub, email, username })` で JWT 発行 → HTTP-only Cookie にセット
5. `middleware/auth.js::authContext` が以降のリクエストで Cookie を検証して `req.user` を詰める
6. 保護したいルートは `requireAuth` ミドルウェアを前置

### 問題生成フロー（`generationService.js`）

1. MCP fetch で学習ガイド/コースの Markdown を取得し、見出し構造からドメインセクションを抽出
   （見出し不一致時はキーワード位置切り出し → 先頭 8000 文字 → HTML スクレイピングへフォールバック）
2. `mcpClient.callLearnSearch` でドメイン特化の関連ドキュメントを追加取得（失敗時は無視）
3. プロンプト（難易度分布 basic2/applied5/analytical3・複数選択 2〜3 問・グラウンディング指示・既存問題の重複禁止リスト）で生成
4. 第2 LLM 呼び出し（レビューパス）が参考資料と照合して不正確問題を修正/除外（失敗時は原案のまま）
5. `questionValidator.validateQuestions` で機械検証（選択肢 4 つ・正解キー妥当・解説 20 字以上・重複）→ 不正問題を除外
6. `questionService.appendDomainQuestions()` で Cosmos に追記。`routes/api.js` が SSE で進捗ストリーミング

### EJS ビューへ渡す変数

各 route の render 呼び出し時に必要な変数をすべて渡す。`partials/` で共通 HUD（HP/ランク/ログインボタン）を描画。`heroHudMiddleware` が `res.locals.hud` を毎リクエスト注入する。

### SSE エンドポイント（`routes/api.js`）

```js
res.setHeader('Content-Type', 'text/event-stream');
res.flushHeaders();
res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
// 最後に event: done または event: error を送信して res.end()
```

クライアント側（`views/domain.ejs` のインライン script）が `ReadableStream` でこれを読む。

### クイズフローの状態管理

セッションストアを使わず、問題順序はクエリパラメータ `?questions=id1,id2,...&idx=0` で管理する。回答送信ごとに `idx` をインクリメントして同じ URL パターンにリダイレクトする。セッション本体は Cosmos の `sessions` コンテナに都度 upsert。

### 合格ライン

ドメイン/全体の判定は `rate >= 0.7` で統一（緑/赤の分岐）。

## CI（`.github/workflows/ci.yml`）

- ジョブ `lint-and-test` が Cosmos Emulator を **GitHub Actions service container** として起動。公式サンプルに倣い `options` に healthcheck は指定しない（vnext-preview 用の安定した healthcheck エンドポイントが無いため）。
- `Wait for Cosmos DB Emulator` ステップが `curl -fks https://localhost:8081/_explorer/emulator.pem` をリトライして gateway 応答を待つ。
- テストは `NODE_TLS_REJECT_UNAUTHORIZED=0` を付けて実行（自己署名証明書のため）。
