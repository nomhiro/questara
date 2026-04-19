import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser, createTestCertification } from './_setup/fixtures.mjs';

const require = createRequire(import.meta.url);
const planService = require('../services/planService');

describe('planService', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('generateSchedule は weeksLeft 分の週次エントリを作成', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'p-cert-1' });
    const futureExam = new Date(Date.now() + 3 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const schedule = await planService.generateSchedule({
      certificationId: 'p-cert-1', examDate: futureExam, userId: user.id,
    });
    expect(schedule.length).toBe(3);
    expect(schedule[0].week).toBe(1);
    expect(schedule[0].targetQuestions).toBeGreaterThanOrEqual(10);
  });

  test('upsertPlan で計画を保存 → listPlans で取得', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'p-cert-2' });
    const futureExam = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await planService.upsertPlan({ userId: user.id, certificationId: 'p-cert-2', examDate: futureExam });
    const list = await planService.listPlans(user.id);
    expect(list).toHaveLength(1);
    expect(list[0].certificationId).toBe('p-cert-2');
  });

  test('deletePlan で計画を削除', async () => {
    const user = await createTestUser();
    await createTestCertification({ id: 'p-cert-3' });
    const examDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await planService.upsertPlan({ userId: user.id, certificationId: 'p-cert-3', examDate });
    await planService.deletePlan(user.id, 'p-cert-3');
    const list = await planService.listPlans(user.id);
    expect(list).toHaveLength(0);
  });
});
