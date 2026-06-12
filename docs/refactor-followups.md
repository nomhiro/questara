# リファクタリング・フォローアップ（要承認・提案）

`refactor-instructions.md` の実行（ブランチ `refactor/tech-debt`）で、指示書上「提案のみ」または
「着手前に承認」とされた項目、および検証可能性の都合で本サイクルから外した項目をここにまとめる。
**いずれも未実装。** 実装する場合は、それぞれ独立したブランチ／PR で行うこと。

---

## D-11（要承認）: `completeSession` の全面分割

### 現状
`services/progressService.js` の `completeSession`（約 150 行）が、以下 6 つの関心事を 1 関数で処理している:
1. スコア確定（`session.score`）
2. ユーザー統計更新（`updateUserStats` クロージャ内: totalSessions / certStats / overall / XP / level / masteryRanks / streak / dailyQuest）
3. デイリークエスト評価（`gamificationService.evaluateDailyQuest`）
4. 実績評価＋実績 XP の二段階加算（`achievementService.evaluate` → 再 `updateUserStats`）
5. アドベンチャーのダンジョン進行（`adventureService.checkDungeonUnlocks` → `saveAdventure`）
6. `session.gamification` の組み立て

すでに本サイクルで `__questResult` ハック除去（D-11 一部）と冪等化ガード（D-18）は実施済み。

### 分割案（承認を得てから着手）
純関数と副作用関数を分離する:

| 抽出先（案） | 責務 | 純粋性 |
|---|---|---|
| `summarizeAnswers(session)` | total / correct / score / xpEarned / maxCombo / sessionDomainAgg を算出 | 純粋 |
| `applySessionToStats(stats, summary, session)` | updateUserStats のクロージャ本体（統計・XP・rank・streak・quest）を純関数化 | 純粋（stats を受けて新 stats を返す） |
| `evaluateAchievements(ctx)` | 実績判定＋XP（既存 achievementService 呼び出しのラッパ） | 副作用（updateUserStats） |
| `progressAdventure(userId, ...)` | ダンジョン進行（既存ロジック） | 副作用 |
| `completeSession` | 上記をオーケストレーションするだけに縮小 | 副作用 |

### リスクと検証
- **リスク: 高**。ゲーミフィケーションの数値仕様の回帰が最も怖い箇所。
- 安全網は本サイクルで整備済み（`gamificationService.test.mjs` 33 件、`progressService.gamification.test.mjs` 4 件、`progressService.stats.test.mjs` 3 件）。
- 分割は **1 抽出ごとにテストを回し**、`completeSession` の戻り値（`session.gamification` 各フィールド）と users.stats を不変に保つこと。
- 着手前に、抽出関数の境界とテスト計画をこのファイルに追記して **承認を得る**。

---

## D-20（提案のみ）: ユーザー統計の read-modify-write 競合

### 現状
`services/userService.js::updateUserStats` は `getUserById` → updater 適用 → `upsert` の
read-modify-write で、ETag 等の楽観的並行性制御が無い。`completeSession` は 1 回の処理中に
`updateUserStats` を最大 2 回呼ぶ（統計更新＋実績 XP）。同一ユーザーが複数セッションをほぼ同時に
完了すると、統計（XP・回数）が取りこぼされる可能性がある。

### 提案（実装しない）
- Cosmos の `accessCondition`（ETag, `ifMatch`）を用いた楽観ロック＋リトライ、または
- Cosmos Patch API による部分加算（`incr`）で read-modify-write を回避。

### リスクと判断材料
- 影響範囲: `updateUserStats` の呼び出し全経路（completeSession / setActive / 実績付与）。
- 個人学習アプリで「同一ユーザーの同時セッション完了」は稀。優先度は中〜低。
- 実装するなら専用ブランチで、並行完了を模した結合テストを伴うこと。

---

## 検証可能性の都合で本サイクルから外した仕上げ

いずれも「テストで正しさを担保できない（主に EJS 内 JS / レンダリング詳細）」ため、手動ブラウザ
検証を伴う作業として分離した。

### F-1: D-19 の `?questions=` 完全撤去（URL サイズ削減）
出題順の正典化・改ざん耐性は実装済み（セッション側）。残るは redirect / `views/quiz.ejs` の
hidden `questionIds` フィールドから `?questions=` を撤去する仕上げ。`routes.quiz.test.mjs` と
`progressService.stats.test.mjs` のクイズフローを「各 idx を GET → レンダリングされた
`questionId` を読み取り → 回答 POST」へ書き換えれば検証可能。価値は URL サイズと体裁のみ。

### F-2: D-14 の SSE error フィールド名統一
`routes/api.js` は `{ message }`、`routes/api-adventure.js` は `{ error }` を送る。統一するには
受信側 view（`views/domain.ejs` は `data.message`、`views/adventure-new.ejs` は `payload.error`）を
同時に変更する必要があり、view 内 JS はテストで実行されないため統一の正しさを CI で担保できない。
手動ブラウザ検証前提のフォローアップ。

### F-3: D-07 の HUD partial include 整理
`middleware/hud.js` が `res.locals.heroHud` を全認証リクエストに注入済み。13 ビューが
`include('partials/hud', { heroHud: typeof heroHud !== ... })` と明示再パスしている重複を
`res.locals` 直参照へ寄せられるが、HUD 表示の正しさは smoke テスト（200＋一部文言）でしか
確認できず、誤ると HUD が静かに消える。1 ビューずつ手動確認しながら進めること。
（route 側の `hudStats` 組み立て重複は `gamificationService.buildHudStats` に集約済み。）

### F-4: D-05 の取りこぼし
`routes/quiz.js` の結果ルートに `const overallRate = total > 0 ? Math.round((correct/total)*100) : 0;`
が残る（`scoreUtil.percentRate` 未使用）。ルート層の表示計算のため本サイクルでは未変更。
`percentRate(correct, total)` に置換可能（ルートが scoreUtil を import する形）。
