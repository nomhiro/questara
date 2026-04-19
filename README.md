# Questara（クエスターラ）

> Microsoft / GitHub 認定資格の学習を、**みんなで冒険として楽しめる**学習エージェント。

Node.js + Express + EJS によるローカル Web アプリ。GitHub OAuth でサインインし、GitHub Models API（既定: `gpt-4o-mini`）でドメインごとに 4 択問題を動的生成する。学習は RPG 風の「冒険」モードで進み、Lv / EXP / 実績 / ストリーク / ランキングと連動する。

---

## 主な機能

- **ランディング + GitHub ログイン** — `/` にアクセスするとサービス紹介ページが表示され、GitHub ワンクリックでサインインできる
- **RPG 冒険モード** — ダンジョン（資格）を攻略する感覚でドメインを学習。Lv / EXP / ストリーク / 実績 / デイリークエストが連動
- **AI 問題生成** — Microsoft Learn の学習ガイドを元に GitHub Models API が 4 択問題を自動生成。SSE で進捗をリアルタイム表示
- **ドメイン別統計 + 弱点ドリル** — 正答率 < 70% のドメインをワンクリックで再練習
- **複数資格対応** — 公開資格は全員が利用でき、自分の非公開資格も作成可能
- **マイ資格の一括インポート** — Microsoft/GitHub の資格カタログからまとめて追加（`scripts/bulk-import-certs.*`）
- **学習計画 / ランキング** — 計画を立てて進捗共有、他ユーザーと比較

## スクリーンショット

| ランディング | 冒険マップ | クイズ / 結果 |
|---|---|---|
| Hero にキャラクター対面構図・松明・コウモリなどの RPG 演出 | ダンジョン一覧と進行状況 | 4 択の即時フィードバック、ドメイン別スコア |

---

## 前提条件

- **Node.js >= 20**
- **GitHub OAuth App**（Authorization callback URL: `http://localhost:3000/auth/github/callback`）
- **Azure Cosmos DB**（ローカル開発は [Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/local-emulator) を推奨）
- **GitHub Copilot プランのアカウント**（問題生成が GitHub Models API の rate limit を消費する）

## セットアップ

```bash
npm install
npm run setup          # .env を生成（JWT_SECRET / ENCRYPTION_KEY 自動生成）
#   ↓ .env を編集して GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET を設定
npm run seed           # 公開資格を Cosmos DB にシード
npm run dev            # http://localhost:3000 でホットリロード起動
```

本番起動は `npm start`。

### `.env` の主なキー

| 変数 | 用途 |
|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App |
| `JWT_SECRET` | セッション JWT 署名鍵（32 文字以上） |
| `JWT_COOKIE_NAME` | 既定 `questara_session`（テスト環境は `questara_session_test`） |
| `ENCRYPTION_KEY` | ユーザーのアクセストークン暗号化鍵（32 バイトの hex） |
| `COSMOS_ENDPOINT` / `COSMOS_KEY` / `COSMOS_DATABASE` | Cosmos DB 接続 |
| `MS_LEARN_MCP_URL` | （任意）Microsoft Learn MCP エンドポイント上書き |

---

## 使い方

### 未ログインの動線

1. `/` にアクセス → ランディングページ（サービス紹介 + キャラクター演出）
2. 「GitHub でログインして始める」→ GitHub 認可 → 自動的に `/adventure` へ
3. 冒険がまだ無い場合は `/adventures/new` で新規作成

### 問題を再生成する

ドメイン画面（`/certifications/{certId}/domains/{domainId}`）の「**問題を再生成**」ボタンを押すと:

1. Microsoft Learn MCP（失敗時は HTML スクレイピング）で学習ガイドを取得
2. GitHub Models API (`gpt-4o-mini`) に 4 択問題 10 問を生成依頼
3. 結果を Cosmos DB に保存（SSE で進捗をストリーミング）

