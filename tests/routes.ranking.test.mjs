import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/ranking', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証で /ranking は /auth/login', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/ranking');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('認証済み GET /ranking は 200', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/ranking');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ランキング');
  });

  test('period=monthly のパラメータを受け付ける', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/ranking?period=monthly');
    expect(res.status).toBe(200);
    expect(res.text).toContain('月次');
  });
});
