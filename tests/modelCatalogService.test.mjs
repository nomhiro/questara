import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const modelCatalogService = _require('../services/modelCatalogService');

const CATALOG_RESPONSE = [
  {
    id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', publisher: 'DeepSeek',
    supported_input_modalities: ['text'], supported_output_modalities: ['text'],
  },
  {
    id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI',
    supported_input_modalities: ['text', 'image'], supported_output_modalities: ['text'],
  },
  {
    id: 'openai/text-embedding-3-small', name: 'Embedding', publisher: 'OpenAI',
    supported_input_modalities: ['text'], supported_output_modalities: ['embeddings'],
  },
];

describe('modelCatalogService.listModels', () => {
  beforeEach(() => {
    modelCatalogService._resetCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('text→text のチャットモデルのみ返し、openai/gpt-5 系を先頭にソートする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => CATALOG_RESPONSE })));
    const models = await modelCatalogService.listModels('token');
    expect(models.map((m) => m.id)).toEqual(['openai/gpt-5', 'deepseek/deepseek-r1']);
  });

  test('カタログ取得失敗（非2xx）時はフォールバック一覧を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    const models = await modelCatalogService.listModels('token');
    expect(models).toEqual(modelCatalogService.FALLBACK_MODELS);
  });

  test('fetch が throw してもフォールバック一覧を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const models = await modelCatalogService.listModels('token');
    expect(models).toEqual(modelCatalogService.FALLBACK_MODELS);
  });

  test('成功結果はキャッシュされ 2 回目の fetch は発生しない', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG_RESPONSE }));
    vi.stubGlobal('fetch', fetchMock);
    await modelCatalogService.listModels('token');
    await modelCatalogService.listModels('token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
