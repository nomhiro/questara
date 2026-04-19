# RPGゲーミフィケーション 設計仕様書

- 作成日: 2026-04-19
- 対象プロジェクト: 資格学習エージェント (`C:/Users/HirokiNomura/workspaces/learn/資格取得`)
- 方向性: **ドット絵レトロRPG × 成長感** — ぱっと見のUIでもゲーム感を出し、XP/レベル/ランクで「自分が強くなっている」感覚を味わえる学習体験に刷新する

## 1. ゴールとスコープ

### 1.1 体験ゴール

- プレイヤー＝1人の勇者として、複数資格（ダンジョン）を順に攻略する冒険の旅
- 学習を続けるほど勇者レベル・ドメイン別マスタリーランク・実績・称号が積み上がり、視覚的に成長が実感できる
- 「どの資格をどの順で取るか」自体を **ユーザーの将来像テキスト入力 → LLM推論（Microsoft Learn MCP裏取り付き） → 冒険（アドベンチャー）生成** で決められる

### 1.2 軸の決定事項（ブレスト結果）

| 項目 | 決定 |
|---|---|
| 主軸 | 成長感（XP/レベル/マスタリーランク）＋ UI のぱっと見のゲーム感 |
| テイスト | ドット絵レトロRPG（FF/ドラクエ系、ピクセルフォント、青ネイビー窓＋金縁） |
| 失敗ペナルティ | なし（コンボリセットのみ） |
| キャラ設計 | 1人の勇者が全資格冒険（資格ごとに別キャラにしない） |
| クリティカル即答ボーナス | 採用しない |
| LLM冒険生成の情報源 | Microsoft Learn MCP（MVP）／Web検索は Phase 2 |
| 根拠可視化 | citations（公式出典URL）を保存して冒険詳細画面に表示 |
| 公式根拠ゼロ時の扱い | 生成は成立させるが「公式確認不足」警告マークを付与 |

### 1.3 MVP スコープ

**含む:** 勇者Lv/XP/コンボ、ドメイン別マスタリーランク、ストリーク、日次クエスト、実績10個、ドット絵UIテーマ、冒険（adventures）、プリセット＋LLM生成（MS Learn MCP裏取り）、冒険マップ（ホーム）、勇者プロフィール画面、結果画面演出。

**含まない（Phase 2 以降）:** ラスボス戦（模擬試験モード）、職業/クラス、装備アイテム、ガチャ/ショップ、Web検索対応（AWS/Google等）、マルチプレイ/対戦。

## 2. アーキテクチャ概要

既存構成（Express 4 + EJS + Cosmos DB + GitHub OAuth + Copilot SDK）は温存し、サービス層を積み増す。

```
routes/        → services/                 → Cosmos DB / 静的JSON
 ├ index       → adventureService            adventures/
 ├ adventures  → adventureGeneratorService   users.stats
 ├ quiz        → gamificationService         sessions.gamification
 ├ profile     → achievementService          achievements (マスタ)
 └ ranking     → progressService (既存)      certifications (既存)
                 mcpClient (新)             data/achievements.json
                                            data/adventure-presets.json
```

- `routes/*` は `services/*` のみを参照し、services 間の直接参照は極力避ける（既存方針踏襲）
- `gamificationService` が XP・レベル・ランク・コンボ・実績評価の中核。`progressService.completeSession` から呼ばれる
- `adventureGeneratorService` は `mcpClient`（Microsoft Learn MCP）と既存 Copilot SDK を合成して citations 付きで冒険 JSON を返す

## 3. データモデル

### 3.1 `users` コンテナ（既存に追記）

```js
stats: {
  // 既存
  totalSessions, totalCorrect, totalAnswered,
  weeklyCorrectRate, monthlyCorrectRate, certStats,
  // 追加
  xp: 0,
  level: 1,
  streak: {
    current: 0,
    longest: 0,
    lastStudyDate: null,   // 'YYYY-MM-DD'
    freeze: false,          // 1日猶予バフ保有フラグ（妖精の加護）
  },
  masteryRanks: {
    // 例: "gh-100:domain-1": { rank: "B", correct: 24, total: 30, rate: 80, scoreIndex: 65 }
  },
  unlockedAchievements: [],   // 実績IDの配列
  equippedTitle: null,
  activeAdventureId: null,
}
```

### 3.2 `sessions` コンテナ（既存に追記）

