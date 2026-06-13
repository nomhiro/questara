import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/mcpClient.js', () => ({
  callLearnSearch: vi.fn().mockResolvedValue([]),
  callLearnFetch: vi.fn().mockResolvedValue(''),
}));
vi.mock('../services/questionService.js', () => ({
  listCertifications: vi.fn().mockResolvedValue([
    { id: 'gh-100', name: 'GitHub Foundations' },
    { id: 'ai-102', name: 'AI Engineer' },
  ]),
}));

import adventureGenerator from '../services/adventureGeneratorService.js';

describe('parseAndValidate', () => {
  const known = new Set(['gh-100', 'ai-102']);

  it('未知の certId を除外する', () => {
    const raw = JSON.stringify({
      name: 'X', description: 'desc', rationale: 'rea',
      dungeons: ['gh-100', 'unknown', 'ai-102'],
      citations: [{ url: 'https://example.com', title: 'T' }],
    });
    const out = adventureGenerator.parseAndValidate({ raw, knownCertIds: known });
    expect(out.dungeons).toEqual(['gh-100', 'ai-102']);
    expect(out.verificationStatus).toBe('verified');
  });

  it('citations が空なら warning-no-citations', () => {
    const raw = JSON.stringify({ name: 'X', dungeons: ['gh-100'], citations: [] });
    const out = adventureGenerator.parseAndValidate({ raw, knownCertIds: known });
    expect(out.verificationStatus).toBe('warning-no-citations');
  });

  it('dungeons が空になったら null', () => {
    const raw = JSON.stringify({ name: 'X', dungeons: ['unknown'], citations: [] });
    const out = adventureGenerator.parseAndValidate({ raw, knownCertIds: known });
    expect(out).toBe(null);
  });

  it('非JSON入力は null', () => {
    expect(adventureGenerator.parseAndValidate({ raw: 'hello', knownCertIds: known })).toBe(null);
  });

  it('ID の大文字小文字は正規化される', () => {
    const raw = JSON.stringify({ name: 'X', dungeons: ['GH-100', 'Ai-102'], citations: [] });
    const out = adventureGenerator.parseAndValidate({ raw, knownCertIds: known });
    expect(out.dungeons).toEqual(['gh-100', 'ai-102']);
  });

  it('超長い name/description は切り詰められる', () => {
    const raw = JSON.stringify({
      name: 'A'.repeat(200),
      description: 'B'.repeat(1000),
      rationale: 'C'.repeat(3000),
      dungeons: ['gh-100'],
      citations: [{ url: 'https://x', title: 't' }],
    });
    const out = adventureGenerator.parseAndValidate({ raw, knownCertIds: known });
    expect(out.name.length).toBeLessThanOrEqual(80);
    expect(out.description.length).toBeLessThanOrEqual(500);
    expect(out.rationale.length).toBeLessThanOrEqual(1500);
  });
});
