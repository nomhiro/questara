# Bulk Import of Microsoft / GitHub Certifications

**Date:** 2026-04-19
**Status:** Draft
**Owner:** cert-quiz maintainers

## 目的

このサービスで扱える資格のカバレッジを、`GH-100` 単独から Microsoft / GitHub の主要な現役資格（Copilot 系 / M365 系 / Azure 系 / セキュリティ系 / GitHub 系）まで一括で拡張する。ドメイン構造（試験出題領域とウェイト）まで Cosmos DB に投入し、ユーザーは WebUI からすぐに「問題生成」を押せる状態にする。

## スコープ

### 投入対象（35 個の新規 + 既存 GH-100）

**Azure 系（AI / Data 含む）— 20**
AZ-900, AZ-104, AZ-204, AZ-305, AZ-400, AZ-700, AZ-800, AZ-801, AZ-140, AZ-120, AZ-220, AI-900, AI-102, DP-900, DP-100, DP-300, DP-420, DP-600, DP-700（DP-203 は 2025-03 リタイア済につき除外）

**M365 系 — 6**
MS-900, MS-102, MS-203, MS-700, MS-721, MD-102

**セキュリティ系 — 7**
SC-900, SC-200, SC-300, SC-400, SC-401, SC-100, AZ-500

**GitHub 系 — 3（GH-100 は既存）**
GH-200, GH-300, GH-500

**Copilot 系**
独立した proctored exam が GH-300 以外に存在しないため、GH-300 のみで代表させる。Applied Skills アセスメント（MS-4xxx 系）は `studyGuideUrl` の形式が異なり別設計が必要なので、今回は対象外。

### スコープ外

- 問題本体の自動生成（既存の WebUI「問題を再生成」機能で個別に実行）
- Applied Skills アセスメント
- Retired exam（DP-203 など）
- 資格カテゴリ分類の UI 表現（現在のデータモデルにカテゴリ属性は無い。本タスクでは加えない）

## アプローチ

新規スクリプト `scripts/bulk-import-certs.js` を追加し、キュレーション済みリストに対して順次以下を実行する。

1. `id`, `name`, `studyGuideUrl`, `courseUrl`（既知のもののみ）を保持したテーブルをスクリプト内に定義する
2. 各エントリで `services/certificationParser.js` の `extractDomains(url, { accessToken })` を呼び出してドメイン構造を抽出する
3. 既存 Cosmos の cert レコード（partition key `/id`）と照合し、既存があれば `domains` と `studyGuideUrl` のみ更新、無ければ新規作成（`upsert`）。既に問題が登録済みのドメインは `questions` を保持する。
4. 成功件数 / スキップ件数 / 失敗件数を最後にサマリ表示。失敗した cert は個別再実行できるよう ID を明記する。

**既存パターンとの関係:**
- `scripts/add-cert.js` は対話的な 1 件追加用、`scripts/seed-certifications.js` は旧 JSON ファイルを Cosmos に seed するレガシースクリプト。どちらも触らず、新しい `bulk-import-certs.js` として追加する。
- 実行は手動（`node scripts/bulk-import-certs.js`）。CI には組み込まない。
- 冪等性は Cosmos の `upsert` と「既存問題を保持」のロジックで担保する。再実行で問題が消えることはない。

## データモデル

既存の `certifications` コンテナ（partition key `/id`）をそのまま使う。投入する 1 レコードの形:

```jsonc
{
  "id": "az-104",
  "name": "Microsoft Azure Administrator (AZ-104)",
  "studyGuideUrl": "https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/az-104",
  "courseUrl": "",            // 既知の AZ-104T00 などがあれば埋める。未定なら空文字
  "domains": [
    {
      "id": "domain-1",
      "name": "Domain 1: ...",
      "weight": 20,
      "generatedAt": null,     // 問題はまだ無い
      "questions": []
    }
    // ...
  ],
  "createdBy": "system",
  "creatorName": "system",
  "isPublic": true,
  "publishedAt": "<ISO8601>",
  "usedByCount": 0
}
```

一覧 API (`questionService.listCertifications`) は `isPublic = true` を拾うので、投入直後からホーム画面に並ぶ。

## エラーハンドリング

- `extractDomains` が regex で抽出できず、`GITHUB_TOKEN` も未設定のときは当該 cert をスキップしてログに残す（他 cert の処理を止めない）
- Learn MCP 側のタイムアウトや 5xx は 2 回リトライ、それでも駄目ならスキップ
- ドメイン抽出結果が空の場合は cert を投入しない（= 壊れた一覧を作らない）。リスト末尾に警告として列挙

## テスト方針

- `bulk-import-certs.js` は外部 IO（MCP / Cosmos）を叩く one-shot スクリプトなので、網羅性ハーネスの `ALLOWED_UNTESTED` に「外部 IO のみで構成された手動実行スクリプト」として登録
- スクリプト内のキュレーションリスト（配列定義）と upsert ペイロード生成関数だけは純関数として切り出し、`tests/scripts/bulk-import-certs.test.mjs` で以下を検証:
  - 全 35 件がユニーク ID であること
  - 既存 cert（問題入り）とマージしたときに `questions` が保持されること
  - ドメイン抽出結果が空の入力はレコードとして返さないこと

## 実行手順（運用）

1. `GITHUB_TOKEN` を環境変数にセット（regex フォールバック用）
2. Cosmos 接続情報 `COSMOS_ENDPOINT` / `COSMOS_KEY` をセット
3. `node scripts/bulk-import-certs.js` を実行
4. サマリで失敗件数を確認し、必要なら `--only <id>` オプションで個別再実行

## 未決事項

- `courseUrl` は現状リストで空にしておく。主要な T00 コースを手入力で埋めるかは別タスク。
- 資格カテゴリ（Copilot 系 / M365 系など）をデータモデルに持たせるかは今回は見送り。将来 UI でフィルタしたくなったら別タスクで導入。