```js
gamification: {
  xpEarned: 120,
  maxCombo: 7,
  leveledUp: true,
  previousLevel: 11,
  newLevel: 12,
  rankUpgrades: [{ domainId: "domain-2", from: "C", to: "B" }],
  newAchievements: [{ id: "streak-7", name: "七日修行" }],
}
```

### 3.3 `achievements` コンテナ（新規、マスタ）

```js
// partitionKey: id 自身
{
  id: "streak-7",
  name: "七日修行",
  description: "7日連続で学習する",
  icon: "⚔️",
  category: "streak",   // streak | mastery | level | milestone | combo
  condition: { type: "streak-reach", value: 7 },
  xpReward: 300,
}
```

- マスタは `data/achievements.json` から `scripts/seed-achievements.js` で Cosmos に upsert
- 10 件（§7.4 で定義）を初期投入

### 3.4 `adventures` コンテナ（新規）

```js
// partitionKey: userId
{
  id: "adv-xxxx",
  userId: "github-12345",
  name: "AIエンジニアの道",
  description: "...",
  source: "llm" | "preset",
  presetId: "ai-engineer" | null,
  userPrompt: "バックエンドとAIに強く...",   // LLM 入力原文
  dungeons: [
    {
      certificationId: "gh-100",
      order: 1,
      status: "in-progress",   // locked | in-progress | cleared
      unlockedAt: "2026-04-19T...",
      clearedAt: null,
    },
    { certificationId: "ai-102", order: 2, status: "locked", ... }
  ],
  rationale: "公式の Azure AI Engineer Associate ラーニングパスによれば...",
  citations: [
    { url: "https://learn.microsoft.com/en-us/credentials/...", title: "..." }
  ],
  verificationStatus: "verified" | "warning-no-citations",
  isActive: true,
  createdAt: "...",
  completedAt: null,
}
```

- 1 ユーザーにつき `isActive: true` は最大 1 件（サービス層で保証）
- ダンジョン解放条件（MVP）: そのダンジョンに対応する資格（`certifications/{certificationId}`）の **すべての domains** が Bランク以上（`masteryRanks["{certId}:{domainId}"].rank` が B/A/S/SS）になったら、冒険内の次の `order` のダンジョンを `locked` → `in-progress` に遷移
- `verificationStatus: "warning-no-citations"` は UI に「⚠️ 公式確認不足」マークを表示する

### 3.5 `adventure-presets` 静的ファイル `data/adventure-presets.json`

```json
[
  { "id": "developer",    "name": "開発者の道",        "icon": "💻", "tagline": "コードで世界を動かす戦士",   "description": "...", "dungeons": ["gh-100","gh-200"] },
  { "id": "infra",        "name": "インフラ魔導士の道", "icon": "🏰", "tagline": "クラウドを支配する守護者", "description": "...", "dungeons": ["az-104"] },
  { "id": "ai-engineer",  "name": "AI賢者の道",        "icon": "🔮", "tagline": "知能を召喚する研究者",     "description": "...", "dungeons": ["ai-102","ai-900"] }
]
```

- `dungeons` 内の資格IDがシステム未導入なら UI でフィルタして表示しない

### 3.6 `studyPlans`（既存、変更なし）

各ダンジョン（資格）内の週次学習計画として役割を維持。冒険の階層構造は「冒険 → ダンジョン → 週次計画」の3階層になる。

## 4. 成長メカニクス

### 4.1 XP計算（回答ごと）

```
baseXp        = 正解: 10 / 不正解: 2（参加XP）
weightBonus   = floor(domain.weight / 10)
comboMultiplier = min(1.0 + 0.1 * (combo - 1), 2.0)     // 11連続正解で頭打ち
xp = round(baseXp * comboMultiplier) + weightBonus
```

- 正解のみコンボ加算、不正解でリセット
- コンボ状態はサーバー側で `session.answers` の末尾から連続正解数を導出する（クライアント送信に依存しない）。回答記録時に `gamificationService.calcCombo(session)` で算出し、その値を XP 計算と `session.gamification.maxCombo` 更新に使う

### 4.2 レベル曲線

```
Lv.N → Lv.N+1 に必要な累計XP:  totalXpNeeded(N) = floor(100 * N^1.5)
Lv.1→2:     100 XP
Lv.5→6:   1,118 XP
Lv.10→11: 3,162 XP
Lv.30→31: 16,432 XP
```

- `users.stats.level` はキャッシュ。`gamificationService.recomputeLevel(xp)` が真値
- セッション完了時のみレベルアップ判定と結果画面演出

