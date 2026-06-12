import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

// routes/domains.js（ドメイン詳細表示）の characterization test。
// 200 描画と 404（資格・ドメイン不在）分岐を固定する。
describe('routes/domains ドメイン詳細', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証は / にリダイレクト', async () => {
    const res = await (await anonAgent()).get('/certifications/c1/domains/domain-1');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('存在する資格・ドメインは 200 でドメイン名を描画', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-dom-1' });
    const agent = await authedAgent(user);
    const res = await agent.get(`/certifications/${cert.id}/domains/domain-1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Domain 1: テストドメイン');
  });

  test('存在しない資格は 404', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/certifications/nope/domains/domain-1');
    expect(res.status).toBe(404);
    expect(res.text).toContain('資格が見つかりません');
  });

  test('存在しないドメインは 404', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-dom-2' });
    const agent = await authedAgent(user);
    const res = await agent.get(`/certifications/${cert.id}/domains/nope`);
    expect(res.status).toBe(404);
    expect(res.text).toContain('ドメインが見つかりません');
  });
});
