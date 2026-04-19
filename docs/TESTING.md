# テスト運用ルール（仕様駆動開発）

このプロジェクトは **仕様駆動開発（Spec-Driven Development）** を採用しており、
「仕様（spec） → 実装計画（plan） → テスト → 実装」の順でコードを増やす。
テストは仕様の実行可能なスナップショットであり、仕様が変われば **必ずテストも更新** する。

## 1. ディレクトリと命名規則

```
docs/superpowers/
  specs/YYYY-MM-DD-<topic>-design.md   # 仕様書（brainstorming 成果物）
  plans/YYYY-MM-DD-<topic>.md          # 実装計画（writing-plans 成果物）

tests/
  _setup/                # 共通テストインフラ（DB, fixtures, HTTP agent）
  _harness/              # 網羅性ハーネス（spec-coverage.test.mjs など）
  <service>.test.{mjs,js}         # 単一サービスの unit / integration
  routes.<name>.test.mjs          # ルート層の integration
  views.<name>.test.mjs           # EJS レンダリングの smoke（500 にならない）
  middleware.<name>.test.mjs      # ミドルウェアの unit
  smoke.test.mjs                  # クロスレイヤーの E2E smoke
```

**規則:**
- `.test.mjs` は ESM、`.test.js` は vitest の ESM/CJS 相互運用で書く（source は CJS、test は ESM 可）。
- テストファイル名は対象ファイルと **一致する語幹** を含めること（例: `services/adventureService.js` → `tests/adventureService.test.js`）。
  - 一致しない場合、`tests/` 内のどこかの test で対象の relative path を `require`/`import` していれば網羅性ハーネスには通る。
- テスト内の `describe` は対象のクラス / 関数 / エンドポイントを示す。

## 2. 網羅性ハーネス（`tests/_harness/spec-coverage.test.mjs`）

`services/` `routes/` `middleware/` に追加された **すべての `.js`** は、
次のいずれかを満たさなければテストが red になる：

1. 対応するテストファイルが存在する（ファイル名に語幹を含む）
2. 既存テストの本文に該当ファイルへの `require`/`import` が含まれる
3. 既存テストのどこかに `// @covers: <relative-path>` アノテーションがある  
   （エンドポイント経由のみでカバーしているケース用。例：`smoke.test.mjs` に `// @covers: routes/index.js`）
4. `ALLOWED_UNTESTED` マップに **理由コメント付き** で登録されている

### ALLOWED_UNTESTED に登録してよいケース

- Cosmos DB / MCP / OAuth など外部 IO ラッパーで、ユニットテストが無意味なもの
- 上位レイヤーのテストで実質的にカバー済みのミドルウェア
- レガシーで近日中にリファクタ予定のもの（その場合は `TODO(DATE):` コメントを併記）

**登録したまま放置しない。** 理由が薄れたら外してテストを書く。

## 3. 仕様が変わったときのワークフロー

### 3.1 小さな仕様変更（関数の追加・挙動変更）

1. `docs/superpowers/specs/` の該当仕様書を編集（該当セクションを更新）
2. 変更箇所に対応する **既存テストを先に更新**（赤くする）
3. 実装を更新（緑にする）
4. 網羅性ハーネス `npm test -- spec-coverage` が緑であることを確認
5. `docs/superpowers/plans/` の該当計画もワークフロー上の変化があれば追記

### 3.2 大きな仕様変更（新機能・新サブシステム）

1. `superpowers:brainstorming` を起動して新しい spec を書く
2. `superpowers:writing-plans` を起動して plan を書く
3. 各 plan タスクに TDD ステップ（失敗テスト → 実装 → 緑）を含める
4. plan の最後のタスクで網羅性ハーネスが緑であることを確認する

## 4. 新ファイル追加時のチェックリスト

新しい `services/` `routes/` `middleware/` ファイルを追加したら:

- [ ] 対応するテストファイルを `tests/` に追加した（ユニット OR routes 経由）
- [ ] `tests/_harness/spec-coverage.test.mjs` が緑
- [ ] 新規エクスポートはすべて少なくとも 1 つ以上の assertion で検証されている
- [ ] 外部 IO のみの場合は `ALLOWED_UNTESTED` に理由付きで登録した

## 5. テストのレイヤリング

| レイヤー | 書き方 | 例 |
|---|---|---|
| **Unit** | `vi.mock` で依存をすべて置換、純粋ロジックのみ | `gamificationService.test.js` |
| **Service integration** | Cosmos emulator を使う `tests/_setup/db.mjs` を起動 | `progressService.gamification.test.js` |
| **Route integration** | supertest の `authedAgent(user)` でエンドポイント叩く | `routes.plans.test.mjs` |
| **View smoke** | route 経由でビューを描画、200 + 主要文字列を確認 | `views.test.mjs` |
| **E2E smoke** | クロスレイヤーで代表的フロー | `smoke.test.mjs` |

## 6. アンチパターン

- ❌ 仕様を変えたが既存テストを更新せず「通ってる」と主張する
- ❌ `skip` / `todo` を残して本線をマージする（例外的に理由コメント付きなら可）
- ❌ 実装詳細（private 関数の戻り値など）を assert し、リファクタのたびに壊れる
- ❌ `ALLOWED_UNTESTED` に何も考えず追加する

## 7. 参考コマンド

```bash
npm test                        # 全テスト
npm test -- spec-coverage       # 網羅性ハーネスだけ
npm test -- routes.adventures   # 特定ファイル
npm run test:watch              # watch モード
```
