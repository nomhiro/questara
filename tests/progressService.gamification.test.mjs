import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

// progressService.js は CJS で各サービスを require するため、vi.mock のファクトリでは
// 差し替わらない。同一シングルトンのメソッドを vi.fn() に直接置き換え、afterAll で restore する。
// gamificationService は「実物」を使い、XP/コンボ/ランク/ストリークの計算を本物で検証する。
const _require = createRequire(import.meta.url);

const _cosmos = _require('../services/cosmosService.js');
const _userService = _require('../services/userService.js');
const _achievementService = _require('../services/achievementService.js');
const _questionService = _require('../services/questionService.js');

const _orig = {
  cosmosRead: _cosmos.read,
  cosmosUpsert: _cosmos.upsert,
  cosmosQuery: _cosmos.query,
  userUpdateStats: _userService.updateUserStats,
  userGetById: _userService.getUserById,
  achievementEvaluate: _achievementService.evaluate,
  questionGetCounts: _questionService.getCertDomainCounts,
};

beforeAll(() => {
  _cosmos.read = vi.fn();
  _cosmos.upsert = vi.fn();
  _cosmos.query = vi.fn(async () => []);
  _userService.updateUserStats = vi.fn();
  _userService.getUserById = vi.fn(async () => null);
  _achievementService.evaluate = vi.fn(() => []);
  _questionService.getCertDomainCounts = vi.fn(async () => ({}));
});
afterAll(() => {
  _cosmos.read = _orig.cosmosRead;
  _cosmos.upsert = _orig.cosmosUpsert;
  _cosmos.query = _orig.cosmosQuery;
  _userService.updateUserStats = _orig.userUpdateStats;
  _userService.getUserById = _orig.userGetById;
  _achievementService.evaluate = _orig.achievementEvaluate;
  _questionService.getCertDomainCounts = _orig.questionGetCounts;
});

const cosmos = _cosmos;
const userService = _userService;
const achievementService = _achievementService;
const questionService = _questionService;
const progressService = _require('../services/progressService.js');

describe('recordAnswer with gamification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('combo と xpEarned を answer に書き込む（初回正解）', async () => {
    const session = { id: 's1', userId: 'u1', answers: [] };
    cosmos.read.mockResolvedValue(session);
    cosmos.upsert.mockResolvedValue(undefined);

    const result = await progressService.recordAnswer({
      sessionId: 's1', userId: 'u1',
      questionId: 'q1', domainId: 'd1', domainWeight: 20,
      selectedAnswer: 'A', isCorrect: true,
    });

    expect(result.combo).toBe(2);
    expect(result.xpEarned).toBeGreaterThan(0);
    const saved = cosmos.upsert.mock.calls[0][1];
    expect(saved.answers[0].combo).toBe(2);
    expect(saved.answers[0].xpEarned).toBe(result.xpEarned);
  });

  it('不正解時は combo 1 にリセット', async () => {
    const session = { id: 's1', userId: 'u1', answers: [
      { isCorrect: true, combo: 2, xpEarned: 12 },
      { isCorrect: true, combo: 3, xpEarned: 13 },
    ] };
    cosmos.read.mockResolvedValue(session);

    const result = await progressService.recordAnswer({
      sessionId: 's1', userId: 'u1',
      questionId: 'q2', domainId: 'd1', domainWeight: 0,
      selectedAnswer: 'B', isCorrect: false,
    });

    expect(result.combo).toBe(1);
  });
});

describe('completeSession with gamification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    achievementService.evaluate.mockReturnValue([]);
    questionService.getCertDomainCounts.mockResolvedValue({});
  });

  it('xpEarned/maxCombo/levelUp/rankUpgrades を格納', async () => {
    const session = {
      id: 's1', userId: 'u1', certificationId: 'c1',
      answers: [
        { questionId: 'q1', domainId: 'd1', isCorrect: true,  combo: 2, xpEarned: 12 },
        { questionId: 'q2', domainId: 'd1', isCorrect: true,  combo: 3, xpEarned: 14 },
        { questionId: 'q3', domainId: 'd2', isCorrect: false, combo: 1, xpEarned: 2 },
      ],
      startedAt: '2026-04-19T00:00:00Z',
    };
    cosmos.read.mockResolvedValue(session);
    cosmos.upsert.mockResolvedValue(undefined);

    userService.updateUserStats.mockImplementation(async (_id, updater) => {
      const stats = {
        totalSessions: 0, totalCorrect: 0, totalAnswered: 0, certStats: {},
        xp: 0, level: 1, masteryRanks: {},
        streak: { current: 0, longest: 0, lastStudyDate: null, freeze: false },
        unlockedAchievements: [],
        dailyQuest: { date: null, completed: [], xpClaimed: 0 },
      };
      return { stats: updater(stats) };
    });

    const completed = await progressService.completeSession('s1', 'u1');

    expect(completed.gamification.xpBase).toBe(12 + 14 + 2);
    expect(completed.gamification.maxCombo).toBe(3);
    expect(completed.gamification.dailyQuestsNewlyCompleted).toContain('daily-session');
    expect(Array.isArray(completed.gamification.rankUpgrades)).toBe(true);
    expect(completed.gamification.newAchievements).toEqual([]);
  });

  it('newly unlocked achievements の xpReward を合計して xpFromAchievements に格納', async () => {
    const session = {
      id: 's2', userId: 'u1', certificationId: 'c1',
      answers: [
        { questionId: 'q1', domainId: 'd1', isCorrect: true, combo: 2, xpEarned: 12 },
      ],
      startedAt: '2026-04-19T00:00:00Z',
    };
    cosmos.read.mockResolvedValue(session);
    cosmos.upsert.mockResolvedValue(undefined);

    let callIdx = 0;
    userService.updateUserStats.mockImplementation(async (_id, updater) => {
      callIdx += 1;
      const initial = callIdx === 1
        ? {
            totalSessions: 0, totalCorrect: 0, totalAnswered: 0, certStats: {},
            xp: 0, level: 1, masteryRanks: {},
            streak: { current: 6, longest: 6, lastStudyDate: '2026-04-18', freeze: false },
            unlockedAchievements: [],
            dailyQuest: { date: null, completed: [], xpClaimed: 0 },
          }
        : {
            totalSessions: 1, totalCorrect: 1, totalAnswered: 1, certStats: {},
            xp: 12, level: 1, masteryRanks: {},
            streak: { current: 7, longest: 7, lastStudyDate: '2026-04-19', freeze: true },
            unlockedAchievements: [],
            dailyQuest: { date: '2026-04-19', completed: ['daily-session'], xpClaimed: 30 },
          };
      return { stats: updater(initial) };
    });

    achievementService.evaluate.mockReturnValue([
      { id: 'streak-7', name: '七日修行', icon: '⚔️', xpReward: 300 },
    ]);

    const completed = await progressService.completeSession('s2', 'u1');

    expect(completed.gamification.xpFromAchievements).toBe(300);
    expect(completed.gamification.newAchievements).toEqual([
      { id: 'streak-7', name: '七日修行', icon: '⚔️' },
    ]);
  });
});
