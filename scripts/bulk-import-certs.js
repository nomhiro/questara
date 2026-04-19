#!/usr/bin/env node
'use strict';

/**
 * Microsoft / GitHub の主要な現役 proctored 資格を Cosmos に一括投入する。
 *
 * 使い方:
 *   node scripts/bulk-import-certs.js               # 全資格
 *   node scripts/bulk-import-certs.js --only az-104,ai-102
 *   node scripts/bulk-import-certs.js --dry-run     # 解析だけして upsert しない
 *
 * 前提:
 *   COSMOS_ENDPOINT / COSMOS_KEY が設定済み（regex 解析が失敗した
 *   一部資格では GITHUB_TOKEN も推奨 — LLM フォールバック用）。
 *
 * spec: docs/superpowers/specs/2026-04-19-bulk-cert-import-design.md
 */

const cosmosService = require('../services/cosmosService');
const { extractDomains } = require('../services/certificationParser');

const STUDY_GUIDE_BASE = 'https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides';

const CERT_LIST = [
  // ===== Azure 系（AI / Data 含む） =====
  { id: 'az-900', name: 'Microsoft Azure Fundamentals (AZ-900)', category: 'Azure' },
  { id: 'az-104', name: 'Microsoft Azure Administrator (AZ-104)', category: 'Azure' },
  { id: 'az-204', name: 'Developing Solutions for Microsoft Azure (AZ-204)', category: 'Azure' },
  { id: 'az-305', name: 'Designing Microsoft Azure Infrastructure Solutions (AZ-305)', category: 'Azure' },
  { id: 'az-400', name: 'Designing and Implementing Microsoft DevOps Solutions (AZ-400)', category: 'Azure' },
  { id: 'az-700', name: 'Designing and Implementing Microsoft Azure Networking Solutions (AZ-700)', category: 'Azure' },
  { id: 'az-800', name: 'Administering Windows Server Hybrid Core Infrastructure (AZ-800)', category: 'Azure' },
  { id: 'az-801', name: 'Configuring Windows Server Hybrid Advanced Services (AZ-801)', category: 'Azure' },
  { id: 'az-140', name: 'Configuring and Operating Microsoft Azure Virtual Desktop (AZ-140)', category: 'Azure' },
  { id: 'az-120', name: 'Planning and Administering Microsoft Azure for SAP Workloads (AZ-120)', category: 'Azure' },
  { id: 'az-220', name: 'Microsoft Azure IoT Developer (AZ-220)', category: 'Azure' },
  { id: 'ai-900', name: 'Microsoft Azure AI Fundamentals (AI-900)', category: 'Azure' },
  { id: 'ai-102', name: 'Designing and Implementing a Microsoft Azure AI Solution (AI-102)', category: 'Azure' },
  { id: 'dp-900', name: 'Microsoft Azure Data Fundamentals (DP-900)', category: 'Azure' },
  { id: 'dp-100', name: 'Designing and Implementing a Data Science Solution on Azure (DP-100)', category: 'Azure' },
  { id: 'dp-300', name: 'Administering Microsoft Azure SQL Solutions (DP-300)', category: 'Azure' },
  { id: 'dp-420', name: 'Designing and Implementing Cloud-Native Applications Using Microsoft Azure Cosmos DB (DP-420)', category: 'Azure' },
  { id: 'dp-600', name: 'Implementing Analytics Solutions Using Microsoft Fabric (DP-600)', category: 'Azure' },
  { id: 'dp-700', name: 'Implementing Data Engineering Solutions Using Microsoft Fabric (DP-700)', category: 'Azure' },

  // ===== M365 系 =====
  { id: 'ms-900', name: 'Microsoft 365 Fundamentals (MS-900)', category: 'M365' },
  { id: 'ms-102', name: 'Microsoft 365 Administrator (MS-102)', category: 'M365' },
  { id: 'ms-203', name: 'Microsoft 365 Messaging (MS-203)', category: 'M365' },
  { id: 'ms-700', name: 'Managing Microsoft Teams (MS-700)', category: 'M365' },
  { id: 'ms-721', name: 'Collaboration Communications Systems Engineer (MS-721)', category: 'M365' },
  { id: 'md-102', name: 'Endpoint Administrator (MD-102)', category: 'M365' },

  // ===== セキュリティ系 =====
  { id: 'sc-900', name: 'Microsoft Security, Compliance, and Identity Fundamentals (SC-900)', category: 'Security' },
  { id: 'sc-200', name: 'Microsoft Security Operations Analyst (SC-200)', category: 'Security' },
  { id: 'sc-300', name: 'Microsoft Identity and Access Administrator (SC-300)', category: 'Security' },
  { id: 'sc-400', name: 'Administering Information Protection and Compliance in Microsoft 365 (SC-400)', category: 'Security' },
  { id: 'sc-401', name: 'Information Security Administrator (SC-401)', category: 'Security' },
  { id: 'sc-100', name: 'Microsoft Cybersecurity Architect (SC-100)', category: 'Security' },
  { id: 'az-500', name: 'Microsoft Azure Security Technologies (AZ-500)', category: 'Security' },

  // ===== GitHub 系（GH-300 は Copilot 系も兼ねる） =====
  { id: 'gh-200', name: 'GitHub Actions (GH-200)', category: 'GitHub' },
  { id: 'gh-300', name: 'GitHub Copilot (GH-300)', category: 'GitHub/Copilot' },
  { id: 'gh-500', name: 'GitHub Advanced Security (GH-500)', category: 'GitHub' },
];

