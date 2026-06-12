import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { percentRate } = _require('../services/scoreUtil');

describe('percentRate', () => {
  it('整数パーセントを返す', () => {
    expect(percentRate(7, 10)).toBe(70);
    expect(percentRate(5, 5)).toBe(100);
    expect(percentRate(0, 4)).toBe(0);
  });

  it('Math.round で丸める', () => {
    expect(percentRate(1, 3)).toBe(33);
    expect(percentRate(2, 3)).toBe(67);
    expect(percentRate(1, 8)).toBe(13); // 12.5 → 13
  });

  it('total が 0 のときは既定で 0 を返す', () => {
    expect(percentRate(0, 0)).toBe(0);
    expect(percentRate(3, 0)).toBe(0);
  });

  it('whenEmpty を指定すると total=0 時にそれを返す', () => {
    expect(percentRate(0, 0, null)).toBe(null);
    expect(percentRate(5, 0, null)).toBe(null);
  });
});
