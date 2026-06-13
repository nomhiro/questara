# 資格のお気に入り・合格マーク・ステータス実績 設計

- 日付: 2026-06-13
- 対象: マイ資格をお気に入り一覧化し、資格の合格マークとステータス画面への合格資格表示を追加する

## 背景・目的

冒険機能の削除後、ログイン後のホームは「マイ資格」になった。従来のマイ資格は「自分が作成した資格」だけを表示していたが、これを次の意味に変える。

- **マイ資格 = お気に入り登録した資格の一覧**（自作・公開のどちらでもよい）。
- 加えて、各資格に**自己申告の「合格」マーク**を付けられるようにする。
- 合格した資格は**ステータス（プロフィール）画面に「🎓 合格資格」セクション**として実績表示する。

これにより、ユーザーは学びたい資格を手元に集め（お気に入り）、達成（合格）を記録・可視化できる。

## 確定した方針

- 自作資格は**作成時に自動でお気に入り登録**される（作る＝マイ資格に並ぶ）。
- 公開/非公開の切替・削除・新規追加といった**管理操作はマイ資格内で自作分にのみ**表示する。
- **合格は手動マーク**（実試験の合格を自己申告。アプリ内成績からの自動判定はしない）。
- ステータス画面は既存の「🏅 実績（アチーブメントバッジ）」を残したまま、**専用の「🎓 合格資格」セクションを追加**する。

## データモデル（`user.stats`）

既存の `stats` オブジェクトにフィールドを2つ追加する。`updateUserStats(id, updater)` で更新。

```jsonc
{
  // 既存フィールド（xp/level/streak/masteryRanks/unlockedAchievements/equippedTitle/dailyQuest ...）
  "favoriteCertifications": ["gh-100", "ai-102"],            // お気に入り cert ID
  "passedCertifications": [                                   // 合格した資格
    { "certId": "gh-100", "passedAt": "2026-06-13T10:00:00.000Z" }
  ],
  "favoritesInitialized": true                               // 一度きりバックフィル済みフラグ
}
```

- `userService.upsertGithubUser` の新規ユーザー初期化に `favoriteCertifications: []` / `passedCertifications: []` を追加。
- 既存ユーザーの正規化（`existing.stats` 分岐）でも、欠損時に `?? []` で補完する。
- **お気に入りの一度きりバックフィル**: マイ資格表示時に `stats.favoritesInitialized` が falsy なら、その時点で「自分が作成済みの資格 ID」を `favoriteCertifications` に投入し、`favoritesInitialized=true` を立てる。以降は配列が唯一の真実になり、お気に入り解除が確実に効く（毎回の再投入はしない）。
- 合格にはバックフィル無し（空から開始）。

## サービス層

### `userService`
- `addFavorite(userId, certId)` — 重複しなければ `favoriteCertifications` に追加。
- `removeFavorite(userId, certId)` — 配列から除去。
- `markPassed(userId, certId, passedAt)` — `passedCertifications` に未登録なら `{ certId, passedAt }` を追加。
- `unmarkPassed(userId, certId)` — `certId` 一致要素を除去。
- いずれも `updateUserStats` を用い、対象配列が無ければ `[]` として扱う。`passedAt` は呼び出し側（route）で `new Date().toISOString()` を生成して渡す。

### `questionService`
- `listCertificationsByIds(ids, userId)` を追加する。
  - 与えられた cert ID 群を順に読み、`canAccessCertification(cert, userId)` を満たすものだけ、既存 `listCertifications` と同形の要約（`id`/`name`/`domainCount`/`questionCount`/`createdBy`/`creatorName`/`isPublic`）に整形して返す。
  - **引数 `ids` の順序を保持**する（お気に入り追加順で並ぶ）。
  - 削除済み（`read` が null）・非公開化された他人の資格は自動的に除外される。
- 既存の `listCertifications` / `canAccessCertification` / `readCertification` はそのまま利用。

### 資格の作成・削除との連動（`routes/certifications.js`）
- `POST /new`（フォーム作成）で資格保存後、作成者の `favoriteCertifications` に当該 ID を追加する。
- `POST /:certId/delete` で、自分の `favoriteCertifications` と `passedCertifications` から当該 ID を除去する（他ユーザー分は read 時の canAccess フィルタで処理）。

