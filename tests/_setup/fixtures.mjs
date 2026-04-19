import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const userService = require('../../services/userService');
const cosmosService = require('../../services/cosmosService');

export async function createTestUser(overrides = {}) {
  const githubId = overrides.githubId ?? Math.floor(Math.random() * 1_000_000);
  return userService.upsertGithubUser({
    githubId,
    githubLogin: overrides.githubLogin ?? `testuser-${githubId}`,
    email: overrides.email ?? `test-${githubId}@example.com`,
    displayName: overrides.displayName ?? `Test User ${githubId}`,
    avatarUrl: overrides.avatarUrl ?? null,
    accessToken: overrides.accessToken ?? `fake-token-${githubId}`,
  });
}

export async function createTestCertification(overrides = {}) {
  const id = overrides.id ?? `test-cert-${Date.now()}`;
  const cert = {
    id,
    name: overrides.name ?? `Test Certification ${id}`,
    studyGuideUrl: overrides.studyGuideUrl ?? '',
    courseUrl: overrides.courseUrl ?? '',
    createdBy: overrides.createdBy ?? 'system',
    creatorName: overrides.creatorName ?? 'system',
    isPublic: overrides.isPublic ?? true,
    publishedAt: overrides.isPublic === false ? null : new Date().toISOString(),
    usedByCount: 0,
    domains: overrides.domains ?? [
      {
        id: 'domain-1',
        name: 'Domain 1: テストドメイン',
        weight: 50,
        generatedAt: null,
        questions: [
          {
            id: `${id}-d1-001`,
            question: 'テスト問題1',
            options: { A: '答えA', B: '答えB', C: '答えC', D: '答えD' },
            correctAnswer: 'A',
            explanation: 'テスト解説',
          },
          {
            id: `${id}-d1-002`,
            question: 'テスト問題2',
            options: { A: '答えA', B: '答えB', C: '答えC', D: '答えD' },
            correctAnswer: 'B',
            explanation: 'テスト解説',
          },
        ],
      },
      {
        id: 'domain-2',
        name: 'Domain 2: テストドメイン2',
        weight: 50,
        generatedAt: null,
        questions: [
          {
            id: `${id}-d2-001`,
            question: 'テスト問題3',
            options: { A: '答えA', B: '答えB', C: '答えC', D: '答えD' },
            correctAnswer: 'C',
            explanation: 'テスト解説',
          },
        ],
      },
    ],
  };
  await cosmosService.upsert('certifications', cert);
  return cert;
}
