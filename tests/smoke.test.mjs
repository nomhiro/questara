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

  test('認証済み GET / は 200 と資格一覧を返す', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'test-public-1', name: 'パブリック資格', isPublic: true });

    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('パブリック資格');
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
