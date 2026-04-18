# 公開SaaS化設計: Microsoft/GitHub認定資格 学習支援サービス

**日付**: 2026-04-16
**ステータス**: レビュー中
**前提**: 旧設計 (`2026-04-16-service-deployment-design.md`) を置き換える

---

## 概要

現在ローカル動作するMicrosoft/GitHub認定資格の学習支援アプリを、一般公開のフリーミアムSaaSとして展開する。Azure Container Apps + Cosmos DB Free Tierによるコスト最適化構成で、スモールスタート（~100ユーザー）から段階的にスケールする。

---

## スコープ

### 含む

- Azure Container Apps (Consumption) へのデプロイ
- SQLite + JSONファイル → Azure Cosmos DB (Free Tier) への移行
- ユーザーによる資格追加機能（Microsoft Learn URL → 自動構造抽出 → AI問題生成）
- 資格の公開/非公開機能（デフォルト非公開）
- 公開資格の閲覧・利用機能
- ランキング機能（週次/月次、資格別）
- 学習計画機能（試験日逆算 → 週次スケジュール自動生成）
- GitHub Actions → ghcr.io → Container Apps のCI/CDパイプライン
- JWT + httpOnly cookieによるセッション管理

### 含まない

- フリーミアムの課金機能（将来検討）
- 無料/プレミアムのユーザー区分（全機能を全ユーザーに提供）
- メール通知・プッシュ通知（リマインドはログイン時のダッシュボード表示のみ）
- Application Insights（初期はContainer Apps組み込みログで運用）
- Microsoft/GitHub以外の資格対応（将来マルチベンダー対応予定）
- カスタムドメイン（初期は `*.azurecontainerapps.io` を使用）

---

## インフラストラクチャ

### Azure構成

```
[ユーザー] → [Azure Container Apps (Consumption)]
                    ↓
              [Express + EJS アプリ]
                    ↓
              [Azure Cosmos DB (Free Tier)]

[GitHub OAuth] ← GitHub API
[GitHub Models] ← ユーザーのGitHubトークン経由
```

### リソース詳細

| リソース | プラン | 用途 |
|----------|--------|------|
| Azure Container Apps | Consumption | アプリホスティング（ゼロスケール対応） |
| Azure Cosmos DB | Free Tier (NoSQL API) | 全データストレージ |
| GitHub Container Registry | Free | Dockerイメージ格納 |

### スケール設定

- min replicas: 0（アイドル時コストゼロ）
- max replicas: 2（初期）
- スケールトリガー: HTTPリクエスト数

### 月額コスト概算（~100ユーザー）

| リソース | コスト |
|----------|--------|
| Container Apps (Consumption) | ¥0（月180,000 vCPU秒無料枠内） |
| Cosmos DB (Free Tier) | ¥0（1,000 RU/s + 25GB無料枠内） |
| GitHub Container Registry | ¥0 |
| **合計** | **¥0/月** |

---

## データモデル（Cosmos DB）

データベース名: `cert-quiz`

### `users` コンテナ — パーティションキー: `/id`

```jsonc
{
  "id": "github-12345",
  "githubId": 12345,
  "username": "nomura-hiroki",
  "displayName": "Hiroki Nomura",
  "avatarUrl": "https://...",
  "email": "...",
  "role": "user",                    // "user" | "admin"
  "githubAccessToken": "encrypted",  // AES-256-GCM暗号化
  "stats": {
    "totalSessions": 42,
    "totalCorrect": 320,
    "totalAnswered": 400,
    "weeklyCorrectRate": 85,
    "monthlyCorrectRate": 80,
    "certStats": {
      "gh-100": { "correctRate": 90, "sessionsCount": 20 }
    }
  },
  "createdAt": "2026-04-16T...",
  "lastLoginAt": "2026-04-16T..."
}
```

### `certifications` コンテナ — パーティションキー: `/id`

```jsonc
{
  "id": "gh-100",
  "name": "GitHub Foundations",
  "studyGuideUrl": "https://learn.microsoft.com/...",
  "createdBy": "system",             // "system" | ユーザーID
  "creatorName": "system",           // 公開時に表示
  "isPublic": false,                 // デフォルト非公開
  "publishedAt": null,
  "usedByCount": 0,
  "domains": [
    {
      "id": "domain-1",
      "name": "Domain 1: ...",
      "weight": 15,
      "generatedAt": null,
      "questions": [
        {
          "id": "gh-100-d1-001",
          "text": "...",
          "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "correctAnswer": "A",
          "explanation": "..."
        }
      ]
    }
  ]
}
```

