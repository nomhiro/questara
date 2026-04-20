#!/usr/bin/env node
// Azure Container Apps へのデプロイスクリプト。
//   1. azd provision (インフラ最新化)
//   2. docker build + push (ghcr.io)
//   3. az containerapp update (新イメージを適用)
//
// 必要な環境変数:
//   GHCR_PAT     … ghcr.io へ push 可能な GitHub PAT (write:packages)
//   (GHCR_USERNAME は azd env 側に保存されている想定)
'use strict';

import { execSync, spawnSync } from 'node:child_process';

function runInherit(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...extra });
  if (result.status !== 0) {
    console.error(`\n❌ ${cmd} ${args.join(' ')} が失敗しました (exit=${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function runWithInput(cmd, args, input) {
  const result = spawnSync(cmd, args, {
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`\n❌ ${cmd} ${args.join(' ')} が失敗しました`);
    process.exit(result.status ?? 1);
  }
}

function azdEnvValues() {
  const out = execSync('azd env get-values', { encoding: 'utf8' });
  const env = {};
  for (const line of out.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

// ---------- 1. provision ----------
console.log('==> [1/4] azd provision');
runInherit('azd', ['provision']);

// ---------- 2. env 収集 ----------
const env = azdEnvValues();
const ghcrUsername = (env.GHCR_USERNAME || process.env.GHCR_USERNAME || '').toLowerCase();
const ghcrPat = process.env.GHCR_PAT;
const rg = env.AZURE_RESOURCE_GROUP;
const app = env.SERVICE_WEB_NAME;
const endpointUrl = env.SERVICE_WEB_ENDPOINT_URL;

if (!ghcrUsername) {
  console.error('❌ GHCR_USERNAME が未設定です。`azd env set GHCR_USERNAME <your-gh-user>` を実行してください。');
  process.exit(1);
}
if (!ghcrPat) {
  console.error('❌ 環境変数 GHCR_PAT が未設定です (write:packages 権限の GitHub PAT を export してください)。');
  process.exit(1);
}
if (!rg || !app) {
  console.error('❌ azd provision の output (AZURE_RESOURCE_GROUP / SERVICE_WEB_NAME) を取得できませんでした。');
  process.exit(1);
}

const sha = gitShortSha();
const image = `ghcr.io/${ghcrUsername}/questara:${sha}`;

// ---------- 3. docker build & push ----------
console.log(`\n==> [2/4] docker login ghcr.io (${ghcrUsername})`);
runWithInput('docker', ['login', 'ghcr.io', '-u', ghcrUsername, '--password-stdin'], ghcrPat);

console.log(`\n==> [3/4] docker build & push -> ${image}`);
runInherit('docker', ['build', '-t', image, '.']);
runInherit('docker', ['push', image]);

// ---------- 4. Container App 更新 ----------
console.log(`\n==> [4/4] az containerapp update (${app})`);
runInherit('az', [
  'containerapp', 'update',
  '--name', app,
  '--resource-group', rg,
  '--image', image,
]);

console.log('\n✅ デプロイ完了');
if (endpointUrl) {
  console.log(`   URL: ${endpointUrl}`);
  console.log(`   GitHub OAuth App の Callback URL を以下に設定してください:`);
  console.log(`     ${endpointUrl}/auth/github/callback`);
}
