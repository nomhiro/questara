# Questara デプロイ・運用ガイド（Azure Container Apps）

Azure Container Apps + Cosmos DB Serverless + GitHub Container Registry 構成の運用手順書。
初回セットアップから継続デプロイ、インフラ変更、シークレット更新、ログ、廃棄までを網羅する。

---

## 1. 構成の全体像

| 層 | リソース | SKU / モード | 想定月額 |
|---|---|---|---|
| アプリ実行 | Azure Container Apps (Consumption, min=0 / max=5) | 0.5 vCPU / 1.0 GiB | ¥0〜¥1,500 |
| データ | Azure Cosmos DB (NoSQL, Serverless) | 従量課金 | ¥50〜¥300 |
| ログ | Log Analytics Workspace | PerGB2018 (5GB/月 無料) | ¥0〜¥100 |
| イメージ | GitHub Container Registry (ghcr.io) | Public or Private | ¥0 |
| IAM | （なし。Container App → ghcr.io は PAT + secretRef） | – | – |

**インフラ定義**: `infra/*.bicep`
**アプリデプロイ**: `scripts/deploy.mjs`（`npm run deploy`）

---

## 2. 前提ツール / 権限

### 必要なツール（ローカル実行環境）

| ツール | 用途 | 確認コマンド |
|---|---|---|
| Node.js >= 20 | アプリランタイム + deploy スクリプト | `node -v` |
| Docker Desktop | コンテナイメージビルド | `docker --version` |
| Azure CLI | Container App 操作・Cosmos キー取得 | `az --version` |
| Azure Developer CLI (azd) | Bicep プロビジョニング | `azd version` |
| Git | リポジトリ操作 | `git --version` |

インストール例:

```bash
# macOS
brew install azure-cli azd node git

# Windows (winget)
winget install Microsoft.AzureCLI
winget install Microsoft.Azd

# Linux
curl -fsSL https://aka.ms/install-azd.sh | bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

### 必要なアカウント / 権限

- Azure サブスクリプション（Container Apps / Cosmos DB / Log Analytics を作成可能）
- GitHub アカウント（OAuth App 作成 + Container Registry 書き込み）

### 準備しておくシークレット

| 項目 | 用途 | 取得方法 |
|---|---|---|
| GitHub OAuth App `Client ID` / `Client Secret` | サインイン | [Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) |
| GitHub PAT (classic) | ghcr.io の push / pull | [Tokens (classic)](https://github.com/settings/tokens) で `write:packages` + `read:packages` |
| `JWT_SECRET` | セッション署名鍵 | `node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'` |
| `ENCRYPTION_KEY` | 暗号化鍵 | 同上（64 文字 hex） |

---

## 3. 初回デプロイ

### 3.1 リポジトリ取得 & 依存インストール

```bash
git clone https://github.com/nomhiro/questara.git
cd questara
npm install
```

### 3.2 Azure / azd にログイン

```bash
az login
azd auth login
```

### 3.3 GitHub OAuth App を作成

> ⚠️ **OAuth App** を作成すること。**GitHub App** ではない。両者は別物で、GitHub App を選ぶと Webhook URL が必須になる等の違いがある。Questara は Webhook を使わない OAuth 認可フローのみ。

