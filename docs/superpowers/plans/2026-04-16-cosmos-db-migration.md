# Cosmos DB 移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現行のSQLite + JSONファイルベースの永続化層をAzure Cosmos DB (NoSQL API)に移行し、express-session から JWT + httpOnly cookie に切り替える。既存の機能は変わらずそのまま動作する。

**Architecture:** `services/cosmosService.js` を新設してCosmos DB接続と基本CRUDを集約。`userService`, `progressService`, `questionService` を async Cosmos DB実装に書き換える。ルートハンドラもすべてasyncに変更。SQLite関連の依存（better-sqlite3, connect-sqlite3, bcrypt）は削除。

**Tech Stack:** `@azure/cosmos` v4, `jsonwebtoken` v9, Azure Cosmos DB Emulator（ローカル開発）またはAzureのFree Tier Cosmos DB。

**参考設計書:** `docs/superpowers/specs/2026-04-16-public-saas-design.md`

---

## ファイル構成

### 新規作成

- `services/cosmosService.js` — Cosmos DB接続、コンテナ初期化、CRUD基本操作
- `services/jwtService.js` — JWT発行・検証
- `scripts/seed-certifications.js` — `data/certifications/*.json` をCosmos DBに投入するシード
- `scripts/init-cosmos.js` — データベース・コンテナを冪等に作成
- `docker-compose.yml` — ローカル Cosmos DB Emulator 起動用

### 変更

- `app.js` — express-session削除、JWT middleware追加
- `middleware/auth.js` — JWT検証、`req.user` 注入
- `services/userService.js` — Cosmos DBベースに書き換え、async化、email/password認証を削除
- `services/progressService.js` — Cosmos DBベースに書き換え、async化
- `services/questionService.js` — Cosmos DBベースに書き換え、async化
- `routes/auth.js` — JWT cookie発行、/login POST と email/password フロー削除
- `routes/index.js` — async化、`req.user.id` 使用
- `routes/quiz.js` — async化、`req.user.id` 使用
- `routes/domains.js` — async化、`req.user.id` 使用
- `routes/api.js` — async化、`req.user.id` 使用
- `package.json` — 依存関係整理
- `.env.example` — Cosmos DB設定追加

### 削除

- `services/dbService.js`
- `data/app.db`, `data/sessions.db`（および `-shm`, `-wal`）
- `views/register.ejs`（メール登録廃止）

---

## 検証方針

本プロジェクトは自動テストを持たない（`CLAUDE.md` 記載）。各タスクの検証は **ブラウザ or curl での動作確認** で行う。各タスクの最後に「Verify」ステップを設け、期待される動作を明示する。

---

### Task 1: 依存関係の整理と環境変数

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: `@azure/cosmos` と `jsonwebtoken` をインストール、不要な依存を削除**

Run:
```bash
npm install @azure/cosmos@^4 jsonwebtoken@^9
npm uninstall better-sqlite3 connect-sqlite3 bcrypt
```

Expected `package.json` dependencies:
```json
"dependencies": {
  "@azure/cosmos": "^4.0.0",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "ejs": "^3.1.10",
  "express": "^4.19.2",
  "express-session": "^1.19.0",
  "jsonwebtoken": "^9.0.2",
  "node-html-parser": "^6.1.13",
  "openai": "^6.34.0"
}
```

- [ ] **Step 2: `.env.example` を更新**

追加する環境変数:
```env
# Cosmos DB
COSMOS_ENDPOINT=https://localhost:8081
COSMOS_KEY=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==
COSMOS_DATABASE=cert-quiz

# JWT
JWT_SECRET=change-me-to-a-random-32-byte-hex-string
JWT_COOKIE_NAME=cert_quiz_session
```

既存の `SESSION_SECRET` は削除してOK（JWTに置き換え）。`ENCRYPTION_KEY` は維持（GitHubトークン暗号化用）。

