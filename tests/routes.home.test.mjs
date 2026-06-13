import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/home — ダッシュボード', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証 GET /home は / にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/home');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('認証済み GET /home は 200 と勇者名を返す', async () => {
    const user = await createTestUser({ displayName: 'ホーム勇者' });
    const agent = await authedAgent(user);
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ホーム勇者');
  });

  test('お気に入り登録した資格が「学習中」として表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'home-fav', name: 'ホーム学習資格', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/home-fav/favorite').type('form').send({ returnTo: '/home' });
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ホーム学習資格');
  });

  test('お気に入りが無いときは資格をさがす導線(/certifications)を表示', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/certifications');
  });

  test('ランキング・学習計画への導線がある', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/home');
    expect(res.text).toContain('/ranking');
    expect(res.text).toContain('/plans');
  });
});
