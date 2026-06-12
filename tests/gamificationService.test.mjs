import { describe, it, expect } from 'vitest';
import gamificationService from '../services/gamificationService.js';

describe('buildHudStats', () => {
  it('生 stats に XP 内訳をマージする', () => {
    const out = gamificationService.buildHudStats({ xp: 0, level: 1, totalSessions: 3 });
    expect(out.totalSessions).toBe(3);
    expect(out.xpIntoLevel).toBe(0);
    expect(out).toHaveProperty('xpForLevel');
  });
  it('空 stats でも XP 内訳フィールドを持つ', () => {
    const out = gamificationService.buildHudStats();
    expect(out).toHaveProperty('xpIntoLevel');
    expect(out).toHaveProperty('xpForLevel');
  });
});

describe('calcAnswerXp', () => {
  it('正解時 base 10、combo 1 では +weightBonus のみ', () => {
    expect(gamificationService.calcAnswerXp({ isCorrect: true, combo: 1, domainWeight: 20 })).toBe(12);
  });
  it('不正解時は base 2、weight ボーナスは付与', () => {
    expect(gamificationService.calcAnswerXp({ isCorrect: false, combo: 5, domainWeight: 15 })).toBe(3);
  });
  it('combo 倍率は 1.0 + 0.1*(combo-1) で上限 2.0', () => {
    expect(gamificationService.calcAnswerXp({ isCorrect: true, combo: 3, domainWeight: 0 })).toBe(12);
  });
  it('combo 11 以上は倍率 2.0 に固定', () => {
    expect(gamificationService.calcAnswerXp({ isCorrect: true, combo: 20, domainWeight: 0 })).toBe(20);
  });
});

describe('recomputeLevel', () => {
  it('XP 0 は Lv.1', () => {
    expect(gamificationService.recomputeLevel(0)).toBe(1);
  });
  it('Lv.1→2 は 100 XP で到達', () => {
    expect(gamificationService.recomputeLevel(99)).toBe(1);
    expect(gamificationService.recomputeLevel(100)).toBe(2);
  });
  it('Lv.2→3 は追加で floor(100*2^1.5)=282 XP 必要', () => {
    expect(gamificationService.recomputeLevel(381)).toBe(2);
    expect(gamificationService.recomputeLevel(382)).toBe(3);
  });
});

describe('xpBreakdown', () => {
  it('Lv.1 で XP 50 の内訳', () => {
    const { currentLevel, xpIntoLevel, xpForLevel } = gamificationService.xpBreakdown(50);
    expect(currentLevel).toBe(1);
    expect(xpIntoLevel).toBe(50);
    expect(xpForLevel).toBe(100);
  });
  it('Lv.3 到達直後 (XP 382) の内訳', () => {
    const { currentLevel, xpIntoLevel, xpForLevel } = gamificationService.xpBreakdown(382);
    expect(currentLevel).toBe(3);
    expect(xpIntoLevel).toBe(0);
    expect(xpForLevel).toBe(gamificationService.xpRequiredForLevelUp(3));
  });
});

describe('calcCombo', () => {
  it('空の answers は combo 1', () => {
    expect(gamificationService.calcCombo({ answers: [] })).toBe(1);
  });
  it('session 自体が未定義でも combo 1', () => {
    expect(gamificationService.calcCombo(undefined)).toBe(1);
  });
  it('末尾が不正解なら combo 1 にリセット', () => {
    expect(gamificationService.calcCombo({ answers: [
      { isCorrect: true }, { isCorrect: true }, { isCorrect: false },
    ]})).toBe(1);
  });
  it('末尾が連続正解 3 連の場合 combo 3', () => {
    expect(gamificationService.calcCombo({ answers: [
      { isCorrect: false }, { isCorrect: true }, { isCorrect: true }, { isCorrect: true },
    ]})).toBe(3);
  });
});

describe('calcMasteryRank', () => {
  it('attempts 0 は 未挑戦', () => {
    expect(gamificationService.calcMasteryRank({ correct: 0, total: 0 }).rank).toBe('未挑戦');
  });
  it('rate 100%, attempts 10 は scoreIndex ≈33.3 で D', () => {
    const r = gamificationService.calcMasteryRank({ correct: 10, total: 10 });
    expect(r.rank).toBe('D');
    expect(r.scoreIndex).toBeCloseTo(33.33, 1);
  });
  it('rate 80%, attempts 30 は scoreIndex 80 で A', () => {
    expect(gamificationService.calcMasteryRank({ correct: 24, total: 30 }).rank).toBe('A');
  });
  it('rate 90%, attempts 30 は scoreIndex 90 で S', () => {
    expect(gamificationService.calcMasteryRank({ correct: 27, total: 30 }).rank).toBe('S');
  });
  it('rate 100%, attempts 50 は SS', () => {
    expect(gamificationService.calcMasteryRank({ correct: 50, total: 50 }).rank).toBe('SS');
  });
});

