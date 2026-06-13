import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('routes/profile', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証は / へリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('認証済みはプロフィール画面 200 とユーザー名・Lv 表示', async () => {
    const user = await createTestUser({ displayName: 'テスト勇者' });
    const agent = await authedAgent(user);
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
    expect(res.text).toContain('テスト勇者');
    expect(res.text).toContain('Lv.');
    expect(res.text).toContain('実績');
  });

  test('実績グリッドに全マスターエントリが描画される', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
    // data/achievements.json にある名前が描画されること（複数チェック）
    expect(res.text).toContain('旅立ち');
    expect(res.text).toContain('七日修行');
    expect(res.text).toContain('連撃の極意');
  });

  test('合格した資格がステータスの合格資格セクションに表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'prof-pass', name: '合格資格X', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/prof-pass/pass').type('form').send({ returnTo: '/certifications/prof-pass' });
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
    expect(res.text).toContain('🎓 合格資格');
    expect(res.text).toContain('合格資格X');
  });
});
