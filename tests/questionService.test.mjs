import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const questionService = _require('../services/questionService');

describe('canAccessCertification (D-17)', () => {
  it('公開資格は誰でもアクセス可', () => {
    expect(questionService.canAccessCertification({ isPublic: true, createdBy: 'owner' }, 'someone')).toBe(true);
  });
  it('非公開資格は作成者のみ', () => {
    expect(questionService.canAccessCertification({ isPublic: false, createdBy: 'owner' }, 'owner')).toBe(true);
    expect(questionService.canAccessCertification({ isPublic: false, createdBy: 'owner' }, 'intruder')).toBe(false);
  });
  it('cert が null なら false', () => {
    expect(questionService.canAccessCertification(null, 'anyone')).toBe(false);
  });
});

describe('buildCertification (D-09)', () => {
  it('フォーム入力から非公開の資格ドキュメントを組み立てる', () => {
    const cert = questionService.buildCertification({
      id: 'my-cert', name: 'マイ資格',
      studyGuideUrl: 'https://guide', courseUrl: '',
      createdBy: 'user-1', creatorName: 'user1',
      domains: [{ id: 'domain-1', name: 'D1', weight: 60 }, { name: 'D2', weight: 40 }],
    });
    expect(cert.id).toBe('my-cert');
    expect(cert.isPublic).toBe(false);
    expect(cert.publishedAt).toBe(null);
    expect(cert.createdBy).toBe('user-1');
    expect(cert.creatorName).toBe('user1');
    expect(cert.domains).toHaveLength(2);
    expect(cert.domains[0]).toEqual({ id: 'domain-1', name: 'D1', weight: 60, generatedAt: null, questions: [] });
    // id 欠落時は domain-N を補完
    expect(cert.domains[1].id).toBe('domain-2');
  });

  it('weight は整数化、欠損 URL は空文字', () => {
    const cert = questionService.buildCertification({
      id: 'c2', name: 'C2', createdBy: 'u', creatorName: 'u',
      domains: [{ id: 'd1', name: 'D', weight: 33.7 }],
    });
    expect(cert.studyGuideUrl).toBe('');
    expect(cert.courseUrl).toBe('');
    expect(cert.domains[0].weight).toBe(34);
  });
});

describe('shuffle (D-09)', () => {
  it('同じ要素の順列を返し、入力を破壊しない', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    const snapshot = [...input];
    const out = questionService.shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
    expect(input).toEqual(snapshot); // 非破壊
  });

  it('空配列はそのまま', () => {
    expect(questionService.shuffle([])).toEqual([]);
  });
});
