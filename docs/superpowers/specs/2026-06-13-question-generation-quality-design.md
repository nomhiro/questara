# 問題生成の品質改善 設計（2026-06-13）

## 背景・課題

AI 問題生成（`generationService`）の出力品質が低い。具体的な症状:

1. **不正確・ハルシネーション** — 学習ガイドに無い機能・仕様を出題する、正解が誤っている
2. **簡単すぎる・表面的** — 用語暗記レベルが多く、実試験のようなシナリオ型・判断型の難問が少ない
3. **複数選択（複数正解）問題が無い** — 実試験には「すべて選択」形式があるが未対応

### 原因分析（現状実装）

- コンテキスト取得が `indexOf` による素朴な切り出し（前後 4000 文字）。ドメイン名が本文に
  一致しないと**ページ先頭 4000 文字だけ**になる。`mcpClient.callLearnSearch`
  （ドメイン特化検索）は問題生成では未使用
- モデルが `gpt-4o-mini`（小型）固定。旧エンドポイント `models.inference.ai.azure.com` 使用
- 1 回の LLM 呼び出しのみで、レビュー（自己校閲）工程が無い
- 生成結果の機械検証が無い（正解キーの妥当性・選択肢数・解説有無・重複チェックすべて無し）

## 決定事項

| # | 決定 | 理由 |
|---|------|------|
| D1 | GitHub Models の新エンドポイント `https://models.github.ai/inference` へ移行。モデル ID は `{publisher}/{model}` 形式（例 `openai/gpt-5`） | gpt-5 系は新エンドポイントのみ。OpenAI SDK 互換 |
| D2 | 問題生成のデフォルトモデルは `openai/gpt-5`、補助タスク（資格抽出・アドベンチャー生成）は `openai/gpt-5-mini` | 品質最優先の生成は gpt-5、頻度の高い補助は mini でレート制限を回避 |
| D3 | モデル一覧はカタログ API `GET https://models.github.ai/catalog/models` から動的取得し、ドメインページの UI で選択可能にする | モデルは随時更新されるため静的リストにしない。失敗時は静的フォールバック |
| D4 | gpt-5 系は `temperature` 非対応のため、全 LLM 呼び出しから `temperature` を削除する | API エラー回避 |
| D5 | グラウンディング強化: ①Markdown 見出しベースのドメインセクション抽出、②`microsoft_docs_search`（callLearnSearch）でドメイン特化資料を追加取得、③コンテキスト上限 4000→8000 文字 | ハルシネーションの根本原因（薄い参照資料）への対策 |
| D6 | 生成→**レビューパス**（第2 LLM 呼び出しで参考資料と照合し修正/除外）→**機械検証**（questionValidator）の 3 段パイプライン | 不正確問題の流出防止。レビュー失敗時は原案を使用（graceful degradation） |
| D7 | プロンプト刷新: 難易度分布 basic 2 / applied 5 / analytical 3、シナリオ要件、複数選択 2〜3 問、誤答肢品質基準、既存問題リストによる重複回避 | 「簡単すぎる」「難問が少ない」への対策 |
| D8 | 複数選択対応: 問題スキーマに `type: "single"\|"multiple"` と `correctAnswers: ["A","C"]` を追加。`correctAnswer`（先頭の正解）は後方互換のため維持 | 既存データ（correctAnswer のみ）を壊さない |
| D9 | 採点は現行どおりクライアント側。複数選択はトグル選択 + 「回答する」ボタンで集合一致判定。`selectedAnswer` は `"A,C"` 形式 | 既存のクイズフロー（answer POST の形）を変えない |

## リスクと検証ゲート

**最重要リスク**: 新エンドポイント（inference / catalog）は `models:read` 権限を要求する。
GitHub OAuth App のアクセストークンで通るかは未確認。
→ **Task 1 でスパイクスクリプトを実行して検証する。失敗した場合は実装を中断し報告する**
（その場合の代替案: fine-grained PAT のユーザー登録機能を別途設計する）。

## アーキテクチャ