システム提供の資格（gh-100等）は `createdBy: "system"`, `isPublic: true`。
ユーザー作成の資格はデフォルト `isPublic: false`。ユーザーが明示的に「公開する」操作で `isPublic: true` に変更。

### `sessions` コンテナ — パーティションキー: `/userId`

```jsonc
{
  "id": "uuid",
  "userId": "github-12345",
  "certificationId": "gh-100",
  "mode": "all",                     // "all" | "wrong-only" | "domain"
  "domainFilter": null,
  "answers": [
    { "questionId": "...", "domainId": "...", "isCorrect": true }
  ],
  "score": 80,
  "completedAt": "2026-04-16T..."
}
```

### `studyPlans` コンテナ — パーティションキー: `/userId`

```jsonc
{
  "id": "uuid",
  "userId": "github-12345",
  "certificationId": "gh-100",
  "examDate": "2026-06-01",
  "schedule": [
    {
      "week": 1,
      "domains": ["domain-1", "domain-2"],
      "targetQuestions": 30
    }
  ],
  "createdAt": "2026-04-16T..."
}
```

### 現行データからの移行

| 現行 | 移行先 |
|------|--------|
| `data/certifications/*.json` | `certifications` コンテナ（初期シードデータ） |
| `data/progress.json` | `sessions` コンテナ |
| SQLite `users` テーブル | `users` コンテナ |
| SQLite sessions | JWT + cookie（DB保存不要） |

---

## 新機能設計

### ユーザーによる資格追加

**フロー:**
1. ユーザーがMicrosoft Learnの学習ガイドURLを入力
2. システムがURLをfetch → ドメイン構造（名前・ウェイト）を自動抽出
3. ユーザーが確認・修正 → 保存（`isPublic: false`）
4. ドメインごとに「問題生成」ボタンでAI生成フローを実行（ユーザーのGitHubトークン経由でGitHub Models）

### 資格の公開・共有

- ユーザー作成の資格にはデフォルト非公開で「公開する」ボタンを表示
- 公開すると `isPublic: true` に更新、全ユーザーの公開資格一覧に表示
- 公開資格は作成者名（GitHub username）付きで表示
- 他ユーザーは公開資格を選択してクイズ・統計・学習計画をすべて利用可能
- 作成者はいつでも公開を取り消し可能

### ランキング

- 週次/月次の正答率ランキング（資格別: システム提供 + 公開資格が対象）
- セッション完了時に `users.stats` を更新
- ランキング表示はCosmos DBクエリでソート（~100ユーザーなら十分な性能）
- 週次統計は毎週月曜 00:00 UTC にリセット（全日時はUTC基準）

### 学習計画

**フロー:**
1. ユーザーが資格と試験予定日を選択
2. 残り日数・ドメイン数・ウェイト・正答率から週次スケジュールを自動生成
3. ダッシュボードに「今週やるべきこと」を表示

**優先度計算:**
```
各ドメインの優先度 = weight × (1 - correctRate)
週あたり目標問題数 = 総問題数 / 残り週数（最低10問/週）
```

### リマインド

- 3日以上ログインなし → 次回ログイン時にダッシュボードにリマインドカード表示
- メール/プッシュ通知は初期スコープ外

---

## アプリケーション構成

### ディレクトリ構成（変更後）

```
資格取得/
├── app.js
├── Dockerfile                      # 追加
├── .dockerignore                   # 追加
├── package.json
├── routes/
│   ├── auth.js                     # GitHub OAuth（既存）
│   ├── index.js                    # ホーム + 公開資格一覧（改修）
│   ├── quiz.js                     # クイズ（既存ベース）
│   ├── domains.js                  # ドメイン管理（既存ベース）
│   ├── api.js                      # SSE問題生成（既存ベース）
│   ├── certifications.js           # 追加: 資格CRUD・公開/非公開
│   ├── ranking.js                  # 追加: ランキング
│   └── plans.js                    # 追加: 学習計画
├── services/
│   ├── cosmosService.js            # 追加: Cosmos DB接続・CRUD
│   ├── userService.js              # 改修: SQLite → Cosmos DB
│   ├── progressService.js          # 改修: JSON → Cosmos DB
│   ├── questionService.js          # 改修: JSON → Cosmos DB
│   ├── generationService.js        # 既存ベース（GitHub Models経由を維持）
│   ├── rankingService.js           # 追加: ランキング集計
│   └── planService.js              # 追加: 学習計画生成
├── views/
│   ├── login.ejs                   # 既存
│   ├── index.ejs                   # 改修: 公開資格タブ追加
│   ├── certification.ejs           # 既存ベース
│   ├── quiz.ejs                    # 既存
│   ├── result.ejs                  # 既存
│   ├── domain.ejs                  # 既存
│   ├── review.ejs                  # 既存
│   ├── my-certifications.ejs       # 追加: 自分の資格管理
│   ├── certification-form.ejs      # 追加: 資格作成/編集
│   ├── ranking.ejs                 # 追加
│   ├── plan.ejs                    # 追加: 学習計画
│   └── error.ejs                   # 既存
├── middleware/
│   └── auth.js                     # 既存
└── .github/
    └── workflows/
        └── deploy.yml              # 追加: GitHub Actions CI/CD
```

