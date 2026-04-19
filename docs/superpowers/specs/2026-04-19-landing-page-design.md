# Questara ランディングページ設計 — 2026-04-19

## 背景と目的

本サービス（正式名称: **Questara** / クエスターラ）は現状、`/` にアクセスすると即 `requireAuth` により認証を求め、ログイン済みユーザーを冒険マップに誘導している。未ログインユーザーに対する「このサービスは何か・なぜ作ったか・どう使うか」という説明がなく、GitHub でログインした瞬間に GitHub Models API の rate limit を消費することも明示されていない。加えて、サービス内部では `cert-study-agent` や「資格取得学習エージェント」など複数の開発期の仮称が残っており、ブランド統一ができていない。

このページは以下を達成する:

1. サービスを作った思い（単なる暗記を冒険に／AIで無限に問題生成／弱点ドメインの自動ドリル、そして「みんなで資格取得を楽しむ」）を最初に伝える
2. サービスの機能概要を3ステップ＋主要機能カードで直感的に理解させる
3. GitHub ログインと問題生成時に消費される API 枠の仕組みを**正確に**伝える（Copilot Premium Request ではなく GitHub Models API の rate limit）
4. 既存 RPG トーン（`theme.css`）を踏襲し、ランディングから冒険マップまで世界観を一貫させる

## スコープ

**含む:**
- 新規ビュー `views/landing.ejs` の追加（Questara ブランディング）
- ルーティング再編（`/` をランディングに、冒険マップを `/adventure` に移動）
- `/auth/login` 中継ページの廃止とランディングへの統合
- 既存テストのリダイレクト先期待値更新と、新規ルートのテスト追加
- **Questara へのブランディング統一**:
  - `views/layout.ejs` の「資格取得学習エージェント」「資格学習エージェント」を「Questara」に
  - `package.json` の `name` を `cert-study-agent` → `questara` に
  - 内部識別子（MCP クライアント名・UA 文字列）を `cert-study-agent` → `questara` に
  - Cookie 名を `cert_quiz_session` → `questara_session` に（テスト用は `questara_session_test`）

**含まない:**
- 冒険マップ・既存各画面の機能変更
- `theme.css` の改修
- 多言語化・SEO メタタグ最適化（将来課題）
- Cosmos DB データベース名（`cert-quiz`）の変更 — データマイグレーションが必要なため別作業

**Cookie 名変更の副作用:** 既存ユーザーのログインセッションは全て無効化され、次回アクセス時に再ログインが必要になる。本 PR の適用タイミングで告知すること。

## ルーティング

### 変更後のエンドポイント

| メソッド | パス | 認証 | レスポンス | 備考 |
|---|---|---|---|---|
| GET | `/` | 不要 | `landing.ejs` | 誰でも閲覧可。ログイン済みは CTA 文言切替 |
| GET | `/adventure` | 必要 | `adventure-map.ejs` | 従来の `/` の責務を移動 |
| GET | `/free-mode` | 必要 | `index.ejs` | 既存維持 |
| GET | `/auth/github` | 不要 | リダイレクト → GitHub OAuth | ランディング CTA から直接叩く |
| GET | `/auth/github/callback` | 不要 | 成功時 `/adventure`、失敗時 `/?error=...` | エラーはランディングに戻す |
| POST | `/auth/logout` | - | リダイレクト → `/` | ログアウト後も再動機付けしやすい |
| GET | `/auth/login` | - | **廃止** | UX 観点で中継画面を撤去 |

### `/auth/login` 廃止の理由（UX観点）

中継画面を置くと動線は次のようになる。

```
/ (ランディングCTAクリック) → /auth/login → (もう一度ボタンクリック) → GitHub OAuth
```

以下の点で UX として望ましくない。

- **認知負荷**: CTA を押したら即 GitHub に飛ぶと期待している。中継画面でまた押すのは「押したのに進まなかった」印象を与える
- **クリック数増加**: ログイン完了までのステップが1つ増え、CVR が下がる
- **情報密度**: 中継画面（`views/login.ejs`）は「GitHub でログイン」ボタンと2行の説明のみ。ランディングに既に含まれる内容であり独立ページにする意味がない
- **ログアウト後の空白感**: ログアウト時にこの空白画面に着地すると「このサービスは何だったか」を再確認する手段がない。ランディングに戻せば世界観とサービス価値を再提示できる
- **エラー文脈**: OAuth エラー時、空白の `/auth/login` でエラーだけ見せるより、サービス説明と一緒に「ログインに失敗しました」と表示する方が次のアクションに繋がる

よってランディングに完全統合し、`/auth/login` を撤去する。

### ログイン済みユーザーが `/` に来たときの挙動

自動リダイレクトせず、ランディングを見せる。理由:

- 自分のサービスを人に紹介するとき「まず `/` を見せたい」場面が想定される
- HUD でログイン状態は視認できるため混乱は起きない
- CTA 文言を「▶ 冒険を再開する」に切り替えることで既ログインユーザーを適切な次画面（`/adventure`）へ導ける

