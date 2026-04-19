'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const LEARN_MCP_URL = 'https://learn.microsoft.com/api/mcp';

async function fetchMarkdown(url) {
  const client = new Client({ name: 'cert-study-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(LEARN_MCP_URL));
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'microsoft_docs_fetch', arguments: { url } });
    return result?.content?.map((c) => c.text).join('\n') || '';
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Markdown からドメイン一覧を抽出する
 * パターン: 「# Domain N: タイトル」「## ドメイン N: タイトル」
 *          「Skills measured on the ... exam - Domain N: ...」
 *          ウェイトは「(20%)」「（20%）」の形式で記載されることが多い
 */
function parseDomainsFromMarkdown(md) {
  const domains = [];
  const lines = md.split('\n');
  const headerRe = /^#+\s*(?:Domain|ドメイン)\s*(\d+)\s*[:：]\s*(.+?)(?:\s*[（(]\s*(\d+)\s*%?\s*[）)])?\s*$/i;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      domains.push({
        id: `domain-${m[1]}`,
        name: `Domain ${m[1]}: ${m[2].trim()}`,
        weight: m[3] ? Number(m[3]) : 0,
      });
    }
  }
  return domains;
}

async function extractDomains(studyGuideUrl) {
  if (!studyGuideUrl) return [];
  const md = await fetchMarkdown(studyGuideUrl);
  const domains = parseDomainsFromMarkdown(md);
  if (domains.length === 0) throw new Error('ドメイン情報を抽出できませんでした。手動で入力してください。');
  return domains;
}

module.exports = { extractDomains, parseDomainsFromMarkdown };
