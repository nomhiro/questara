# 資格取得学習AIエージェント

Microsoft / GitHub認定資格（GH-100, AI-102 等）の学習を支援するローカルWebアプリ。

- **問題を動的に再生成** — 学習ガイドURLをfetchし、GitHub Copilot SDKが問題を自動作成
- **ドメイン別正答率** — 資格の出題ドメインごとに弱点を把握
- **弱点集中練習** — 正答率 < 70% のドメインをワンクリックで再練習

## スクリーンショット

| 資格詳細（ドメイン別正答率） | 問題解答画面 | セッション結果 |
|---|---|---|
| ドメインごとの正答率バー表示 | 4択 + 即時フィードバック | ドメイン別スコアと弱点リンク |

## 前提条件

- Node.js >= 20
- GitHub Copilot CLI がインストール・認証済み（問題再生成機能を使う場合）

## セットアップ

```bash
npm install
npm run dev
# → http://localhost:3000
```

本番起動は `npm start`。

## 使い方

### 学習の流れ

```
ホーム
  └─ 資格を選択
       └─ 資格詳細（ドメイン別正答率を確認）
            ├─ 全問クイズ開始
            ├─ 間違えた問題のみ（累積誤答から出題）
            └─ ドメインを選択
                  ├─ このドメインで練習
                  └─ 問題を再生成（AI生成）
```

### 問題を再生成する

ドメイン管理画面（`/certifications/{id}/domains/{domainId}`）の「**問題を再生成する**」ボタンを押すと：

1. `studyGuideUrl` から学習ガイドのテキストを取得
2. GitHub Copilot SDK でドメインに特化した4択問題を5問生成
3. 生成完了後、`data/certifications/{id}.json` に上書き保存

進捗はリアルタイムで画面に表示されます（SSE）。

## 新しい資格を追加する

`data/certifications/` に JSON ファイルを追加するだけです。

```jsonc
// data/certifications/ai-102.json
{
  "id": "ai-102",
  "name": "Designing and Implementing a Microsoft Azure AI Solution (AI-102)",
  "studyGuideUrl": "https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/ai-102",
  "courseUrl": "https://learn.microsoft.com/ja-jp/training/courses/ai-102t00",
  "domains": [
    {
      "id": "domain-1",
      "name": "Domain 1: Plan and manage an Azure AI solution",
      "weight": 15,
      "generatedAt": null,
      "questions": []  // 空でもOK。再生成ボタンで問題を作成できる
    }
  ]
}
```

サーバー再起動不要で一覧に反映されます。

## データ構造

```
data/
├── certifications/
│   └── gh-100.json   # 問題集（ドメイン構造）
└── progress.json     # 回答履歴（セッション管理）
```

- `progress.json` が回答履歴の唯一の永続化場所です
- シングルユーザー想定のため排他制御はありません
- データをリセットしたい場合は `progress.json` を `{"sessions":[]}` に戻してください

## 問題IDの命名規則

| 種別 | 形式 | 例 |
|---|---|---|
| 手書きシード | `{certId}-{domainId}-{3桁連番}` | `gh-100-d1-001` |
| AI生成 | `{certId}-{domainId}-{3桁連番}-gen` | `gh-100-domain-1-001-gen` |

## 技術スタック

| 用途 | ライブラリ |
|---|---|
| Webサーバー | Express 4 |
| テンプレート | EJS 3 (SSR) |
| スタイル | Tailwind CSS (CDN) |
| AI問題生成 | `@github/copilot-sdk` |
| HTMLパース | `node-html-parser` |