## ビュー設計 — `views/landing.ejs`

既存 `theme.css` の RPG トーンを踏襲し、以下5ブロックで構成する。

### Hero セクション

**ブランディング:** サービス名は **Questara**（読み: クエスターラ）。語源は Quest + ラテン的女性形語尾 -ara で、RPG ファンタジーの荘厳さと「探求」のニュアンスを両立。

- メインタイトル: `rpg-title` クラス（DotGothic16）で「⚔ Questara ⚔」
- 読み仮名: 「クエスターラ」を小さく（14px, gold, タイトル直下）
- 装飾的タグラインは採用しない（過剰な比喩は避ける方針）
- 説明: 「Microsoft / GitHub 認定資格の学習を、みんなで冒険として楽しめる学習エージェント。」
- ログイン状態の判定は `res.locals.userEmail` の有無で行う（既存 HUD と同じ判定軸）
- CTA ボタン（`rpg-btn is-gold`）:
  - 未ログイン: 「⚔ GitHubでログインして始める」→ `/auth/github`
  - ログイン済み: 「▶ 冒険を再開する」→ `/adventure`
- `?error=<key>` クエリがある場合、CTA 上部に `rpg-window` 風のエラーバナーを表示
- 許容するエラーキー: `auth_failed`（OAuth認可失敗）・`no_code`（code欠落）・`token_failed`（アクセストークン取得失敗）。不明なキーは無視

### Why（思い）セクション
3カードを並置。各カードは `rpg-window` クラス。

1. 🗡 **冒険として学ぶ** — 単なる暗記ではなく、ドメインを攻略する冒険として資格学習を楽しむ
2. ✨ **AIで無限に問題生成** — Microsoft Learn の学習ガイドを元に AI が実務的な4択問題を生成。何度でも挑める
3. 📊 **弱点を自動ドリル** — 正答率 70% 未満のドメインをワンクリックで再練習。苦手を可視化して潰す

加えて、セクション下部に一文でユーザーの思いを添える: 「みんなで資格取得を通して、学びを楽しめるように」

### 3ステップで始めるセクション
横並び3カード（モバイルは縦）。アイコン＋短文のみ。

1. **🔑 GitHubでログイン** — 認証と問題生成API設定を自動で済ませます
2. **📚 資格を選ぶ** — GH-100・AI-102 など公開資格から選択、または独自資格を追加
3. **⚔ 冒険スタート** — 各ドメインを攻略し、弱点を潰して合格ラインへ

### 仕組み（透明性）セクション
本サービスの AI 利用について正確に説明する。

