#!/usr/bin/env node
'use strict';

/**
 * 新しい資格の JSON 雛形を生成するスクリプト
 *
 * 使い方:
 *   node scripts/add-cert.js <id> <studyGuideUrl> [courseUrl]
 *
 * 例:
 *   node scripts/add-cert.js ai-102 \
 *     "https://learn.microsoft.com/ja-jp/credentials/certifications/resources/study-guides/ai-102" \
 *     "https://learn.microsoft.com/ja-jp/training/courses/ai-102t00"
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certifications');

async function main() {
  const [, , certId, studyGuideUrl, courseUrl = ''] = process.argv;

  if (!certId || !studyGuideUrl) {
    console.error('Usage: node scripts/add-cert.js <id> <studyGuideUrl> [courseUrl]');
    process.exit(1);
  }

  const outputPath = path.join(CERT_DIR, `${certId}.json`);
  if (fs.existsSync(outputPath)) {
    console.error(`Error: ${outputPath} はすでに存在します。上書きを避けるため中断します。`);
    process.exit(1);
  }

  console.log(`📥 学習ガイドを取得中: ${studyGuideUrl}`);
  const domains = await extractDomains(studyGuideUrl);

  if (domains.length === 0) {
    console.warn('⚠️  ドメインを自動抽出できませんでした。雛形のドメインを手動で編集してください。');
    domains.push({
      id: 'domain-1',
      name: 'Domain 1: (ドメイン名を入力)',
      weight: 100,
      generatedAt: null,
      questions: [],
    });
  }

  // 資格名を URL から推測（fallback: certId をそのまま使う）
  const certName = inferCertName(certId, studyGuideUrl);

  const certData = {
    id: certId,
    name: certName,
    studyGuideUrl,
    courseUrl,
    domains,
  };

  fs.writeFileSync(outputPath, JSON.stringify(certData, null, 2), 'utf-8');

  console.log(`✅ 生成完了: ${outputPath}`);
  console.log(`   ドメイン数: ${domains.length}`);
  domains.forEach((d) => console.log(`   - ${d.name} (${d.weight}%)`));
  console.log('\n次のステップ: ブラウザで http://localhost:3000 を開き「問題を生成」を実行してください。');
}

/**
 * Microsoft Learn 学習ガイドページから Domain 一覧を抽出する
 */
async function extractDomains(url) {
  let html;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn(`⚠️  ページ取得に失敗しました: ${err.message}`);
    return [];
  }

  const root = parse(html);
  const main = root.querySelector('main') || root.querySelector('.content') || root;
  const text = main.structuredText || main.text;

  return parseDomains(text);
}

/**
 * テキストから "Domain N: ..." パターンでドメインを抽出する
 * ウェイト (xx%) も抽出する
 */
function parseDomains(text) {
  // "Domain 1: Foo Bar (15%)" のような行を抽出
  const domainPattern = /Domain\s+(\d+)\s*[:\-–]\s*([^\n(]+?)(?:\s*\((\d+)%\))?(?:\s*\n|$)/gi;
  const domains = [];
  let match;

  while ((match = domainPattern.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const name = match[2].trim();
    const weight = match[3] ? parseInt(match[3], 10) : null;

    // 重複を除く（同一番号が複数ヒットする場合）
    if (!domains.find((d) => d.id === `domain-${num}`)) {
      domains.push({
        id: `domain-${num}`,
        name: `Domain ${num}: ${name}`,
        weight: weight ?? 0,
        generatedAt: null,
        questions: [],
      });
    }
  }

  // ウェイト合計が0なら均等割り当て
  const totalWeight = domains.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0 && domains.length > 0) {
    const each = Math.round(100 / domains.length);
    domains.forEach((d) => (d.weight = each));
  }

  return domains.sort((a, b) => {
    const numA = parseInt(a.id.replace('domain-', ''), 10);
    const numB = parseInt(b.id.replace('domain-', ''), 10);
    return numA - numB;
  });
}

/**
 * URL と certId から資格の正式名称を推測する
 * 例: "ai-102" → "Azure AI Engineer Associate (AI-102)"
 */
function inferCertName(certId, url) {
  const knownNames = {
    'gh-100': 'GitHub Administration (GH-100)',
    'ai-102': 'Azure AI Engineer Associate (AI-102)',
    'az-900': 'Microsoft Azure Fundamentals (AZ-900)',
    'az-104': 'Microsoft Azure Administrator (AZ-104)',
    'az-204': 'Developing Solutions for Microsoft Azure (AZ-204)',
    'az-305': 'Designing Microsoft Azure Infrastructure Solutions (AZ-305)',
    'ms-700': 'Managing Microsoft Teams (MS-700)',
    'sc-900': 'Microsoft Security, Compliance, and Identity Fundamentals (SC-900)',
    'dp-100': 'Designing and Implementing a Data Science Solution on Azure (DP-100)',
  };

  if (knownNames[certId.toLowerCase()]) return knownNames[certId.toLowerCase()];

  // URL の末尾セグメントから推測
  const urlId = url.split('/').pop()?.toUpperCase() ?? certId.toUpperCase();
  return `Microsoft Certification (${urlId})`;
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