```
routes/api.js
  ├─ GET  /api/models                 … modelCatalogService.listModels（10分キャッシュ）
  └─ POST /api/.../generate           … body.model（形式検証）→ generationService
        generationService.generateQuestions
          ├─ fetchContentForDomain    … MCP fetch → 見出し抽出 → indexOf fallback
          ├─ fetchSearchContext       … callLearnSearch 上位3件（失敗時は空）
          ├─ LLM 呼び出し #1（生成）
          ├─ LLM 呼び出し #2（レビュー: 修正/除外、失敗時は原案）
          ├─ normalizeQuestions       … type / correctAnswers / id 採番
          └─ questionValidator.validateQuestions … 機械検証で不正問題を除外
```

### 新規ファイル

| ファイル | 責務 |
|---|---|
| `services/modelCatalogService.js` | GitHub Models カタログ取得・チャットモデル抽出・ソート・キャッシュ・フォールバック |
| `services/questionValidator.js` | 生成問題の機械検証（選択肢 4 つ / 正解キー妥当 / 解説長 / 重複） |
| `scripts/check-models-api.js` | スパイク: OAuth トークンで catalog + inference の疎通確認 |

### 変更ファイル

| ファイル | 変更 |
|---|---|
| `services/llmClient.js` | エンドポイント・デフォルトモデル定数を新 API に更新。`GENERATION_DEFAULT_MODEL` 追加 |
| `services/generationService.js` | グラウンディング強化・プロンプト刷新・レビューパス・検証統合。純粋関数をエクスポートしてテスト可能に |
| `services/certificationParser.js` / `services/adventureGeneratorService.js` | `temperature` 削除のみ |
| `routes/api.js` | `GET /api/models` 追加、generate の `model` パラメータ受付 |
| `views/domain.ejs` | モデル選択ドロップダウン、正解表示の複数対応 |
| `views/quiz.ejs` | 複数選択 UI（トグル + 回答ボタン）と集合一致採点 |
| `views/review.ejs` | 正解表示の複数対応 |
| `services/questionService.js` | `getCorrectAnswers(q)` 正規化ヘルパー追加 |
| `tests/_harness/spec-coverage.test.mjs` | generationService の ALLOWED_UNTESTED 除去（テスト追加に伴い） |
| `CLAUDE.md` | モデル/エンドポイント/スキーマ記述の更新 |

## データ構造（問題スキーマの拡張）

```jsonc
{
  "id": "gh-100-domain-1-001-gen",
  "question": "...（複数選択の場合は末尾に「（該当するものをすべて選択してください）」）",
  "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "type": "single",            // NEW: "single" | "multiple"。省略時は single 扱い
  "correctAnswers": ["A"],     // NEW: 正解キー配列（multiple は 2〜3 個）
  "correctAnswer": "A",        // 維持: correctAnswers[0]。既存データ・既存表示の後方互換
  "explanation": "...",
  "difficulty": "basic",       // "basic" | "applied" | "analytical"
  "tags": ["..."]
}
```

- 既存データ（`correctAnswer` のみ）は `getCorrectAnswers(q)` で `["A"]` に正規化して扱う
- `sessions.answers[].selectedAnswer` は複数選択時 `"A,C"`（ソート済みカンマ結合）

## エラーハンドリング

- カタログ取得失敗 → 静的フォールバックモデル一覧を返す（UI は常に動く）
- `callLearnSearch` 失敗 → 空文字（追加ソース扱いなので無視）
- レビューパス失敗 → 原案をそのまま検証へ（console.warn）
- 機械検証で全問除外 → `Error('検証を通過した問題がありません。再度お試しください。')` → SSE error
- `model` パラメータ不正形式 → 400

## テスト方針

- 新規 service 2 つ（modelCatalog / questionValidator）は unit テスト必須（spec-coverage ハーネス）
- `generationService` は純粋関数（`extractDomainSection` / `normalizeQuestions` / `buildPrompt`）を
  エクスポートして unit テストし、ALLOWED_UNTESTED から除去する（LLM/MCP 呼び出し部は対象外のまま）
- `routes/api.js` は既存のスパイ方式（モジュール関数の差し替え）で `GET /api/models` と
  `model` パラメータ検証を追加テスト
- `views.test.mjs` に複数選択問題のレンダリングテストを追加

## スコープ外

- fine-grained PAT の登録機能（スパイク失敗時に別途設計）
- シードデータ（`data/certifications/*.json`）への複数選択問題追加
- サーバーサイド採点への移行
