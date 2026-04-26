import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// adventureService.js は CJS で require('./cosmosService') を使うため
// CJS require キャッシュのオブジェクトのメソッドを直接 vi.fn() に置き換える必要がある。
// ただしプロセス全体に残ると他のテストファイルが壊れるので、afterAll で restore する。
const _cosmos = _require('../services/cosmosService.js');
const _origCosmos = {
  read: _cosmos.read,
  query: _cosmos.query,
  upsert: _cosmos.upsert,
  remove: _cosmos.remove,
};

vi.mock('../services/cosmosService.js', () => ({ default: _cosmos, ..._cosmos }));
vi.mock('../services/userService.js', () => {
  const mock = { updateUserStats: vi.fn(), getUserById: vi.fn() };
  return { default: mock, ...mock };
});

beforeAll(() => {
  _cosmos.read = vi.fn();
  _cosmos.query = vi.fn();
  _cosmos.upsert = vi.fn();
  _cosmos.remove = vi.fn();
});
afterAll(() => {
  Object.assign(_cosmos, _origCosmos);
});

import adventureService from '../services/adventureService.js';

describe('checkDungeonUnlocks', () => {
  const baseAdv = {
    id: 'adv1', userId: 'u1', isActive: true,
    dungeons: [
      { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 'x', clearedAt: 'x' },
      { certificationId: 'gh-200', order: 2, status: 'in-progress', unlockedAt: 'y', clearedAt: null },
      { certificationId: 'ai-102', order: 3, status: 'in-progress', unlockedAt: 'z', clearedAt: null },
    ],
  };
  const domainCounts = { 'gh-100': 3, 'gh-200': 2, 'ai-102': 3 };

  it('B 以上のダンジョンを cleared に遷移させる（次の自動 unlock は行わない）', () => {
    const ranks = {
      'gh-200:d1': { rank: 'B' },
      'gh-200:d2': { rank: 'A' },
    };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('cleared');
    expect(next.dungeons[1].clearedAt).not.toBeNull();
    expect(next.dungeons[2].status).toBe('in-progress');
  });

  it('未達ランクなら状態変化なし', () => {
    const ranks = { 'gh-200:d1': { rank: 'C' }, 'gh-200:d2': { rank: 'A' } };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('in-progress');
    expect(next.dungeons[2].status).toBe('in-progress');
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

  it('全 in-progress ダンジョンが条件を満たせば全て cleared に遷移する', () => {
    const ranks = {
      'gh-200:d1': { rank: 'A' }, 'gh-200:d2': { rank: 'A' },
      'ai-102:d1': { rank: 'B' }, 'ai-102:d2': { rank: 'B' }, 'ai-102:d3': { rank: 'A' },
    };
    const next = adventureService.checkDungeonUnlocks(baseAdv, ranks, domainCounts);
    expect(next.dungeons[1].status).toBe('cleared');
    expect(next.dungeons[2].status).toBe('cleared');
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

describe('read methods normalize', () => {
  it('getAdventure は locked を含むドキュメントを正規化して返す', async () => {
    const cosmosService = (await import('../services/cosmosService.js')).default;
    cosmosService.read.mockResolvedValueOnce({
      id: 'adv1', userId: 'u1',
      dungeons: [
        { certificationId: 'gh-100', order: 1, status: 'cleared', unlockedAt: 't1', clearedAt: 't1' },
        { certificationId: 'gh-200', order: 2, status: 'locked', unlockedAt: null, clearedAt: null },
      ],
    });
    const out = await adventureService.getAdventure('adv1', 'u1');
    expect(out.dungeons[1].status).toBe('in-progress');
    expect(out.dungeons[1].unlockedAt).toBeTruthy();
  });

  it('listAdventures は配列の各要素を正規化する', async () => {
    const cosmosService = (await import('../services/cosmosService.js')).default;
    cosmosService.query.mockResolvedValueOnce([
      {
        id: 'adv1', userId: 'u1',
        dungeons: [{ certificationId: 'gh-100', order: 1, status: 'locked', unlockedAt: null, clearedAt: null }],
      },
    ]);
    const out = await adventureService.listAdventures('u1');
    expect(out[0].dungeons[0].status).toBe('in-progress');
  });
});
