import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';

const require = createRequire(import.meta.url);
const cosmosService = require('../services/cosmosService');
const rankingService = require('../services/rankingService');

async function insertSession({ userId, certificationId, answers, completedAt }) {
  await cosmosService.upsert('sessions', {
    id: `s-${userId}-${Math.random()}`,
    userId, certificationId,
    mode: 'all', domainFilter: null,
    startedAt: completedAt, completedAt,
    answers,
    score: 0,
  });
}

describe('rankingService', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('最低10問に満たないユーザーは除外される', async () => {
    const user = await createTestUser();
    const answers = Array.from({ length: 5 }, (_, i) => ({
      questionId: `q${i}`, domainId: 'd1', isCorrect: true, selectedAnswer: 'A',
    }));
    await insertSession({
      userId: user.id, certificationId: 'c1', answers,
      completedAt: new Date().toISOString(),
    });
    const ranking = await rankingService.getWeeklyRanking();
    expect(ranking).toHaveLength(0);
  });

  test('週次ランキングは正答率降順でソートされる', async () => {
    const u1 = await createTestUser({ githubId: 1 });
    const u2 = await createTestUser({ githubId: 2 });
    const now = new Date().toISOString();
    await insertSession({
      userId: u1.id, certificationId: 'c1',
      answers: Array.from({ length: 10 }, (_, i) => ({
        questionId: `q${i}`, domainId: 'd1', isCorrect: i < 8, selectedAnswer: 'A',
      })),
      completedAt: now,
    });
    await insertSession({
      userId: u2.id, certificationId: 'c1',
      answers: Array.from({ length: 10 }, (_, i) => ({
        questionId: `q${i}`, domainId: 'd1', isCorrect: i < 5, selectedAnswer: 'A',
      })),
      completedAt: now,
    });
    const ranking = await rankingService.getWeeklyRanking();
    expect(ranking).toHaveLength(2);
    expect(ranking[0].userId).toBe(u1.id);
    expect(ranking[0].rate).toBe(80);
    expect(ranking[1].rate).toBe(50);
  });

  test('certificationId フィルタで特定資格のみ集計', async () => {
    const u1 = await createTestUser({ githubId: 1 });
    const now = new Date().toISOString();
    await insertSession({
      userId: u1.id, certificationId: 'c1',
      answers: Array.from({ length: 10 }, () => ({ questionId: 'q', domainId: 'd1', isCorrect: true, selectedAnswer: 'A' })),
      completedAt: now,
    });
    await insertSession({
      userId: u1.id, certificationId: 'c2',
      answers: Array.from({ length: 10 }, () => ({ questionId: 'q', domainId: 'd1', isCorrect: false, selectedAnswer: 'A' })),
      completedAt: now,
    });
    const r1 = await rankingService.getWeeklyRanking('c1');
    expect(r1[0].rate).toBe(100);
    const r2 = await rankingService.getWeeklyRanking('c2');
    expect(r2[0].rate).toBe(0);
  });
});
