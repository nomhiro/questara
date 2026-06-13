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

  test('未認証で / は 200 とランディングを返す', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Questara');
  });

  test('認証済み GET / は 200 とランディング(学習を再開CTA)を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('学習を再開');
  });

  test('認証済み GET /certifications は 200 と資格一覧を返す', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'test-public-1', name: 'パブリック資格', isPublic: true });

    const agent = await authedAgent(user);
    const res = await agent.get('/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('パブリック資格');
  });

  test('GET /certifications は公開資格と自作の非公開資格を両方レンダリング', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-1', name: 'パブリック資格A', isPublic: true });
    await createTestCertification({ id: 'priv-1', name: '自分の非公開資格', createdBy: user.id, creatorName: user.username, isPublic: false });
    await createTestCertification({ id: 'other-priv', name: '他人の非公開資格', createdBy: 'github-99999', creatorName: 'other', isPublic: false });

    const agent = await authedAgent(user);
    const res = await agent.get('/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('パブリック資格A');
    expect(res.text).toContain('自分の非公開資格');
    expect(res.text).not.toContain('他人の非公開資格');
    expect(res.text).toContain('公開資格');
    expect(res.text).toContain('すべて');
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
