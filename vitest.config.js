import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

// .env.test を読んで process.env に反映（dotenv 不使用・素朴に）
const envFile = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['tests/_setup/global.mjs'],
  },
});
