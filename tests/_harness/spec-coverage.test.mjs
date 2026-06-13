/**
 * 仕様駆動開発ハーネス: services / routes / middleware の全ファイルに、
 * 対応するテストファイルが存在することを自動検証する。
 *
 * 新しいサービスやルートを追加した瞬間に失敗する（red）。テストを
 * 書くか、明確な理由とともに ALLOWED_UNTESTED に登録するまで緑にならない。
 * ALLOWED_UNTESTED には必ずコメントで理由を書くこと（レビュー容易化のため）。
 *
 * 検出アルゴリズム:
 *   対象ファイル foo.js に対して、tests/ 以下の .test.{mjs,js} のいずれかが
 *   以下のいずれかを満たせば「カバーあり」とみなす:
 *     1) テストファイル名 に foo のベース名が含まれる
 *        (例: services/foo.js → tests/foo.test.js, tests/foo.xxx.test.mjs)
 *     2) テスト本文に require/import パスとして該当ファイルへの参照がある
 *        (例: from '../services/foo.js' / require('../services/foo'))
 *     3) テスト本文に `// @covers: <relative-path>` アノテーションがある
 *        (エンドポイント経由でのみカバーするケース用)
 */

import { describe, test, expect } from 'vitest';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const TESTS_DIR = path.resolve(__dirname, '..');

const TARGET_DIRS = ['services', 'routes', 'middleware'];

/**
 * テストを書かない・書けないファイルの明示リスト。
 * 各エントリには理由をコメントで必ず書く（レビュアーが追跡できるように）。
 */
const ALLOWED_UNTESTED = new Map([
  // Cosmos DB の薄いラッパー。他の service テスト経由で実質カバー。
  ['services/cosmosService.js', 'thin Cosmos wrapper, integration-only'],
  // JWT 署名検証。routes.auth テストでエンドツーエンド検証済み。
  ['services/jwtService.js', 'covered end-to-end by routes.auth tests'],
  // MCP クライアントは外部 SSE/HTTP 依存の薄いトランスポート。利用側（generationService 等）でモックされる。
  ['services/mcpClient.js', 'external MCP transport, mocked at call sites'],
  // GitHub OAuth callback を実機に飛ばさず検証するのは高コスト。routes.auth.test で cookie 挙動のみ確認。
  // すでに routes.auth.test でカバー済みの扱い。
  // 必要ならここを外して detailed test を追加可能。

  // routes/api.js（問題再生成 SSE）, routes/domains.js は LLM/MCP をモックした
  // characterization test を追加したため除外不要:
  //   tests/routes.api.test.mjs, tests/routes.domains.test.mjs

  // authContext / requireAuth は全 routes.* テストで間接的に検証されている。
  ['middleware/auth.js', 'exercised by all routes.* tests'],
]);

function walkJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkJsFiles(full));
    } else if (st.isFile() && name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function walkTestFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue; // _setup, _harness 自身など内部ディレクトリは対象外
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTestFiles(full));
    } else if (st.isFile() && /\.test\.(mjs|js)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function toRelUnix(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function isCoveredByTests(sourceFile, testFiles, testContents) {
  const rel = toRelUnix(sourceFile);
  const base = path.basename(sourceFile, '.js');
  const dir = path.basename(path.dirname(sourceFile));

  // 1) ファイル名にベース名が含まれる
  const nameMatch = testFiles.some((tf) => {
    const tfName = path.basename(tf);
    return tfName.toLowerCase().includes(base.toLowerCase());
  });
  if (nameMatch) return true;

  // 2) 本文に require/import パスが含まれる
  const needles = [
    `/${dir}/${base}`,
    `${dir}/${base}.js`,
    `${dir}/${base}'`,
    `${dir}/${base}"`,
  ];
  const contentMatch = testContents.some((tc) =>
    needles.some((n) => tc.content.includes(n))
  );
  if (contentMatch) return true;

  // 3) `// @covers: <relative-path>` アノテーション宣言
  const coversNeedle = `@covers: ${rel}`;
  const annotationMatch = testContents.some((tc) => tc.content.includes(coversNeedle));
  return annotationMatch;
}

describe('spec-coverage harness', () => {
  const testFiles = walkTestFiles(TESTS_DIR);
  const testContents = testFiles.map((f) => ({ path: f, content: readFileSync(f, 'utf8') }));

  for (const dir of TARGET_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!existsSync(absDir)) continue;
    const files = walkJsFiles(absDir);

    for (const file of files) {
      const rel = toRelUnix(file);

      if (ALLOWED_UNTESTED.has(rel)) {
        test(`(allowed) ${rel} -- ${ALLOWED_UNTESTED.get(rel)}`, () => {
          // 明示的に除外されていることを記録するための pass テスト
          expect(true).toBe(true);
        });
        continue;
      }

      test(`${rel} is covered by at least one test file`, () => {
        const covered = isCoveredByTests(file, testFiles, testContents);
        expect(
          covered,
          `"${rel}" にテストがありません。tests/ にテストを追加するか、理由を添えて ALLOWED_UNTESTED に登録してください。`
        ).toBe(true);
      });
    }
  }

  test('ALLOWED_UNTESTED に記録された全ファイルが実在する（デッドエントリ防止）', () => {
    const missing = [];
    for (const rel of ALLOWED_UNTESTED.keys()) {
      const abs = path.join(ROOT, rel);
      if (!existsSync(abs)) missing.push(rel);
    }
    expect(
      missing,
      `ALLOWED_UNTESTED に実在しないエントリ: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
