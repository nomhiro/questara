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

Microsoft/GitHub認定資格（GH-100, AI-102 等）の学習を支援するローカルWebアプリ。
Node.js + Express + EJS による SSR。`@github/copilot-sdk` を使ってドメイン別に問題を動的生成する。

### 主な機能

1. **複数資格対応** - `data/certifications/{id}.json` を追加するだけで新しい資格を管理
2. **ドメイン別問題管理** - 問題は学習ガイドのドメイン単位で格納・再生成できる
3. **AI問題再生成** - WebUI から「問題を再生成」→ 学習ガイドURLを fetch → Copilot SDK で問題生成
4. **クイズモード** - 全問 / 間違えた問題のみ / ドメイン指定
5. **即時フィードバック** - 回答後に正誤と解説を表示
6. **ドメイン別統計** - セッション結果・資格詳細でドメインごとの正答率を可視化
7. **弱点ドリル** - 正答率 < 70% のドメインをワンクリックで再練習

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

### ディレクトリ構成

```
資格取得/
├── app.js                          # Expressサーバー エントリポイント
├── package.json
├── routes/
│   ├── index.js                    # GET / (ホーム), GET /certifications/:certId
│   ├── quiz.js                     # POST /quiz/start, GET /quiz/:sessionId, POST /quiz/:sessionId/answer
│   │                               # GET /quiz/:sessionId/result, GET /quiz/:sessionId/review
│   ├── domains.js                  # GET /certifications/:certId/domains/:domainId
│   └── api.js                      # POST /api/certifications/:certId/domains/:domainId/generate (SSE)
├── services/
│   ├── progressService.js          # セッション作成・回答記録・統計計算
│   ├── questionService.js          # 問題の読み書き・フィルタリング
│   └── generationService.js        # URLフェッチ + Copilot SDK による問題生成
├── views/                          # EJS テンプレート
│   ├── index.ejs                   # ホーム (資格一覧)
│   ├── certification.ejs           # 資格詳細 (ドメイン別正答率)
│   ├── quiz.ejs                    # 問題解答画面
│   ├── result.ejs                  # セッション結果
│   ├── domain.ejs                  # ドメイン管理 (再生成 + 問題一覧)
│   ├── review.ejs                  # 間違い復習
│   └── error.ejs                   # エラー画面
├── data/
│   ├── certifications/
│   │   └── gh-100.json             # 資格ごとの問題集 (ドメイン構造)
│   └── progress.json               # 回答履歴 (セッションベース)
└── .github/instructions/           # Copilot コンテキストファイル
```

### レイヤー間の依存関係

- `routes/*` → `services/*` のみ参照 (services 間の直接参照は避ける)
- `services/*` → `data/` ファイル操作のみ
- 方向: routes → services → data files

### サービス層

- `progressService.js` — `data/progress.json` の読み書き・セッション管理・統計計算
- `questionService.js` — `data/certifications/{id}.json` の読み書き・問題フィルタリング
- `generationService.js` — Microsoft Learn ページの fetch + Copilot SDK による問題生成

### ビュー層

EJSテンプレート。共通レイアウトはなく、各ファイルが完全なHTMLを持つ。

## Tech Stack

- **Runtime**: Node.js >= 20
- **Framework**: Express 4
- **Template engine**: EJS 3 (Server-Side Rendering)
- **AI SDK**: `@github/copilot-sdk` — Copilot CLI を JSON-RPC で呼び出して問題生成
- **HTML parsing**: `node-html-parser` — Microsoft Learn ページのスクレイピング
- **Storage**: JSON ファイル (`data/progress.json`, `data/certifications/*.json`)
- **CSS**: Tailwind CSS (CDN読み込み、カスタムCSSなし)
- セッションIDは `crypto.randomUUID()` を使用

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

### クイズフローの状態管理

セッションストアを使わず、問題順序はクエリパラメータ `?questions=id1,id2,...&idx=0` で管理する。
回答送信ごとに `idx` をインクリメントして同じURLパターンにリダイレクトする。

### 問題生成フロー (generationService.js)

1. `cert.studyGuideUrl` を `fetch` → `node-html-parser` でテキスト抽出
2. ドメイン名キーワードで前後2500文字を切り出してプロンプトに埋め込む
3. `CopilotClient` + `CopilotSession.sendAndWait()` で問題JSON を生成（タイムアウト120秒）
4. レスポンスから `[...]` をregexで抽出してパース → `questionService.replaceDomainQuestions()` で保存
5. 呼び出し元の `routes/api.js` が SSE で進捗をクライアントにストリーミング
