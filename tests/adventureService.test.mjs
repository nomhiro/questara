import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/cosmosService.js', () => {
  const mock = { upsert: vi.fn(), read: vi.fn(), query: vi.fn(), remove: vi.fn() };
  return { default: mock, ...mock };
});
vi.mock('../services/userService.js', () => {
  const mock = { updateUserStats: vi.fn(), getUserById: vi.fn() };
  return { default: mock, ...mock };
});

import adventureService from '../services/adventureService.js';

describe('checkDungeonUnlocks', () => {
  const baseAdv = {
    id: 'adv1', userId: 'u1', isActive: true,
    dungeons: [
      { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 'x', clearedAt: 'x' },
      { certificationId: 'gh-200', order: 2, status: 'in-progress', unlockedAt: 'y', clearedAt: null },
      { certificationId: 'ai-102', order: 3, status: 'locked', unlockedAt: null, clearedAt: null },
    ],
  };
  const domainCounts = { 'gh-100': 3, 'gh-200': 2, 'ai-102': 3 };

  it('現在のダンジョン全ドメインが B 以上で cleared に遷移し次を unlock', () => {
    const ranks = {
      'gh-200:d1': { rank: 'B' },
      'gh-200:d2': { rank: 'A' },
    };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('cleared');
    expect(next.dungeons[1].clearedAt).not.toBeNull();
    expect(next.dungeons[2].status).toBe('in-progress');
    expect(next.dungeons[2].unlockedAt).not.toBeNull();
  });

  it('未達ランクなら状態変化なし', () => {
    const ranks = { 'gh-200:d1': { rank: 'C' }, 'gh-200:d2': { rank: 'A' } };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('in-progress');
    expect(next.dungeons[2].status).toBe('locked');
  });

  it('ドメインカウントに無い cert は false 扱い', () => {
    const ranks = { 'gh-200:d1': { rank: 'A' }, 'gh-200:d2': { rank: 'A' } };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, {});
    expect(next.dungeons[1].status).toBe('in-progress');
  });

  it('既に cleared の前ダンジョンには影響しない', () => {
    const ranks = {};
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[0].status).toBe('cleared');
  });

  it('最終ダンジョン cleared 時も次が存在しない場合例外を出さない', () => {
    const soloAdv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'in-progress', unlockedAt: 'x', clearedAt: null },
      ],
    };
    const ranks = { 'gh-100:d1': { rank: 'A' } };
    const next = adventureService.checkDungeonUnlocks(soloAdv, ranks, { 'gh-100': 1 });
    expect(next.dungeons[0].status).toBe('cleared');
  });
});

describe('normalizeAdventure', () => {
  it('locked ステータスは in-progress に変換される', () => {
    const adv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't1' },
        { certificationId: 'gh-200', order: 2, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
    };
    const out = adventureService.normalizeAdventure(adv);
    expect(out.dungeons[1].status).toBe('in-progress');
  });

  it('unlockedAt が null のダンジョンは値が補完される', () => {
    const adv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
    };
    const out = adventureService.normalizeAdventure(adv);
    expect(out.dungeons[0].unlockedAt).toBe(new Date(0).toISOString());
  });

  it('cleared ステータスはそのまま保持される', () => {
    const adv = {
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't2' },
      ],
    };
    const out = adventureService.normalizeAdventure(adv);
    expect(out.dungeons[0].status).toBe('cleared');
    expect(out.dungeons[0].unlockedAt).toBe('t1');
    expect(out.dungeons[0].clearedAt).toBe('t2');
  });

  it('null や undefined を渡しても落ちない', () => {
    expect(adventureService.normalizeAdventure(null)).toBe(null);
    expect(adventureService.normalizeAdventure(undefined)).toBe(undefined);
  });
});