### 4.3 マスタリーランク（ドメイン別）

```
rate = そのドメインの累計正答率 (0-100)
attempts = そのドメインの累計挑戦数
scoreIndex = rate * min(attempts / 30, 1.0)
```

| ランク | 条件 | 章 |
|---|---|---|
| SS | scoreIndex ≥ 95 かつ attempts ≥ 50 | 🌟 虹 |
| S  | scoreIndex ≥ 85 かつ attempts ≥ 30 | 🥇 金 |
| A  | scoreIndex ≥ 75 | 🥈 銀 |
| B  | scoreIndex ≥ 60 | 🥉 銅 |
| C  | scoreIndex ≥ 40 | ⚪ 白 |
| D  | scoreIndex < 40 | ⚫ 黒 |
| 未挑戦 | attempts = 0 | `???` |

- セッション完了時に全ドメインのランクを再計算し、昇格があれば `session.gamification.rankUpgrades` に記録

### 4.4 ストリーク（連続学習）

- 「修行日」= セッションを1つでも `completeSession` まで到達した日
- `stats.streak.lastStudyDate` と今日の差:
  - 0日 → 維持
  - 1日 → `current++`（`longest` 更新）
  - 2日以上 → `freeze` が true なら消費してセーフ、false なら 0 にリセット
- 7日連続で `freeze = true` を自動付与（再取得は消費後、再度 7 日連続で）

### 4.5 日次クエスト（固定3種ローテ）

- 今日5問解く
- 1ドメインで正答率80%以上
- 1セッション完了
- 達成時 +50〜100 XP、HUD に「📜 本日のクエスト」として表示
- 判定は回答時／セッション完了時に都度評価

### 4.6 実績バッジ（MVP 10個）

| id | 名称 | 条件 | XP報酬 |
|---|---|---|---|
| first-quest | 旅立ち | 初セッション完了 | 50 |
| streak-3 | 三日修行 | 3日連続学習 | 100 |
| streak-7 | 七日修行 | 7日連続学習 | 300 |
| streak-30 | 三十日修行 | 30日連続学習 | 1000 |
| level-5 | 見習い卒業 | Lv.5到達 | 200 |
| level-10 | 一人前 | Lv.10到達 | 500 |
| mastery-first-b | 初段昇格 | 任意ドメインでB達成 | 100 |
| mastery-first-s | 達人への扉 | 任意ドメインでS達成 | 500 |
| combo-10 | 連撃の極意 | コンボ10達成 | 200 |
| dungeon-cleared | ダンジョン踏破 | 1資格の全ドメインB以上 | 1000 |

## 5. LLM 冒険生成（Microsoft Learn MCP 連携）

### 5.1 フロー

```
adventureGeneratorService.generateFromPrompt({ userPrompt, userId }):

  1. mcpClient.callLearnSearch(userPrompt + " certification learning path")
       → 上位 5〜8 件の公式記事抜粋（title, url, excerpt）

  2. questionService.listCertifications() で既存資格の id/name/description 取得

  3. system prompt に以下を埋め込み:
       - 利用可能資格リスト（この中から選択必須）
       - 検索結果抜粋（公式情報）
       - 「回答JSON: { name, description, dungeons[], rationale, citations[] }」

  4. GitHub Models API (既存 copilot-sdk) で sendAndWait (timeout 120s)

  5. JSON パース → dungeons のうち未知IDを除外
       - 残った dungeons が0件 → 失敗（リトライ最大2回、ダメならエラー）
       - citations 0件 → verificationStatus = "warning-no-citations" で成立
       - citations ありなら verificationStatus = "verified"

  6. adventures upsert、isActive 切替
```

### 5.2 MCP クライアント (`services/mcpClient.js`)

- パッケージ: `@modelcontextprotocol/sdk`
- 接続先: `process.env.MS_LEARN_MCP_URL`（実装時に正式エンドポイント確認）
- 公開する関数:
  - `callLearnSearch(question) → [{title, url, content}]`
  - `callLearnFetch(url) → {title, url, content}`
- タイムアウト5秒。接続失敗時はエラーを上位に投げる（UI で「公式情報取得失敗、再試行 or プリセット選択」を案内）

### 5.3 進捗ストリーミング（SSE）

- `POST /api/adventures/generate` を SSE で実装（既存 `routes/api.js` と同じパターン）
- イベント: `progress`（MCP検索中 / LLM推論中 / 保存中）→ `done` or `error`
- UI は `views/adventure-new.ejs` に生成中ローディングをインラインJSで表示

