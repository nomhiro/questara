// @covers: routes/index.js
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
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

  test('認証済み GET / は 200 と「学習を再開」CTA（→/home）を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('学習を再開');
    expect(res.text).toContain('/home');
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

  test('資格詳細にお気に入り・合格トグルが表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'detail-cert', name: '詳細資格', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.get('/certifications/detail-cert');
    expect(res.status).toBe(200);
    expect(res.text).toContain('☆ お気に入り登録');
    expect(res.text).toContain('🎓 合格した');
  });

  test('お気に入り/合格済みならトグルが解除表示になる', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'detail-cert2', name: '詳細資格2', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/detail-cert2/favorite').type('form').send({ returnTo: '/certifications/detail-cert2' });
    await agent.post('/my/certifications/detail-cert2/pass').type('form').send({ returnTo: '/certifications/detail-cert2' });
    const res = await agent.get('/certifications/detail-cert2');
    expect(res.text).toContain('★ お気に入り解除');
    expect(res.text).toContain('🎓 合格を取り消す');
  });

  test('旧URL /free-mode は /certifications にリダイレクト', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/free-mode');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/certifications');
  });
});

describe('routes/index — 資格統合画面 /certifications', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('GET /certifications は学習中/すべての両タブを描画する', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('学習中');
    expect(res.text).toContain('すべて');
  });

  test('すべてタブに公開資格とお気に入りトグル(returnTo=/certifications)が表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'all-cert', name: 'すべて資格', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.get('/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('すべて資格');
    expect(res.text).toContain('/my/certifications/all-cert/favorite');
    expect(res.text).toContain('value="/certifications"');
  });

  test('学習中タブにお気に入り登録済みの資格が表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'fav-cert', name: '学習中資格', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/fav-cert/favorite').type('form').send({ returnTo: '/certifications' });
    const res = await agent.get('/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('学習中資格');
  });

  test('合格済みの資格には🎓バッジが付く', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pass-cert', name: '合格資格', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/pass-cert/favorite').type('form').send({ returnTo: '/certifications' });
    await agent.post('/my/certifications/pass-cert/pass').type('form').send({ returnTo: '/certifications' });
    const res = await agent.get('/certifications');
    expect(res.text).toContain('🎓');
  });

  test('＋新規追加リンクがある', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/certifications');
    expect(res.text).toContain('/my/certifications/new');
  });

  test('未認証 GET /certifications は / にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/certifications');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
