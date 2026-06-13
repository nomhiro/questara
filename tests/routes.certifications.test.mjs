import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const userService = require('../services/userService');

describe('routes/certifications', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('GET /my/certifications → 空状態メッセージ', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('まだお気に入りの資格がありません');
  });

  test('POST /my/certifications/new で新規作成', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.post('/my/certifications/new').type('form').send({
      id: 'user-cert-1', name: 'テスト資格',
      studyGuideUrl: '', courseUrl: '',
      domainsJson: JSON.stringify([{ id: 'domain-1', name: 'D1', weight: 100 }]),
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/my/certifications');

    const list = await agent.get('/my/certifications');
    expect(list.text).toContain('テスト資格');
    expect(list.text).toContain('非公開');
  });

  test('POST /my/certifications/:id/publish で公開', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'user-cert-2', createdBy: user.id, creatorName: user.username, isPublic: false });
    const agent = await authedAgent(user);
    const res = await agent.post('/my/certifications/user-cert-2/publish');
    expect(res.status).toBe(302);

    const list = await agent.get('/my/certifications');
    expect(list.text).toContain('公開中');
  });

  test('他人の資格を publish しようとすると 403', async () => {
    const owner = await createTestUser({ githubId: 111 });
    const other = await createTestUser({ githubId: 222 });
    await createTestCertification({ id: 'user-cert-3', createdBy: owner.id, creatorName: owner.username, isPublic: false });
    const agent = await authedAgent(other);
    const res = await agent.post('/my/certifications/user-cert-3/publish');
    expect(res.status).toBe(403);
  });

  test('POST /my/certifications/:id/delete で削除', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'user-cert-4', createdBy: user.id, creatorName: user.username, isPublic: false });
    const agent = await authedAgent(user);
    const res = await agent.post('/my/certifications/user-cert-4/delete');
    expect(res.status).toBe(302);

    const list = await agent.get('/my/certifications');
    expect(list.text).not.toContain('user-cert-4');
  });

  test('favorite/unfavorite が stats を更新し returnTo にリダイレクト', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-fav', isPublic: true });
    const agent = await authedAgent(user);

    let res = await agent.post('/my/certifications/pub-fav/favorite').type('form').send({ returnTo: '/free-mode' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/free-mode');
    let u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).toContain('pub-fav');

    res = await agent.post('/my/certifications/pub-fav/unfavorite').type('form').send({ returnTo: '/free-mode' });
    expect(res.status).toBe(302);
    u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).not.toContain('pub-fav');
  });

  test('pass/unpass が stats を更新する', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-pass', isPublic: true });
    const agent = await authedAgent(user);

    await agent.post('/my/certifications/pub-pass/pass').type('form').send({ returnTo: '/certifications/pub-pass' });
    let u = await userService.getUserById(user.id);
    expect(u.stats.passedCertifications.map((p) => p.certId)).toContain('pub-pass');

    await agent.post('/my/certifications/pub-pass/unpass').type('form').send({});
    u = await userService.getUserById(user.id);
    expect(u.stats.passedCertifications.map((p) => p.certId)).not.toContain('pub-pass');
  });

  test('不正な returnTo は /my/certifications にフォールバック', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pub-rt', isPublic: true });
    const agent = await authedAgent(user);
    const res = await agent.post('/my/certifications/pub-rt/favorite').type('form').send({ returnTo: 'https://evil.com' });
    expect(res.headers.location).toBe('/my/certifications');
  });

  test('資格作成時に作成者のお気に入りへ自動追加される', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/new').type('form').send({
      id: 'auto-fav', name: '自動お気に入り', studyGuideUrl: '', courseUrl: '',
      domainsJson: JSON.stringify([{ id: 'domain-1', name: 'D1', weight: 100 }]),
    });
    const u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).toContain('auto-fav');
  });

  test('資格削除時にお気に入り/合格から除去される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'del-fav', createdBy: user.id, creatorName: user.username, isPublic: false });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/del-fav/favorite').type('form').send({ returnTo: '/my/certifications' });
    await agent.post('/my/certifications/del-fav/pass').type('form').send({ returnTo: '/my/certifications' });
    await agent.post('/my/certifications/del-fav/delete');
    const u = await userService.getUserById(user.id);
    expect(u.stats.favoriteCertifications).not.toContain('del-fav');
    expect(u.stats.passedCertifications.map((p) => p.certId)).not.toContain('del-fav');
  });

  test('お気に入り登録した公開資格がマイ資格に表示される', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'gh-seed', name: 'GHシード資格', createdBy: 'system', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/gh-seed/favorite').type('form').send({ returnTo: '/my/certifications' });
    const res = await agent.get('/my/certifications');
    expect(res.text).toContain('GHシード資格');
  });

  test('既存の自作資格は初回ロードでバックフィルされマイ資格に出る', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'own-bf', name: '自作バックフィル資格', createdBy: user.id, creatorName: user.username, isPublic: false });
    const agent = await authedAgent(user);
    const res = await agent.get('/my/certifications');
    expect(res.text).toContain('自作バックフィル資格');
  });

  test('合格済みの資格には🎓バッジが付く', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'pass-badge', name: '合格バッジ資格', isPublic: true });
    const agent = await authedAgent(user);
    await agent.post('/my/certifications/pass-badge/favorite').type('form').send({ returnTo: '/my/certifications' });
    await agent.post('/my/certifications/pass-badge/pass').type('form').send({ returnTo: '/my/certifications' });
    const res = await agent.get('/my/certifications');
    expect(res.text).toContain('🎓');
  });
});
