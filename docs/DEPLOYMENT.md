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
**アプリデプロイ（推奨）**: GitHub Actions `.github/workflows/cd.yml`（main push で自動発火）
**アプリデプロイ（ローカル・緊急時）**: `scripts/deploy.mjs`（`npm run deploy`）

### 1.1 運用フローの使い分け

| シーン | 手段 | 実体 |
|---|---|---|
| 日常のコード変更反映 | `main` への push / PR マージ | `.github/workflows/cd.yml`（build → GHCR push → `az containerapp update` → smoke test） |
| Bicep / インフラ変更 | GitHub Actions を手動起動 | `.github/workflows/infra.yml`（`workflow_dispatch`、`azd provision`） |
| 緊急ホットフィックス | ローカルから即時反映 | `npm run deploy`（`scripts/deploy.mjs`） |
| 初回プロビジョン | GitHub Actions を手動起動（OIDC セットアップ後） | `.github/workflows/infra.yml` |

GitHub Actions 経由のデプロイは OIDC（Federated Credential）でシークレットレスに Azure を叩く。長期 Service Principal シークレットは発行しない方針。

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

1. [https://github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. 以下を入力（URL は仮置きでよい。デプロイ後に本物の URL に更新する）
   - **Homepage URL**: `https://example.com`
   - **Authorization callback URL**: `https://example.com/auth/github/callback`
3. 発行された `Client ID` と `Client Secret` を控える

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

```powershell
$jwt = node -r crypto -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
azd env set JWT_SECRET $jwt
$enc = node -r crypto -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
azd env set ENCRYPTION_KEY $enc
azd env set GITHUB_CLIENT_ID "<3.3 で控えた Client ID>"
azd env set GITHUB_CLIENT_SECRET "<3.3 で控えた Client Secret>"
azd env set GHCR_USERNAME "<GitHub ユーザー名 or organization>"
azd env set GHCR_PAT "<3.4 で作成した PAT>"
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
2. 「GitHub でログインして始める」→ OAuth 認可 → `/my/certifications`（マイ資格）に遷移
3. `/free-mode`（資格一覧）から公開資格を選ぶ、または `/my/certifications/new` で独自資格を追加

### 3.11 GitHub Actions OIDC セットアップ（初回 1 回のみ）

以降のデプロイ（アプリ & インフラ）を GitHub Actions から実行するための Azure AD 側の設定。

```bash
ORG_REPO="<OWNER>/<REPO>"           # 例: nomhiro1204/questara
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
SUB_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

# 1. App Registration 作成
az ad app create --display-name questara-github-oidc
APP_ID=$(az ad app list --display-name questara-github-oidc --query '[0].appId' -o tsv)
az ad sp create --id "$APP_ID"

# 2. Federated Credential（main ブランチ向け）
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"questara-main\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${ORG_REPO}:ref:refs/heads/main\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"

# 3. RBAC（Resource Group 単位で Contributor を付与）
az role assignment create \
  --assignee "$APP_ID" --role "Contributor" \
  --scope "/subscriptions/${SUB_ID}/resourceGroups/${RG}"

# 4. GitHub 側に登録する値
echo "AZURE_CLIENT_ID=$APP_ID"
echo "AZURE_TENANT_ID=$TENANT_ID"
echo "AZURE_SUBSCRIPTION_ID=$SUB_ID"
echo "AZURE_RESOURCE_GROUP=$RG"
echo "CONTAINER_APP_NAME=$(azd env get-value SERVICE_WEB_NAME)"
```

```powershell
$OrgRepo   = "<OWNER>/<REPO>"        # 例: nomhiro1204/questara
$Rg        = azd env get-value AZURE_RESOURCE_GROUP
$SubId     = az account show --query id -o tsv
$TenantId  = az account show --query tenantId -o tsv

# 1. App Registration 作成
az ad app create --display-name questara-github-oidc | Out-Null
$AppId = az ad app list --display-name questara-github-oidc --query "[0].appId" -o tsv
az ad sp create --id $AppId | Out-Null

# 2. Federated Credential（main ブランチ向け）
#    PowerShell の引用符エスケープ問題を避けるため一時 JSON ファイル経由で渡す
$fic = @{
  name     = "questara-main"
  issuer   = "https://token.actions.githubusercontent.com"
  subject  = "repo:$OrgRepo`:ref:refs/heads/main"
  audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json -Compress
$ficPath = Join-Path $env:TEMP "questara-fic.json"
$fic | Out-File -FilePath $ficPath -Encoding ascii
az ad app federated-credential create --id $AppId --parameters "@$ficPath"
Remove-Item $ficPath

# 3. RBAC（Resource Group 単位で Contributor を付与）
az role assignment create `
  --assignee $AppId --role "Contributor" `
  --scope "/subscriptions/$SubId/resourceGroups/$Rg"

# 4. GitHub 側に登録する値
$ContainerApp = azd env get-value SERVICE_WEB_NAME
Write-Host "AZURE_CLIENT_ID=$AppId"
Write-Host "AZURE_TENANT_ID=$TenantId"
Write-Host "AZURE_SUBSCRIPTION_ID=$SubId"
Write-Host "AZURE_RESOURCE_GROUP=$Rg"
Write-Host "CONTAINER_APP_NAME=$ContainerApp"
```

`workflow_dispatch` も起動ブランチの ref claim で認証できるため、main からの手動起動は上記の credential でそのまま通る。feature ブランチから `infra.yml` を走らせたい場合のみ、該当ブランチ用に federated credential を追加する。

### 3.12 GitHub リポジトリに Secrets / Variables を登録

**Secrets（Settings → Secrets and variables → Actions → Secrets）:**

| 名前 | 値 |
|---|---|
| `AZURE_CLIENT_ID` | 3.11 の `APP_ID` |
| `AZURE_TENANT_ID` | 3.11 の `TENANT_ID` |
| `AZURE_SUBSCRIPTION_ID` | 3.11 の `SUB_ID` |
| `APP_JWT_SECRET` | 3.6 の `JWT_SECRET` と同じ値（infra.yml から azd env へ注入） |
| `APP_ENCRYPTION_KEY` | 3.6 の `ENCRYPTION_KEY` |
| `APP_GITHUB_CLIENT_ID` | 3.3 の OAuth App Client ID |
| `APP_GITHUB_CLIENT_SECRET` | 3.3 の OAuth App Client Secret |
| `APP_GHCR_USERNAME` | 3.6 の `GHCR_USERNAME` |
| `APP_GHCR_PAT` | 3.4 の PAT（Container App が GHCR から pull するのに使用。`read:packages` だけでも可） |

**Variables（同画面の Variables タブ）:**

| 名前 | 値 |
|---|---|
| `AZURE_RESOURCE_GROUP` | 3.11 の `$RG`（例: `rg-questara-prod`） |
| `CONTAINER_APP_NAME` | `azd env get-value SERVICE_WEB_NAME` の値（例: `ca-web-xxxxxx`） |

> `GITHUB_TOKEN` は自動付与されるため登録不要。GHCR への push はこのトークンで行う（`packages: write` permission）。

### 3.13 GitHub Actions で初回 provision（azd を CI 経由で実行）

ローカルの `npm run deploy` で済んでいる場合は不要。CI 経由で初回構築する場合のみ:

1. GitHub → Actions → `Infra (azd provision)` → **Run workflow**
2. `env_name` に `questara-prod`、`azure_location` に `japaneast` を指定
3. 成功すると Azure にリソース一式が作成され、Container App 名を 3.12 の `CONTAINER_APP_NAME` variable に反映

---

## 4. 継続的デプロイ（コード変更の反映）

### 4.1 推奨: GitHub Actions (main マージで自動)

1. feature ブランチで実装 → PR 作成（PR 上で `CI` workflow が lint + test を実行）
2. main にマージ
3. `CD` workflow が自動発火し、以下を実行:
   - `ci.yml` の再利用ジョブで lint + test
   - GHCR に `ghcr.io/<owner>/questara:sha-<shortsha>` と `:latest` を push
   - Azure OIDC ログイン → `az containerapp update --image <sha タグ>`
   - FQDN に対する HTTP 200 スモークテスト
4. GitHub → Actions → 該当 run の Summary に デプロイした image / URL が表示される

トリガは `paths-ignore: ['infra/**', 'docs/**', '**.md']`。ドキュメントや Bicep 単体の変更ではアプリイメージを作り直さない。Bicep 変更は `infra.yml` を手動起動する。

### 4.2 ロールバック

```bash
APP=$(azd env get-value SERVICE_WEB_NAME)
RG=$(azd env get-value AZURE_RESOURCE_GROUP)
USER=$(azd env get-value GHCR_USERNAME)

# 過去のコミットの short SHA を指定
az containerapp update --name "$APP" --resource-group "$RG" \
  --image "ghcr.io/${USER}/questara:sha-<prev-sha>"
```

```powershell
$App  = azd env get-value SERVICE_WEB_NAME
$Rg   = azd env get-value AZURE_RESOURCE_GROUP
$User = azd env get-value GHCR_USERNAME

az containerapp update --name $App --resource-group $Rg `
  --image "ghcr.io/$User/questara:sha-<prev-sha>"
```

または Azure Portal で Container App → Revisions → 該当 revision を Activate。

### 4.3 緊急ローカルデプロイ（GitHub Actions が使えない時）

```bash
npm run deploy
```

`scripts/deploy.mjs` が `azd provision` → docker build/push → `az containerapp update` を直列実行する。通常は CI に任せ、ローカル実行は CI 障害時や検証目的に限定する。

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

1. GitHub で新 PAT を作成（`read:packages`。`write:packages` はローカル `npm run deploy` を使う場合のみ）
2. リポジトリ Secrets の `APP_GHCR_PAT` を新値に更新
3. GitHub → Actions → **Infra (azd provision)** を手動実行（新 PAT が Container App secret に反映される）
4. 旧 PAT を GitHub 設定から revoke

ローカル環境も併用するなら、並行して `azd env set GHCR_PAT <new>` と `export GHCR_PAT=<new>` も実施。

### 10.2 JWT_SECRET / ENCRYPTION_KEY のローテーション

**注意**: これらを変更すると、既存ユーザーのセッション JWT と暗号化済みアクセストークンが全て無効になる。ユーザーは再ログインが必要。

1. リポジトリ Secrets の `APP_JWT_SECRET` / `APP_ENCRYPTION_KEY` を更新
2. GitHub → Actions → **Infra (azd provision)** を手動実行

必要ならローカル `azd env` も同期:

```bash
azd env set JWT_SECRET     "<new>"
azd env set ENCRYPTION_KEY "<new>"
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
| GitHub Actions の `azure/login` で `AADSTS70021` / `no matching federated identity` | `az ad app federated-credential list --id <APP_ID>` で subject を確認。`repo:<OWNER>/<REPO>:ref:refs/heads/main` と正確に一致しているか、または `workflow_dispatch` 実行元のブランチが一致しているか |
| CD workflow で `az containerapp update` が `AuthorizationFailed` | Service Principal に Resource Group スコープの `Contributor` が付与されているか (`az role assignment list --assignee <APP_ID>`) |
| CD の smoke test が 403 / 502 を返す | 新 revision が Active になる前に叩いている可能性。workflow 内のリトライを待つ。`az containerapp revision list` で最新 revision の `provisioningState` と `healthState` を確認 |

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

| やりたいこと | コマンド / 手段 |
|---|---|
| コードだけ更新して再デプロイ | `main` に push（CD workflow が自動発火） |
| 緊急ローカルデプロイ | `npm run deploy` |
| Bicep だけ更新 | GitHub Actions → **Infra (azd provision)** を手動実行 |
| Bicep 更新をプレビュー | 同上、`preview_only` を `true` にして実行 |
| スケール上限を 10 にする | `infra/resources.bicep` の `maxReplicas` 変更 → Infra workflow を実行 |
| 環境変数を追加 | `infra/resources.bicep` の `env:` に追加 → リポジトリ Secrets に追加 → Infra workflow を実行 |
| ログを追跡 | `az containerapp logs show --name <app> -g <rg> --follow` |
| イメージを過去にロールバック | `az containerapp update --image ghcr.io/<u>/questara:sha-<past-sha>` |
| 環境一式を削除 | `azd down --purge` |
| PAT を差し替え | Secrets の `APP_GHCR_PAT` 更新 → Infra workflow を実行 |

---

## 15. 参考リンク

- [Azure Container Apps ドキュメント](https://learn.microsoft.com/azure/container-apps/)
- [Azure Cosmos DB Serverless](https://learn.microsoft.com/azure/cosmos-db/serverless)
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub Models API](https://docs.github.com/en/github-models)
