'use strict';

/**
 * スパイク: GitHub Models の新 API（catalog + inference）が
 * 手元のトークンで使えるかを確認する使い捨てスクリプト。
 *
 * 使い方（.env は Node の --env-file で読み込む）:
 *   node --env-file=.env scripts/check-models-api.js <トークン>   # PAT などを直接渡す
 *   node --env-file=.env scripts/check-models-api.js db:          # Cosmos の users 一覧を表示
 *   node --env-file=.env scripts/check-models-api.js db:<userId>  # ログイン済みユーザーの OAuth トークンで検証
 *
 * 判定基準（スペックのリスクゲート）:
 *   - db:<userId>（OAuth App トークン）で catalog / inference の両方が 200 → 実装続行 OK
 *   - PAT では通るが OAuth トークンで 401/403 → 実装を中断してユーザーに報告
 */

const CATALOG_URL = 'https://models.github.ai/catalog/models';
const INFERENCE_URL = 'https://models.github.ai/inference/chat/completions';

async function resolveToken(arg) {
  if (!arg || !arg.startsWith('db:')) return arg;
  const cosmosService = require('../services/cosmosService');
  await cosmosService.init();
  const userId = arg.slice(3);
  if (!userId) {
    const users = await cosmosService.query('users', { query: 'SELECT c.id, c.githubLogin FROM c' });
    console.log('users コンテナのユーザー一覧:');
    for (const u of users) console.log(`  db:${u.id}  (${u.githubLogin})`);
    process.exit(0);
  }
  const userService = require('../services/userService');
  const token = await userService.getGithubAccessToken(userId);
  if (!token) {
    console.error(`ユーザー ${userId} のアクセストークンが取得できませんでした`);
    process.exit(1);
  }
  return token;
}

async function main() {
  const token = await resolveToken(process.argv[2] || process.env.GITHUB_TOKEN);
  if (!token) {
    console.error('使い方: node scripts/check-models-api.js <token | db: | db:userId>');
    process.exit(1);
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 1) カタログ API
  const catRes = await fetch(CATALOG_URL, { headers });
  console.log(`[catalog]   GET ${CATALOG_URL} -> ${catRes.status}`);
  if (catRes.ok) {
    const models = await catRes.json();
    console.log(`[catalog]   モデル数: ${models.length}, 例: ${models.slice(0, 5).map((m) => m.id).join(', ')}`);
    const gpt5 = models.filter((m) => m.id.startsWith('openai/gpt-5')).map((m) => m.id);
    console.log(`[catalog]   gpt-5 系: ${gpt5.join(', ') || '(なし)'}`);
  } else {
    console.log(`[catalog]   body: ${(await catRes.text()).slice(0, 300)}`);
  }

  // 2) inference API（gpt-5-mini で最小呼び出し）
  const infRes = await fetch(INFERENCE_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: '1+1の答えを数字のみで返してください' }],
    }),
  });
  console.log(`[inference] POST ${INFERENCE_URL} -> ${infRes.status}`);
  const body = await infRes.text();
  console.log(`[inference] body: ${body.slice(0, 300)}`);

  console.log(catRes.ok && infRes.ok ? '\n✅ 両方 OK — 実装続行可能' : '\n❌ NG — 実装を中断して報告すること');
}

main().catch((e) => { console.error(e); process.exit(1); });
