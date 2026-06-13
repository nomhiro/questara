import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const modelCatalogService = _require('../services/modelCatalogService');

const CATALOG_RESPONSE = [
  {
    id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', publisher: 'Meta',
    rate_limit_tier: 'high',
    supported_input_modalities: ['text'], supported_output_modalities: ['text'],
  },
  {
    id: 'openai/gpt-4.1', name: 'OpenAI GPT-4.1', publisher: 'OpenAI',
    rate_limit_tier: 'high',
    supported_input_modalities: ['text', 'image'], supported_output_modalities: ['text'],
  },
  {
    id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o mini', publisher: 'OpenAI',
    rate_limit_tier: 'low',
    supported_input_modalities: ['text'], supported_output_modalities: ['text'],
  },
  {
    // custom ティアは無料ティアで推論不可（unavailable_model）→ 除外される
    id: 'openai/gpt-5', name: 'OpenAI GPT-5', publisher: 'OpenAI',
    rate_limit_tier: 'custom',
    supported_input_modalities: ['text', 'image'], supported_output_modalities: ['text'],
  },
  {
    id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', publisher: 'DeepSeek',
    rate_limit_tier: 'custom',
    supported_input_modalities: ['text'], supported_output_modalities: ['text'],
  },
  {
    // embeddings はチャット不可 → 除外される
    id: 'openai/text-embedding-3-small', name: 'Embedding', publisher: 'OpenAI',
    rate_limit_tier: 'embeddings',
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

  test('全チャットモデル（custom 含む）を tier 付きで返し、embeddings のみ除外する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => CATALOG_RESPONSE })));
    const models = await modelCatalogService.listModels('token');
    const ids = models.map((m) => m.id);
    expect(ids).toContain('openai/gpt-5');               // custom も含む
    expect(ids).toContain('deepseek/deepseek-r1');       // custom も含む
    expect(ids).toContain('openai/gpt-4.1');
    expect(ids).not.toContain('openai/text-embedding-3-small'); // embeddings → 除外
    // tier 情報を UI のグルーピング用に付与する
    expect(models.find((m) => m.id === 'openai/gpt-5').tier).toBe('custom');
    expect(models.find((m) => m.id === 'openai/gpt-4.1').tier).toBe('high');
  });

  test('ソート順: gpt-4.1 系 → openai 系 → その他（同順位は id 昇順）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => CATALOG_RESPONSE })));
    const models = await modelCatalogService.listModels('token');
    expect(models.map((m) => m.id)).toEqual([
      'openai/gpt-4.1',
      'openai/gpt-4o-mini',
      'openai/gpt-5',
      'deepseek/deepseek-r1',
      'meta/llama-3.3-70b-instruct',
    ]);
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
