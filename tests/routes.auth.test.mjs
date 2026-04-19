import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/auth', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test('GET /auth/login は / に 301 リダイレクト (legacy互換)', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/login');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/');
  });

  test('GET /auth/github は GitHub の認可URLにリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/github');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('github.com/login/oauth/authorize');
  });

  test('GET /auth/github/callback (codeなし) は /?error=no_code にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/github/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?error=no_code');
  });

  test('POST /auth/logout は cookie をクリアして / にリダイレクト', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.headers['set-cookie']?.[0]).toMatch(/cert_quiz_session_test=;/);
  });
});
