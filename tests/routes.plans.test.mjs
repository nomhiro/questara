import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

describe('routes/plans', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('GET /plans は 200 + 空リスト表示', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/plans');
    expect(res.status).toBe(200);
    expect(res.text).toContain('学習計画がまだありません');
  });

  test('POST /plans で計画作成 → 一覧に反映', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'plan-c-1', name: '計画テスト資格' });
    const agent = await authedAgent(user);
    const examDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await agent.post('/plans').type('form').send({ certificationId: 'plan-c-1', examDate });
    expect(res.status).toBe(302);

    const list = await agent.get('/plans');
    expect(list.text).toContain('計画テスト資格');
    expect(list.text).toContain('今週のタスク');
  });

  test('POST /plans/:certId/delete で削除', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'plan-c-2' });
    const agent = await authedAgent(user);
    const examDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await agent.post('/plans').type('form').send({ certificationId: 'plan-c-2', examDate });

    const del = await agent.post('/plans/plan-c-2/delete');
    expect(del.status).toBe(302);

    const list = await agent.get('/plans');
    expect(list.text).toContain('学習計画がまだありません');
  });
});
