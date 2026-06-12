import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { initSse } = _require('../middleware/sse');

function fakeRes() {
  return {
    headers: {},
    written: [],
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders: vi.fn(),
    write(chunk) { this.written.push(chunk); return true; },
  };
}

describe('initSse', () => {
  it('SSE 用ヘッダを設定し flushHeaders を呼ぶ', () => {
    const res = fakeRes();
    initSse(res);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Connection']).toBe('keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('send は event/data 形式のフレームを書き込む', () => {
    const res = fakeRes();
    const { send } = initSse(res);
    send('progress', { message: 'こんにちは' });
    expect(res.written[0]).toBe('event: progress\ndata: {"message":"こんにちは"}\n\n');
  });

  it('write が例外を投げても send は throw しない（切断耐性）', () => {
    const res = fakeRes();
    res.write = () => { throw new Error('client disconnected'); };
    const { send } = initSse(res);
    expect(() => send('done', { ok: true })).not.toThrow();
  });
});
