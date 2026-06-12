import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

// userService.js は CJS で require('./cosmosService') するため、vi.mock のファクトリでは
// 差し替わらない。adventureService.test.mjs と同様に、同一シングルトンのメソッドを
// store ベースの vi.fn() に直接置き換え、afterAll で restore する。
const _require = createRequire(import.meta.url);

// 暗号化鍵（.env.test でも同値だが自己完結のため明示）
vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));

const store = new Map();
const _cosmos = _require('../services/cosmosService.js');
const _origCosmos = {
  read: _cosmos.read,
  upsert: _cosmos.upsert,
  query: _cosmos.query,
  remove: _cosmos.remove,
};

vi.mock('../services/cosmosService.js', () => ({ default: _cosmos, ..._cosmos }));

beforeAll(() => {
  _cosmos.upsert = vi.fn(async (container, doc) => { store.set(`${container}:${doc.id}`, doc); return doc; });
  _cosmos.read = vi.fn(async (container, id) => store.get(`${container}:${id}`) || null);
  _cosmos.query = vi.fn(async () => []);
  _cosmos.remove = vi.fn(async (container, id) => { store.delete(`${container}:${id}`); });
});
afterAll(() => {
  Object.assign(_cosmos, _origCosmos);
});

const userService = _require('../services/userService.js');

describe('upsertGithubUser stats initialization', () => {
  beforeEach(() => { store.clear(); });

  it('新規ユーザーは gamification 用 stats フィールドをすべて持つ', async () => {
    const user = await userService.upsertGithubUser({
      githubId: 1, githubLogin: 'u1', email: 'u1@example.com',
      accessToken: 'tok', displayName: 'User1', avatarUrl: null,
    });
    expect(user.stats.xp).toBe(0);
    expect(user.stats.level).toBe(1);
    expect(user.stats.streak).toEqual({ current: 0, longest: 0, lastStudyDate: null, freeze: false });
    expect(user.stats.masteryRanks).toEqual({});
    expect(user.stats.unlockedAchievements).toEqual([]);
    expect(user.stats.equippedTitle).toBeNull();
    expect(user.stats.activeAdventureId).toBeNull();
    expect(user.stats.dailyQuest).toEqual({ date: null, completed: [], xpClaimed: 0 });
  });

  it('既存ユーザーの stats は値を保持しつつ、欠損した新フィールドは初期化される', async () => {
    // 既存レコードを手で仕込む
    const existing = {
      id: 'github-2',
      githubId: 2,
      username: 'u2',
      displayName: 'User2',
      avatarUrl: null,
      email: 'u2@example.com',
      role: 'user',
      githubAccessToken: null,
      stats: {
        totalSessions: 5,
        totalCorrect: 10,
        totalAnswered: 20,
        certStats: { 'gh-100': { correct: 10, answered: 20 } },
      },
      createdAt: '2025-01-01T00:00:00Z',
      lastLoginAt: '2025-01-01T00:00:00Z',
    };
    store.set('users:github-2', existing);

    const user = await userService.upsertGithubUser({
      githubId: 2, githubLogin: 'u2', email: 'u2@example.com',
      accessToken: 'tok2', displayName: 'User2', avatarUrl: null,
    });
    expect(user.stats.totalSessions).toBe(5);
    expect(user.stats.totalCorrect).toBe(10);
    expect(user.stats.xp).toBe(0);
    expect(user.stats.dailyQuest).toEqual({ date: null, completed: [], xpClaimed: 0 });
  });
});

describe('getGithubAccessToken round-trip', () => {
  beforeEach(() => { store.clear(); });

  it('暗号化保存 → 復号取得が元の値と一致', async () => {
    await userService.upsertGithubUser({
      githubId: 3, githubLogin: 'u3', email: 'u3@example.com',
      accessToken: 'my-secret-token', displayName: 'User3', avatarUrl: null,
    });
    const tok = await userService.getGithubAccessToken('github-3');
    expect(tok).toBe('my-secret-token');
  });
});
