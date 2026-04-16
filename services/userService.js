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
  verifyUser,
  getUserById,
  saveLlmConfig,
  getLlmConfig,
  hasLlmConfig,
};
