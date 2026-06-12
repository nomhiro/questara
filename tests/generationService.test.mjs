import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { extractDomainSection, normalizeQuestions, buildPrompt } = _require('../services/generationService');

describe('extractDomainSection', () => {
  const markdown = [
    '# 学習ガイド',
    'はじめに',
    '## Domain 1: Support GitHub Enterprise for users',
    'ドメイン1の本文です。',
    '### サブセクション',
    'サブ本文。',
    '## Domain 2: Manage user identities',
    'ドメイン2の本文です。',
  ].join('\n');

  test('ドメイン見出しから次の同レベル見出しまでを切り出す', () => {
    const section = extractDomainSection(markdown, 'Domain 1: Support GitHub Enterprise for users');
    expect(section).toContain('ドメイン1の本文です。');
    expect(section).toContain('サブ本文。');
    expect(section).not.toContain('ドメイン2の本文です。');
  });

  test('見出しが見つからなければ null', () => {
    expect(extractDomainSection(markdown, 'Domain 9: 存在しないドメイン')).toBe(null);
  });

  test('空入力でも落ちない', () => {
    expect(extractDomainSection('', 'Domain 1: x')).toBe(null);
    expect(extractDomainSection(null, 'Domain 1: x')).toBe(null);
  });
});

describe('normalizeQuestions', () => {
  test('correctAnswers が複数なら type=multiple、id は連番 -gen 形式', () => {
    const raw = [{
      question: 'Q1', options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      correctAnswers: ['A', 'C'], explanation: 'E1', difficulty: 'applied', tags: ['t'],
    }];
    const [q] = normalizeQuestions(raw, 'gh-100', 'domain-1', 2);
    expect(q.id).toBe('gh-100-domain-1-003-gen');
    expect(q.type).toBe('multiple');
    expect(q.correctAnswers).toEqual(['A', 'C']);
    expect(q.correctAnswer).toBe('A'); // 後方互換: 先頭の正解
  });

  test('correctAnswer 単一文字列のみでも正規化される（type=single）', () => {
    const raw = [{ question: 'Q', options: {}, correctAnswer: 'B', explanation: 'E' }];
    const [q] = normalizeQuestions(raw, 'c', 'd', 0);
    expect(q.type).toBe('single');
    expect(q.correctAnswers).toEqual(['B']);
    expect(q.correctAnswer).toBe('B');
  });
});

describe('buildPrompt', () => {
  const domain = { id: 'domain-1', name: 'Domain 1: Support GitHub Enterprise' };

  test('ドメイン名・難易度分布・複数選択・グラウンディング指示を含む', () => {
    const prompt = buildPrompt(domain, '## 学習ガイド\n本文', []);
    expect(prompt).toContain(domain.name);
    expect(prompt).toContain('basic');
    expect(prompt).toContain('multiple');
    expect(prompt).toContain('参考資料');
  });

  test('既存問題のリストが重複禁止セクションに入る', () => {
    const existing = [{ question: '既存問題ですよこれは' }];
    const prompt = buildPrompt(domain, 'ctx', existing);
    expect(prompt).toContain('既存問題ですよこれは');
  });
});
