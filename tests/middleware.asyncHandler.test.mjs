import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { asyncHandler } = _require('../middleware/asyncHandler');

describe('asyncHandler', () => {
  it('正常時は next を呼ばない', async () => {
    const next = vi.fn();
    const res = {};
    const handler = asyncHandler(async (_req, r) => { r.sent = true; });
    await handler({}, res, next);
    expect(res.sent).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('reject した例外を next に渡す', async () => {
    const next = vi.fn();
    const err = new Error('boom');
    const handler = asyncHandler(async () => { throw err; });
    handler({}, {}, next);
    // マイクロタスクを 1 回流す
    await Promise.resolve();
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(err);
  });
});