- [ ] **Step 3: コミット**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: switch deps from sqlite to cosmos db + jwt"
```

---

### Task 2: Docker Compose で Cosmos DB Emulator を用意

**Files:**
- Create: `docker-compose.yml`
- Modify: `.gitignore`

- [ ] **Step 1: `docker-compose.yml` を作成**

```yaml
services:
  cosmos-emulator:
    image: mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview
    container_name: cosmos-emulator
    ports:
      - "8081:8081"
      - "1234:1234"
    environment:
      - PROTOCOL=https
    volumes:
      - cosmos-data:/tmp/cosmos/appdata
    healthcheck:
      test: ["CMD-SHELL", "curl -fks https://localhost:8081/_explorer/emulator.pem || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 30

volumes:
  cosmos-data:
```

- [ ] **Step 2: `.gitignore` に既存 SQLite ファイルを追加しても良いが基本不要**

既に `data/app.db` 等は `.gitignore` に含まれている。確認のみ。

- [ ] **Step 3: Emulatorを起動**

Run:
```bash
docker compose up -d cosmos-emulator
```

Expected: コンテナが起動し、`docker ps` でhealthyになること（1-2分かかる）。

**Node.js で自己署名証明書を受け入れる設定**: 起動スクリプトに `NODE_TLS_REJECT_UNAUTHORIZED=0` を設定する（ローカル開発のみ、本番では使わない）。`package.json` の scripts を調整:

```json
"scripts": {
  "start": "node --env-file=.env app.js",
  "dev": "NODE_TLS_REJECT_UNAUTHORIZED=0 node --env-file=.env --watch app.js"
}
```

Windows bash では `NODE_TLS_REJECT_UNAUTHORIZED=0 node ...` の prefix 形式が動かない。`.env` ファイルに `NODE_TLS_REJECT_UNAUTHORIZED=0` を追加する方式を推奨（`--env-file=.env` で読み込まれる）。本番では絶対に設定しないこと。

- [ ] **Step 4: コミット**

```bash
git add docker-compose.yml package.json
git commit -m "chore: add cosmos db emulator docker compose"
```

---

### Task 3: cosmosService.js を作成

**Files:**
- Create: `services/cosmosService.js`

- [ ] **Step 1: 接続とコンテナ取得ヘルパーを実装**

```javascript
'use strict';

const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = process.env.COSMOS_DATABASE || 'cert-quiz';

const CONTAINERS = {
  users: { id: 'users', partitionKey: '/id' },
  certifications: { id: 'certifications', partitionKey: '/id' },
  sessions: { id: 'sessions', partitionKey: '/userId' },
  studyPlans: { id: 'studyPlans', partitionKey: '/userId' },
};

let client;
let database;
const containers = {};

function getClient() {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) throw new Error('COSMOS_ENDPOINT and COSMOS_KEY are required');
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

async function init() {
  const c = getClient();
  const { database: db } = await c.databases.createIfNotExists({ id: DATABASE_ID });
  database = db;
  for (const [key, def] of Object.entries(CONTAINERS)) {
    const { container } = await db.containers.createIfNotExists(def);
    containers[key] = container;
  }
}

function getContainer(name) {
  if (!containers[name]) throw new Error(`Container "${name}" not initialized. Did you call init()?`);
  return containers[name];
}

async function upsert(containerName, item) {
  const { resource } = await getContainer(containerName).items.upsert(item);
  return resource;
}

async function read(containerName, id, partitionKey) {
  try {
    const { resource } = await getContainer(containerName).item(id, partitionKey).read();
    return resource || null;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

async function remove(containerName, id, partitionKey) {
  try {
    await getContainer(containerName).item(id, partitionKey).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

async function query(containerName, querySpec, options = {}) {
  const { resources } = await getContainer(containerName).items.query(querySpec, options).fetchAll();
  return resources;
}

module.exports = { init, upsert, read, remove, query, getContainer };
```

- [ ] **Step 2: `app.js` 起動時に `init()` を呼ぶ**

`app.js` の `app.listen` 直前に追加:
```javascript
const cosmosService = require('./services/cosmosService');

(async () => {
  try {
    await cosmosService.init();
    console.log('✅ Cosmos DB initialized');
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Cosmos DB init failed:', err);
    process.exit(1);
  }
})();
```

既存の `app.listen` 呼び出しは削除。

- [ ] **Step 3: Verify - Emulatorが起動している状態でアプリを起動**

Run:
```bash
npm run dev
```

Expected: `✅ Cosmos DB initialized` と `🚀 Server running` が表示される。

Emulator UI (`https://localhost:8081/_explorer/index.html`) で `cert-quiz` データベースと4つのコンテナが作成されていることを確認。

- [ ] **Step 4: コミット**

```bash
git add services/cosmosService.js app.js
git commit -m "feat: add cosmos db service and initialize on startup"
```

---

### Task 4: シード スクリプトで既存資格データをCosmos DBに投入

**Files:**
- Create: `scripts/seed-certifications.js`

- [ ] **Step 1: シードスクリプトを書く**

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const cosmosService = require('../services/cosmosService');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certifications');

(async () => {
  await cosmosService.init();
  const files = fs.readdirSync(CERT_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(CERT_DIR, f), 'utf-8'));
    const cert = {
      ...data,
      createdBy: 'system',
      creatorName: 'system',
      isPublic: true,
      publishedAt: new Date().toISOString(),
      usedByCount: 0,
    };
    await cosmosService.upsert('certifications', cert);
    console.log(`✅ Seeded: ${cert.id} (${cert.name})`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: `package.json` に scripts を追加**

```json
"scripts": {
  ...,
  "seed": "node --env-file=.env scripts/seed-certifications.js"
}
```

- [ ] **Step 3: 実行**

Run:
```bash
npm run seed
```

Expected: `gh-100.json`, `gh-200.json` 等の各ファイルについて `✅ Seeded:` メッセージ。

- [ ] **Step 4: Emulator UI でデータ確認**

`cert-quiz > certifications` コンテナに各資格のドキュメントが存在することを確認。

- [ ] **Step 5: コミット**

```bash
git add scripts/seed-certifications.js package.json
git commit -m "feat: add seed script for certifications"
```

---

### Task 5: userService.js を Cosmos DB 版に書き換え

**Files:**
- Modify: `services/userService.js`

- [ ] **Step 1: 既存のemail/passwordベース関数を削除、Cosmos DB版に書き換え**

```javascript
'use strict';

const crypto = require('crypto');
const cosmosService = require('./cosmosService');

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext) {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function userId(githubId) {
  return `github-${githubId}`;
}

async function upsertGithubUser({ githubId, githubLogin, email, accessToken, displayName, avatarUrl }) {
  const id = userId(githubId);
  const existing = await cosmosService.read('users', id, id);
  const now = new Date().toISOString();
  const user = {
    id,
    githubId: Number(githubId),
    username: githubLogin,
    displayName: displayName || githubLogin,
    avatarUrl: avatarUrl || null,
    email: email || existing?.email || null,
    role: existing?.role || 'user',
    githubAccessToken: accessToken ? encrypt(accessToken) : existing?.githubAccessToken || null,
    stats: existing?.stats || {
      totalSessions: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      weeklyCorrectRate: null,
      monthlyCorrectRate: null,
      certStats: {},
    },
    createdAt: existing?.createdAt || now,
    lastLoginAt: now,
  };
  await cosmosService.upsert('users', user);
  return user;
}

async function getUserById(id) {
  return cosmosService.read('users', id, id);
}

async function getGithubAccessToken(id) {
  const user = await getUserById(id);
  if (!user?.githubAccessToken) return null;
  return decrypt(user.githubAccessToken);
}

async function updateUserStats(id, updater) {
  const user = await getUserById(id);
  if (!user) return null;
  user.stats = updater(user.stats || {});
  await cosmosService.upsert('users', user);
  return user;
}

module.exports = {
  upsertGithubUser,
  getUserById,
  getGithubAccessToken,
  updateUserStats,
};
```

**注意**: `createUser`, `verifyUser`, `saveLlmConfig`, `getLlmConfig`, `hasLlmConfig` は削除。GitHubトークンは `users.githubAccessToken` に直接格納する。

- [ ] **Step 2: Verify - 構文チェック**

Run:
```bash
node -c services/userService.js
```

Expected: エラーなし。

- [ ] **Step 3: コミット（まだアプリ全体は動かない状態、後続タスクで整える）**

```bash
git add services/userService.js
git commit -m "refactor: rewrite userService with cosmos db"
```

---

### Task 6: questionService.js を Cosmos DB 版に書き換え

**Files:**
- Modify: `services/questionService.js`

- [ ] **Step 1: ファイルIO版をCosmos DB版に書き換え**

```javascript
'use strict';

const cosmosService = require('./cosmosService');

async function readCertification(certId) {
  return cosmosService.read('certifications', certId, certId);
}

async function writeCertification(certData) {
  await cosmosService.upsert('certifications', certData);
}

async function listCertifications({ includePrivate = false, userId = null } = {}) {
  let query;
  if (includePrivate && userId) {
    query = {
      query: 'SELECT * FROM c WHERE c.isPublic = true OR c.createdBy = @userId',
      parameters: [{ name: '@userId', value: userId }],
    };
  } else {
    query = { query: 'SELECT * FROM c WHERE c.isPublic = true' };
  }
  const certs = await cosmosService.query('certifications', query);
  return certs.map((data) => ({
    id: data.id,
    name: data.name,
    domainCount: data.domains.length,
    questionCount: data.domains.reduce((acc, d) => acc + d.questions.length, 0),
    createdBy: data.createdBy,
    creatorName: data.creatorName,
  }));
}

async function getDomain(certId, domainId) {
  const cert = await readCertification(certId);
  if (!cert) return null;
  return cert.domains.find((d) => d.id === domainId) || null;
}

async function getAllQuestions(certId) {
  const cert = await readCertification(certId);
  if (!cert) return [];
  return cert.domains.flatMap((domain) =>
    domain.questions.map((q) => ({ ...q, domainId: domain.id, domainName: domain.name }))
  );
}

async function getQuestionsByDomain(certId, domainId) {
  const domain = await getDomain(certId, domainId);
  if (!domain) return [];
  return domain.questions.map((q) => ({ ...q, domainId: domain.id, domainName: domain.name }));
}

async function getQuestionsByIds(certId, questionIds) {
  const all = await getAllQuestions(certId);
  const idSet = new Set(questionIds);
  return all.filter((q) => idSet.has(q.id));
}

async function replaceDomainQuestions(certId, domainId, newQuestions) {
  const cert = await readCertification(certId);
  if (!cert) throw new Error(`Certification not found: ${certId}`);
  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Domain not found: ${domainId}`);
  domain.questions = newQuestions;
  domain.generatedAt = new Date().toISOString();
  await writeCertification(cert);
}

module.exports = {
  readCertification,
  writeCertification,
  listCertifications,
  getDomain,
  getAllQuestions,
  getQuestionsByDomain,
  getQuestionsByIds,
  replaceDomainQuestions,
};
```

- [ ] **Step 2: Verify**

```bash
node -c services/questionService.js
```

- [ ] **Step 3: コミット**

```bash
git add services/questionService.js
git commit -m "refactor: rewrite questionService with cosmos db"
```

---

### Task 7: progressService.js を Cosmos DB 版に書き換え

**Files:**
- Modify: `services/progressService.js`

- [ ] **Step 1: SQLite版をCosmos DB版に書き換え**

```javascript
'use strict';

const crypto = require('crypto');
const cosmosService = require('./cosmosService');

async function createSession({ userId, certificationId, domainFilter = null, mode = 'all' }) {
  const session = {
    id: crypto.randomUUID(),
    userId,
    certificationId,
    mode,
    domainFilter,
    startedAt: new Date().toISOString(),
    completedAt: null,
    answers: [],
    score: null,
  };
  await cosmosService.upsert('sessions', session);
  return session;
}

async function getSession(sessionId, userId) {
  if (!userId) {
    // userIdが分からない場合は全パーティション検索（非効率、回避推奨）
    const results = await cosmosService.query('sessions', {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: sessionId }],
    });
    return results[0] || null;
  }
  return cosmosService.read('sessions', sessionId, userId);
}

async function recordAnswer({ sessionId, userId, questionId, domainId, selectedAnswer, isCorrect }) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.answers.push({
    questionId,
    domainId,
    selectedAnswer,
    isCorrect,
    answeredAt: new Date().toISOString(),
  });
  await cosmosService.upsert('sessions', session);
}

async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.completedAt = new Date().toISOString();
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  session.score = total > 0 ? Math.round((correct / total) * 100) : 0;
  await cosmosService.upsert('sessions', session);
  return session;
}

async function calcDomainStats(certificationId, userId) {
  const sessions = await cosmosService.query('sessions', {
    query: 'SELECT * FROM c WHERE c.userId = @userId AND c.certificationId = @certId',
    parameters: [
      { name: '@userId', value: userId },
      { name: '@certId', value: certificationId },
    ],
  }, { partitionKey: userId });

  const stats = {};
  for (const sess of sessions) {
    for (const a of sess.answers) {
      const d = a.domainId;
      if (!stats[d]) stats[d] = { correct: 0, total: 0 };
      stats[d].total += 1;
      if (a.isCorrect) stats[d].correct += 1;
    }
  }
  for (const d of Object.keys(stats)) {
    const { correct, total } = stats[d];
    stats[d].rate = total > 0 ? Math.round((correct / total) * 100) : null;
  }
  return stats;
}

async function getWrongQuestionIds(certificationId, userId) {
  const sessions = await cosmosService.query('sessions', {
    query: 'SELECT * FROM c WHERE c.userId = @userId AND c.certificationId = @certId',
    parameters: [
      { name: '@userId', value: userId },
      { name: '@certId', value: certificationId },
    ],
  }, { partitionKey: userId });

  const wrongSet = new Set();
  const correctSet = new Set();
  for (const sess of sessions) {
    for (const a of sess.answers) {
      if (a.isCorrect) correctSet.add(a.questionId);
      else wrongSet.add(a.questionId);
    }
  }
  return [...wrongSet].filter((id) => !correctSet.has(id));
}

function calcSessionDomainScores(session) {
  const scores = {};
  for (const answer of session.answers) {
    const d = answer.domainId;
    if (!scores[d]) scores[d] = { correct: 0, total: 0 };
    scores[d].total += 1;
    if (answer.isCorrect) scores[d].correct += 1;
  }
  for (const d of Object.keys(scores)) {
    const { correct, total } = scores[d];
    scores[d].rate = total > 0 ? Math.round((correct / total) * 100) : null;
  }
  return scores;
}

module.exports = {
  createSession,
  recordAnswer,
  completeSession,
  getSession,
  calcDomainStats,
  getWrongQuestionIds,
  calcSessionDomainScores,
};
```

**重要な変更**: `getSession`, `recordAnswer`, `completeSession` に `userId` 引数が必須（Cosmos DBのpartition key）。ルート側で `req.user.id` を渡す必要がある。

- [ ] **Step 2: Verify**

```bash
node -c services/progressService.js
```

- [ ] **Step 3: コミット**

```bash
git add services/progressService.js
git commit -m "refactor: rewrite progressService with cosmos db"
```

---

### Task 8: jwtService.js を作成

**Files:**
- Create: `services/jwtService.js`

- [ ] **Step 1: JWT 発行・検証を実装**

```javascript
'use strict';

const jwt = require('jsonwebtoken');

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return secret;
}

