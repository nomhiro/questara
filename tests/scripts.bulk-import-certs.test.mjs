import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  CERT_LIST,
  studyGuideUrl,
  validateCertList,
  mergeCert,
  parseArgs,
} = require('../scripts/bulk-import-certs');

describe('bulk-import-certs: CERT_LIST', () => {
  test('全 ID がユニーク', () => {
    expect(() => validateCertList(CERT_LIST)).not.toThrow();
  });

  test('対象カテゴリがすべて含まれている', () => {
    const categories = new Set(CERT_LIST.map((c) => c.category));
    expect(categories.has('Azure')).toBe(true);
    expect(categories.has('M365')).toBe(true);
    expect(categories.has('Security')).toBe(true);
    // Copilot は GitHub と合流
    const gh = CERT_LIST.filter((c) => c.category.startsWith('GitHub'));
    expect(gh.length).toBeGreaterThan(0);
  });

  test('リタイア済 DP-203 は含まれない', () => {
    expect(CERT_LIST.find((c) => c.id === 'dp-203')).toBeUndefined();
  });

  test('重複検知が機能する', () => {
    expect(() =>
      validateCertList([
        { id: 'az-900', name: 'A', category: 'X' },
        { id: 'az-900', name: 'B', category: 'X' },
      ])
    ).toThrow(/Duplicate/);
  });
});

describe('bulk-import-certs: studyGuideUrl', () => {
  test('標準的な Learn URL を生成', () => {
    expect(studyGuideUrl('az-104')).toBe(
      'https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/az-104'
    );
  });
});

describe('bulk-import-certs: mergeCert', () => {
  const parsed = {
    id: 'az-104',
    name: 'Microsoft Azure Administrator (AZ-104)',
    studyGuideUrl: studyGuideUrl('az-104'),
    courseUrl: '',
    domains: [
      { id: 'domain-1', name: 'Domain 1: Identity', weight: 25 },
      { id: 'domain-2', name: 'Domain 2: Storage', weight: 15 },
    ],
  };

  test('既存 cert がないときはシステム属性付きで新規作成する', () => {
    const out = mergeCert(null, parsed);
    expect(out.createdBy).toBe('system');
    expect(out.isPublic).toBe(true);
    expect(out.domains).toHaveLength(2);
    expect(out.domains[0].questions).toEqual([]);
    expect(out.domains[0].generatedAt).toBeNull();
    expect(out.publishedAt).toBeTruthy();
  });

  test('既存 domain の questions は保持される', () => {
    const existing = {
      id: 'az-104',
      name: 'old name',
      studyGuideUrl: 'old-url',
      courseUrl: 'course-url',
      domains: [
        {
          id: 'domain-1',
          name: 'old domain',
          weight: 10,
          generatedAt: '2024-01-01T00:00:00Z',
          questions: [{ id: 'q1', question: '?' }],
        },
      ],
      createdBy: 'user-1',
      creatorName: 'Alice',
      isPublic: true,
    };
    const out = mergeCert(existing, parsed);
    expect(out.createdBy).toBe('user-1'); // 既存属性を保持
    expect(out.courseUrl).toBe('course-url'); // 既存 courseUrl を保持
    expect(out.name).toBe(parsed.name); // name は更新
    expect(out.studyGuideUrl).toBe(parsed.studyGuideUrl);
    expect(out.domains[0].questions).toEqual([{ id: 'q1', question: '?' }]);
    expect(out.domains[0].generatedAt).toBe('2024-01-01T00:00:00Z');
    expect(out.domains[0].weight).toBe(25); // weight は新しい値
    expect(out.domains[1].questions).toEqual([]); // 新規ドメインは空
  });

  test('parsed に無い domain は削除される', () => {
    const existing = {
      id: 'az-104',
      name: 'x',
      studyGuideUrl: 'x',
      courseUrl: '',
      domains: [
        { id: 'domain-1', name: 'd1', weight: 10, generatedAt: null, questions: [] },
        { id: 'domain-99', name: 'obsolete', weight: 50, generatedAt: null, questions: [{ id: 'old' }] },
      ],
      createdBy: 'system',
      creatorName: 'system',
      isPublic: true,
    };
    const out = mergeCert(existing, parsed);
    expect(out.domains.map((d) => d.id)).toEqual(['domain-1', 'domain-2']);
  });
});

describe('bulk-import-certs: parseArgs', () => {
  test('デフォルトは全件・非 dry-run', () => {
    expect(parseArgs([])).toEqual({ only: null, dryRun: false });
  });

  test('--dry-run を認識', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ only: null, dryRun: true });
  });

  test('--only a,b を配列に分解する', () => {
    expect(parseArgs(['--only', 'az-104,ai-102'])).toEqual({
      only: ['az-104', 'ai-102'],
      dryRun: false,
    });
  });

  test('--only=a,b 形式も受ける', () => {
    expect(parseArgs(['--only=gh-200,gh-300'])).toEqual({
      only: ['gh-200', 'gh-300'],
      dryRun: false,
    });
  });
});
