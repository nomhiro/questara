## 基本行動指針
- **日本語対応**: すべての回答を日本語で行うこと。
- **簡潔性**: 挨拶や過剰な丁寧語（「恐れ入りますが」「よろしければ」等）は省略し、情報の密度を高めること。
- **安全性**: セキュリティリスクのあるコード（SQLインジェクション、XSS等）は絶対に提案しないこと。
- **品質**: 可読性が高く、保守しやすいコード（Clean Code）を優先すること。

## プロセス
- 実装前に必ず要件を確認し、不明点があれば質問すること。
- 複雑なロジックは、擬似コードやステップごとの解説を行ってから実装コードを提示すること。

## ドメイン知識の参照
詳細なコンテキストが必要な場合は、`.github/instructions/` 配下の以下のファイルを参照するよう指示があります。適宜これらを読み込んで回答の精度を高めてください。

- `01_project_overview.md`: プロジェクト概要
- `02_architecture.md`: アーキテクチャ
- `03_tech_stack.md`: 技術スタック
- `04_coding_principles.md`: コーディング原則
- `05_design_settings.md`: デザイン設定・トークン
- `06_git_rules.md`: Gitコミットルール
- `07_testing.md`: テスト手法・戦略
- `08_comment_driven.md`: コメント駆動開発ガイドライン
- `09_security_rules.md`: セキュリティガイドライン

---

## サービス概要

Microsoft/GitHub認定資格（GH-100, AI-102 等）の学習を支援するローカルWebアプリ。
Node.js + Express + EJS による SSR。`@github/copilot-sdk` を使ってドメイン別に問題を動的生成する。

## 開発コマンド

```bash
npm run dev    # node --watch app.js でホットリロード起動 (http://localhost:3000)
npm start      # 本番起動
```

テストは存在しない。動作確認はブラウザまたは `Invoke-WebRequest` で行う。

## アーキテクチャ

```
routes/ → services/ → data/*.json
```

- **routes/**: リクエスト受付・バリデーション・EJSレンダリング。ビジネスロジックは持たない
- **services/**: 3つのサービスが全ロジックを担当
  - `progressService.js` — `data/progress.json` の読み書き・セッション管理・統計計算
  - `questionService.js` — `data/certifications/{id}.json` の読み書き・問題フィルタリング
  - `generationService.js` — Microsoft Learn ページの fetch + Copilot SDK による問題生成
- **views/**: EJSテンプレート。共通レイアウトはなく、各ファイルが完全なHTMLを持つ
- **data/**: 唯一の永続化層。排他制御なし（シングルユーザー想定）

### 問題生成フロー (generationService.js)
1. `cert.studyGuideUrl` を `fetch` → `node-html-parser` でテキスト抽出
2. ドメイン名キーワードで前後2500文字を切り出してプロンプトに埋め込む
3. `CopilotClient` + `CopilotSession.sendAndWait()` で問題JSON を生成（タイムアウト120秒）
4. レスポンスから `[...]` をregexで抽出してパース → `questionService.replaceDomainQuestions()` で保存
5. 呼び出し元の `routes/api.js` が SSE で進捗をクライアントにストリーミング

### クイズフローの状態管理
セッションストアを使わず、問題順序はクエリパラメータ `?questions=id1,id2,...&idx=0` で管理する。
回答送信ごとに `idx` をインクリメントして同じURLパターンにリダイレクトする。

## データ構造

### 問題集 `data/certifications/{id}.json`
```jsonc
{
  "id": "gh-100",
  "studyGuideUrl": "https://learn.microsoft.com/...",
  "domains": [
    {
      "id": "domain-1",           // "domain-N" 形式
      "name": "Domain 1: ...",
      "weight": 15,               // 試験ウェイト(%)
      "generatedAt": null,        // AI生成時にISO8601で更新
      "questions": [
        {
          "id": "gh-100-d1-001",  // {certId}-{domainId}-{3桁連番}
          "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "correctAnswer": "A",
          "explanation": "..."
        }
      ]
    }
  ]
}
```

AI生成問題のIDは末尾に `-gen` が付く: `gh-100-domain-1-001-gen`

### 進捗データ `data/progress.json`
```jsonc
{
  "sessions": [{
    "id": "uuid",
    "certificationId": "gh-100",
    "mode": "all | wrong-only | domain",
    "domainFilter": "domain-1 | null",
    "answers": [{ "questionId": "...", "domainId": "...", "isCorrect": true }]
  }]
}
```

`getWrongQuestionIds()` は「一度でも正解した問題は除外」するロジック（累積セッション横断）。

## 主要な実装パターン

### 新しい資格の追加
`data/certifications/{新ID}.json` を上記スキーマで作成するだけ。コード変更不要。

### EJSビューへ渡す変数
各routeのrender呼び出し時に必要な変数をすべて渡す。共有レイアウトなし・グローバル変数なし。

### SSEエンドポイント (`routes/api.js`)
```js
res.setHeader('Content-Type', 'text/event-stream');
res.flushHeaders();
res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
// 最後に event: done または event: error を送信して res.end()
```
クライアント側 (`views/domain.ejs` のインラインscript) が `ReadableStream` でこれを読む。

### Tailwind CSS
CDN (`https://cdn.tailwindcss.com`) のみ使用。カスタムCSSファイルは存在しない。
合格ライン判定は `rate >= 70` で統一（緑/赤の分岐）。