function sign({ userId, email, username }) {
  return jwt.sign(
    { sub: userId, email, username },
    getSecret(),
    { expiresIn: SEVEN_DAYS_SEC }
  );
}

function verify(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SEVEN_DAYS_SEC * 1000,
  };
}

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'cert_quiz_session';

module.exports = { sign, verify, getCookieOptions, COOKIE_NAME, SEVEN_DAYS_SEC };
```

- [ ] **Step 2: `cookie-parser` をインストール**

Run:
```bash
npm install cookie-parser
```

- [ ] **Step 3: Verify**

```bash
node -c services/jwtService.js
```

- [ ] **Step 4: コミット**

```bash
git add services/jwtService.js package.json package-lock.json
git commit -m "feat: add jwt service"
```

---

### Task 9: middleware/auth.js を JWT ベースに書き換え

**Files:**
- Modify: `middleware/auth.js`

- [ ] **Step 1: JWT検証 + `req.user` 注入**

```javascript
'use strict';

const jwtService = require('../services/jwtService');

function authContext(req, res, next) {
  const token = req.cookies?.[jwtService.COOKIE_NAME];
  if (token) {
    const payload = jwtService.verify(token);
    if (payload) {
      req.user = { id: payload.sub, email: payload.email, username: payload.username };
      res.locals.userEmail = payload.email || payload.username;
    }
  }
  if (!res.locals.userEmail) res.locals.userEmail = null;
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  res.redirect('/auth/login');
}

