#!/usr/bin/env node
// ローカル Cosmos DB エミュレータのデータをクラウド Cosmos DB に反映する。
//
// 使い方:
//   node scripts/migrate-local-to-cloud.mjs                       # 全 5 container を upsert
//   node scripts/migrate-local-to-cloud.mjs --dry-run              # 件数だけ表示
//   node scripts/migrate-local-to-cloud.mjs --only certifications  # 指定 container のみ
//
// クラウド側の接続情報は az CLI から自動取得する (キーはプロセス内部に留まり、stdout には出さない)。
// 既定の接続先:
//   subscription = f80766c9-6be7-43f9-8369-d492efceff1e (shirokuma)
//   resourceGroup = rg-questara-prod
//   account = cosmos-ajq7cvepegncm (未指定なら RG 内の先頭 1 件)
//
// ローカル側は .env の COSMOS_ENDPOINT / COSMOS_KEY を使う。
'use strict';

import { CosmosClient } from '@azure/cosmos';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env を簡易ロード (dotenv 依存を避けるため)
try {
  const envPath = path.join(__dirname, '..', '.env');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* .env 無くても環境変数で動けばよい */ }

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Cosmos Emulator 自己署名用

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
let only = null;
const onlyIdx = process.argv.indexOf('--only');
if (onlyIdx >= 0) only = process.argv[onlyIdx + 1];

const AZ = 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd';
const CLOUD_SUB = process.env.QUESTARA_CLOUD_SUBSCRIPTION || 'f80766c9-6be7-43f9-8369-d492efceff1e';
const CLOUD_RG = process.env.QUESTARA_CLOUD_RG || 'rg-questara-prod';
let CLOUD_ACC = process.env.QUESTARA_CLOUD_ACCOUNT || 'cosmos-ajq7cvepegncm';
const CLOUD_DB = process.env.QUESTARA_CLOUD_DB || 'cert-quiz';

const CONTAINERS = [
  { id: 'users', partitionKey: '/id' },
  { id: 'certifications', partitionKey: '/id' },
  { id: 'sessions', partitionKey: '/userId' },
  { id: 'studyPlans', partitionKey: '/userId' },
];

function az(...argv) {
  // Windows の .cmd バッチは shell 経由でないと spawn EINVAL になる。
  // exe パスにスペースが含まれるので cmd.exe 向けにダブルクォートで囲う。
  const parts = [`"${AZ}"`, ...argv.map((a) => `"${String(a).replace(/"/g, '\\"')}"`)];
  return execSync(parts.join(' '), { encoding: 'utf8', windowsHide: true }).trim();
}

function getCloudCreds() {
  console.log(`→ azure subscription = ${CLOUD_SUB}`);
  if (!CLOUD_ACC) {
    CLOUD_ACC = az('cosmosdb', 'list', '-g', CLOUD_RG, '--subscription', CLOUD_SUB,
      '--query', '[0].name', '-o', 'tsv');
  }
  console.log(`→ cosmos account     = ${CLOUD_ACC} (rg=${CLOUD_RG})`);
  const endpoint = az('cosmosdb', 'show', '-g', CLOUD_RG, '-n', CLOUD_ACC,
    '--subscription', CLOUD_SUB, '--query', 'documentEndpoint', '-o', 'tsv');
  const key = az('cosmosdb', 'keys', 'list', '-g', CLOUD_RG, '-n', CLOUD_ACC,
    '--subscription', CLOUD_SUB, '--query', 'primaryMasterKey', '-o', 'tsv');
  return { endpoint, key };
}

async function readAll(container) {
  const items = [];
  const iterator = container.items.readAll().getAsyncIterator();
  for await (const batch of iterator) {
    items.push(...batch.resources);
  }
  return items;
}

function stripSystemProps(doc) {
  const clean = { ...doc };
  delete clean._rid;
  delete clean._self;
  delete clean._etag;
  delete clean._attachments;
  delete clean._ts;
  return clean;
}

async function ensureCloudContainers(db) {
  for (const c of CONTAINERS) {
    await db.containers.createIfNotExists(c);
  }
}

async function migrateContainer(localDb, cloudDb, def) {
  const localC = localDb.container(def.id);
  const cloudC = cloudDb.container(def.id);

  const docs = await readAll(localC);
  console.log(`  local  ${def.id.padEnd(16)} ${docs.length.toString().padStart(4)} docs`);

  if (dryRun || docs.length === 0) return { read: docs.length, wrote: 0, failed: 0 };

  let wrote = 0;
  let failed = 0;
  for (const d of docs) {
    try {
      await cloudC.items.upsert(stripSystemProps(d));
      wrote += 1;
    } catch (err) {
      failed += 1;
      console.warn(`    ! upsert failed: id=${d.id} reason=${err.code || err.message}`);
    }
  }
  console.log(`  cloud  ${def.id.padEnd(16)} ${wrote.toString().padStart(4)} upserted` +
    (failed ? ` (${failed} failed)` : ''));
  return { read: docs.length, wrote, failed };
}

(async () => {
  const localEndpoint = process.env.COSMOS_ENDPOINT;
  const localKey = process.env.COSMOS_KEY;
  const localDbName = process.env.COSMOS_DATABASE || 'cert-quiz';
  if (!localEndpoint || !localKey) {
    console.error('❌ ローカルの COSMOS_ENDPOINT / COSMOS_KEY が未設定');
    process.exit(1);
  }

  console.log('=== Local → Cloud Cosmos 移行 ===');
  console.log(`local endpoint      = ${localEndpoint} (db=${localDbName})`);
  const { endpoint: cloudEndpoint, key: cloudKey } = getCloudCreds();
  console.log(`cloud endpoint      = ${cloudEndpoint} (db=${CLOUD_DB})`);
  console.log(`mode                = ${dryRun ? 'DRY-RUN' : 'APPLY'}${only ? ` / only=${only}` : ''}`);
  console.log('');

  const localClient = new CosmosClient({ endpoint: localEndpoint, key: localKey });
  const cloudClient = new CosmosClient({ endpoint: cloudEndpoint, key: cloudKey });

  const localDb = localClient.database(localDbName);
  const { database: cloudDb } = await cloudClient.databases.createIfNotExists({ id: CLOUD_DB });
  await ensureCloudContainers(cloudDb);

  const targets = only ? CONTAINERS.filter((c) => c.id === only) : CONTAINERS;
  if (targets.length === 0) {
    console.error(`❌ unknown container: ${only}`);
    process.exit(1);
  }

  const summary = [];
  for (const def of targets) {
    const r = await migrateContainer(localDb, cloudDb, def);
    summary.push({ container: def.id, ...r });
  }

  console.log('\n=== Summary ===');
  console.table(summary);
  const totalFailed = summary.reduce((s, r) => s + r.failed, 0);
  process.exit(totalFailed ? 2 : 0);
})().catch((err) => {
  console.error('❌ migration failed:', err);
  process.exit(1);
});
