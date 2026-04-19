// @covers: routes/index.js
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('smoke', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test('未認証で / は /auth/login にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('認証済み GET / は アクティブ冒険なしなら /adventures/new へリダイレクト', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/adventures/new');
  });

  test('認証済み GET /free-mode は 200 と資格一覧を返す', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'test-public-1', name: 'パブリック資格', isPublic: true });

    const agent = await authedAgent(user);
    const res = await agent.get('/free-mode');
    expect(res.status).toBe(200);
    expect(res.text).toContain('パブリック資格');
  });

  test('GET /free-mode は publicCerts と myCerts 両方をレンダリング', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-1', name: 'パブリック資格A', isPublic: true });
    await createTestCertification({ id: 'priv-1', name: '自分の非公開資格', createdBy: user.id, creatorName: user.username, isPublic: false });
    await createTestCertification({ id: 'other-priv', name: '他人の非公開資格', createdBy: 'github-99999', creatorName: 'other', isPublic: false });

    const agent = await authedAgent(user);
    const res = await agent.get('/free-mode');
    expect(res.status).toBe(200);
    expect(res.text).toContain('パブリック資格A');
    expect(res.text).toContain('自分の非公開資格');
    expect(res.text).not.toContain('他人の非公開資格');
    expect(res.text).toContain('公開資格 (1)');
    expect(res.text).toContain('自分の非公開資格 (1)');
  });

  test('認証済み GET /certifications/:id は 200 と詳細を返す', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'test-cert-detail' });

    const agent = await authedAgent(user);
    const res = await agent.get(`/certifications/${cert.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(cert.name);
    expect(res.text).toContain('問');
  });
});
