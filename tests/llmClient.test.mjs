import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const llmClient = _require('../services/llmClient');
const {
  GITHUB_MODELS_ENDPOINT,
  GITHUB_MODELS_DEFAULT_MODEL,
  GENERATION_DEFAULT_MODEL,
  LLM_TIMEOUT_MS,
  createLlmClient,
  extractJsonObject,
  extractJsonArray,
} = llmClient;

describe('llmClient 定数', () => {
  it('GitHub Models のエンドポイント・モデル・タイムアウトを公開する', () => {
    expect(GITHUB_MODELS_ENDPOINT).toBe('https://models.github.ai/inference');
    expect(GITHUB_MODELS_DEFAULT_MODEL).toBe('openai/gpt-5-mini');
    expect(GENERATION_DEFAULT_MODEL).toBe('openai/gpt-5');
    expect(LLM_TIMEOUT_MS).toBe(120000);
  });
});

describe('createLlmClient', () => {
  it('chat.completions.create を持つクライアントを返す', () => {
    const client = createLlmClient('fake-token');
    expect(client).toBeTruthy();
    expect(typeof client.chat.completions.create).toBe('function');
  });
});

describe('extractJsonObject', () => {
  it('テキスト中の最初の JSON オブジェクトを取り出す', () => {
    expect(extractJsonObject('前置き {"a":1} 後置き')).toBe('{"a":1}');
  });
  it('複数行/コードフェンス混じりでも取り出す', () => {
    const text = '```json\n{\n  "name": "x"\n}\n```';
    expect(JSON.parse(extractJsonObject(text))).toEqual({ name: 'x' });
  });
  it('オブジェクトが無ければ null', () => {
    expect(extractJsonObject('ただのテキスト')).toBe(null);
    expect(extractJsonObject('')).toBe(null);
    expect(extractJsonObject(null)).toBe(null);
  });
});

describe('extractJsonArray', () => {
  it('テキスト中の最初の JSON 配列を取り出す', () => {
    expect(extractJsonArray('結果: [1,2,3] です')).toBe('[1,2,3]');
  });
  it('配列が無ければ null', () => {
    expect(extractJsonArray('{"a":1}')).toBe(null);
    expect(extractJsonArray(null)).toBe(null);
  });
});
