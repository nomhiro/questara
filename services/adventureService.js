'use strict';

const crypto = require('crypto');
const cosmosService = require('./cosmosService');
const { compareRanks } = require('./gamificationService');

function isDungeonBClearable(dungeonEntry, ranks, domainCounts) {
  const certId = dungeonEntry.certificationId;
  const need = domainCounts[certId];
  if (!need) return false;
  let ok = 0;
  for (const [k, r] of Object.entries(ranks)) {
    if (k.startsWith(certId + ':') && compareRanks(r.rank, 'B') >= 0) ok += 1;
  }
  return ok >= need;
}

function normalizeAdventure(adv) {
  if (!adv) return adv;
  if (!Array.isArray(adv.dungeons)) return adv;
  const dungeons = adv.dungeons.map((d) => {
    const status = d.status === 'locked' ? 'in-progress' : d.status;
    const unlockedAt = d.unlockedAt
      || (status === 'cleared' ? d.clearedAt : new Date(0).toISOString());
    return { ...d, status, unlockedAt };
  });
  return { ...adv, dungeons };
}

function checkDungeonUnlocks(adventure, ranks, domainCounts) {
  const dungeons = adventure.dungeons.map((d) => ({ ...d }));
  for (let i = 0; i < dungeons.length; i += 1) {
    const d = dungeons[i];
    if (d.status === 'in-progress' && isDungeonBClearable(d, ranks, domainCounts)) {
      d.status = 'cleared';
      d.clearedAt = new Date().toISOString();
      const next = dungeons[i + 1];
      if (next && next.status === 'locked') {
        next.status = 'in-progress';
        next.unlockedAt = new Date().toISOString();
      }
    }
  }
  return { ...adventure, dungeons };
}

async function listAdventures(userId) {
  return cosmosService.query('adventures', {
    query: 'SELECT * FROM c WHERE c.userId = @u',
    parameters: [{ name: '@u', value: userId }],
  }, { partitionKey: userId });
}

async function getAdventure(id, userId) {
  return cosmosService.read('adventures', id, userId);
}

async function createAdventure(payload) {
  const adv = {
    id: `adv-${crypto.randomUUID()}`,
    ...payload,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  await cosmosService.upsert('adventures', adv);
  return adv;
}

async function setActive(userId, adventureId) {
  const all = await listAdventures(userId);
  for (const a of all) {
    const next = { ...a, isActive: a.id === adventureId };
    await cosmosService.upsert('adventures', next);
  }
  const userService = require('./userService');
  await userService.updateUserStats(userId, (s) => {
    s.activeAdventureId = adventureId;
    return s;
  });
}

async function deleteAdventure(id, userId) {
  await cosmosService.remove('adventures', id, userId);
  const userService = require('./userService');
  const user = await userService.getUserById(userId);
  if (user?.stats?.activeAdventureId === id) {
    await userService.updateUserStats(userId, (s) => {
      s.activeAdventureId = null;
      return s;
    });
  }
}

async function getActiveAdventure(userId) {
  const userService = require('./userService');
  const user = await userService.getUserById(userId);
  const id = user?.stats?.activeAdventureId;
  if (!id) return null;
  return getAdventure(id, userId);
}

module.exports = {
  normalizeAdventure,
  checkDungeonUnlocks,
  isDungeonBClearable,
  listAdventures,
  getAdventure,
  createAdventure,
  setActive,
  deleteAdventure,
  getActiveAdventure,
};