function studyGuideUrl(certId) {
  return `${STUDY_GUIDE_BASE}/${certId}`;
}

function validateCertList(list) {
  const ids = list.map((c) => c.id);
  const seen = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  if (dupes.length > 0) {
    throw new Error(`Duplicate cert IDs: ${[...new Set(dupes)].join(', ')}`);
  }
  return true;
}

/**
 * 既存 cert（Cosmos にある）と新規パース結果をマージする。
 * 同じ domain id に問題が既に登録されていれば保持する。
 */
function mergeCert(existing, parsed) {
  const now = new Date().toISOString();
  const existingDomainMap = new Map(
    (existing?.domains || []).map((d) => [d.id, d])
  );

  const mergedDomains = parsed.domains.map((d) => {
    const prev = existingDomainMap.get(d.id);
    return {
      id: d.id,
      name: d.name,
      weight: d.weight,
      generatedAt: prev?.generatedAt || null,
      questions: prev?.questions || [],
    };
  });

  if (existing) {
    return {
      ...existing,
      name: parsed.name,
      studyGuideUrl: parsed.studyGuideUrl,
      courseUrl: parsed.courseUrl || existing.courseUrl || '',
      domains: mergedDomains,
    };
  }

  return {
    id: parsed.id,
    name: parsed.name,
    studyGuideUrl: parsed.studyGuideUrl,
    courseUrl: parsed.courseUrl || '',
    domains: mergedDomains,
    createdBy: 'system',
    creatorName: 'system',
    isPublic: true,
    publishedAt: now,
    usedByCount: 0,
  };
}

function parseArgs(argv) {
  const args = { only: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--only') {
      const val = argv[++i] || '';
      args.only = val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (a.startsWith('--only=')) {
      args.only = a.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  return args;
}

async function extractWithRetry(url, { accessToken, attempts = 2 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await extractDomains(url, { accessToken });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

async function run({ only, dryRun } = {}) {
  validateCertList(CERT_LIST);

  const targets = only
    ? CERT_LIST.filter((c) => only.includes(c.id.toLowerCase()))
    : CERT_LIST;

  if (targets.length === 0) {
    console.error('対象の資格が見つかりませんでした。--only の指定を確認してください。');
    process.exit(1);
  }

  if (!dryRun) await cosmosService.init();

  const accessToken = process.env.GITHUB_TOKEN || null;
  const summary = { created: [], updated: [], skipped: [], failed: [] };

  for (const entry of targets) {
    const url = studyGuideUrl(entry.id);
    process.stdout.write(`\n📥 ${entry.id.toUpperCase()} — ${url}\n`);

    let domains;
    try {
      domains = await extractWithRetry(url, { accessToken });
    } catch (err) {
      console.error(`  ❌ ドメイン抽出失敗: ${err.message}`);
      summary.failed.push({ id: entry.id, reason: err.message });
      continue;
    }

    if (!Array.isArray(domains) || domains.length === 0) {
      console.warn('  ⚠️  ドメインが抽出できませんでした。スキップします。');
      summary.skipped.push({ id: entry.id, reason: 'empty domains' });
      continue;
    }

    console.log(`  ✓ ${domains.length} ドメイン抽出`);
    domains.forEach((d) => console.log(`    - ${d.name} (${d.weight}%)`));

    if (dryRun) continue;

    const existing = await cosmosService.read('certifications', entry.id, entry.id);
    const merged = mergeCert(existing, {
      id: entry.id,
      name: entry.name,
      studyGuideUrl: url,
      courseUrl: '',
      domains,
    });

    try {
      await cosmosService.upsert('certifications', merged);
      if (existing) {
        summary.updated.push(entry.id);
        console.log('  ✅ 更新');
      } else {
        summary.created.push(entry.id);
        console.log('  ✅ 新規作成');
      }
    } catch (err) {
      console.error(`  ❌ Cosmos 投入失敗: ${err.message}`);
      summary.failed.push({ id: entry.id, reason: err.message });
    }
  }

  console.log('\n=== サマリ ===');
  console.log(`新規作成: ${summary.created.length}`);
  if (summary.created.length > 0) console.log(`  ${summary.created.join(', ')}`);
  console.log(`更新   : ${summary.updated.length}`);
  if (summary.updated.length > 0) console.log(`  ${summary.updated.join(', ')}`);
  console.log(`スキップ: ${summary.skipped.length}`);
  summary.skipped.forEach((s) => console.log(`  ${s.id} — ${s.reason}`));
  console.log(`失敗   : ${summary.failed.length}`);
  summary.failed.forEach((s) => console.log(`  ${s.id} — ${s.reason}`));
  return summary;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run(args)
    .then((s) => process.exit(s.failed.length > 0 ? 1 : 0))
    .catch((err) => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}

module.exports = {
  CERT_LIST,
  studyGuideUrl,
  validateCertList,
  mergeCert,
  parseArgs,
  run,
};
