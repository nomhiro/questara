import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

const _require = createRequire(import.meta.url);
const cosmosService = _require('../services/cosmosService');

async function seedAvailableCerts() {
  await createTestCertification({ id: 'gh-100', name: 'GitHub Foundations', isPublic: true });
  await createTestCertification({ id: 'gh-200', name: 'GitHub Actions', isPublic: true });
}

describe('routes/adventures', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('GET /adventures/new は 200 とプリセット一覧を返す', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);
    const res = await agent.get('/adventures/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('開発者の道');
  });

  test('POST /adventures/preset（developer）で冒険作成→詳細ページへ', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);
    const res = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/adventures\/adv-/);

    const detail = await agent.get(res.headers.location);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('開発者の道');
  });

  test('POST /adventures/preset で複数道を指定すると冒険名が連結される', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    await createTestCertification({ id: 'ai-102', name: 'AI Engineer', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer', 'ai-engineer'] });
    expect(res.status).toBe(302);
    const detail = await agent.get(res.headers.location);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('×');
  });

  test('POST /adventures/:id/delete で削除→詳細は 404', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);
    const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    const id = created.headers.location.replace('/adventures/', '');

    const del = await agent.post(`/adventures/${id}/delete`);
    expect(del.status).toBe(302);

    const after = await agent.get(`/adventures/${id}`);
    expect(after.status).toBe(404);
  });

  test('GET /adventures は active 冒険があればその詳細へ 302', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);
    const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    const id = created.headers.location.replace('/adventures/', '');

    const res = await agent.get('/adventures');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/adventures/${id}`);
  });

  test('GET /adventures は冒険が無ければ /adventures/new へ 302', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/adventures');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/adventures/new');
  });

  test('POST /adventures/preset は対応する資格が無ければ 400', async () => {
    const user = await createTestUser();
    // seed しない → developer の dungeons (gh-100, gh-200) が未登録で空
    const agent = await authedAgent(user);
    const res = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    expect(res.status).toBe(400);
  });

  test('POST /preset で作成された冒険の全ダンジョンが in-progress で unlockedAt がセットされる', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);
    const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    const id = created.headers.location.replace('/adventures/', '');

    const adv = await cosmosService.read('adventures', id, user.id);
    expect(adv.dungeons.length).toBeGreaterThan(1);
    for (const d of adv.dungeons) {
      expect(d.status).toBe('in-progress');
      expect(d.unlockedAt).toBeTruthy();
      expect(d.clearedAt).toBeNull();
    }
  });

  test('GET /:id で全ダンジョンに「入る」ボタンが表示される（🔒 が出ない）', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);
    const created = await agent.post('/adventures/preset').type('form').send({ presetIds: ['developer'] });
    const id = created.headers.location.replace('/adventures/', '');

    const detail = await agent.get(`/adventures/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).not.toContain('🔒');
    // gh-100 と gh-200 の両方の「入る」リンクが存在
    expect(detail.text).toContain('href="/certifications/gh-100"');
    expect(detail.text).toContain('href="/certifications/gh-200"');
  });

  test('既存の locked ステータスを持つドキュメントも GET 時に正規化されて表示される', async () => {
    const user = await createTestUser();
    await seedAvailableCerts();
    const agent = await authedAgent(user);

    const advId = `adv-${crypto.randomUUID()}`;
    await cosmosService.upsert('adventures', {
      id: advId,
      userId: user.id,
      name: 'レガシー冒険',
      description: '',
      source: 'preset',
      presetId: 'developer',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't1' },
        { certificationId: 'gh-200', order: 2, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
      rationale: '',
      citations: [],
      verificationStatus: 'verified',
      isActive: true,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });

    const detail = await agent.get(`/adventures/${advId}`);
    expect(detail.status).toBe(200);
    expect(detail.text).not.toContain('🔒');
    expect(detail.text).toContain('href="/certifications/gh-200"');
  });
});
