---
description: 技術スタック
alwaysApply: false
---

# Tech Stack

## Core
- **Runtime**: Node.js >= 20
- **Entry point**: `app.js`

## Backend / API
- **Framework**: Express 4
- **Template engine**: EJS 3 (Server-Side Rendering)
- **AI SDK**: `@github/copilot-sdk` — Copilot CLI を JSON-RPC で呼び出して問題生成
- **HTML parsing**: `node-html-parser` — Microsoft Learn ページのスクレイピング

## State Management
- **Storage**: JSON ファイル (`data/progress.json`, `data/certifications/*.json`)
- セッションIDは `crypto.randomUUID()` を使用

## Styling / UI
- **CSS**: Tailwind CSS (CDN読み込み)
- カスタム CSS は使用しない

## Quality Assurance
- テストなし (シングルユーザーのローカルツール)
- `node --watch app.js` で開発
