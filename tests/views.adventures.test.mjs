import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

describe('adventure & profile views render without 500', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('views/adventure-new.ejs', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/adventures/new');
    expect(res.status).toBe(200);
  });

  test('views/adventure-detail.ejs', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'gh-100', name: 'GitHub Foundations' });
    const agent = await authedAgent(user);
    const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    const id = created.headers.location.replace('/adventures/', '');
    const res = await agent.get(`/adventures/${id}`);
    expect(res.status).toBe(200);
  });

  test('views/adventure-map.ejs (ホーム) はアクティブ冒険があれば 200', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'gh-100', name: 'GitHub Foundations' });
    const agent = await authedAgent(user);
    await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('冒険');
  });

  test('views/profile.ejs', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
  });
});
