import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

describe('routes/quiz', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test('POST /quiz/start → セッション作成 + /quiz/:sessionId にリダイレクト', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'quiz-test-1' });
    const agent = await authedAgent(user);

    const res = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/quiz\/[^?]+\?questions=.+&certId=quiz-test-1&idx=0$/);
  });

  test('GET /quiz/:sessionId は 200 と最初の問題を返す', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'quiz-test-2' });
    const agent = await authedAgent(user);

    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const location = startRes.headers.location;

    const res = await agent.get(location);
    expect(res.status).toBe(200);
    expect(res.text).toContain('問題 1 /');
  });

  test('POST /quiz/:sessionId/answer で回答記録 → 次の問題にリダイレクト', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({ id: 'quiz-test-3' });
    const agent = await authedAgent(user);

    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const startLocation = new URL(`http://localhost${startRes.headers.location}`);
    const sessionId = startLocation.pathname.split('/')[2];
    const questions = startLocation.searchParams.get('questions');
    const firstQuestionId = questions.split(',')[0];

    const answerRes = await agent
      .post(`/quiz/${sessionId}/answer`)
      .type('form')
      .send({
        questionId: firstQuestionId,
        domainId: 'domain-1',
        selectedAnswer: 'A',
        isCorrect: 'true',
        questionIds: questions,
        certId: cert.id,
        currentIdx: '0',
      });
    expect(answerRes.status).toBe(302);
    expect(answerRes.headers.location).toContain('idx=1');
  });

  test('全問回答後の /quiz/:sessionId/result は正答率を表示', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'quiz-test-4',
      domains: [
        {
          id: 'domain-1',
          name: 'Domain 1',
          weight: 100,
          generatedAt: null,
          questions: [
            { id: 'q1', question: 'Q1', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A', explanation: '' },
          ],
        },
      ],
    });
    const agent = await authedAgent(user);

    const startRes = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const startLocation = new URL(`http://localhost${startRes.headers.location}`);
    const sessionId = startLocation.pathname.split('/')[2];
    const questions = startLocation.searchParams.get('questions');

    await agent.post(`/quiz/${sessionId}/answer`).type('form').send({
      questionId: 'q1', domainId: 'domain-1', selectedAnswer: 'A', isCorrect: 'true',
      questionIds: questions, certId: cert.id, currentIdx: '0',
    });

    // idx=1 でアクセスすると completeSession → /result にリダイレクト
    const nextRes = await agent.get(`/quiz/${sessionId}?questions=${questions}&certId=${cert.id}&idx=1`);
    expect(nextRes.status).toBe(302);
    expect(nextRes.headers.location).toContain('/result');

    const resultRes = await agent.get(`/quiz/${sessionId}/result?certId=${cert.id}`);
    expect(resultRes.status).toBe(200);
    expect(resultRes.text).toContain('100');
  });
});