### レイヤー依存関係

```
routes/ → services/ → cosmosService.js → Cosmos DB
```

- `cosmosService.js` がCosmos DBクライアントの初期化と基本CRUD操作を担当
- 他のサービスは `cosmosService` 経由でDBアクセス
- `@azure/cosmos` を直接importするのは `cosmosService.js` のみ

### Tech Stack変更

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| Runtime | Node.js >= 20 | 同じ |
| Framework | Express 4 + EJS 3 | 同じ |
| AI SDK | @github/copilot-sdk | 同じ（GitHub Models経由を維持） |
| DB | SQLite + JSONファイル | Azure Cosmos DB (NoSQL API) |
| セッション | express-session + SQLite | JWT + httpOnly cookie |
| ホスティング | ローカル | Azure Container Apps (Consumption) |
| CI/CD | なし | GitHub Actions → ghcr.io → Container Apps |
| CSS | Tailwind CDN | 同じ |

### 環境変数

```env
# 既存
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
SESSION_SECRET=xxx

# 追加
COSMOS_ENDPOINT=https://xxx.documents.azure.com:443/
COSMOS_KEY=xxx
COSMOS_DATABASE=cert-quiz
ENCRYPTION_KEY=xxx              # GitHubトークン暗号化用
ADMIN_GITHUB_IDS=12345,67890    # 管理者のGitHub ID
JWT_SECRET=xxx                  # JWT署名用
```

---

## セキュリティ設計

### 認証・認可

- GitHub OAuthを維持（公開サービス、GitHubアカウントがあれば誰でも登録可能）
- セッション: JWT + httpOnly cookie（SameSite=Strict）
- CSRF: SameSite=Strict cookie + csrfトークン
- admin権限: 環境変数 `ADMIN_GITHUB_IDS` で指定

### GitHubトークンの扱い

- AI問題生成時にGitHub Models APIを呼び出すため、OAuthトークンをDBに保存
- `users`コンテナの`githubAccessToken`フィールドにAES-256-GCMで暗号化して格納
- 暗号化キーは環境変数 `ENCRYPTION_KEY`

### データ保護

- Cosmos DB接続キーはContainer Appsのsecretsで管理
- ユーザーデータ削除機能を提供（アカウント削除 → 関連データ全削除）

### 監視・ログ

- Container Apps組み込みのLog Analytics連携
- アプリ内で構造化ログ（JSON形式 `console.log`）
- Application Insightsは初期スコープ外

### バックアップ

- Cosmos DB連続バックアップ（Free Tierに含まれる、7日間保持）

---

## CI/CDパイプライン

```
git push main
  → GitHub Actions
    → npm ci && npm test（将来）
    → Docker build
    → ghcr.io にプッシュ
    → az containerapp update でデプロイ
```

### GitHub Actions ワークフロー概要

1. mainブランチへのpushをトリガー
2. Dockerイメージをビルド
3. ghcr.ioにプッシュ（タグ: `latest` + コミットSHA）
4. Azure CLIでContainer Appsのイメージを更新

---

## 画面一覧

| 画面 | パス | 認証 | 概要 |
|------|------|------|------|
| ログイン | `/auth/login` | 不要 | GitHub OAuthログイン |
| ホーム | `/` | 必要 | システム資格一覧 + 公開資格タブ |
| 資格詳細 | `/certifications/:id` | 必要 | ドメイン別正答率 |
| マイ資格 | `/my/certifications` | 必要 | 自分が作成した資格一覧 |
| 資格作成 | `/my/certifications/new` | 必要 | URL入力 → 構造抽出 |
| ドメイン管理 | `/certifications/:id/domains/:did` | 必要 | 問題一覧 + 再生成 |
| クイズ | `/quiz/:sessionId` | 必要 | 問題解答 |
| 結果 | `/quiz/:sessionId/result` | 必要 | セッション結果 |
| 復習 | `/quiz/:sessionId/review` | 必要 | 間違い復習 |
| ランキング | `/ranking` | 必要 | 週次/月次ランキング |
| 学習計画 | `/plans` | 必要 | 計画一覧 + 作成 |

---

## 未解決事項

なし。すべての設計判断は本ドキュメントで確定済み。