> **注意:** 問題生成 1 回 = LLM 呼び出し 1 回。お使いの GitHub Copilot プランに紐づく rate limit（1 分 / 1 日あたりのリクエスト数）を消費します。詳細 → [GitHub Models ドキュメント](https://docs.github.com/en/github-models)

### 新しい資格を追加する

`data/certifications/` に JSON を追加して `npm run seed` を再実行、または UI から「新規資格作成」。

```jsonc
{
  "id": "ai-102",
  "name": "Designing and Implementing a Microsoft Azure AI Solution (AI-102)",
  "studyGuideUrl": "https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/ai-102",
  "courseUrl": "https://learn.microsoft.com/ja-jp/training/courses/ai-102t00",
  "domains": [
    { "id": "domain-1", "name": "Domain 1: Plan and manage an Azure AI solution", "weight": 15, "generatedAt": null, "questions": [] }
  ]
}
```

---

## アーキテクチャ

```
views/ ← routes/ ← services/ ← data/ (Cosmos DB containers + seed JSON)
                       ↑
                  middleware/ (auth, HUD context)
```

- **`routes/`** — Express ルート（landing / auth / adventures / certifications / domains / quiz / plans / ranking / profile / api）
- **`services/`** — ビジネスロジック（user / progress / question / generation / gamification / achievement / jwt / MCP / Cosmos）
- **`middleware/`** — JWT 認証・Hero HUD コンテキスト供給
- **`views/`** — EJS テンプレート（共通レイアウトなし、各ファイルが完全な HTML）
- **`data/certifications/*.json`** — 資格シード（起動時に Cosmos にシード可能）
- **`public/theme.css`** — カスタム RPG テーマ（Tailwind CDN と併用）

主要ルーティング（抜粋）

| ルート | 内容 |
|---|---|
| `GET /` | ランディング（誰でも閲覧可、`?error=<key>` でバナー表示） |
| `GET /adventure` | 冒険マップ（要認証。未認証は `/` にリダイレクト） |
| `GET /certifications/:certId` | 資格詳細 + ドメイン別統計 |
| `POST /api/certifications/:certId/domains/:domainId/generate` | 問題生成 SSE |
| `GET /auth/github` → `/auth/github/callback` | GitHub OAuth |
| `POST /auth/logout` | ログアウト → `/` |

---

## 技術スタック

| 用途 | ライブラリ |
|---|---|
| Web サーバー | Express 4 |
| テンプレート | EJS 3（SSR） |
| スタイル | Tailwind CSS（CDN）+ `public/theme.css` |
| 認証 | GitHub OAuth + JWT（`jsonwebtoken`）+ cookie-parser |
| DB | Azure Cosmos DB（`@azure/cosmos`） |
| AI 問題生成 | GitHub Models API を `openai` SDK 互換クライアントで呼び出し |
| Microsoft Learn 取得 | `@modelcontextprotocol/sdk`（公式 Learn MCP）+ `node-html-parser`（フォールバック） |
| テスト | vitest + supertest |

## 開発

```bash
npm test                        # 全テスト
npm run test:watch              # watch モード
npm test -- spec-coverage       # 網羅性ハーネスのみ
npm run lint / npm run lint:fix # ESLint
```

### 仕様駆動開発

- `docs/superpowers/specs/*.md` が仕様の正本。変更時はまず仕様・テストを更新してから実装を追随させる
- `tests/_harness/spec-coverage.test.mjs` が `services/` `routes/` `middleware/` の全ファイルに対応テストがあるかを自動検証。新規ファイル追加時、対応テスト無しだと赤になる
- 詳細は `docs/TESTING.md` と `CLAUDE.md` を参照

### ディレクトリ構成

```
questara/
├── app.js
├── routes/          # Express ルート
├── services/        # ビジネスロジック
├── middleware/      # 認証・HUD
├── views/           # EJS テンプレート（landing, adventure-map, quiz, ...）
├── public/          # 静的アセット（theme.css）
├── data/            # 資格シード JSON と仮置き progress
├── scripts/         # seed / bulk-import など管理スクリプト
├── tests/           # vitest
└── docs/superpowers/  # 仕様（specs）と実装計画（plans）
```

---

## ライセンス

内部利用 / ローカル開発向け。
