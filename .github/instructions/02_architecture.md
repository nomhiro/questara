---
description: backend,services,data,hooks
alwaysApply: false
---

# ディレクトリ構成

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

## バックエンド(API Routes)

- `routes/index.js` → `services/questionService.js`, `services/progressService.js`
- `routes/quiz.js` → `services/progressService.js`, `services/questionService.js`
- `routes/domains.js` → `services/questionService.js`, `services/progressService.js`
- `routes/api.js` → `services/generationService.js`, `services/questionService.js`

## クライアント

- Tailwind CSS (CDN) のみ使用
- `views/domain.ejs` に SSE を読み取る JS あり (問題生成の進捗表示)

## 依存関係の制約

### レイヤー間の依存関係
- `routes/*` → `services/*` のみ参照 (services 間の直接参照は避ける)
- `services/*` → `data/` ファイル操作のみ

### 依存関係の方向性
routes → services → data files
