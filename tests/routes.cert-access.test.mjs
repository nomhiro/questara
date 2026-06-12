import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

// D-17: 非公開資格（isPublic=false かつ非所有者）へのアクセスは全コンテンツ経路で 404。
// 公開資格・自作資格は従来どおりアクセス可能（回帰ガード）。
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

const PRIVATE_CERT = {
  id: 'priv-cert',
  isPublic: false,
  domains: [
    {
      id: 'domain-1', name: 'Secret Domain', weight: 100, generatedAt: null,
      questions: [
        { id: 'priv-cert-d1-001', question: '秘密の問題', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A', explanation: '秘密の解説' },
      ],
    },
  ],
};

describe('資格アクセス制御 (D-17)', () => {
  let owner; let intruder;

  beforeEach(async () => {
    await truncateAll();
    owner = await createTestUser({ githubId: 9001 });
    intruder = await createTestUser({ githubId: 9002 });
    await createTestCertification({ ...PRIVATE_CERT, createdBy: owner.id, creatorName: owner.username });
    await createTestCertification({ id: 'pub-cert' }); // 既定で公開
  });

  test('非所有者は非公開資格の詳細にアクセスできない (404)', async () => {
    const agent = await authedAgent(intruder);
    const res = await agent.get('/certifications/priv-cert');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Secret Domain');
  });

  test('非所有者は非公開資格のドメイン詳細にアクセスできない (404)', async () => {
    const agent = await authedAgent(intruder);
    const res = await agent.get('/certifications/priv-cert/domains/domain-1');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Secret Domain');
  });

  test('非所有者は非公開資格でクイズを開始できない (404)', async () => {
    const agent = await authedAgent(intruder);
    const res = await agent.post('/quiz/start').type('form').send({ certId: 'priv-cert', mode: 'all' });
    expect(res.status).toBe(404);
  });

  test('非所有者は非公開資格の問題生成 (SSE) を呼べない (404 JSON)', async () => {
    const agent = await authedAgent(intruder);
    const res = await agent.post('/api/certifications/priv-cert/domains/domain-1/generate');
    expect(res.status).toBe(404);
  });

  test('クエリ certId を非公開資格に差し替えても問題表示できない (404)', async () => {
    const agent = await authedAgent(intruder);
    // 公開資格で自分の正規セッションを作る
    const start = await agent.post('/quiz/start').type('form').send({ certId: 'pub-cert', mode: 'all' });
    const sessionId = new URL(`http://localhost${start.headers.location}`).pathname.split('/')[2];
    // certId/questions を非公開資格のものに差し替えて問題を覗こうとする
    const res = await agent.get(`/quiz/${sessionId}?questions=priv-cert-d1-001&certId=priv-cert&idx=0`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('秘密の問題');
  });

  test('結果ページもクエリ差し替えを拒否する (404)', async () => {
    const agent = await authedAgent(intruder);
    const start = await agent.post('/quiz/start').type('form').send({ certId: 'pub-cert', mode: 'all' });
    const sessionId = new URL(`http://localhost${start.headers.location}`).pathname.split('/')[2];
    const res = await agent.get(`/quiz/${sessionId}/result?certId=priv-cert`);
    expect(res.status).toBe(404);
  });

  test('復習ページもクエリ差し替えを拒否する (404)', async () => {
    const agent = await authedAgent(intruder);
    const start = await agent.post('/quiz/start').type('form').send({ certId: 'pub-cert', mode: 'all' });
    const sessionId = new URL(`http://localhost${start.headers.location}`).pathname.split('/')[2];
    const res = await agent.get(`/quiz/${sessionId}/review?certId=priv-cert`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('秘密の解説');
  });

  test('所有者は自分の非公開資格にアクセスできる (200)', async () => {
    const agent = await authedAgent(owner);
    const res = await agent.get('/certifications/priv-cert');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Secret Domain');
  });

  test('公開資格は誰でもアクセスできる (200・回帰ガード)', async () => {
    const agent = await authedAgent(intruder);
    const res = await agent.get('/certifications/pub-cert');
    expect(res.status).toBe(200);
  });
});