## 6. UI/UX（ドット絵レトロRPG）

本章は frontend-design レビューを反映した確定版。AI slop 回避のため、角丸・ `ease-*` イージング・パステル調の彩度・Tailwind 中央寄せのデフォルトレイアウトはすべて禁止する。

### 6.1 パレット（NES/SNES 系 純度高 5 色）

```css
:root {
  --bg-void:   #0a0a0a;   /* 漆黒（宇宙/洞窟背景の基底） */
  --window:    #1a2a6e;   /* ロイヤルブルー（ウィンドウ塗り、ドラクエ窓由来） */
  --window-lt: #2a4ab3;   /* ハイライト（内側枠） */
  --ink:       #f4f4f4;   /* 文字（純白より少し落とす） */
  --gold:      #ffc425;   /* 金（Lv/XP/重要数値/アクセント） */
  --crimson:   #e63946;   /* 赤（警告/HP/ミス/failed） */
  --fern:      #7ac74f;   /* NES緑（成功/昇格/クエスト達成） */
  --shadow:    #000000;   /* ピクセル影 */
}
```

- モダンコーラル／ミントは禁止
- 中間色・パステルは全面禁止（グレーも真っ黒と純白の間を複数は使わない）

### 6.2 タイポグラフィ

```css
--font-display: 'DotGothic16', monospace;        /* 見出し・HUD・ボタン・ステータス数値 */
--font-body:    'M PLUS 1 Code', ui-monospace;   /* 問題文・解説・長文（可読性優先） */
```

- 数字は `font-feature-settings: "tnum"` で等幅揃え
- HUD 数値は `text-shadow: 2px 2px 0 var(--shadow)` で厚みを出す
- `letter-spacing` は見出し `0.02em`、本文は 0（ピクセル等幅を崩さない）

### 6.3 ウィンドウフレーム（ドラクエ/FF 風4重ライン）

```css
.rpg-window {
  background: var(--window);
  color: var(--ink);
  border: 3px solid var(--ink);
  box-shadow:
    inset 0 0 0 3px var(--window),
    inset 0 0 0 6px var(--window-lt),
    4px 4px 0 var(--shadow);
  image-rendering: pixelated;
  border-radius: 0;   /* 角丸禁止 */
  padding: 20px 24px;
}
```

- 角丸は **全コンポーネントで `border-radius: 0` を徹底**
- ボタンもこのフレームの縮小版で統一

### 6.4 背景（3層構造）

```css
body {
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0, transparent 2px,
      rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 3px
    ),                                                  /* CRTスキャンライン */
    radial-gradient(
      ellipse at top,
      #0f1530 0%, var(--bg-void) 70%
    );                                                  /* 星雲グラデ */
}
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none;
  background-image: radial-gradient(#fff 1px, transparent 1px);
  background-size: 120px 120px;
  opacity: 0.15;
  z-index: 0;
}
```

- 冒険マップ画面はさらにドット絵タイル（芝・道・水 32x32）を前景に重ねる
- すべての画像/SVG/canvas に `image-rendering: pixelated` を強制

### 6.5 モーション原則

| 演出 | 実装方針 |
|---|---|
| タイプライター表示 | 問題文/冒険説明/勇者セリフは `steps(N)` で1文字ずつ表示、スキップ可 |
| ウィンドウ開閉 | `transform: scaleY(0)→scaleY(1)` を `steps(4)` で段階展開（ぬるっと展開禁止） |
| LEVEL UP 演出 | 画面中央に `LEVEL UP!` が点滅（`steps(2)`）→ `Lv.N → Lv.N+1` をタイプライター表示 |
| コンボ表示 | 値更新時に `shake .2s steps(4)` 震え、段階色 白→金→赤 |
| ランク昇格 | 旧ランク章が `clip-path` で割れる破片アニメ → 新ランク章がフェードイン |
| ダンジョン解放 | 鍵アイコンが左右振れ→中央で光って消える（`steps(6)`） |
| 実績解放トースト | 右からスライドイン（`steps(8)`）、3秒後にパリンと割れて消える |

**禁止**：`ease-in-out` / `cubic-bezier` / `ease` 系 transition 全般。`steps(N)` または `linear` のみ許可。

### 6.6 画面別レイアウト

