targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('azd 環境名。リソース命名のハッシュ元に使用')
param environmentName string

@minLength(1)
@description('全リソースを配置するリージョン')
param location string

@secure()
@minLength(32)
@description('JWT 署名用シークレット（32文字以上）')
param jwtSecret string

@secure()
@minLength(64)
@maxLength(64)
@description('API キー暗号化用の 64 文字 hex 文字列（32 バイト）')
param encryptionKey string

@description('GitHub OAuth App の Client ID')
param githubClientId string

@secure()
@description('GitHub OAuth App の Client Secret')
param githubClientSecret string

@description('GitHub Container Registry のユーザー名または organization')
param ghcrUsername string

@secure()
@description('GitHub PAT (read:packages 必須、push も同 PAT で賄うなら write:packages も)')
param ghcrPat string

@description('Cosmos DB データベース名')
param cosmosDatabaseName string = 'cert-quiz'

@description('リソースグループ名（空なら自動生成）')
param resourceGroupName string = ''

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
}

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: !empty(resourceGroupName) ? resourceGroupName : '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

module resources './resources.bicep' = {
  scope: rg
  name: 'resources'
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
    abbrs: abbrs
    jwtSecret: jwtSecret
    encryptionKey: encryptionKey
    githubClientId: githubClientId
    githubClientSecret: githubClientSecret
    cosmosDatabaseName: cosmosDatabaseName
    ghcrUsername: ghcrUsername
    ghcrPat: ghcrPat
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output SERVICE_WEB_NAME string = resources.outputs.containerAppName
output SERVICE_WEB_ENDPOINT_URL string = resources.outputs.webAppUrl
output COSMOS_ENDPOINT string = resources.outputs.cosmosEndpoint
output COSMOS_DATABASE string = cosmosDatabaseName
output GHCR_USERNAME string = ghcrUsername