module.exports = { authContext, requireAuth };
```

- [ ] **Step 2: Verify**

```bash
node -c middleware/auth.js
```

- [ ] **Step 3: コミット**

```bash
git add middleware/auth.js
git commit -m "refactor: switch auth middleware to jwt"
```

---

### Task 10: app.js を JWT ベースに更新

**Files:**
- Modify: `app.js`

- [ ] **Step 1: express-session と SQLiteStore を削除し、cookie-parser と authContext を設定**

```javascript
'use strict';

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// 起動時に必須環境変数をチェック
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET が未設定または短すぎます（32文字以上必要）');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  console.error('❌ ENCRYPTION_KEY 環境変数が未設定または不正です（64文字の hex 文字列が必要）');
  process.exit(1);
}
if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
  console.error('❌ GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 環境変数が設定されていません');
  process.exit(1);
}
if (!process.env.COSMOS_ENDPOINT || !process.env.COSMOS_KEY) {
  console.error('❌ COSMOS_ENDPOINT / COSMOS_KEY 環境変数が設定されていません');
  process.exit(1);
}

const indexRouter = require('./routes/index');
const quizRouter = require('./routes/quiz');
const domainsRouter = require('./routes/domains');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const { authContext } = require('./middleware/auth');
const cosmosService = require('./services/cosmosService');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(authContext);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', authRouter);
app.use('/', indexRouter);
app.use('/quiz', quizRouter);
app.use('/certifications', domainsRouter);
app.use('/api', apiRouter);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404 Not Found', message: 'ページが見つかりません' });
});

