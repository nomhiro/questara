import { describe, it, expect } from 'vitest';
import achievementService from '../services/achievementService.js';

describe('evaluate', () => {
  const baseCtx = {
    stats: {
      totalSessions: 1,
      streak: { current: 0 },
      level: 1,
      masteryRanks: {},
      unlockedAchievements: [],
    },
    session: { gamification: { maxCombo: 1 }, certificationId: 'gh-100' },
    certDomainCounts: {},
  };

  it('streak-7 は streak 7 到達で解放', () => {
    const ctx = { ...baseCtx, stats: { ...baseCtx.stats, streak: { current: 7 } } };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).toContain('streak-7');
  });

  it('既に解放済みの実績は再解放しない', () => {
    const ctx = { ...baseCtx, stats: { ...baseCtx.stats, streak: { current: 7 }, unlockedAchievements: ['streak-7'] } };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).not.toContain('streak-7');
  });

  it('combo-10 は maxCombo 10 で解放', () => {
    const ctx = { ...baseCtx, session: { gamification: { maxCombo: 10 }, certificationId: 'gh-100' } };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).toContain('combo-10');
  });

  it('level-5 は level 5 到達で解放', () => {
    const ctx = { ...baseCtx, stats: { ...baseCtx.stats, level: 5 } };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).toContain('level-5');
  });

  it('mastery-first-s は任意ドメインで S 以上', () => {
    const ctx = { ...baseCtx, stats: { ...baseCtx.stats, masteryRanks: { 'gh-100:d1': { rank: 'S' } } } };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).toContain('mastery-first-s');
    expect(ids).toContain('mastery-first-b');
  });

  it('dungeon-cleared は 1 資格の全ドメイン B 以上', () => {
    const ctx = {
      ...baseCtx,
      stats: {
        ...baseCtx.stats,
        masteryRanks: {
          'gh-100:d1': { rank: 'B' },
          'gh-100:d2': { rank: 'A' },
          'gh-100:d3': { rank: 'S' },
        },
      },
      certDomainCounts: { 'gh-100': 3 },
    };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).toContain('dungeon-cleared');
  });

  it('dungeon-cleared は 1 つでも B 未満なら未解放', () => {
    const ctx = {
      ...baseCtx,
      stats: {
        ...baseCtx.stats,
        masteryRanks: {
          'gh-100:d1': { rank: 'B' },
          'gh-100:d2': { rank: 'C' },
          'gh-100:d3': { rank: 'S' },
        },
      },
      certDomainCounts: { 'gh-100': 3 },
    };
    const ids = achievementService.evaluate(ctx).map((a) => a.id);
    expect(ids).not.toContain('dungeon-cleared');
  });
});
