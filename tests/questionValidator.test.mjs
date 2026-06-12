import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { validateQuestions } = _require('../services/questionValidator');

function validQuestion(overrides = {}) {
  return {
    question: 'GitHub Enterprise の監査ログをエクスポートする最適な方法はどれですか？',
    options: { A: '選択肢Aの内容', B: '選択肢Bの内容', C: '選択肢Cの内容', D: '選択肢Dの内容' },
    type: 'single',
    correctAnswers: ['A'],
    correctAnswer: 'A',
    explanation: '監査ログ API を使うと外部ストレージへの定期エクスポートが可能です。B/C/D は要件に合いません。',
    ...overrides,
  };
}

describe('validateQuestions', () => {
  test('正常な問題は valid に入る', () => {
    const { valid, rejected } = validateQuestions([validQuestion()]);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  test('選択肢が4つ（A〜D）でなければ除外', () => {
    const q = validQuestion({ options: { A: 'a', B: 'b', C: 'c' } });
    const { valid, rejected } = validateQuestions([q]);
    expect(valid).toHaveLength(0);
    expect(rejected[0].reason).toContain('選択肢');
  });

  test('空の選択肢があれば除外', () => {
    const q = validQuestion({ options: { A: 'a', B: '', C: 'c', D: 'd' } });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('選択肢のテキストが重複していれば除外', () => {
    const q = validQuestion({ options: { A: '同じ', B: '同じ', C: 'c', D: 'd' } });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('正解キーが A〜D 以外なら除外', () => {
    const q = validQuestion({ correctAnswers: ['E'] });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('multiple なのに正解が1つなら除外', () => {
    const q = validQuestion({ type: 'multiple', correctAnswers: ['A'] });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('single なのに正解が複数なら除外', () => {
    const q = validQuestion({ type: 'single', correctAnswers: ['A', 'B'] });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('multiple で正解2〜3個は valid', () => {
    const q = validQuestion({ type: 'multiple', correctAnswers: ['A', 'C'] });
    expect(validateQuestions([q]).valid).toHaveLength(1);
  });

  test('解説が20文字未満なら除外', () => {
    const q = validQuestion({ explanation: '短い' });
    expect(validateQuestions([q]).valid).toHaveLength(0);
  });

  test('既存問題と問題文が重複していれば除外（空白・大小文字無視）', () => {
    const existing = [{ question: 'GitHub  Enterprise の監査ログをエクスポートする最適な方法はどれですか？' }];
    const { valid, rejected } = validateQuestions([validQuestion()], { existingQuestions: existing });
    expect(valid).toHaveLength(0);
    expect(rejected[0].reason).toContain('重複');
  });

  test('同一バッチ内の重複も2問目以降を除外', () => {
    const { valid } = validateQuestions([validQuestion(), validQuestion()]);
    expect(valid).toHaveLength(1);
  });

  test('correctAnswers が無く correctAnswer のみでも検証できる（後方互換）', () => {
    const q = validQuestion();
    delete q.correctAnswers;
    expect(validateQuestions([q]).valid).toHaveLength(1);
  });
});