describe('compareRanks', () => {
  it('D < C < B < A < S < SS', () => {
    expect(gamificationService.compareRanks('C', 'B')).toBe(-1);
    expect(gamificationService.compareRanks('S', 'A')).toBe(1);
    expect(gamificationService.compareRanks('B', 'B')).toBe(0);
  });
  it('未挑戦 は最も低い', () => {
    expect(gamificationService.compareRanks('未挑戦', 'D')).toBe(-1);
  });
});

describe('diffRankUpgrades', () => {
  it('ランクが上がったドメインのみを返す', () => {
    const before = { 'c:d1': { rank: 'C' }, 'c:d2': { rank: 'B' } };
    const after  = { 'c:d1': { rank: 'B' }, 'c:d2': { rank: 'B' } };
    expect(gamificationService.diffRankUpgrades(before, after)).toEqual([{ key: 'c:d1', from: 'C', to: 'B' }]);
  });
  it('新規ドメイン（beforeに無い）は未挑戦→新ランクとして扱う', () => {
    expect(gamificationService.diffRankUpgrades({}, { 'c:d1': { rank: 'D' } })).toEqual([
      { key: 'c:d1', from: '未挑戦', to: 'D' }
    ]);
  });
});

describe('updateStreak', () => {
  const today = '2026-04-19';

  it('初回 (lastStudyDate=null) は current=1', () => {
    const s = gamificationService.updateStreak({ current: 0, longest: 0, lastStudyDate: null, freeze: false }, today);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
    expect(s.lastStudyDate).toBe(today);
  });
  it('連続1日は +1', () => {
    const s = gamificationService.updateStreak({ current: 2, longest: 2, lastStudyDate: '2026-04-18', freeze: false }, today);
    expect(s.current).toBe(3);
  });
  it('2日以上空白で freeze false はリセット', () => {
    const s = gamificationService.updateStreak({ current: 5, longest: 5, lastStudyDate: '2026-04-16', freeze: false }, today);
    expect(s.current).toBe(1);
  });
  it('2日空白で freeze true はセーフ（freeze消費）', () => {
    const s = gamificationService.updateStreak({ current: 5, longest: 5, lastStudyDate: '2026-04-17', freeze: true }, today);
    expect(s.current).toBe(6);
    expect(s.freeze).toBe(false);
  });
  it('同日 2 回目は current 維持', () => {
    const s = gamificationService.updateStreak({ current: 3, longest: 3, lastStudyDate: today, freeze: false }, today);
    expect(s.current).toBe(3);
  });
  it('7 日到達で freeze 付与', () => {
    const s = gamificationService.updateStreak({ current: 6, longest: 6, lastStudyDate: '2026-04-18', freeze: false }, today);
    expect(s.current).toBe(7);
    expect(s.freeze).toBe(true);
  });
});

describe('evaluateDailyQuest', () => {
  const today = '2026-04-19';
  const emptyDaily = { date: today, completed: [], xpClaimed: 0 };

  it('セッションで正答5問以上 → daily-5q 達成', () => {
    const answers = Array.from({ length: 5 }, () => ({ isCorrect: true, domainId: 'd1' }));
    const result = gamificationService.evaluateDailyQuest({ daily: emptyDaily, session: { answers }, todayISODate: today });
    expect(result.completed).toContain('daily-5q');
    expect(result.bonus).toBeGreaterThanOrEqual(50);
  });
  it('session完了で daily-session 必ず達成', () => {
    const result = gamificationService.evaluateDailyQuest({ daily: emptyDaily, session: { answers: [{ isCorrect: false, domainId: 'd1' }] }, todayISODate: today });
    expect(result.completed).toContain('daily-session');
  });
  it('1ドメインで正答率80%以上 → daily-domain-80', () => {
    const answers = [
      { isCorrect: true, domainId: 'd1' }, { isCorrect: true, domainId: 'd1' },
      { isCorrect: true, domainId: 'd1' }, { isCorrect: true, domainId: 'd1' },
      { isCorrect: false, domainId: 'd1' },
    ];
    const result = gamificationService.evaluateDailyQuest({ daily: emptyDaily, session: { answers }, todayISODate: today });
    expect(result.completed).toContain('daily-domain-80');
  });
  it('日付が異なる daily はリセットしてから評価', () => {
    const staleDaily = { date: '2026-04-18', completed: ['daily-5q', 'daily-session'], xpClaimed: 80 };
    const result = gamificationService.evaluateDailyQuest({
      daily: staleDaily,
      session: { answers: [{ isCorrect: false, domainId: 'd1' }] },
      todayISODate: today,
    });
    expect(result.date).toBe(today);
    expect(result.completed).toEqual(['daily-session']);
    expect(result.xpClaimed).toBe(30);
    expect(result.bonus).toBe(30);
  });
  it('既達成クエストは newlyCompleted に含めず、bonus も 0', () => {
    const daily = { date: today, completed: ['daily-session'], xpClaimed: 30 };
    const result = gamificationService.evaluateDailyQuest({
      daily,
      session: { answers: [{ isCorrect: false, domainId: 'd1' }] },
      todayISODate: today,
    });
    expect(result.newlyCompleted).toEqual([]);
    expect(result.bonus).toBe(0);
    expect(result.xpClaimed).toBe(30);
  });
});
