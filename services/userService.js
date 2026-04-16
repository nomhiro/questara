'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDb } = require('./dbService');

const SALT_ROUNDS = 12;
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function encryptApiKey(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptApiKey(ciphertext) {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── User CRUD ───────────────────────────────────────────

function createUser(email, password) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw new Error('このメールアドレスは既に登録されています');

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, passwordHash);
  return { id, email };
}

/**
 * GitHub OAuth でのユーザー作成または更新
 * 既存ユーザーなら github_id/login を更新して返す
 */
function upsertGithubUser({ githubId, githubLogin, email }) {
  const db = getDb();

  // 既存の GitHub ユーザー
  const existing = db.prepare('SELECT id, email, github_login FROM users WHERE github_id = ?').get(String(githubId));
  if (existing) {
    db.prepare('UPDATE users SET github_login = ? WHERE id = ?').run(githubLogin, existing.id);
    return { id: existing.id, email: existing.email || email, githubLogin };
  }

  // メールが既存ユーザーと一致する場合は紐付け
  if (email) {
    const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (byEmail) {
      db.prepare('UPDATE users SET github_id = ?, github_login = ? WHERE id = ?').run(String(githubId), githubLogin, byEmail.id);
      return { id: byEmail.id, email, githubLogin };
    }
  }

  // 新規作成
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, github_id, github_login) VALUES (?, ?, ?, ?)').run(
    id, email || null, String(githubId), githubLogin
  );
  return { id, email: email || null, githubLogin };
}

function verifyUser(email, password) {
  const db = getDb();
  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
  if (!user) return null;
  const valid = bcrypt.compareSync(password, user.password_hash);
  return valid ? { id: user.id, email: user.email } : null;
}

function getUserById(userId) {
  const db = getDb();
  return db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(userId) || null;
}

// ─── LLM Config ──────────────────────────────────────────

function saveLlmConfig(userId, { endpointUrl, apiKey, modelName }) {
  const db = getDb();
  const apiKeyEncrypted = encryptApiKey(apiKey);
  db.prepare(`
    INSERT INTO llm_configs (user_id, endpoint_url, api_key_encrypted, model_name, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      endpoint_url = excluded.endpoint_url,
      api_key_encrypted = excluded.api_key_encrypted,
      model_name = excluded.model_name,
      updated_at = excluded.updated_at
  `).run(userId, endpointUrl, apiKeyEncrypted, modelName);
}

function getLlmConfig(userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM llm_configs WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    endpointUrl: row.endpoint_url,
    apiKey: decryptApiKey(row.api_key_encrypted),
    modelName: row.model_name,
  };
}

function hasLlmConfig(userId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM llm_configs WHERE user_id = ?').get(userId);
}

module.exports = {
  createUser,
  upsertGithubUser,
  verifyUser,
  getUserById,
  saveLlmConfig,
  getLlmConfig,
  hasLlmConfig,
};
