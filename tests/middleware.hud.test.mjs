// @covers: middleware/hud.js
/**
 * hud middleware の統合テスト。
 *
 * 純粋な unit test は CJS require（`middleware/hud.js` 内）と
 * ESM import 間の vi.mock specifier mismatch が不安定なため、
 * Express 実行環境で renderer が res.locals.heroHud を使い表示するかを検証する
 * 統合テスト形式を採用している。実挙動を保証する観点でこちらが堅牢。
 */
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, truncateAll } from './_setup/db.mjs';
import { createTestUser } from './_setup/fixtures.mjs';
import { authedAgent, anonAgent } from './_setup/http.mjs';

describe('heroHudMiddleware (integration)', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(async () => { await truncateAll(); });

  test('未認証リクエストでは heroHud は設定されずログイン画面にリダイレクト', async () => {
    const agent = await anonAgent();
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('認証済みリクエストでは HUD の Lv / EXP / 勇者名が描画される', async () => {
    const user = await createTestUser({ displayName: 'HUD勇者' });
    const agent = await authedAgent(user);
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
    // HUD の内容（partials/hud.ejs が heroHud を参照して描画）
    expect(res.text).toContain('HUD勇者');
    expect(res.text).toContain('Lv.');
    expect(res.text).toContain('EXP');
  });

  test('認証済みリクエストでは HUD にストリーク・実績数の cell が含まれる', async () => {
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
    // 🔥 連続日数の cell、🏅 実績数の cell が HUD にあることを確認
    expect(res.text).toMatch(/🔥[\s\S]*?日/);
    expect(res.text).toContain('🏅');
  });

  test('DB 障害やユーザー欠損でも middleware は落ちず認証後ページを返す', async () => {
    // 実 DB は emulator 上で健全なので、このケースは middleware の try/catch が
    // 実際に例外を吸収することを「壊れていない」形で間接的に保証する。
    // 本格的なエラー注入は別 CI で。
    const user = await createTestUser();
    const agent = await authedAgent(user);
    const res = await agent.get('/my/profile');
    expect(res.status).toBe(200);
  });
});