#### 冒険マップ（`GET /`）
- ビューポート全幅（`max-w` 制限なし）
- 上部に HUD バー（全画面共通）
- 中央～下部に横スクロールの「道」。道は 32x32 ピクセルタイルの繰り返し
- ダンジョンは 64x64 の城/塔/祠スプライト、道沿いに配置
- 現在位置に勇者ドットが `steps(4)` の足踏みアニメ
- 左側に縦アイコンメニュー（クエスト・プロフィール・ランキング・自由モード）
- 「冒険を変える」ボタンは右上

#### 戦闘（`GET /quiz/:sessionId`）
- 上部 60%: 「敵」ドメインスプライト（64x64 ピクセル化）＋ 問題ウィンドウ
- 下部 40%: 選択肢コマンドウィンドウ（ドラクエ式 `▶ A) ...` カーソル点滅、矢印キー選択対応）
- フッターに HUD

#### 勇者プロフィール（`GET /my/profile`）
- FF6/ドラクエのステータス画面を踏襲
- 左: ドット絵勇者立ち絵（32x48 想定）
- 右: `Lv / HP / MP / EXP / 次Lvまで / 称号 / 所持バッジ`（ピクセル数字）
- 実績バッジは 48x48 グリッド、未取得は `filter: grayscale(1) opacity(.2)`

#### 冒険新規作成（`GET /adventures/new`）
- 画面中央に巨大なピクセル水晶玉（CSS で作成）
- 下部に「どんな勇者を目指す？」テキストエリア（古い石碑風にレリーフ化）
- プリセット3枚はサイドに置かれた「巻物」スタイル

#### 冒険詳細（`GET /adventures/:id`）
- 上部にタイトル（羊皮紙テクスチャ）
- rationale をメッセージウィンドウでタイプライター表示
- citations は「📜 古の書の引用」セクション、各出典は羊皮紙片スタイルのリンク
- `verificationStatus: warning-no-citations` の場合は「⚠️ 公式確認不足」赤バッジ

### 6.7 共通 HUD

全画面共通のトップバー（ビューポート固定）:

```
[🛡️ <勇者名>] [Lv.12] [EXP ▮▮▮▮░░ 312/1118] [🔥 7日] [🏅 3/10] [<称号>] [ログアウト]
```

- 各セルは `.rpg-window` の縮小版
- XPバーはピクセル8x8ブロックの集合（`repeating-linear-gradient` で金ブロック、黒の溝）
- 画面幅が狭いときはコンパクト表示（Lv/XPのみ残す）

### 6.8 マイクロディテール

- カーソル: ドット絵十字カーソルに差し替え（`cursor: url("/cursor-pixel.png") 0 0, auto`）
- ボタン押下: `transform: translateY(2px)` + 外側シャドウ消去で沈む
- フォーカスリング: `outline: 2px dashed var(--gold); outline-offset: 2px;`
- リンクのホバー: 金色点滅（`animation: blink-link 1s steps(2) infinite`）
- 画面遷移時: 全画面を黒からスイッチカットで切り替え（`steps(2)` ワイプ）

### 6.9 画面一覧（ルーティング対応表）

| ルート | 画面 | レイアウト仕様 |
|---|---|---|
| `GET /` | ホーム＝冒険マップ | 6.6 冒険マップ参照 |
| `GET /adventures/new` | 冒険新規作成 | 6.6 冒険新規作成参照 |
| `GET /adventures/:id` | 冒険詳細 | 6.6 冒険詳細参照 |
| `GET /certifications/:id` | ダンジョン画面（改修） | 既存の「ドメイン別正答率」にマスタリーランク章を追加。各ドメインが `.rpg-window` カード |
| `GET /quiz/:sessionId` | 戦闘画面（改修） | 6.6 戦闘参照 |
| `GET /quiz/:sessionId/result` | 結果画面（改修） | §6.10 参照 |
| `GET /my/profile` | 勇者プロフィール（新規） | 6.6 プロフィール参照 |
| `GET /ranking` | ランキング（改修） | テーブルを石碑風テクスチャに、上位3位は金/銀/銅ドット章 |
| `GET /my/certifications*` | マイ資格（既存） | 自由モードから到達、テーマのみ刷新 |
| `GET /plans*` | 学習計画（既存） | テーマのみ刷新 |

### 6.10 結果画面演出シーケンス

1. 画面暗転からの `steps(2)` フェードイン
2. レベルアップ時のみ `LEVEL UP!` 中央点滅（1.2秒）
3. `Lv.N → Lv.N+1` をタイプライター表示
4. 昇格ランクごとに `[Domain X] C → B` の行を順次（0.3秒間隔でスライドイン、`steps(4)`）
5. 新規実績を右上トーストで順次（1件ずつ2秒間表示、割れて消える）
6. 取得XP合計・最大コンボ・正答率をサマリーウィンドウで表示

