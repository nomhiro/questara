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

  test('現代的な Microsoft Learn 形式（H3 + 範囲ウェイト）を抽出し 100 に正規化する', () => {
    const md = `
## 2026 年 1 月 14 日時点で測定されたスキル
### クラウドの概念について説明する (25–30%)
#### サブセクション
### Azure のアーキテクチャとサービスについて説明する (35–40%)
### Azure の管理とガバナンスについて説明する (30–35%)
`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(3);
    expect(domains[0].id).toBe('domain-1');
    expect(domains[0].name).toBe('Domain 1: クラウドの概念について説明する');
    const sum = domains.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBe(100);
  });

  test('現代形式で単一値ウェイト (XX%) も認識', () => {
    const md = `### 基本 (40%)\n### 応用 (60%)`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(2);
    expect(domains[0].weight).toBe(40);
    expect(domains[1].weight).toBe(60);
  });

  test('レガシー形式が優先される（両方あれば legacy を使う）', () => {
    const md = `# Domain 1: Legacy (50%)\n### Modern Heading (30–40%)`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(1);
    expect(domains[0].name).toContain('Legacy');
  });

  test('範囲区切り「から」も範囲として認識する（AZ-305 形式）', () => {
    const md = `### ID、ガバナンスを設計する (25 から 30%)\n### データを設計する (20 から 25%)`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(2);
    const sum = domains.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBe(100);
  });

  test('学習リソース以降のセクションは無視される', () => {
    const md = `### 現行ドメイン (40–50%)
### 現行ドメイン 2 (40–50%)
## 学習リソース
### ノイズ見出し (10%)`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(2);
  });

  test('SC-400 形式の「以前の評価されるスキル」セクションで重複を防ぐ', () => {
    const md = `### 情報保護を実装する (25 – 30%)
### DLP を実装する (15 – 20%)
## 2023 年 8 月 22 日以前の評価されるスキル
### 情報保護を実装する (25 – 30%)
### DLP を実装する (15 – 20%)`;
    const domains = parseDomainsFromMarkdown(md);
    expect(domains).toHaveLength(2);
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
