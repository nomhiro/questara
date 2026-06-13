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
    stats: existing?.stats
      ? {
          totalSessions: existing.stats.totalSessions || 0,
          totalCorrect: existing.stats.totalCorrect || 0,
          totalAnswered: existing.stats.totalAnswered || 0,
          weeklyCorrectRate: existing.stats.weeklyCorrectRate ?? null,
          monthlyCorrectRate: existing.stats.monthlyCorrectRate ?? null,
          certStats: existing.stats.certStats || {},
          xp: existing.stats.xp || 0,
          level: existing.stats.level || 1,
          streak: existing.stats.streak || { current: 0, longest: 0, lastStudyDate: null, freeze: false },
          masteryRanks: existing.stats.masteryRanks || {},
          unlockedAchievements: existing.stats.unlockedAchievements || [],
          equippedTitle: existing.stats.equippedTitle ?? null,
          dailyQuest: existing.stats.dailyQuest || { date: null, completed: [], xpClaimed: 0 },
        }
      : {
          totalSessions: 0,
          totalCorrect: 0,
          totalAnswered: 0,
          weeklyCorrectRate: null,
          monthlyCorrectRate: null,
          certStats: {},
          xp: 0,
          level: 1,
          streak: { current: 0, longest: 0, lastStudyDate: null, freeze: false },
          masteryRanks: {},
          unlockedAchievements: [],
          equippedTitle: null,
          dailyQuest: { date: null, completed: [], xpClaimed: 0 },
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