1. 直リンク: [https://github.com/settings/applications/new](https://github.com/settings/applications/new)
   （Organization 配下で作るなら `https://github.com/organizations/<ORG>/settings/applications` → **New OAuth App**）
2. 以下を入力（URL は仮置きでよい。デプロイ後に本物の URL に更新する）
   - **Application name**: `Questara` など任意
   - **Homepage URL**: `https://example.com`
   - **Authorization callback URL**: `https://example.com/auth/github/callback`
3. 発行された `Client ID` と `Client Secret` を控える

> 誤って **GitHub App** を作ってしまった場合は、**Webhook** セクションの `Active` チェックを外せば URL は任意になる（Questara は Webhook 未使用）。ただし GitHub App と OAuth App はトークン発行フローが異なるため、Questara では OAuth App を使うこと。

### 3.4 GitHub PAT を作成

1. [https://github.com/settings/tokens/new](https://github.com/settings/tokens/new)（Classic）
2. Note: `questara-ghcr`
3. Scopes: **`write:packages`** と **`read:packages`** を必ずチェック
4. 発行されたトークン文字列を控える（2度目は表示されない）

### 3.5 azd 環境を作成

```bash
azd env new questara-prod
azd env set AZURE_LOCATION japaneast
```

### 3.6 シークレット類を azd env に設定

```bash
azd env set JWT_SECRET        "$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')"
azd env set ENCRYPTION_KEY    "$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')"
azd env set GITHUB_CLIENT_ID     "<3.3 で控えた Client ID>"
azd env set GITHUB_CLIENT_SECRET "<3.3 で控えた Client Secret>"
azd env set GHCR_USERNAME        "<GitHub ユーザー名 or organization>"
azd env set GHCR_PAT             "<3.4 で作成した PAT>"
```

> `.azure/questara-prod/.env` に平文で保存される。`.gitignore` で除外済み。

### 3.7 ローカルの docker push 用に PAT を export

```bash
# bash / zsh
export GHCR_PAT="<3.4 で作成した PAT>"

# PowerShell
$env:GHCR_PAT = "<3.4 で作成した PAT>"
```

### 3.8 デプロイ実行

```bash
npm run deploy
```

内部で以下が走る:

1. `azd provision` — Bicep で以下を作成
   - Resource Group `rg-questara-prod`
   - Log Analytics
   - Container Apps Environment（Consumption）
   - Cosmos DB Account（Serverless）+ database `cert-quiz` + 5 containers
   - Container App（min=0, max=5, 0.5 vCPU / 1 GiB）
2. `docker login ghcr.io`（PAT 経由）
3. `docker build -t ghcr.io/<user>/questara:<git-sha> .`
4. `docker push`
5. `az containerapp update --image ghcr.io/<user>/questara:<git-sha>`

完了時に URL が出力される（例: `https://ca-web-abc123.japaneast.azurecontainerapps.io`）。

### 3.9 OAuth App の URL を更新

[OAuth App 設定](https://github.com/settings/developers) で以下に更新:

- **Homepage URL**: `<出力された URL>`
- **Authorization callback URL**: `<出力された URL>/auth/github/callback`

### 3.10 動作確認

1. URL にアクセス → ランディングが表示される
2. 「GitHub でログインして始める」→ OAuth 認可 → `/adventure` に遷移
3. 冒険未作成なら `/adventures/new` から作成

---

## 4. 継続的デプロイ（コード変更の反映）

1. コードを編集して commit
2. `npm run deploy`

`azd provision` は毎回走るが、Bicep に差分がなければ数秒で no-op 終了。docker ビルド &push と Container App の image 更新だけが実質的な作業。

image tag は `git rev-parse --short HEAD` で自動採番されるため、コミット単位で一意になる。ロールバックは古いタグを指定すれば可能:

```bash
APP=$(azd env get-value SERVICE_WEB_NAME)
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
USER=$(azd env get-value GHCR_USERNAME)

# 例: 過去のイメージ <prev-sha> に戻す
az containerapp update --name $APP --resource-group $RG \
  --image "ghcr.io/${USER}/questara:<prev-sha>"
```

---

## 5. インフラ（Bicep）変更の反映

`infra/` 配下を編集した場合:

```bash
npm run deploy:infra     # = azd provision
```

Container App の設定（env, scale, secrets, ingress 等）だけが変わる場合は image ビルド不要。
コードとインフラ両方が変わる場合は `npm run deploy` で両方を一括反映する。

プレビュー:

```bash
azd provision --preview    # what-if 解析。適用はしない
```

---

## 6. 環境変数 / シークレットの更新

### 6.1 既存キーの値を変える

```bash
azd env set JWT_SECRET "<new-value>"
npm run deploy:infra
```

Bicep の `@secure()` parameter 経由で Container App の secret が更新される。新リクエストから新 revision（新シークレット反映）に切り替わる。

### 6.2 新しい環境変数を追加する

1. `infra/resources.bicep` の `env: []` に追記
2. パラメータ化が必要なら `infra/main.bicep` と `infra/main.parameters.json` にも追加
3. `azd env set <KEY> <VALUE>`
4. `npm run deploy:infra`

### 6.3 Container App を強制的に再起動する

```bash
APP=$(azd env get-value SERVICE_WEB_NAME)
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
az containerapp revision restart --name $APP --resource-group $RG \
  --revision $(az containerapp revision list --name $APP --resource-group $RG --query "[0].name" -o tsv)
```

---

## 7. スケール設定の変更

`infra/resources.bicep` の `scale` ブロックを編集:

```bicep
scale: {
  minReplicas: 0       // 常時 1 インスタンス欲しければ 1
  maxReplicas: 5       // 上限
  rules: [
    {
      name: 'http-concurrency'
      http: { metadata: { concurrentRequests: '30' } }  // 1 replica あたり同時 30 req
    }
  ]
}
```

| 設定 | 効果 |
|---|---|
| `minReplicas: 0` | アイドル時 ¥0。最初のアクセスで 2〜3 秒の cold start |
| `minReplicas: 1` | 常時稼働で即応。月額 +¥1,000〜1,500 |
| `concurrentRequests: '30'` | これを下げると早くスケールアウト |

変更後:

```bash
npm run deploy:infra
```

---

## 8. Cosmos DB の操作

### 8.1 接続情報の取得

Cosmos のキーは azd env に保存されない（Bicep 内部で `listKeys()` 経由で Container App の secret に直接注入）。ローカルから使いたい場合は `az` で取得する。

```bash
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
COSMOS_NAME=$(az cosmosdb list --resource-group $RG --query "[0].name" -o tsv)
COSMOS_ENDPOINT=$(az cosmosdb show -g $RG -n $COSMOS_NAME --query documentEndpoint -o tsv)
COSMOS_KEY=$(az cosmosdb keys list -g $RG -n $COSMOS_NAME --query primaryMasterKey -o tsv)
```

### 8.2 資格シードを本番に投入

```bash
cat > .env.prod <<EOF
COSMOS_ENDPOINT=$COSMOS_ENDPOINT
COSMOS_KEY=$COSMOS_KEY
COSMOS_DATABASE=cert-quiz
EOF

node --env-file=.env.prod scripts/seed-certifications.js
rm .env.prod   # 必ず削除
```

> `data/certifications/*.json` のうち既存 ID のものは upsert される。

### 8.3 単発クエリ（本番データの覗き見）

```bash
node --env-file=.env.prod -e "
const {CosmosClient}=require('@azure/cosmos');
(async()=>{
  const c=new CosmosClient({endpoint:process.env.COSMOS_ENDPOINT,key:process.env.COSMOS_KEY});
  const {resources}=await c.database(process.env.COSMOS_DATABASE)
    .container('users').items.query('SELECT TOP 5 c.id FROM c').fetchAll();
  console.log(resources);
})();
"
```

### 8.4 Cosmos DB バックアップからの復元

Continuous7Days を有効化済み。復元は Azure Portal の Cosmos DB → Point in time restore から（過去 7 日以内）。

---

## 9. ログ / 監視

### 9.1 リアルタイムログ（stdout）

```bash
APP=$(azd env get-value SERVICE_WEB_NAME)
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
az containerapp logs show --name $APP --resource-group $RG --follow
```

### 9.2 過去ログを KQL で検索

```bash
WORKSPACE=$(az monitor log-analytics workspace list -g $RG --query "[0].customerId" -o tsv)
az monitor log-analytics query \
  --workspace $WORKSPACE \
  --analytics-query "ContainerAppConsoleLogs_CL
    | where TimeGenerated > ago(1h)
    | where ContainerAppName_s == '$APP'
    | project TimeGenerated, Log_s
    | order by TimeGenerated desc
    | take 100"
```

Portal: **Container App → Monitoring → Logs** でも同じクエリを GUI で実行可能。

### 9.3 メトリクス

Portal: **Container App → Monitoring → Metrics** で以下が見られる:

- `Requests`（リクエスト数）
- `Replica Count`（現在稼働中のインスタンス数）
- `CPU Usage` / `Memory Working Set Bytes`
- `Restart Count`

---

## 10. PAT / シークレットのローテーション

### 10.1 GitHub PAT のローテーション（ghcr.io 用）

```bash
# 1. 新 PAT を作成（同 scope）
# 2. azd env を更新
azd env set GHCR_PAT "<new-PAT>"
# 3. ローカル env も更新
export GHCR_PAT="<new-PAT>"
# 4. インフラ反映 (Container App の secret が更新される)
npm run deploy:infra
# 5. 旧 PAT を GitHub 設定から revoke
```

### 10.2 JWT_SECRET / ENCRYPTION_KEY のローテーション

**注意**: これらを変更すると、既存ユーザーのセッション JWT と暗号化済みアクセストークンが全て無効になる。ユーザーは再ログインが必要。

```bash
azd env set JWT_SECRET     "<new>"
azd env set ENCRYPTION_KEY "<new>"
npm run deploy:infra
```

### 10.3 Cosmos DB キーの再生成

```bash
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
COSMOS_NAME=$(az cosmosdb list -g $RG --query "[0].name" -o tsv)
az cosmosdb keys regenerate -g $RG -n $COSMOS_NAME --key-kind primary
# Bicep は次回 provision 時に listKeys() で最新値を取りに行くので再プロビジョン
npm run deploy:infra
```

---

## 11. コスト確認

### 11.1 現時点までの使用量

```bash
SUB=$(az account show --query id -o tsv)
az consumption usage list \
  --start-date $(date -d '1 month ago' +%Y-%m-01) \
  --end-date $(date +%Y-%m-%d) \
  --subscription $SUB \
  --query "[?contains(instanceName, 'questara')].[instanceName, pretaxCost]" \
  -o table
```

### 11.2 Portal で確認

**Cost Management → Cost analysis** でリソースグループ `rg-questara-prod` をフィルタ。

### 11.3 予算アラート設定（任意）

```bash
az consumption budget create \
  --budget-name questara-monthly \
  --amount 3000 \
  --category cost \
  --time-grain Monthly \
  --start-date $(date +%Y-%m-01) \
  --end-date 2030-12-31 \
  --resource-group $RG
```

---

## 12. 環境の削除（クリーンアップ）

```bash
azd down --purge --force
```

- `--purge`: Cosmos DB 等の soft-delete も強制解除（復元不可）
- `--force`: 確認プロンプトなしで削除

ghcr.io の image は別途削除:

1. [https://github.com/users/<user>/packages](https://github.com/users/) → questara → Package settings → Delete

---

## 13. トラブルシューティング

### デプロイ時

| 症状 | 原因 / 確認ポイント |
|---|---|
| `azd provision` で `QuotaExceeded` | サブスクリプションの vCPU quota 不足。リージョン変更 (`azd env set AZURE_LOCATION eastus`) または [quota 申請](https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade) |
| `docker push` で 403 / unauthorized | PAT の scope (`write:packages`)、Organization 所属なら SSO 承認を確認 |
| `az containerapp update` で timeout | Container Apps の provisioning に時間がかかることがある。再実行 |
| Bicep のバリデーションで `InvalidTemplate` | `azd provision --preview` で詳細確認 |

### アプリ実行時

| 症状 | 原因 / 確認ポイント |
|---|---|
| コンテナが起動しない（`Starting` のまま） | `az containerapp logs show --follow` で起動時エラーを確認。多くは env vars 不足・Cosmos 接続失敗 |
| OAuth で `redirect_uri_mismatch` | GitHub OAuth App の callback URL が本番 URL と一致していない |
| OAuth 後に 500 エラー | `JWT_SECRET` / `ENCRYPTION_KEY` が変更されてセッション復号失敗。ユーザーは再ログインで解消 |
| 問題生成 (LLM) が失敗 | ログインユーザーの GitHub アカウントが Copilot プランに加入していない、または GitHub Models の rate limit に到達 |
| 問題生成が途中で止まる | MCP/HTML スクレイピングのタイムアウト。ドメイン名で部分ヒットできているか確認 |
| Cosmos で 429 (TooManyRequests) | Serverless のアカウント上限。クエリの効率化 or Provisioned Throughput への切り替え検討 |

### 診断コマンド集

```bash
# Container App の状態
az containerapp show --name $APP --resource-group $RG --query "{status:properties.runningStatus, fqdn:properties.configuration.ingress.fqdn}"

# 最新 revision
az containerapp revision list --name $APP --resource-group $RG -o table

# 現在の image
az containerapp show --name $APP --resource-group $RG --query "properties.template.containers[0].image" -o tsv

# 環境変数（secretRef は値 ×、 key のみ）
az containerapp show --name $APP --resource-group $RG --query "properties.template.containers[0].env"

# Cosmos の capability (Serverless か)
az cosmosdb show -g $RG -n $COSMOS_NAME --query "capabilities"
```

---

## 14. よくある運用作業チートシート

| やりたいこと | コマンド |
|---|---|
| コードだけ更新して再デプロイ | `npm run deploy` |
| Bicep だけ更新 | `npm run deploy:infra` |
| スケール上限を 10 にする | `infra/resources.bicep` の `maxReplicas` 変更 → `npm run deploy:infra` |
| 環境変数を追加 | `infra/resources.bicep` の `env:` に追加 → `azd env set` → `npm run deploy:infra` |
| ログを追跡 | `az containerapp logs show --name <app> -g <rg> --follow` |
| イメージを過去にロールバック | `az containerapp update --image ghcr.io/<u>/questara:<past-sha>` |
| 環境一式を削除 | `azd down --purge` |
| PAT を差し替え | `azd env set GHCR_PAT <new>` → `export GHCR_PAT=<new>` → `npm run deploy:infra` |

---

## 15. 参考リンク

- [Azure Container Apps ドキュメント](https://learn.microsoft.com/azure/container-apps/)
- [Azure Cosmos DB Serverless](https://learn.microsoft.com/azure/cosmos-db/serverless)
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub Models API](https://docs.github.com/en/github-models)
