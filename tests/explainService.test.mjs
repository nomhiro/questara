import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

// explainService の unit test。MCP 検索（mcpClient.callLearnSearch）と
// LLM クライアント生成（llmClient.createLlmClient）をスパイ化し、
// グラウンディング → 生成 → 構造化整形 → references フィルタの挙動を固定する。
// mapLlmError / extractJsonObject は実物を使う（純粋関数のため）。
const _require = createRequire(import.meta.url);
const explainService = _require('../services/explainService');
const mcpClient = _require('../services/mcpClient');
const llmClient = _require('../services/llmClient');

const _orig = {
  callLearnSearch: mcpClient.callLearnSearch,
  createLlmClient: llmClient.createLlmClient,
};

// LLM クライアントのモックを差し込み、create が返す応答テキストを制御する。
function mockLlm(createImpl) {
  const create = vi.fn(createImpl);
  llmClient.createLlmClient = vi.fn(() => ({ chat: { completions: { create } } }));
  return create;
}

function okResponse(content) {
  return async () => ({ choices: [{ message: { content } }] });
}

const cert = { id: 'gh-100', name: 'GitHub Administration' };
const domain = { id: 'domain-1', name: 'Domain 1: Manage GitHub' };
const question = {
  id: 'gh-100-d1-001',
  question: 'ブランチ保護で main への直接 push を防ぐ最適な方法は？',
  options: { A: 'ruleset', B: 'webhook', C: 'fork', D: 'mirror' },
  correctAnswers: ['A'],
  correctAnswer: 'A',
  explanation: '既存の短い解説',
};
const llmConfig = { apiKey: 'fake-token', modelName: 'openai/gpt-4.1' };

beforeEach(() => {
  mcpClient.callLearnSearch = vi.fn(async () => [
    { title: 'Branch protection', url: 'https://learn.microsoft.com/branch', content: 'rulesets で push を制御できます' },
  ]);
});
afterEach(() => {
  mcpClient.callLearnSearch = _orig.callLearnSearch;
  llmClient.createLlmClient = _orig.createLlmClient;
});

describe('explainService.explainQuestion', () => {
  test('検索結果を参考資料に含めて LLM を呼び、構造化結果を返す', async () => {
    const create = mockLlm(okResponse(JSON.stringify({
      summary: '要点です',
      whyCorrect: 'ruleset が正しい理由',
      whyIncorrect: { B: 'webhook は事後対応', C: 'fork は無関係', D: 'mirror は無関係' },
      deepDive: '背景の補足',
      references: [{ title: 'Branch protection', url: 'https://learn.microsoft.com/branch' }],
    })));

    const result = await explainService.explainQuestion({ cert, domain, question, llmConfig });

    expect(result.summary).toBe('要点です');
    expect(result.whyCorrect).toContain('ruleset');
    expect(result.whyIncorrect.B).toContain('webhook');
    expect(result.deepDive).toBe('背景の補足');

    // 検索は 1 回、クエリに問題文を含む
    expect(mcpClient.callLearnSearch).toHaveBeenCalledTimes(1);
    expect(String(mcpClient.callLearnSearch.mock.calls[0][0])).toContain('main への直接 push');

    // LLM プロンプトに検索結果の本文と問題文が含まれる
    const prompt = create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('rulesets で push を制御できます');
    expect(prompt).toContain('main への直接 push');
    expect(create.mock.calls[0][0].model).toBe('openai/gpt-4.1');
  });

  test('references は https:// 以外を除外し重複排除する', async () => {
    mcpClient.callLearnSearch = vi.fn(async () => [
      { title: 'Branch protection', url: 'https://learn.microsoft.com/branch', content: 'x' },
      { title: 'Rulesets', url: 'https://learn.microsoft.com/rulesets', content: 'y' },
    ]);
    mockLlm(okResponse(JSON.stringify({
      summary: 's', whyCorrect: 'w', whyIncorrect: {}, deepDive: 'd',
      references: [
        { title: 'Branch protection', url: 'https://learn.microsoft.com/branch' }, // 検索結果と重複
        { title: 'Insecure', url: 'http://insecure.example.com' },                 // http は除外
        { title: 'XSS', url: 'javascript:alert(1)' },                              // 危険スキームは除外
      ],
    })));

    const result = await explainService.explainQuestion({ cert, domain, question, llmConfig });

    const urls = result.references.map((r) => r.url);
    expect(urls).toContain('https://learn.microsoft.com/branch');
    expect(urls).toContain('https://learn.microsoft.com/rulesets');
    expect(urls).not.toContain('http://insecure.example.com');
    expect(urls).not.toContain('javascript:alert(1)');
    // 重複は 1 件に
    expect(urls.filter((u) => u === 'https://learn.microsoft.com/branch').length).toBe(1);
  });

  test('検索が失敗しても解説生成は継続する（graceful）', async () => {
    mcpClient.callLearnSearch = vi.fn(async () => { throw new Error('MCP down'); });
    const create = mockLlm(okResponse(JSON.stringify({
      summary: '検索なしでも生成', whyCorrect: 'w', whyIncorrect: {}, deepDive: '', references: [],
    })));

    const result = await explainService.explainQuestion({ cert, domain, question, llmConfig });

    expect(result.summary).toBe('検索なしでも生成');
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('unavailable_model は mapLlmError の利用者向けメッセージに変換して投げる', async () => {
    mockLlm(async () => { throw { code: 'unavailable_model', message: 'Unavailable model: gpt-5' }; });

    await expect(
      explainService.explainQuestion({ cert, domain, question, llmConfig: { apiKey: 't', modelName: 'openai/gpt-5' } })
    ).rejects.toThrow(/openai\/gpt-5/);
  });

  test('JSON 抽出に失敗したら summary に生テキストを入れて返す', async () => {
    // parse フォールバックを純粋に検証するため検索結果は空にする
    mcpClient.callLearnSearch = vi.fn(async () => []);
    mockLlm(okResponse('これはJSONではないただのプレーンテキスト解説'));

    const result = await explainService.explainQuestion({ cert, domain, question, llmConfig });

    expect(result.summary).toBe('これはJSONではないただのプレーンテキスト解説');
    expect(result.whyIncorrect).toEqual({});
    expect(result.references).toEqual([]);
  });

  test('onProgress に検索中・生成中の進捗が通知される', async () => {
    mockLlm(okResponse(JSON.stringify({ summary: 's', whyCorrect: '', whyIncorrect: {}, deepDive: '', references: [] })));
    const messages = [];

    await explainService.explainQuestion({ cert, domain, question, llmConfig, onProgress: (m) => messages.push(m) });

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.join('\n')).toContain('検索');
    expect(messages.join('\n')).toContain('生成');
  });
});
