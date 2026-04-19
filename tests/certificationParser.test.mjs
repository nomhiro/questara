import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseDomainsFromMarkdown } = require('../services/certificationParser');

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
