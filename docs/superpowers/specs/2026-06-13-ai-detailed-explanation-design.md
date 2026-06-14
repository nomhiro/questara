# 「AIに詳しく聞く」機能 設計（2026-06-13）

## 背景・課題

クイズ回答後・復習画面では、問題に固定で紐づく `explanation` テキストしか表示されない。学習者は「なぜこの選択肢が正解／不正解なのか」をより深く、かつ**公式 Microsoft Learn の最新情報に基づいて**知りたいことがある。

そこで「🔍 AIに詳しく聞く」ボタンを追加し、押下時に LLM が Microsoft Learn MCP で関連する公式ドキュメントを取得（グラウンディング）し、その問題に特化した深掘り解説をワンショット生成して表示する。

必要な配管（MCP・GitHub Models LLM・SSE・認証・問題特定情報）は問題生成機能で実証済みであり、新規配管はほぼ不要。既存パターンの組み合わせで実装する。

## 決定事項

| # | 決定 | 理由 |
|---|------|------|
| D1 | 機能はワンショット（対話チャットではない）。1 リクエストで深掘り解説を完結させる | スコープを絞り、既存 SSE 基盤で最短実装 |
| D2 | 表示は `views/quiz.ejs` の回答後 `explanationBox` 内 ＋ `views/review.ejs` の各復習カード。**回答前には出さない** | 回答前の詳細解説は正解漏洩になるため |
| D3 | モデルは既定 `openai/gpt-4.1`（`GENERATION_DEFAULT_MODEL`）固定。UI にモデルピッカーは付けない | UX を単純に保つ。問題生成と違い随時の調整は不要 |
| D4 | 生成結果は Cosmos に永続化しない。クライアントが取得済み結果を DOM 保持し、ボタン再クリックは表示トグルのみ（再フェッチしない） | 「最新情報」が価値のため毎回フレッシュ取得。スキーマ変更を避ける |
| D5 | LLM レスポンスは**構造化 JSON**（`summary` / `whyCorrect` / `whyIncorrect` / `deepDive` / `references`）。クライアントは固定テンプレートに `textContent` で描画し、`references` は `https://` のみ `<a>` 化 | 任意 markdown の innerHTML を避け XSS を排除（CLAUDE.md のセキュリティ方針） |
| D6 | MCP 検索（`callLearnSearch`）失敗時は graceful に参考資料なしで生成継続。JSON 抽出失敗時は `summary` に生テキストを入れて返す | 既存 `fetchSearchContext` と同じ degradation 方針 |
| D7 | LLM 呼び出しの `temperature` 等は送らない。エラーは `generationService.mapLlmError` を再利用して利用者向けに変換 | 既存 LLM 呼び出し規約と統一 |

## アーキテクチャ

```
views/quiz.ejs / views/review.ejs（🔍 AIに詳しく聞く ボタン）
  → POST /api/certifications/:certId/domains/:domainId/questions/:questionId/explain（SSE）
      routes/api.js（requireAuth → cert/domain/question 検証 → トークン取得 → initSse）
        explainService.explainQuestion({ cert, domain, question, llmConfig, onProgress })
          ├─ mcpClient.callLearnSearch()         … 公式ドキュメント検索（失敗時は空）
          ├─ llmClient.createLlmClient() + chat.completions.create()  … 深掘り解説生成
          ├─ llmClient.extractJsonObject() + 形状検証 + references フィルタ
          └─ return 構造化オブジェクト
  ← SSE: progress（検索中→生成中）→ done({ explanation }) / error({ message })
  → views/partials/ask-ai.ejs の renderExplanation() が安全に DOM 描画
```

既存の問題生成フロー（`/generate` → `generationService`）と完全に同型。

### 新規ファイル

| ファイル | 責務 |
|---|---|
| `services/explainService.js` | 1 問の深掘り解説を公式ドキュメントにグラウンディングして生成する |
| `views/partials/ask-ai.ejs` | クライアント JS（SSE 読取・安全な構造化描画・取得キャッシュ）を集約 |

### 変更ファイル

| ファイル | 変更 |
|---|---|
| `routes/api.js` | `POST .../questions/:questionId/explain`（SSE）エンドポイント追加 |
| `views/quiz.ejs` | `explanationBox` 内にボタン＋結果コンテナ＋`partials/ask-ai` include |
| `views/review.ejs` | 各復習カードにボタン＋結果コンテナ＋`partials/ask-ai` include |

### レスポンススキーマ（SSE `done` の `explanation`）

```jsonc
{
  "summary": "この問題が問うている要点（1〜2文）",
  "whyCorrect": "正解が正しい理由（公式仕様の具体的な機能名・設定名を伴う）",
  "whyIncorrect": { "B": "なぜ要件に合わないか", "C": "...", "D": "..." },
  "deepDive": "関連概念・背景の補足説明",
  "references": [ { "title": "...", "url": "https://learn.microsoft.com/..." } ]
}
```

## テスト（仕様の実行可能スナップショット）

- `tests/explainService.test.mjs`（unit, `mcpClient`/OpenAI モック）
  - 検索結果を参考資料に含めて LLM を呼ぶ
  - JSON をパースし構造化結果を返す
  - `references` が `https://` 以外を除外し重複排除する
  - 検索 throw 時も解説生成を継続（graceful）
  - `unavailable_model` 時に `mapLlmError` のメッセージを投げる
  - JSON 抽出失敗時は `summary` へフォールバック
- `tests/routes.api.test.mjs`（integration 追記）
  - 未認証 302 / 不明な cert・question で 404 / トークン無しで 400 / 成功時 `progress`→`done` を流す / 失敗時 `error`
- `tests/views.test.mjs`（smoke 追記）
  - `quiz.ejs`・`review.ejs` がボタン込みでレンダーされる

## 検証ゲート

- `npm run lint` / `npm test`（網羅性ハーネス含む）が緑
- `npm run dev` で手動 E2E: 回答 → ボタン → 進捗 → 構造化解説（公式リンク付き）→ 再クリックでトグル → 復習画面でも同様
