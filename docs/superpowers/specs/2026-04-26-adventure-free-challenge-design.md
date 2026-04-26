# 冒険ダンジョンの自由挑戦化（順次アンロック廃止）

- 起票: 2026-04-26
- 対象機能: アドベンチャー（`/adventures/*`）
- 関連ファイル: `services/adventureService.js`, `services/progressService.js`, `routes/adventures.js`, `views/adventure-detail.ejs`, `tests/adventureService.test.js`, `tests/routes.adventures.test.mjs`

## 背景

冒険機能では、プリセット（開発者の道、インフラの道、AI エンジニアの道など）から「道」を選ぶと、含まれる資格（ダンジョン）が `order` 順に並べられる。現状は最初のダンジョンだけが `in-progress` で、それ以外は `locked` になっており、UI で 🔒 表示・「入る」ボタンが出ない。順次アンロック条件は「現在の `in-progress` ダンジョンの全ドメインで B ランク以上を取る」（`adventureService.checkDungeonUnlocks`）。

これは学習設計上の "推奨順" を強制する役割を果たしているが、実運用上は以下の不都合がある:

- 既に部分的に学習済み・受験予定の資格を先取りで挑戦できない
- 1 つ目の資格でつまずくと、興味のある資格にたどり着く前にモチベーションが切れる
- アドベンチャーが「メインルートを縛る仕組み」ではなく、「学習計画のテンプレート」として使われている

## 目的

ユーザーがプリセットを選んで冒険を始めたあとも、含まれるダンジョンを **任意の順序で挑戦できる** ようにする。順番（推奨順）の概念は残し、「次に挑むべき」を視覚的に示すが、ロックはかけない。

## ノンゴール

- プリセット選択画面（`/adventures/new`）の変更（順番表示そのまま）
- 既存データのバルクマイグレーションスクリプト
- アチーブメント条件・ランキング・ランクロジックへの変更
- 「自由挑戦モード」と「順次アンロックモード」を切り替えるユーザー設定（YAGNI）

## データモデル

### 変更前

```jsonc
dungeons: [
  { certificationId, order, status: 'locked' | 'in-progress' | 'cleared', unlockedAt, clearedAt }
]
```

新規作成時の初期値: 1 番目だけ `in-progress` + `unlockedAt` セット、残り全て `locked` + `unlockedAt: null`。

### 変更後

```jsonc
dungeons: [
  { certificationId, order, status: 'in-progress' | 'cleared', unlockedAt, clearedAt }
]
```

新規作成時の初期値: **全ダンジョンが `in-progress` + `unlockedAt: now`**。

### 既存データの後方互換

DB 上の既存ドキュメントには `status: 'locked'` や `unlockedAt: null` のダンジョンが残っている。マイグレーションスクリプトは作らず、**読み取り時の正規化レイヤ**で吸収する:

- `adventureService.normalizeAdventure(adv)` を新設
- `getAdventure` / `listAdventures` / `getActiveAdventure` の戻り値を全て `normalizeAdventure` 経由で返す
- `status === 'locked'` → `'in-progress'`
- `unlockedAt` が無ければ補完（`cleared` のものは `clearedAt`、それ以外は epoch）

書き込み（`upsert`）時は通常通り新仕様の値を保存する。次回更新時に DB 値も自然に書き戻る。

## サービス層

### `services/adventureService.js`

#### 新設: `normalizeAdventure(adv)`

```js
function normalizeAdventure(adv) {
  if (!adv) return adv;
  const dungeons = adv.dungeons.map((d) => ({
    ...d,
    status: d.status === 'locked' ? 'in-progress' : d.status,
    unlockedAt: d.unlockedAt
      || (d.status === 'cleared' ? d.clearedAt : new Date(0).toISOString()),
  }));
  return { ...adv, dungeons };
}
```

#### 改修: `checkDungeonUnlocks(adventure, ranks, domainCounts)`

「`in-progress` のダンジョンが B ランク以上のクリア条件を満たせば `cleared` に遷移」だけを行う。次のダンジョンを `locked` から `in-progress` にする処理は削除する。

```js
function checkDungeonUnlocks(adventure, ranks, domainCounts) {
  const dungeons = adventure.dungeons.map((d) => {
    if (d.status === 'in-progress' && isDungeonBClearable(d, ranks, domainCounts)) {
      return { ...d, status: 'cleared', clearedAt: new Date().toISOString() };
    }
    return d;
  });
  return { ...adventure, dungeons };
}
```

#### 改修: 戻り値正規化

- `getAdventure` / `listAdventures` / `getActiveAdventure` は呼び出し前後で `normalizeAdventure` を通す

### `services/progressService.js`

