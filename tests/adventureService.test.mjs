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

describe('buildAdventureFromPresets', () => {
  const presetA = {
    id: 'a', name: 'A道', description: 'descA', officialUrl: 'https://a',
    dungeons: [
      { certId: 'gh-100', name: 'GH100', url: 'https://gh100' },
      { certId: 'gh-200', name: 'GH200', url: 'https://gh200' },
    ],
  };
  const presetB = {
    id: 'b', name: 'B道', description: 'descB',
    dungeons: [
      { certId: 'gh-200', name: 'GH200', url: '' }, // 重複 certId
      { certId: 'ai-102', name: 'AI102', url: 'https://ai102' },
    ],
  };

  it('単一プリセット: 利用可能な資格で in-progress の payload を作る', () => {
    const p = adventureService.buildAdventureFromPresets([presetA], new Set(['gh-100', 'gh-200']));
    expect(p.name).toBe('A道');
    expect(p.source).toBe('preset');
    expect(p.presetId).toBe('a');
    expect(p.verificationStatus).toBe('verified');
    expect(p.dungeons.map((d) => d.certificationId)).toEqual(['gh-100', 'gh-200']);
    expect(p.dungeons.every((d) => d.status === 'in-progress')).toBe(true);
    expect(p.dungeons.map((d) => d.order)).toEqual([1, 2]);
  });

  it('複数プリセット: 重複 certId は最初だけ残し、名前を × で結合する', () => {
    const p = adventureService.buildAdventureFromPresets([presetA, presetB], new Set(['gh-100', 'gh-200', 'ai-102']));
    expect(p.dungeons.map((d) => d.certificationId)).toEqual(['gh-100', 'gh-200', 'ai-102']);
    expect(p.name).toBe('A道 × B道');
    expect(p.presetId).toBe('a,b');
  });

  it('システムに無い資格は除外する', () => {
    const p = adventureService.buildAdventureFromPresets([presetA], new Set(['gh-100']));
    expect(p.dungeons.map((d) => d.certificationId)).toEqual(['gh-100']);
  });

  it('利用可能な資格が 0 件なら null', () => {
    expect(adventureService.buildAdventureFromPresets([presetA], new Set(['other']))).toBe(null);
  });

  it('citations は url のあるダンジョンのみ', () => {
    const p = adventureService.buildAdventureFromPresets([presetA, presetB], new Set(['gh-100', 'gh-200', 'ai-102']));
    const urls = p.citations.map((c) => c.url);
    expect(urls).toContain('https://gh100');
    expect(urls).toContain('https://ai102');
  });
});

describe('saveAdventure', () => {
  it('adventures コンテナに upsert して同じ adventure を返す', async () => {
    const cosmosService = (await import('../services/cosmosService.js')).default;
    cosmosService.upsert.mockClear();
    const adv = { id: 'adv-x', userId: 'u1', isActive: true, dungeons: [] };
    const out = await adventureService.saveAdventure(adv);
    expect(out).toBe(adv);
    expect(cosmosService.upsert).toHaveBeenCalledWith('adventures', adv);
  });
});

describe('setActive', () => {
  it('isActive が変化する冒険のみ upsert する（無駄な書き込みをしない・D-16）', async () => {
    const cosmosService = (await import('../services/cosmosService.js')).default;
    cosmosService.query.mockResolvedValueOnce([
      { id: 'a1', userId: 'u1', isActive: true },
      { id: 'a2', userId: 'u1', isActive: false },
      { id: 'a3', userId: 'u1', isActive: false },
    ]);
    cosmosService.upsert.mockClear();

    await adventureService.setActive('u1', 'a2');

    // a1(true→false) と a2(false→true) のみ upsert。a3(false→false) は据え置き。
    const upsertedIds = cosmosService.upsert.mock.calls.map((c) => c[1].id).sort();
    expect(upsertedIds).toEqual(['a1', 'a2']);
    const a2call = cosmosService.upsert.mock.calls.find((c) => c[1].id === 'a2');
    expect(a2call[1].isActive).toBe(true);
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
