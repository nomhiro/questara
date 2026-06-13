// @covers: middleware/theme.js
/**
 * themeMiddleware の unit test。
 * cookie の値を res.locals.theme に 'light' | 'dark' | null へ正規化する。
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { themeMiddleware } = require('../middleware/theme.js');

function run(cookies) {
  const req = { cookies };
  const res = { locals: {} };
  let called = false;
  themeMiddleware(req, res, () => { called = true; });
  return { theme: res.locals.theme, called };
}

describe('themeMiddleware', () => {
  test('cookie theme=dark → res.locals.theme = "dark"', () => {
    expect(run({ theme: 'dark' }).theme).toBe('dark');
  });

  test('cookie theme=light → res.locals.theme = "light"', () => {
    expect(run({ theme: 'light' }).theme).toBe('light');
  });

  test('cookie 未設定 → null', () => {
    expect(run({}).theme).toBeNull();
  });

  test('不正値 → null', () => {
    expect(run({ theme: 'rainbow' }).theme).toBeNull();
  });

  test('req.cookies が undefined でも落ちず null になる', () => {
    const res = { locals: {} };
    expect(() => themeMiddleware({}, res, () => {})).not.toThrow();
    expect(res.locals.theme).toBeNull();
  });

  test('next() を呼ぶ', () => {
    expect(run({ theme: 'dark' }).called).toBe(true);
  });
});