変更なし。`checkDungeonUnlocks` の戻り値の差分検知（`JSON.stringify` 比較）は新ロジックでも機能する。

## ルート層

### `routes/adventures.js` の `POST /preset`

ダンジョン配列の生成（128-134 行目付近）を変更:

```js
dungeons: availableDungeons.map((d, i) => ({
  certificationId: d.certId,
  order: i + 1,
  status: 'in-progress',
  unlockedAt: new Date().toISOString(),
  clearedAt: null,
})),
```

### `routes/adventures.js` の `GET /:id`

「次のおすすめ」のハイライト用に `recommendedIndex` を計算してテンプレに渡す:

```js
const recommendedIndex = adv.dungeons.findIndex((d) => d.status === 'in-progress');
res.render('adventure-detail', { title: adv.name, adventure: adv, certById, recommendedIndex });
```

その他のルート（`GET /`, `GET /new`, `POST /:id/activate`, `POST /:id/delete`）は変更不要。

## UI

### `views/adventure-detail.ejs`

1. `statusText` / `statusColor` の `locked` 分岐を削除
   - `cleared` → `var(--fern)` / "踏破済み"
   - `in-progress` → `var(--gold)` / "挑戦中"
2. 🔒 表示と「入る」ボタン非表示の分岐を削除し、**全ダンジョンに「入る」ボタン** を表示
3. 「次のおすすめ」推奨フォーカスを派生計算で表示
   - サーバ側で `recommendedIndex = adventure.dungeons.findIndex(d => d.status === 'in-progress')` を計算してテンプレに渡す
   - 該当 `<li>` に `▶ 次のおすすめ` バッジを付与し、枠を `var(--gold)` で強調

#### 描画イメージ

```
#1  GH-100  [踏破済み]                  [入る]
#2  GH-200  [挑戦中] ▶ 次のおすすめ       [入る]   ← gold 枠で強調
#3  AI-102  [挑戦中]                     [入る]
#4  AZ-104  [挑戦中]                     [入る]
```

### `views/adventure-new.ejs`

変更なし。プリセット選択画面はもともと「順番」を見せるだけで、ロック概念に依存していない。

## テスト

### `tests/adventureService.test.js`

#### 改修: `checkDungeonUnlocks` の既存ケース

| 既存ケース | 新仕様での扱い |
| --- | --- |
| ① B 以上で cleared に遷移し**次を unlock** | → 「B 以上で cleared に遷移する」だけ。次の遷移期待は削除 |
| ② 未達ランクなら状態変化なし | → `in-progress` のまま（locked の検証は不要） |
| ③ ドメインカウントに無い cert は false 扱い | → そのまま維持 |
| ④ 既に cleared の前ダンジョンには影響しない | → そのまま維持 |
| ⑤ 最終ダンジョン cleared 時も例外を出さない | → そのまま維持 |

#### 新設: `normalizeAdventure` の単体テスト

```js
describe('normalizeAdventure', () => {
  it('locked ステータスは in-progress に変換される');
  it('unlockedAt が null のダンジョンは値が補完される');
  it('cleared ステータスはそのまま保持される');
  it('null/undefined を渡しても落ちない');
});
```

### `tests/routes.adventures.test.mjs`

#### 新設

```js
test('POST /preset で作成された冒険の全ダンジョンが in-progress', ...);
test('GET /:id で全ダンジョンに「入る」ボタンが表示される（🔒 が出ない）', ...);
test('既存データの locked ステータスは GET 時に in-progress に正規化される', ...);
```

3 つ目のテストは、`cosmosService.upsert` で直接 `status: 'locked'` を含むドキュメントを書き込んでから GET し、レスポンス HTML に 🔒 が含まれないことを検証する。

## 互換性 / リスク

- **進行中の冒険**: 次回 `getAdventure` で正規化されるため、ユーザー体感は「次の試合まで待っていたダンジョンが解放された」になる。デグレなし。
- **`progressService.completeSession` のアドベンチャー差分検知**: `normalizeAdventure` 経由で値が安定するので、初回読み込みで spurious な差分が出る可能性はあるが、`upsert` 1 回で収束する。
- **アチーブメント連動**: アンロック解除トリガーで発火するアチーブメントは存在しない（`achievementService` は `unlockedAchievements` を `data/achievements.json` のトリガーで判定）ため影響なし。
- **ランキング**: 影響なし。

## 完了条件

- 新規冒険作成時、全ダンジョンが最初から「入る」可能
- 既存の `status: 'locked'` を持つドキュメントが、UI 上で違和感なく動く
- 「次のおすすめ」が最初の未クリアダンジョンに gold 強調で表示される
- `npm test` と `npm run lint` が green
- `tests/_harness/spec-coverage.test.mjs` が green