// エラー
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { title: 'エラー', message: err.message });
});

(async () => {
  try {
    await cosmosService.init();
    console.log('✅ Cosmos DB initialized');
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Cosmos DB init failed:', err);
    process.exit(1);
  }
})();

module.exports = app;
```

- [ ] **Step 2: Verify**

```bash
node -c app.js
```

- [ ] **Step 3: コミット**

```bash
git add app.js
git commit -m "refactor: switch app to jwt-based auth"
```

---

### Task 11: routes/auth.js を JWT 発行型に書き換え

**Files:**
- Modify: `routes/auth.js`
- Delete: `views/register.ejs`

- [ ] **Step 1: email/password ログイン廃止、JWT cookie発行に切替**

```javascript
'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const userService = require('../services/userService');
const jwtService = require('../services/jwtService');

router.get('/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.render('error', { title: 'GitHub OAuth 未設定', message: 'GITHUB_CLIENT_ID が設定されていません' });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'read:user user:email',
    state: crypto.randomUUID(),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login');

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('GitHub からアクセストークンを取得できませんでした');

    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'cert-study-agent' },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'cert-study-agent' },
      }),
    ]);
    const githubUser = await userRes.json();
    const emails = await emailsRes.json();
    const primaryEmail = Array.isArray(emails)
      ? (emails.find((e) => e.primary && e.verified)?.email || emails[0]?.email)
      : null;

    const user = await userService.upsertGithubUser({
      githubId: githubUser.id,
      githubLogin: githubUser.login,
      email: primaryEmail,
      displayName: githubUser.name,
      avatarUrl: githubUser.avatar_url,
      accessToken,
    });

    const token = jwtService.sign({
      userId: user.id,
      email: user.email,
      username: user.username,
    });
    res.cookie(jwtService.COOKIE_NAME, token, jwtService.getCookieOptions());
    res.redirect('/');
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.render('error', { title: 'GitHub ログインエラー', message: err.message });
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'ログイン', error: null });
});

