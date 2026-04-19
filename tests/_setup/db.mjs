/**
 * テスト用 Cosmos DB 管理ヘルパー
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cosmosService = require('../../services/cosmosService');

const CONTAINERS = ['users', 'certifications', 'sessions', 'studyPlans'];

let initialized = false;

export async function setupTestDb() {
  if (!initialized) {
    await cosmosService.init();
    initialized = true;
  }
}

export async function truncateAll() {
  for (const name of CONTAINERS) {
    const container = cosmosService.getContainer(name);
    const { resources } = await container.items.query('SELECT c.id, c.userId FROM c').fetchAll();
    for (const item of resources) {
      const partitionKey = item.userId !== undefined ? item.userId : item.id;
      try {
        await container.item(item.id, partitionKey).delete();
      } catch (err) {
        if (err.code !== 404) throw err;
      }
    }
  }
}
