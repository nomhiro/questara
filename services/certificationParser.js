'use strict';

const mcpClient = require('./mcpClient');
const { createLlmClient, GITHUB_MODELS_DEFAULT_MODEL, extractJsonArray } = require('./llmClient');

/**
 * 現行スキル範囲より後ろのセクション（学習リソース / 変更履歴 / 以前の評価されるスキル）を落とす。
 * SC-400 のように旧版スキルを併記する学習ガイドでドメインが重複するのを防ぐ。
 */
function trimPastCurrentSkills(md) {
  const stopRes = [
    /^##\s+学習リソース/m,
    /^##\s+変更履歴/m,
    /^##\s+ログの変更/m,
    /^##\s+Change\s+log/im,
    /^##\s+Learning\s+resources/im,
    /^##\s+.+以前/m,
  ];
  let out = md;
  for (const re of stopRes) {
    const m = out.match(re);
    if (m && typeof m.index === 'number') {
      out = out.slice(0, m.index);
    }
  }
  return out;
}

/**
 * Markdown からドメイン一覧を正規表現で抽出する（速い・API不要）
 *
 * 2 パターンを順に試す:
 *   1) レガシー形式 - "# Domain 1: Foo (15%)" / "## ドメイン 2: ..."
 *   2) 現代的な Microsoft Learn 形式 - "### トピック (25–30%)" / "(25 から 30%)"
 */
function parseDomainsFromMarkdown(md) {
  const trimmed = trimPastCurrentSkills(md);
  const lines = trimmed.split('\n');

  // 1) レガシー形式
  const legacy = [];
  const legacyRe = /^#+\s*(?:Domain|ドメイン)\s*(\d+)\s*[:：]\s*(.+?)(?:\s*[（(]\s*(\d+)\s*%?\s*[）)])?\s*$/i;
  for (const line of lines) {
    const m = line.match(legacyRe);
    if (m) {
      legacy.push({
        id: `domain-${m[1]}`,
        name: `Domain ${m[1]}: ${m[2].trim()}`,
        weight: m[3] ? Number(m[3]) : 0,
      });
    }
  }
  if (legacy.length > 0) return legacy;

  // 2) 現代的な Microsoft Learn 形式（H3 + 末尾ウェイト。範囲区切りに「から」「to」も含む）
  const modern = [];
  const modernRe = /^###\s+(.+?)\s*[（(]\s*(\d+)\s*(?:(?:[-–—~〜～－−]|から|to)\s*(\d+))?\s*%?\s*[）)]\s*$/i;
  for (const line of lines) {
    const m = line.match(modernRe);
    if (m) {
      const w1 = Number(m[2]);
      const w2 = m[3] ? Number(m[3]) : w1;
      const idx = modern.length + 1;
      modern.push({
        id: `domain-${idx}`,
        name: `Domain ${idx}: ${m[1].trim()}`,
        weight: Math.round((w1 + w2) / 2),
      });
    }
  }
  if (modern.length > 0) return normalizeWeightsToSum100(modern);

  return [];
}

/**
 * LLM（GitHub Models）でドメイン構造を抽出する（regex が失敗した場合のフォールバック）
 */
async function parseDomainsWithLlm(md, accessToken) {
  const openai = createLlmClient(accessToken);

  const truncated = md.length > 12000 ? md.slice(0, 12000) : md;
  const prompt = `あなたは Microsoft/GitHub 認定資格の学習ガイドを解析する専門家です。
以下の Markdown テキストから試験ドメイン（出題範囲のセクション）を抽出してください。

## 抽出ルール
- 各ドメインの「名前」と「試験ウェイト（%）」を特定する
- セクション見出しは「Skills measured」「Study these skills」「試験の対象となるスキル」「評価されるスキル」など多様な表現がある
- ウェイト表記は「20%」「約20%」「(20%)」など多様
- ドメイン名は日本語/英語そのままの表記を維持
- ウェイトが明記されていない場合は 0 を設定
- **ウェイトは必ず整数で出力する**（小数点を含めない。「20-25%」のような範囲表記は中央値を四捨五入）
- **全ドメインのウェイト合計がちょうど100になるようにする**（丸め誤差がある場合は最大ウェイトのドメインで調整）

## 出力形式
JSON 配列のみを返してください（説明文・コードブロック記号は不要）:
[
  { "id": "domain-1", "name": "ドメイン1の名前", "weight": 25 },
  { "id": "domain-2", "name": "ドメイン2の名前", "weight": 30 }
]

## 学習ガイド本文

${truncated}`;

  const response = await openai.chat.completions.create({
    model: GITHUB_MODELS_DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.choices[0]?.message?.content || '';
  const json = extractJsonArray(text);
  if (!json) throw new Error('LLM のレスポンスから JSON を抽出できませんでした');

  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('LLM が有効なドメイン一覧を返しませんでした');
  }

  const mapped = parsed.map((d, i) => ({
    id: d.id || `domain-${i + 1}`,
    name: d.name || `Domain ${i + 1}`,
    weight: Math.round(Number(d.weight) || 0),
  }));
  return normalizeWeightsToSum100(mapped);
}

/**
 * ドメインのウェイト合計を 100 に正規化する。
 * すべて 0 の場合は均等配分。それ以外は比例配分して余剰/不足を最大のドメインに加減する。
 */
function normalizeWeightsToSum100(domains) {
  if (domains.length === 0) return domains;
  const sum = domains.reduce((acc, d) => acc + (d.weight || 0), 0);
  if (sum === 100) return domains;

  if (sum === 0) {
    // 全て 0 なら均等配分
    const base = Math.floor(100 / domains.length);
    const remainder = 100 - base * domains.length;
    return domains.map((d, i) => ({ ...d, weight: base + (i < remainder ? 1 : 0) }));
  }

  // 比例配分して整数化
  const scaled = domains.map((d) => ({ ...d, weight: Math.round((d.weight * 100) / sum) }));
  const newSum = scaled.reduce((acc, d) => acc + d.weight, 0);
  const diff = 100 - newSum;
  if (diff !== 0) {
    // 最大ウェイトのドメインで調整
    let maxIdx = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i].weight > scaled[maxIdx].weight) maxIdx = i;
    }
    scaled[maxIdx] = { ...scaled[maxIdx], weight: scaled[maxIdx].weight + diff };
  }
  return scaled;
}

/**
 * URL からドメイン構造を抽出する。
 * まず regex で試し、失敗したら LLM（GitHub Models）にフォールバックする。
 * @param {string} studyGuideUrl
 * @param {object} [options]
 * @param {string} [options.accessToken] - GitHub アクセストークン（LLM フォールバック用）
 */
async function extractDomains(studyGuideUrl, { accessToken } = {}) {
  if (!studyGuideUrl) return [];
  const md = await mcpClient.callLearnFetch(studyGuideUrl);
  if (!md) throw new Error('学習ガイドのコンテンツを取得できませんでした');

  const regexDomains = parseDomainsFromMarkdown(md);
  if (regexDomains.length > 0) return regexDomains;

  if (!accessToken) {
    throw new Error('ドメイン情報を正規表現では抽出できません。LLM フォールバックには GitHub トークンが必要です。');
  }

  return parseDomainsWithLlm(md, accessToken);
}

module.exports = { extractDomains, parseDomainsFromMarkdown, parseDomainsWithLlm, normalizeWeightsToSum100 };