### 6.11 テーマ実装の置き場

- `public/theme.css` — 上記すべての CSS 変数・`.rpg-window`・モーション keyframes・body 背景
- Tailwind CDN は継続利用するが、レイアウト用ユーティリティ（`flex`, `grid`, `gap-*`, `px-*`）のみに限定。色・角丸・影は Tailwind を使わず `theme.css` のクラスで統一
- `public/mocks/adventure-map.html` に冒険マップの先行モックを置く（本 spec と併せて視覚確認用）

## 7. ファイル変更マップ

### 7.1 新規ファイル

```
services/gamificationService.js
services/achievementService.js
services/adventureService.js
services/adventureGeneratorService.js
services/mcpClient.js
routes/adventures.js
routes/profile.js
routes/api-adventure.js
views/adventure-map.ejs
views/adventure-new.ejs
views/adventure-detail.ejs
views/profile.ejs
public/theme.css
data/achievements.json
data/adventure-presets.json
scripts/seed-achievements.js
```

### 7.2 変更ファイル

```
app.js                         # ルート追加
routes/index.js                # "/" を冒険マップに置換（アクティブ冒険がなければ新規作成導線）
routes/quiz.js                 # gamificationService 経由の recordAnswer/completeSession
services/progressService.js    # gamification フック
services/userService.js        # stats 新フィールド初期化
views/quiz.ejs                 # HUD / コンボ表示
views/result.ejs               # 演出（レベルアップ/昇格/実績）
views/certification.ejs        # マスタリーランク章表示
views/ranking.ejs              # Lv / 称号表示
package.json                   # @modelcontextprotocol/sdk 追加
.env.example                   # MS_LEARN_MCP_URL 追加
```

## 8. MVP 実装ステージ（マイルストーン）

| 段階 | 内容 | 確認基準 |
|---|---|---|
| **M1: 基盤ゲーミフィケーション** | gamificationService / XP・Lv・コンボ・マスタリーランク / 結果画面演出 / ドット絵テーマ | 既存ユーザーでLv・ランクが正しく算出される。クイズ/結果画面が新テーマ適用 |
| **M2: 継続仕掛け** | ストリーク / 日次クエスト / achievementService / 実績10個 / プロフィール画面 | 7日連続で `streak-7` 解放、プロフィールに表示 |
| **M3: 冒険基盤** | adventures コンテナ / プリセット / adventureService / アクティブ切替 | プリセットから冒険作成、isActive 切替ができる |
| **M4: LLM 冒険生成** | mcpClient / adventureGeneratorService / SSE / warning フラグ | 「AIエンジニアになりたい」→ citations付き冒険生成。MCP失敗時は警告表示 |
| **M5: ホーム再構築** | 冒険マップUI / ダンジョン解放ロジック | 前ダンジョン全ドメインB以上で次が in-progress に遷移 |

Phase 2（別プロジェクト化）: ラスボス戦（模擬試験）、職業／クラス、装備、ガチャ、Web検索対応、PvP/ギルド。

## 9. 非機能・運用上の注意

- 既存 Tailwind CDN 方針は維持（カスタムCSSは `public/theme.css` のみ）
- Cosmos DB への新コンテナ追加は `cosmosService.init` の自動作成に任せる（既存パターン踏襲）
- 実績マスタは初回リリース時に `npm run seed:achievements` を手動実行して投入
- MS Learn MCP の接続先URLと認証方式は実装時に要確認。失敗時は warning-no-citations で運用継続
- XP/Lv/ランクの再計算はすべてサーバー側で行い、クライアント送信値は検証する
- 既存 `studyPlans` は冒険の内側で引き続き使用する（削除・改名しない）
- セキュリティ: ユーザー入力プロンプトは MCP 検索 / LLM に素通しせず、コマンドインジェクション対策として改行除去・最大長 500 文字制限をかける

## 10. 未決事項（Phase 2 以降で再検討）

- 「ラスボス戦」＝ 模擬試験モードの具体仕様（タイマー・合格ライン演出）
- 職業／クラスの外観差別化と解放条件
- 装備アイテム／ショップ／ガチャのゲームバランス
- Web検索（Bing等）導入時のコスト見積と非Microsoft資格の扱い
- PvP／ギルドの同期整合性