## ルート

ユーザー状態の更新は `/my/certifications` ルーター（`routes/certifications.js`）に集約する。各フォームは `returnTo`（hidden、既定 `/my/certifications`）を送り、更新後そこへリダイレクトする。`returnTo` はオープンリダイレクト防止のため**先頭が `/` の相対パスのみ許可**し、それ以外は既定値にフォールバックする。

- `POST /:certId/favorite` — お気に入り登録 → `returnTo`
- `POST /:certId/unfavorite` — お気に入り解除 → `returnTo`
- `POST /:certId/pass` — 合格マーク（`passedAt=now`）→ `returnTo`
- `POST /:certId/unpass` — 合格取り消し → `returnTo`
- `GET /`（マイ資格）— `stats.favoriteCertifications` を解決してお気に入り一覧を `my-certifications` に渡す。バックフィル処理もここで行う。`passedIds` も渡す。

既存の `publish`/`unpublish`/`delete`/`new`/`extract` は維持（自作のみ操作可は既存の `createdBy` チェックで担保）。

詳細・一覧側の render（`routes/index.js` の `/free-mode` と `/certifications/:certId`）では、表示用に `favoriteIds`（Set）・`passedIds`（Set）を渡す。

## ビュー

トグルはすべて form POST（GET 副作用を避ける）。合格マークの**操作は資格詳細でのみ**行い、一覧・マイ資格カードには合格バッジ（🎓）を表示する。お気に入りは一覧・詳細でトグル、マイ資格では解除のみ。

- **`my-certifications.ejs`（マイ資格 = お気に入り一覧）**
  - 各カード: 「開く」＋「★ お気に入り解除」、合格済みは `🎓 合格` バッジ。
  - `createdBy === 自分` のカードにのみ「公開/非公開」「削除」ボタン。
  - 「＋ 新規追加」と導線リンク（資格一覧/ランキング/学習計画）は維持。
  - 空状態: 「まだお気に入りがありません。資格一覧から ★ で登録しましょう」＋ `/free-mode` への導線。
- **`index.ejs`（資格一覧 / free-mode）**
  - 公開資格・自分の非公開資格の各カードに `☆/★` トグル（`returnTo=/free-mode`）＋合格済み `🎓` バッジ。
- **`certification.ejs`（資格詳細）**
  - ヘッダ付近に `☆/★` お気に入りトグルと「🎓 合格した／合格を取り消す」トグル（`returnTo=/certifications/:id`）。
- **`profile.ejs`（ステータス）**
  - 既存の「🏅 実績」グリッドは変更しない。
  - 新セクション「🎓 合格資格」: `passedCertifications` を解決し、資格名＋合格日（YYYY-MM-DD）を**合格日の新しい順**で一覧表示。空なら非表示。

## エッジケース

- 二重お気に入り／二重合格は防止（追加前に存在チェック）。
- 他人が非公開化・削除した資格は、お気に入り/合格一覧から `canAccess`/`read=null` フィルタで自動的に消える。
- 自作資格を削除すると、自分の favorites/passed からも除去。
- `returnTo` は相対パス（`/` 始まり）のみ許可。

## テスト

- **`userService`**: addFavorite/removeFavorite/markPassed/unmarkPassed の追加・解除・重複防止、新規初期化に両配列、バックフィル（`favoritesInitialized` 立ち上げ・再投入しない）。
- **`routes.certifications`**: 各トグルで stats 更新＋`returnTo` リダイレクト、`returnTo` の検証、マイ資格がお気に入りを返す（公開シード資格を含む）、自作のみ管理ボタン、作成時の自動お気に入り、削除時の除去。
- **`routes.index`**: 資格詳細・資格一覧の render に `favoriteIds`/`passedIds` が反映される。
- **views**: マイ資格・資格一覧・資格詳細・プロフィールが新 UI 付きで 500 にならない。
- 網羅性ハーネス（`spec-coverage`）が green を維持。

## スコープ外（YAGNI）

- 合格はあくまで手動。アプリ内成績からの自動判定はしない。
- 合格マークと既存アチーブメント自動解放の連動はしない（独立した記録）。
- 合格資格の証跡（証明書アップロード等）は扱わない。
