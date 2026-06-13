// @covers: routes/index.js
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/index — landing page', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証 GET / は 200 とランディングを返す', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Questara');
    expect(res.text).toContain('クエスターラ');
  });

  test('未認証 GET / には GitHub ログイン CTA が含まれる', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/auth/github');
    expect(res.text).toMatch(/GitHub.*ログイン/);
  });

  test('認証済み GET / は 200 と「学習を再開」CTA を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('学習を再開');
    expect(res.text).toContain('/my/certifications');
  });

  test('GET /?error=auth_failed でエラーバナーが表示される', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=auth_failed');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/ログイン.*失敗|認可.*失敗/);
  });

  test('GET / には GitHub Models API の説明と公式リンクが含まれる', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('GitHub Models');
    expect(res.text).toMatch(/rate.?limit/i);
    expect(res.text).toContain('docs.github.com/en/github-models');
  });

  test('GET / の Why セクションに「みんなで資格取得」の思いが残っている', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('みんなで資格取得');
  });

  test('GET /?error=no_code でエラーバナー表示', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=no_code');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/応答が不完全/);
  });

  test('GET /?error=token_failed でエラーバナー表示', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=token_failed');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/アクセストークン.*失敗/);
  });

  test('GET /?error=unknown_key では エラーバナー非表示', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/?error=unknown_key');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/⚠/);
  });
});
