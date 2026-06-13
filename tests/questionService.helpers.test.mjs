import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { getCorrectAnswers } = _require('../services/questionService');

describe('getCorrectAnswers', () => {
  test('correctAnswers 配列があればそれを返す', () => {
    expect(getCorrectAnswers({ correctAnswers: ['A', 'C'], correctAnswer: 'A' })).toEqual(['A', 'C']);
  });

  test('correctAnswers が無ければ correctAnswer を配列化して返す（既存データ互換）', () => {
    expect(getCorrectAnswers({ correctAnswer: 'B' })).toEqual(['B']);
  });

  test('correctAnswers が空配列なら correctAnswer にフォールバック', () => {
    expect(getCorrectAnswers({ correctAnswers: [], correctAnswer: 'D' })).toEqual(['D']);
  });

  test('どちらも無ければ空配列', () => {
    expect(getCorrectAnswers({})).toEqual([]);
    expect(getCorrectAnswers(null)).toEqual([]);
  });
});
