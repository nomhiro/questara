import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

/**
 * 全ビューを実レンダリングして EJS テンプレートが 500 にならないことを確認する。
 * Plan 1 Task 12 で起きた「route が渡さない変数を view が参照する」バグを検出する。
 */
describe('views render without 500', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test('views/index.ejs（自由モード）', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'v-index-1' });
    const agent = await authedAgent(user);
    const res = await agent.get('/free-mode');
    expect(res.status).toBe(200);
  });

  test('views/certification.ejs（統計なし）', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'v-cert-1' });
    const agent = await authedAgent(user);
    const res = await agent.get(`/certifications/${cert.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(cert.name);
  });

  test('views/domain.ejs', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'v-domain-1' });
    const agent = await authedAgent(user);
    const res = await agent.get(`/certifications/${cert.id}/domains/domain-1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('domain-1'.toUpperCase() !== 'DOMAIN-1' ? 'domain-1' : 'Domain 1');
  });

  test('views/quiz.ejs', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'v-quiz-1' });
    const agent = await authedAgent(user);
    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const quizRes = await agent.get(startRes.headers.location);
    expect(quizRes.status).toBe(200);
    expect(quizRes.text).toContain('問題 1');
  });

  test('views/result.ejs', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'v-result-1',
      domains: [
        {
          id: 'domain-1', name: 'D1', weight: 100, generatedAt: null,
          questions: [{ id: 'q1', question: 'Q', options: {A:'a',B:'b',C:'c',D:'d'}, correctAnswer: 'A', explanation: '' }],
        },
      ],
    });
    const agent = await authedAgent(user);
    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const sp = new URL(`http://localhost${startRes.headers.location}`);
    const sessionId = sp.pathname.split('/')[2];
    const questions = sp.searchParams.get('questions');

    await agent.post(`/quiz/${sessionId}/answer`).type('form').send({
      questionId: 'q1', domainId: 'domain-1', selectedAnswer: 'A', isCorrect: 'true',
      questionIds: questions, certId: cert.id, currentIdx: '0',
    });
    await agent.get(`/quiz/${sessionId}?questions=${questions}&certId=${cert.id}&idx=1`);

    const res = await agent.get(`/quiz/${sessionId}/result?certId=${cert.id}`);
    expect(res.status).toBe(200);
  });

  test('views/review.ejs', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'v-review-1',
      domains: [
        {
          id: 'domain-1', name: 'D1', weight: 100, generatedAt: null,
          questions: [{ id: 'q1', question: 'Q', options: {A:'a',B:'b',C:'c',D:'d'}, correctAnswer: 'A', explanation: '' }],
        },
      ],
    });
    const agent = await authedAgent(user);
    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const sp = new URL(`http://localhost${startRes.headers.location}`);
    const sessionId = sp.pathname.split('/')[2];
    const questions = sp.searchParams.get('questions');

    await agent.post(`/quiz/${sessionId}/answer`).type('form').send({
      questionId: 'q1', domainId: 'domain-1', selectedAnswer: 'B', isCorrect: 'false',
      questionIds: questions, certId: cert.id, currentIdx: '0',
    });
    await agent.get(`/quiz/${sessionId}?questions=${questions}&certId=${cert.id}&idx=1`);

    const res = await agent.get(`/quiz/${sessionId}/review?certId=${cert.id}`);
    expect(res.status).toBe(200);
  });

  test('views/login.ejs (廃止: /auth/login は / に 301)', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/auth/login');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/');
  });

  test('views/error.ejs (404)', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/nonexistent-path');
    expect(res.status).toBe(404);
    expect(res.text).toContain('404');
  });
});