router.post('/logout', (req, res) => {
  res.clearCookie(jwtService.COOKIE_NAME, jwtService.getCookieOptions());
  res.redirect('/auth/login');
});

module.exports = router;
```

削除: `POST /login`, `GET /register`（GitHub OAuthに一本化）。

- [ ] **Step 2: `views/register.ejs` を削除**

```bash
rm views/register.ejs
```

- [ ] **Step 3: `views/login.ejs` を GitHub OAuth のみに簡略化（必要なら）**

login.ejs が email/password フォームを含んでいる場合、GitHub OAuth ボタンのみにする。実装:
```html
<!-- views/login.ejs のフォーム部分を以下に置換 -->
<a href="/auth/github" class="inline-block bg-gray-900 text-white px-6 py-3 rounded">
  GitHubでログイン
</a>
```

- [ ] **Step 4: Verify**

```bash
node -c routes/auth.js
```

- [ ] **Step 5: コミット**

```bash
git add routes/auth.js views/login.ejs
git rm views/register.ejs
git commit -m "refactor: issue jwt cookie on github oauth callback"
```

---

### Task 12: routes/index.js を async + req.user 対応に

**Files:**
- Modify: `routes/index.js`

- [ ] **Step 1: async化して `req.user.id` を使う**

既存ファイルを読み、`req.session.userId` → `req.user.id`, `req.session.userEmail` → `req.user.email || req.user.username` に置換し、サービス呼び出しに `await` を追加。全ハンドラに `async` を付与。

例:
```javascript
'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  res.render('index', { title: '資格取得学習エージェント', certs, userEmail: res.locals.userEmail });
});

router.get('/certifications/:certId', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });
  const domainStats = await progressService.calcDomainStats(cert.id, req.user.id);
  const wrongIds = await progressService.getWrongQuestionIds(cert.id, req.user.id);
  res.render('certification', {
    title: cert.name,
    cert,
    domainStats,
    wrongCount: wrongIds.length,
    info: req.query.info || null,
    userEmail: res.locals.userEmail,
  });
});

module.exports = router;
```

- [ ] **Step 2: Verify - 起動して/にアクセス**

```bash
npm run dev
```
ブラウザで `http://localhost:3000/auth/github` → GitHub OAuthでログイン → `/` にリダイレクトされ、資格一覧が表示される。

- [ ] **Step 3: コミット**

```bash
git add routes/index.js
git commit -m "refactor: async routes for index with req.user"
```

---

### Task 13: routes/quiz.js を async + req.user 対応に

**Files:**
- Modify: `routes/quiz.js`

- [ ] **Step 1: `req.session.userId` → `req.user.id`、サービス呼び出しに await、全ハンドラにasync**

