// 各テストファイル実行前にロードされる setup
import { CosmosClient } from '@azure/cosmos';

const required = ['JWT_SECRET', 'ENCRYPTION_KEY', 'COSMOS_ENDPOINT', 'COSMOS_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`[test setup] ${key} が .env.test に設定されていません`);
  }
}

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
  connectionPolicy: { requestTimeout: 5000 },
});
try {
  await client.getDatabaseAccount();
} catch (err) {
  throw new Error(
    `[test setup] Cosmos DB Emulator に接続できません (${process.env.COSMOS_ENDPOINT}): ${err.message}\n` +
      `  docker compose -p cert-quiz -f docker-compose.yml up -d cosmos-emulator で起動してください`
  );
}
