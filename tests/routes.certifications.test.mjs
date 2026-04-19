import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

describe('routes/certifications', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('GET /my/certifications → 空リスト', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/certifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('まだ資格を作成していません');
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
});
