import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

// routes/api.js（問題再生成 SSE）の characterization test。
// LLM/MCP を叩く generationService.generateQuestions と、トークン取得の
// userService.getGithubAccessToken をスパイ化し、現状の挙動（フレーム形式・
// error フィールド名 = message・各 404/400 分岐）を固定する。
const _require = createRequire(import.meta.url);
const generationService = _require('../services/generationService');
const userService = _require('../services/userService');
const _orig = {
  generateQuestions: generationService.generateQuestions,
  getGithubAccessToken: userService.getGithubAccessToken,
};

beforeAll(async () => {
  await setupTestDb();
  generationService.generateQuestions = vi.fn(async () => []);
  userService.getGithubAccessToken = vi.fn(async () => 'fake-token');
});
afterAll(() => {
  generationService.generateQuestions = _orig.generateQuestions;
  userService.getGithubAccessToken = _orig.getGithubAccessToken;
});
beforeEach(async () => {
  await truncateAll();
  generationService.generateQuestions.mockImplementation(async () => []);
  userService.getGithubAccessToken.mockImplementation(async () => 'fake-token');
});

describe('routes/api 問題再生成 SSE', () => {
  test('未認証は / にリダイレクト', async () => {
    const res = await (await anonAgent()).post('/api/certifications/c1/domains/domain-1/generate');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('存在しない資格は 404 + JSON', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.post('/api/certifications/nope/domains/domain-1/generate');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('資格が見つかりません');
  });

  test('存在しないドメインは 404 + JSON', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-1' });
    const agent = await authedAgent(user);
    const res = await agent.post(`/api/certifications/${cert.id}/domains/nope/generate`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ドメインが見つかりません');
  });

  test('GitHub トークンが無ければ 400 + JSON', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-2' });
    userService.getGithubAccessToken.mockResolvedValueOnce(null);
    const agent = await authedAgent(user);
    const res = await agent.post(`/api/certifications/${cert.id}/domains/domain-1/generate`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('GitHubトークン');
  });

  test('成功時は SSE で progress→done を流す', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-3' });
    const agent = await authedAgent(user);
    const res = await agent.post(`/api/certifications/${cert.id}/domains/domain-1/generate`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('event: done');
  });

  test('生成失敗時は event: error を流す（フィールド名は message）', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'cert-api-4' });
    generationService.generateQuestions.mockRejectedValueOnce(new Error('LLM 失敗'));
    const agent = await authedAgent(user);
    const res = await agent.post(`/api/certifications/${cert.id}/domains/domain-1/generate`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('LLM 失敗');
    // 現状の error フィールド名は `message`（api-adventure.js の `error` と不一致 = D-14 の対象）
    const errFrame = res.text.split('\n\n').find((f) => f.includes('event: error'));
    expect(errFrame).toContain('"message"');
  });
});
