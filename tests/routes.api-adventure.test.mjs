import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

// routes/api-adventure.js（冒険生成 SSE）の characterization test。
// LLM/MCP を叩く adventureGeneratorService.generateFromPrompt と
// userService.getGithubAccessToken をスパイ化し、現状の挙動（フレーム形式・
// error フィールド名 = error・400 分岐）を固定する。createAdventure/setActive は実 DB。
const _require = createRequire(import.meta.url);
const adventureGenerator = _require('../services/adventureGeneratorService');
const userService = _require('../services/userService');
const _orig = {
  generateFromPrompt: adventureGenerator.generateFromPrompt,
  getGithubAccessToken: userService.getGithubAccessToken,
};

const validated = {
  name: 'テスト冒険',
  description: '説明',
  userPrompt: 'developer になりたい',
  dungeons: ['gh-100', 'gh-200'],
  rationale: '根拠',
  citations: [],
  verificationStatus: 'unverified',
};

beforeAll(async () => {
  await setupTestDb();
  adventureGenerator.generateFromPrompt = vi.fn(async () => validated);
  userService.getGithubAccessToken = vi.fn(async () => 'fake-token');
});
afterAll(() => {
  adventureGenerator.generateFromPrompt = _orig.generateFromPrompt;
  userService.getGithubAccessToken = _orig.getGithubAccessToken;
});
beforeEach(async () => {
  await truncateAll();
  adventureGenerator.generateFromPrompt.mockImplementation(async () => validated);
  userService.getGithubAccessToken.mockImplementation(async () => 'fake-token');
});

describe('routes/api-adventure 冒険生成 SSE', () => {
  test('未認証は / にリダイレクト', async () => {
    const res = await (await anonAgent()).post('/api/adventures/generate').send({ userPrompt: 'x' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('GitHub トークンが無ければ 400 + JSON', async () => {
    const user = await createTestUser();
    userService.getGithubAccessToken.mockResolvedValueOnce(null);
    const agent = await authedAgent(user);
    const res = await agent.post('/api/adventures/generate').send({ userPrompt: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('アクセストークン');
  });

  test('成功時は SSE で progress→done を流し adventureId を返す', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.post('/api/adventures/generate').send({ userPrompt: 'developer' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('adventureId');
  });

  test('生成失敗時は event: error を流す（フィールド名は error）', async () => {
    const user = await createTestUser();
    adventureGenerator.generateFromPrompt.mockRejectedValueOnce(new Error('生成失敗'));
    const agent = await authedAgent(user);
    const res = await agent.post('/api/adventures/generate').send({ userPrompt: 'x' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('生成失敗');
    // 現状の error フィールド名は `error`（api.js の `message` と不一致 = D-14 の対象）
    const errFrame = res.text.split('\n\n').find((f) => f.includes('event: error'));
    expect(errFrame).toContain('"error"');
  });
});
