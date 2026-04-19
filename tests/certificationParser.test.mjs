import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseDomainsFromMarkdown, normalizeWeightsToSum100 } = require('../services/certificationParser');

describe('parseDomainsFromMarkdown', () => {
  test('標準的なドメインヘッダを抽出', () => {
    const md = `
# Domain 1: ワークフローの作成と管理 (35%)
## Domain 2: ワークフローの利用とトラブルシューティング (25%)
`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(2);
    expect(domains[0]).toEqual({ id: 'domain-1', name: 'Domain 1: ワークフローの作成と管理', weight: 35 });
    expect(domains[1]).toEqual({ id: 'domain-2', name: 'Domain 2: ワークフローの利用とトラブルシューティング', weight: 25 });
  });

  test('日本語キーワード「ドメイン」も認識', () => {
    const md = `## ドメイン 1: テスト (10%)`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(1);
    expect(domains[0].weight).toBe(10);
  });

  test('ウェイト表記なしは 0 として扱う', () => {
    const md = `## Domain 1: テスト`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains[0].weight).toBe(0);
  });

  test('該当ヘッダがない場合は空配列', () => {
    const md = `# 普通の見出し\n本文`;
    expect(parseDomainsFromMarkdown(md)).toEqual([]);
  });
});

describe('normalizeWeightsToSum100', () => {
  test('既に100ならそのまま', () => {
    const input = [{ id: 'd1', name: 'D1', weight: 60 }, { id: 'd2', name: 'D2', weight: 40 }];
    expect(normalizeWeightsToSum100(input)).toEqual(input);
  });

  test('合計が99なら最大に+1', () => {
    const result = normalizeWeightsToSum100([
      { id: 'd1', name: 'D1', weight: 30 },
      { id: 'd2', name: 'D2', weight: 50 },
      { id: 'd3', name: 'D3', weight: 19 },
    ]);
    const sum = result.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBe(100);
    expect(result[1].weight).toBe(51);
  });

  test('合計が120なら比例配分で100に', () => {
    const result = normalizeWeightsToSum100([
      { id: 'd1', name: 'D1', weight: 60 },
      { id: 'd2', name: 'D2', weight: 60 },
    ]);
    const sum = result.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBe(100);
  });

  test('全て0なら均等配分', () => {
    const result = normalizeWeightsToSum100([
      { id: 'd1', name: 'D1', weight: 0 },
      { id: 'd2', name: 'D2', weight: 0 },
      { id: 'd3', name: 'D3', weight: 0 },
    ]);
    const sum = result.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBe(100);
    expect(result[0].weight).toBe(34);
    expect(result[1].weight).toBe(33);
    expect(result[2].weight).toBe(33);
  });

  test('空配列はそのまま', () => {
    expect(normalizeWeightsToSum100([])).toEqual([]);
  });
});
