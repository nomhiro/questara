param location string
param resourceToken string
param tags object
param abbrs object

@secure()
param jwtSecret string

@secure()
param encryptionKey string

param githubClientId string

@secure()
param githubClientSecret string

param cosmosDatabaseName string

@description('GitHub Container Registry のユーザー名または organization 名')
param ghcrUsername string

@secure()
@description('GitHub PAT (少なくとも read:packages 権限)。Container App が ghcr.io から pull するため')
param ghcrPat string

// azure.yaml の service 名と一致させる
var serviceName = 'web'

// ---------- Log Analytics ----------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: { name: 'PerGB2018' }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

// ---------- Container Apps Environment ----------
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${abbrs.appManagedEnvironments}${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// ---------- Cosmos DB (Serverless) ----------
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: '${abbrs.documentDBDatabaseAccounts}${resourceToken}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      { locationName: location, failoverPriority: 0, isZoneRedundant: false }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: { tier: 'Continuous7Days' }
    }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: { resource: { id: cosmosDatabaseName } }
}

var cosmosContainers = [
  { id: 'users', partitionKey: '/id' }
  { id: 'certifications', partitionKey: '/id' }
  { id: 'sessions', partitionKey: '/userId' }
  { id: 'studyPlans', partitionKey: '/userId' }
]

resource cosmosContainerResources 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in cosmosContainers: {
  parent: cosmosDatabase
  name: c.id
  properties: {
    resource: {
      id: c.id
      partitionKey: { paths: [ c.partitionKey ], kind: 'Hash' }
    }
  }
}]

// ---------- Container App (ghcr.io から pull) ----------
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${abbrs.appContainerApps}${serviceName}-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': serviceName })
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
      registries: [
        {
          server: 'ghcr.io'
          username: ghcrUsername
          passwordSecretRef: 'ghcr-pat'
        }
      ]
      secrets: [
        { name: 'cosmos-key', value: cosmosAccount.listKeys().primaryMasterKey }
        { name: 'jwt-secret', value: jwtSecret }
        { name: 'encryption-key', value: encryptionKey }
        { name: 'github-client-secret', value: githubClientSecret }
        { name: 'ghcr-pat', value: ghcrPat }
      ]
    }
    template: {
      containers: [
        {
          name: serviceName
          // 初回デプロイ用プレースホルダー。npm run deploy が実イメージに置き換える
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }
            { name: 'COSMOS_KEY', secretRef: 'cosmos-key' }
            { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'ENCRYPTION_KEY', secretRef: 'encryption-key' }
            { name: 'GITHUB_CLIENT_ID', value: githubClientId }
            { name: 'GITHUB_CLIENT_SECRET', secretRef: 'github-client-secret' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 5
        rules: [
          {
            name: 'http-concurrency'
            http: { metadata: { concurrentRequests: '30' } }
          }
        ]
      }
    }
  }
}

output containerAppName string = containerApp.name
output webAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
