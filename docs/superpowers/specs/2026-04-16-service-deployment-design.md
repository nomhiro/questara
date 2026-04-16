# サービス化設計: ユーザー登録 + LLM API キー管理

**日付**: 2026-04-16  
**ステータス**: 承認待ち

---

## 概要

現在ローカル・シングルユーザー専用の学習支援ツールを、複数ユーザーが利用できる Web サービスとして展開する。  
各ユーザーが自分の LLM API キー（OpenAI 互換）を登録して問題生成を行い、学習進捗も独立して管理される。

---

## スコープ

### 含む
- ユーザー登録・ログイン・ログアウト（メールアドレス + パスワード）
- LLM API キー設定画面（エンドポイント URL / API キー / モデル名）
- API キーの暗号化保存
- 学習進捗データのユーザー分離
- `@github/copilot-sdk` → `openai` パッケージへの移行
- 全ルートへの認証ガード

### 含まない
- OAuth / ソーシャルログイン
- メール確認・パスワードリセット
- 管理者画面
- 課金・プラン管理
- 複数デバイス間のリアルタイム同期

---

## アーキテクチャ

### 永続化レイヤー

| 用途 | 変更前 | 変更後 |
|------|--------|--------|
| 学習進捗 | `data/progress.json` | SQLite `quiz_sessions` / `session_answers` |
| ユーザー情報 | なし | SQLite `users` |
| LLM 設定 | なし | SQLite `llm_configs` |
| 問題データ | `data/certifications/*.json` | **変更なし**（全ユーザー共有） |

SQLite ファイル: `data/app.db`（`better-sqlite3` 使用）

### データベーススキーマ

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,        -- UUID
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE llm_configs (
  user_id         TEXT PRIMARY KEY REFERENCES users(id),
  endpoint_url    TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  api_key_encrypted TEXT NOT NULL,
  model_name      TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quiz_sessions (
  id              TEXT PRIMARY KEY,   -- UUID
  user_id         TEXT NOT NULL REFERENCES users(id),
  certification_id TEXT NOT NULL,
  mode            TEXT NOT NULL,      -- 'all' | 'wrong-only' | 'domain'
  domain_filter   TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE TABLE session_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL REFERENCES quiz_sessions(id),
  question_id     TEXT NOT NULL,
  domain_id       TEXT NOT NULL,
  selected_answer TEXT NOT NULL,
  is_correct      INTEGER NOT NULL,   -- 0 or 1
  answered_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 新規ファイル構成

```
middleware/
└── auth.js              # requireAuth: 未ログイン → /auth/login にリダイレクト

routes/
├── auth.js              # GET/POST /auth/login, /auth/register, POST /auth/logout
└── settings.js          # GET/POST /settings (LLM API キー管理)

services/
├── dbService.js         # SQLite 接続・初期化（マイグレーション含む）
└── userService.js       # ユーザー CRUD、パスワードハッシュ、LLM 設定管理

views/
├── login.ejs            # ログイン画面
├── register.ejs         # 登録画面
└── settings.ejs         # API キー設定画面
```

### 変更ファイル

| ファイル | 変更内容 |
|--------|---------|
| `app.js` | express-session・認証ルート追加 |
| `services/progressService.js` | JSON ファイル → SQLite、全関数に `userId` 引数追加 |
| `services/generationService.js` | `@github/copilot-sdk` → `openai` パッケージ、ユーザーの LLM 設定を受け取る |
| `routes/index.js` | `req.session.userId` を progressService に渡す |
| `routes/quiz.js` | `req.session.userId` を progressService に渡す |
| `routes/domains.js` | `req.session.userId` を progressService に渡す |
| `routes/api.js` | ユーザーの LLM 設定を取得して generationService に渡す |

---

## セキュリティ設計

### パスワード
- `bcrypt`（saltRounds: 12）でハッシュ化
- 平文は保存しない

### API キー暗号化
- `crypto.createCipheriv` で AES-256-GCM 暗号化
- 暗号化キーは環境変数 `ENCRYPTION_KEY`（32 バイト hex）
- DB には暗号文 + IV + auth tag を結合した文字列を保存

### セッション管理
- `express-session` + `better-sqlite3-session-store`（または `connect-sqlite3`）
- `SESSION_SECRET` 環境変数
- `httpOnly: true`, `sameSite: 'strict'`
- セッション有効期限: 7日

### 環境変数（必須）

```env
SESSION_SECRET=<32文字以上のランダム文字列>
ENCRYPTION_KEY=<64文字の hex 文字列（32 バイト）>
PORT=3000  # optional
```

---

## ユーザーフロー

### 新規登録
1. `/auth/register` でメール・パスワード入力
2. バリデーション: メール形式・パスワード8文字以上・重複チェック
3. パスワードハッシュ化 → `users` テーブルに挿入
4. 自動ログイン → `/settings` にリダイレクト（API キー設定を促す）

### ログイン
1. `/auth/login` でメール・パスワード入力
2. `bcrypt.compare` で検証
3. セッションに `userId` をセット
4. `/` にリダイレクト

### LLM API キー設定
1. `/settings` で以下を入力:
   - エンドポイント URL（デフォルト: `https://api.openai.com/v1`）
   - API キー
   - モデル名（デフォルト: `gpt-4o-mini`）
2. AES-256-GCM で暗号化 → `llm_configs` に upsert
3. 問題生成時に復号して `openai` クライアントに渡す

### 問題生成（変更後）
1. ユーザーの `llm_configs` を取得・復号
2. 未設定の場合は「API キーを設定してください」エラーを SSE で送信
3. `new OpenAI({ baseURL, apiKey })` でクライアント生成
4. `chat.completions.create` でプロンプト送信（既存プロンプトをそのまま流用）

---

## 依存パッケージ変更

### 追加
```json
"bcrypt": "^5.1.1",
"better-sqlite3": "^9.x",
"connect-sqlite3": "^0.9.x",
"express-session": "^1.18.x",
"openai": "^4.x"
```

### 削除
```json
"@github/copilot-sdk": "latest"
```

### 保持
```json
"@modelcontextprotocol/sdk": "^1.29.0",  // Microsoft Learn MCP fetch に引き続き使用
"node-html-parser": "^6.1.13"
```

---

## .gitignore 追加項目

```
data/app.db
data/app.db-shm
data/app.db-wal
.env
```

---

## 移行考慮事項

既存の `data/progress.json` は新システムでは参照されない。  
既存データを SQLite に移行するスクリプトは初回リリースでは提供しない（ローカル学習データのため影響なし）。

---

## 未解決事項（実装時に決定）

- `connect-sqlite3` と `better-sqlite3-session-store` のどちらを使うか（APIの安定性で選択）
- 暗号化キーが未設定の場合のエラーハンドリング（起動時チェック推奨）