> 本サービスは問題生成に **GitHub Models API**（既定モデル: `gpt-4o-mini`）を使います。
> GitHub アカウントでログインするとご自身のアクセストークンが API 呼び出しに使われ、
> お使いの GitHub Copilot プランに紐づく **rate limit（1分 / 1日あたりのリクエスト数）** を消費します。
> 問題生成1回 = LLM呼び出し1回です。無料プランでも試せますが、頻繁に問題を再生成するとプラン上限に達することがあります。
>
> - プラン別のレート制限一覧: [GitHub Models ドキュメント](https://docs.github.com/en/github-models)
> - Copilot プランの比較: [GitHub Copilot plans & pricing](https://github.com/features/copilot/plans)

**表現ルール**: 「Premium Request」という語は使わない（本サービスはそれを消費しないため）。

### CTA 再掲セクション
- 見出し: 「さあ、学びの冒険へ」
- CTA ボタン再掲（Hero と同ロジック）
- 直下に小さな注意書き: 「※ ログインと問題生成で GitHub Models API の rate limit を消費します」

## デザイン方針

- 既存 `theme.css` のクラスのみ使用。新規 CSS ファイルは作らない
- 見出しは `rpg-title`（DotGothic16）、本文は M PLUS 1 Code
- セクションは `rpg-window` / `rpg-window is-open` で囲む
- CTA は `rpg-btn is-gold`
- レスポンシブは Tailwind（CDN）の `sm:` / `md:` breakpoint で2〜3カラム→1カラム
- カラーは既存 CSS 変数（`--gold`, `--ink`, `--crimson`）を参照

## 実装影響範囲

| 種別 | ファイル | 変更内容 |
|---|---|---|
| 新規 | `views/landing.ejs` | ランディング本体。`?error` クエリを受けてバナー表示、ログイン状態で CTA 切替 |
| 削除 | `views/login.ejs` | `/auth/login` 廃止に伴い削除 |
| 変更 | `routes/index.js` | `GET /` を `landing.ejs` レンダリングに変更（認証不要化）。`GET /adventure` を新設し現行 `/` の冒険マップ責務を移動 |
| 変更 | `routes/auth.js` | `GET /auth/login` ハンドラ削除。コールバック成功時リダイレクト先を `/` → `/adventure` に変更。コールバック失敗時リダイレクト先を `/?error=...` に変更。ログアウト後リダイレクトを `/` に変更 |
| 変更 | `middleware/auth.js` | 未認証リダイレクト先を `/auth/login` → `/` に変更 |
| 変更 | `tests/routes.auth.test.mjs` | `GET /auth/login` のテスト削除。ログアウトリダイレクト先を `/` に更新。OAuth エラー時のリダイレクト先期待値を `/?error=...` パターンに更新 |
| 変更 | `tests/middleware.hud.test.mjs` | 未認証リダイレクト先期待値を `/` に更新 |
| 変更 | `tests/routes.profile.test.mjs` | 未認証リダイレクト先期待値を `/` に更新 |
| 新規/変更 | `tests/routes.index.test.mjs` | `GET /` を未認証・認証済み両方でテスト（200 応答、CTA 切替、エラーバナー表示）。`GET /adventure` を新設してテスト |
| 変更 | `views/partials/hud.ejs` ほか HUD の「ホーム」リンク箇所 | `href="/"` を `href="/adventure"` に変更（ログイン後ユーザーの「ホーム」は冒険マップのため） |
| 変更 | `views/layout.ejs` | `<title>` と HUD ヘッダーの「資格取得学習エージェント」「資格学習エージェント」を `Questara` に |
| 変更 | `package.json` / `package-lock.json` | `name: cert-study-agent` → `name: questara`（`description` も日本語で「Questara — 資格取得を冒険として楽しむ学習エージェント」相当に更新） |
| 変更 | `services/certificationParser.js`, `services/mcpClient.js`, `services/generationService.js` | 内部文字列 `cert-study-agent`（MCP Client name, UA）を `questara` に |
| 変更 | `services/jwtService.js` | `COOKIE_NAME` のデフォルト値 `cert_quiz_session` → `questara_session` |
| 変更 | `.env.example` / `.env.test` | `JWT_COOKIE_NAME` を `questara_session` / `questara_session_test` に |
| 変更 | `tests/routes.auth.test.mjs` | cookie クリア後のマッチ `cert_quiz_session_test=;` を `questara_session_test=;` に |

### レイヤー間の依存関係確認

既存の `routes → services → data` の方向は維持。ランディングはサービス層を呼ばない（ログイン状態の判定のみで、`res.locals.userEmail` や `req.user` の有無を見る）。冒険マップを移動する `/adventure` は従来 `/` と同等の service 呼び出しを行う。

## テスト方針

`tests/_harness/spec-coverage.test.mjs` により新規/既存ファイルへのテスト存在がチェックされるため、以下のケースを少なくともカバーする。

- `GET /` 未認証でも 200、`landing.ejs` をレンダリング、`/adventure` へのリンクは出ない（または無効化）
- `GET /` ログイン済みでも 200、CTA が「▶ 冒険を再開する」に切り替わる
- `GET /?error=xxx` でエラーバナーが出る
- `GET /adventure` 未認証は `/` にリダイレクト（`/auth/login` ではない）
- `GET /adventure` ログイン済みは 200、`adventure-map.ejs` をレンダリング
- `POST /auth/logout` のリダイレクト先が `/` であること
- `GET /auth/github/callback` で code 欠落時のリダイレクト先が `/?error=...` パターンであること

## 段階的実装の推奨順序

1. `/adventure` ルート追加と冒険マップ移動（既存テストは `/` → `/adventure` に書き換え）
2. ランディング `views/landing.ejs` を作成し `GET /` をそれに差し替え（未認証で 200 になるよう `requireAuth` を外す）
3. HUD の「ホーム」リンクを `/adventure` に書き換え
4. `middleware/auth.js` の未認証リダイレクト先を `/` に変更
5. `routes/auth.js` のコールバックエラーとログアウトのリダイレクト先を変更、`GET /auth/login` を削除、`views/login.ejs` を削除
6. 全テスト更新（リダイレクト先期待値、新ケース追加）

各ステップで `npm test` を通してから次へ進む。

## 既知のリスクと緩和

| リスク | 緩和策 |
|---|---|
| ブックマーク・外部からの `/auth/login` 直リンクが切れる | `GET /auth/login` を `/` への 301 リダイレクトとして残す（ハンドラ本体は `res.redirect(301, '/')` の1行のみ）。将来的にアクセスログで利用実績がゼロになったら完全削除を検討 |
| ログイン済みユーザーが `/` を踏んで「何このサービス？」と戸惑う | HUD をランディングでも表示し、ログイン中であることを明示。CTA 文言を「冒険を再開する」に切替 |
| OAuth エラー時にクエリパラメータでエラーメッセージを渡すと長文が URL に出る | メッセージは短い固定キー（`auth_failed`・`no_code` 等）にして、ランディング側でキーからユーザー向け文言を引く |
