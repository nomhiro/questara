import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';
import { authedAgent } from './_setup/http.mjs';

const require = createRequire(import.meta.url);
const userService = require('../services/userService');
const progressService = require('../services/progressService');

describe('progressService.completeSession stats update', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('セッション完了で users.stats が更新される', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'stats-test-1',
      domains: [
        {
          id: 'domain-1', name: 'D1', weight: 100, generatedAt: null,
          questions: [
            { id: 'q1', question: 'Q1', options: {A:'a',B:'b',C:'c',D:'d'}, correctAnswer: 'A', explanation: '' },
            { id: 'q2', question: 'Q2', options: {A:'a',B:'b',C:'c',D:'d'}, correctAnswer: 'B', explanation: '' },
          ],
        },
      ],
    });
    const agent = await authedAgent(user);

    // クイズ開始
    const start = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
    const sp = new URL(`http://localhost${start.headers.location}`);
    const sessionId = sp.pathname.split('/')[2];
    const questionIds = sp.searchParams.get('questions').split(',');

    // 2問答える（q1 正解、q2 不正解）
    await agent.post(`/quiz/${sessionId}/answer`).type('form').send({
      questionId: questionIds[0], domainId: 'domain-1',
      selectedAnswer: 'A', isCorrect: questionIds[0] === 'q1' ? 'true' : 'false',
      questionIds: questionIds.join(','), certId: cert.id, currentIdx: '0',
    });
    await agent.post(`/quiz/${sessionId}/answer`).type('form').send({
      questionId: questionIds[1], domainId: 'domain-1',
      selectedAnswer: 'A', isCorrect: questionIds[1] === 'q1' ? 'true' : 'false',
      questionIds: questionIds.join(','), certId: cert.id, currentIdx: '1',
    });

    // idx=2 でアクセス → completeSession → stats 更新
    await agent.get(`/quiz/${sessionId}?questions=${questionIds.join(',')}&certId=${cert.id}&idx=2`);

    // stats を確認
    const updated = await userService.getUserById(user.id);
    expect(updated.stats.totalSessions).toBe(1);
    expect(updated.stats.totalAnswered).toBe(2);
    expect(updated.stats.totalCorrect).toBe(1);
    expect(updated.stats.certStats[cert.id]).toBeTruthy();
    expect(updated.stats.certStats[cert.id].answered).toBe(2);
    expect(updated.stats.certStats[cert.id].correct).toBe(1);
    expect(updated.stats.certStats[cert.id].correctRate).toBe(50);
    expect(updated.stats.certStats[cert.id].sessionsCount).toBe(1);
  });

  test('複数セッション完了で stats が累積される', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'stats-test-2',
      domains: [
        {
          id: 'domain-1', name: 'D1', weight: 100, generatedAt: null,
          questions: [
            { id: 'q1', question: 'Q1', options: {A:'a',B:'b',C:'c',D:'d'}, correctAnswer: 'A', explanation: '' },
          ],
        },
      ],
    });
    const agent = await authedAgent(user);

    async function completeOneQuestion(isCorrect) {
      const start = await agent.post('/quiz/start').type('form').send({ certId: cert.id, mode: 'all' });
      const sp = new URL(`http://localhost${start.headers.location}`);
      const sessionId = sp.pathname.split('/')[2];
      const q = sp.searchParams.get('questions');
      await agent.post(`/quiz/${sessionId}/answer`).type('form').send({
        questionId: 'q1', domainId: 'domain-1',
        selectedAnswer: 'A', isCorrect: isCorrect ? 'true' : 'false',
        questionIds: q, certId: cert.id, currentIdx: '0',
      });
      await agent.get(`/quiz/${sessionId}?questions=${q}&certId=${cert.id}&idx=1`);
    }

    await completeOneQuestion(true);
    await completeOneQuestion(false);
    await completeOneQuestion(true);

    const updated = await userService.getUserById(user.id);
    expect(updated.stats.totalSessions).toBe(3);
    expect(updated.stats.totalAnswered).toBe(3);
    expect(updated.stats.totalCorrect).toBe(2);
    expect(updated.stats.certStats[cert.id].sessionsCount).toBe(3);
    expect(updated.stats.certStats[cert.id].correctRate).toBe(67);
  });

  test('completeSession は二重呼び出しでも stats を一度しか加算しない（冪等・D-18）', async () => {
    const user = await createTestUser();
    const cert = await createTestCertification({
      id: 'idempotent-1',
      domains: [
        {
          id: 'domain-1', name: 'D1', weight: 100, generatedAt: null,
          questions: [
            { id: 'q1', question: 'Q1', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A', explanation: '' },
          ],
        },
      ],
    });

    const session = await progressService.createSession({ userId: user.id, certificationId: cert.id, mode: 'all' });
    await progressService.recordAnswer({
      sessionId: session.id, userId: user.id,
      questionId: 'q1', domainId: 'domain-1', domainWeight: 100,
      selectedAnswer: 'A', isCorrect: true,
    });

    const first = await progressService.completeSession(session.id, user.id);
    const afterFirst = await userService.getUserById(user.id);
    const xpAfterFirst = afterFirst.stats.xp;

    // リロード/戻る相当: 完了済みセッションをもう一度完了させる
    const second = await progressService.completeSession(session.id, user.id);
    const afterSecond = await userService.getUserById(user.id);

    expect(afterSecond.stats.totalSessions).toBe(1);
    expect(afterSecond.stats.totalAnswered).toBe(1);
    expect(afterSecond.stats.totalCorrect).toBe(1);
    expect(afterSecond.stats.xp).toBe(xpAfterFirst); // XP は二重加算されない
    expect(second.completedAt).toBe(first.completedAt); // 完了時刻も保持
  });
});