全体を async 化。`progressService.getSession(sessionId)` は `progressService.getSession(sessionId, req.user.id)` に変更（partition key 指定）。以下が全体:

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

router.post('/start', requireAuth, async (req, res) => {
  const { certId, mode, domainId } = req.body;
  const userId = req.user.id;
  const cert = await questionService.readCertification(certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });

  let questions;
  let domainFilter = null;

  if (mode === 'wrong-only') {
    const wrongIds = await progressService.getWrongQuestionIds(certId, userId);
    if (wrongIds.length === 0) return res.redirect(`/certifications/${certId}?info=no-wrong`);
    questions = await questionService.getQuestionsByIds(certId, wrongIds);
  } else if (mode === 'domain' && domainId) {
    questions = await questionService.getQuestionsByDomain(certId, domainId);
    domainFilter = domainId;
  } else {
    questions = await questionService.getAllQuestions(certId);
  }

  if (questions.length === 0) return res.redirect(`/certifications/${certId}?info=no-questions`);

  questions.sort(() => Math.random() - 0.5);
  const session = await progressService.createSession({ userId, certificationId: certId, domainFilter, mode });
  const questionIds = questions.map((q) => q.id).join(',');
  res.redirect(`/quiz/${session.id}?questions=${encodeURIComponent(questionIds)}&certId=${certId}&idx=0`);
});

router.get('/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { questions: questionIdsStr, certId, idx } = req.query;
  if (!questionIdsStr || !certId) return res.redirect('/');

  const session = await progressService.getSession(sessionId, req.user.id);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const questionIds = questionIdsStr.split(',');
  const currentIdx = parseInt(idx, 10) || 0;
  if (currentIdx >= questionIds.length) {
    await progressService.completeSession(sessionId, req.user.id);
    return res.redirect(`/quiz/${sessionId}/result?certId=${certId}`);
  }

  const allQuestions = await questionService.getAllQuestions(certId);
  const question = allQuestions.find((q) => q.id === questionIds[currentIdx]);
  if (!question) return res.redirect(`/quiz/${sessionId}/result?certId=${certId}`);

  res.render('quiz', {
    title: `問題 ${currentIdx + 1} / ${questionIds.length}`,
    session, question, currentIdx,
    total: questionIds.length,
    questionIds: questionIdsStr, certId, answered: null,
  });
});

router.post('/:sessionId/answer', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { questionId, domainId, selectedAnswer, isCorrect, questionIds, certId, currentIdx } = req.body;
  await progressService.recordAnswer({
    sessionId, userId: req.user.id, questionId, domainId, selectedAnswer,
    isCorrect: isCorrect === 'true',
  });
  const nextIdx = parseInt(currentIdx, 10) + 1;
  res.redirect(
    `/quiz/${sessionId}?questions=${encodeURIComponent(questionIds)}&certId=${certId}&idx=${nextIdx}&lastAnswer=${selectedAnswer}&lastCorrect=${isCorrect}&lastQuestionId=${questionId}`
  );
});

router.get('/:sessionId/result', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { certId } = req.query;
  const session = await progressService.getSession(sessionId, req.user.id);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const cert = await questionService.readCertification(certId);
  const domainScores = progressService.calcSessionDomainScores(session);
  const total = session.answers.length;
  const correct = session.answers.filter((a) => a.isCorrect).length;
  const overallRate = total > 0 ? Math.round((correct / total) * 100) : 0;

  const domainsWithScores = cert
    ? cert.domains.filter((d) => domainScores[d.id]).map((d) => ({ ...d, score: domainScores[d.id] }))
    : [];
  const weakDomains = domainsWithScores.filter((d) => d.score.rate !== null && d.score.rate < 70);

  res.render('result', {
    title: 'セッション結果', session, cert, overallRate, correct, total,
    domainsWithScores, weakDomains, certId,
  });
});

router.get('/:sessionId/review', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { certId } = req.query;
  const session = await progressService.getSession(sessionId, req.user.id);
  if (!session) return res.status(404).render('error', { title: '404', message: 'セッションが見つかりません' });

  const wrongAnswers = session.answers.filter((a) => !a.isCorrect);
  const allQuestions = await questionService.getAllQuestions(certId);
  const wrongQuestions = wrongAnswers.map((a) => {
    const q = allQuestions.find((q) => q.id === a.questionId);
    return q ? { ...q, selectedAnswer: a.selectedAnswer } : null;
  }).filter(Boolean);

  res.render('review', { title: '間違い復習', session, wrongQuestions, certId });
});

