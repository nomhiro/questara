'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const DEFAULT_URL = process.env.MS_LEARN_MCP_URL || 'https://learn.microsoft.com/api/mcp';

async function withClient(fn) {
  const client = new Client({ name: 'cert-study-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(DEFAULT_URL));
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Microsoft Learn MCP の microsoft_docs_search を呼ぶ
 * @param {string} question - 検索クエリ
 * @returns {Promise<Array<{title: string, url: string, content: string}>>} 検索結果
 */
async function callLearnSearch(question) {
  return withClient(async (client) => {
    const result = await client.callTool({
      name: 'microsoft_docs_search',
      arguments: { query: question },
    });
    // result.content は [{ type: 'text', text: '...' }, ...]。text は JSON 文字列の場合あり。
    const textJoined = result?.content?.map((c) => c.text).join('\n') || '';
    // 1) まず JSON パースを試みる（{"results":[...]} 形式）
    try {
      const parsed = JSON.parse(textJoined);
      if (parsed && Array.isArray(parsed.results)) {
        return parsed.results.map((r) => ({
          title: r.title || '',
          url: r.contentUrl || r.url || '',
          content: r.content || r.excerpt || '',
        }));
      }
    } catch { /* 非JSON フォーマットの可能性 */ }
    // 2) プレーンテキストならそのまま 1 件として扱う
    if (textJoined.trim()) {
      return [{ title: 'Microsoft Learn', url: '', content: textJoined.slice(0, 4000) }];
    }
    return [];
  });
}

/**
 * Microsoft Learn MCP の microsoft_docs_fetch を呼ぶ
 * @param {string} url
 * @returns {Promise<string>} ページ本文（markdown）
 */
async function callLearnFetch(url) {
  return withClient(async (client) => {
    const result = await client.callTool({
      name: 'microsoft_docs_fetch',
      arguments: { url },
    });
    return result?.content?.map((c) => c.text).join('\n') || '';
  });
}

module.exports = { callLearnSearch, callLearnFetch };