module.exports = router;
```

- [ ] **Step 2: Verify - クイズ開始→回答→結果画面までのE2E**

ブラウザでクイズを1問でも回答して結果画面が出ることを確認。

- [ ] **Step 3: コミット**

```bash
git add routes/quiz.js
git commit -m "refactor: async routes for quiz with req.user"
```

---

### Task 14: routes/domains.js と routes/api.js を async + req.user 対応に

**Files:**
- Modify: `routes/domains.js`
- Modify: `routes/api.js`

- [ ] **Step 1: domains.js の変更**

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const progressService = require('../services/progressService');
const { requireAuth } = require('../middleware/auth');

router.get('/:certId/domains/:domainId', requireAuth, async (req, res) => {
  const { certId, domainId } = req.params;
  const cert = await questionService.readCertification(certId);
  if (!cert) return res.status(404).render('error', { title: '404', message: '資格が見つかりません' });
  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) return res.status(404).render('error', { title: '404', message: 'ドメインが見つかりません' });
  const domainStats = await progressService.calcDomainStats(certId, req.user.id);

  res.render('domain', {
    title: domain.name, cert, domain,
    stats: domainStats[domainId] || { correct: 0, total: 0, rate: null },
  });
});

module.exports = router;
```

- [ ] **Step 2: api.js の変更**

既存の `POST /api/certifications/:certId/domains/:domainId/generate` SSEエンドポイントで以下を変更:
- `userService.getLlmConfig(req.session.userId)` → GitHub Models エンドポイント + `userService.getGithubAccessToken(req.user.id)` に置換
- ハンドラを async 化（既に async の場合はそのまま）
- `questionService` 呼び出しを await

例（概略、既存コードを基にした変更箇所）:
```javascript
const accessToken = await userService.getGithubAccessToken(req.user.id);
if (!accessToken) {
  res.write(`event: error\ndata: ${JSON.stringify({ message: 'GitHubトークンが見つかりません。再ログインしてください。' })}\n\n`);
  return res.end();
}
const llmConfig = {
  endpointUrl: 'https://models.inference.ai.azure.com',
  apiKey: accessToken,
  modelName: 'gpt-4o-mini',
};
const cert = await questionService.readCertification(certId);
// 以降の generationService 呼び出しはそのまま
```

- [ ] **Step 3: Verify - ドメイン画面表示 + AI問題生成**

ドメイン画面を開き、「問題を再生成」を押してSSEで進捗が流れ、Cosmos DB上の certifications に新しい問題が保存されることを確認。

- [ ] **Step 4: コミット**

```bash
git add routes/domains.js routes/api.js
git commit -m "refactor: async routes for domains and api with req.user"
```

---

### Task 15: 不要コード削除・最終確認

**Files:**
- Delete: `services/dbService.js`
- Delete: `data/app.db`, `data/sessions.db`（および -shm, -wal）

- [ ] **Step 1: dbService.js を削除**

```bash
git rm services/dbService.js
```

どのファイルからも `require('./dbService')` や `require('../services/dbService')` が残っていないことを確認:
```bash
grep -r "dbService" --include="*.js" .
```
Expected: matches なし。

- [ ] **Step 2: 古いSQLiteデータベースファイルを削除**

```bash
rm -f data/app.db data/app.db-shm data/app.db-wal data/sessions.db data/sessions.db-shm data/sessions.db-wal
```

- [ ] **Step 3: E2Eスモークテスト**

以下を1回ずつ実行:
1. `docker compose up -d cosmos-emulator` → Emulator起動
2. `npm run seed` → 資格データ投入
3. `npm run dev` → アプリ起動
4. `http://localhost:3000` → `/auth/login` にリダイレクトされる
5. 「GitHubでログイン」をクリック → OAuth完了後 `/` に戻り資格一覧が出る
6. 資格を選択 → ドメイン統計が表示される（初回は0%）
7. 「クイズ開始」→ 1-2問回答 → 結果画面で正答率が表示される
8. 「間違い復習」→ 間違えた問題が表示される（全問正解なら空）
9. ドメイン画面 →「問題を再生成」→ SSE進捗表示 → 完了後に問題が更新される

全て動作すれば完了。

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "chore: remove sqlite dependencies and old db files"
```

---

## 完了条件

- [ ] Cosmos DB Emulator でアプリが完全に動作する
- [ ] SQLite関連のコードとファイルが全て削除されている
- [ ] express-session → JWT の切替が完了している
- [ ] 既存機能（ログイン、資格一覧、クイズ、結果、復習、AI問題生成）が全て動作する

## 未解決事項

なし。すべての実装詳細は本プランで確定済み。
