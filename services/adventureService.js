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
  const dungeons = adventure.dungeons.map((d) => {
    if (d.status === 'in-progress' && isDungeonBClearable(d, ranks, domainCounts)) {
      return { ...d, status: 'cleared', clearedAt: new Date().toISOString() };
    }
    return d;
  });
  return { ...adventure, dungeons };
}

async function listAdventures(userId) {
  const items = await cosmosService.query('adventures', {
    query: 'SELECT * FROM c WHERE c.userId = @u',
    parameters: [{ name: '@u', value: userId }],
  }, { partitionKey: userId });
  return items.map(normalizeAdventure);
}

async function getAdventure(id, userId) {
  const adv = await cosmosService.read('adventures', id, userId);
  return normalizeAdventure(adv);
}

// adventures コンテナへの書き込みはこの関数に集約する（progressService からの
// 直接 upsert も含め、書き込み経路を adventureService に一本化する・D-10）。
async function saveAdventure(adventure) {
  await cosmosService.upsert('adventures', adventure);
  return adventure;
}

async function createAdventure(payload) {
  const adv = {
    id: `adv-${crypto.randomUUID()}`,
    ...payload,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  return saveAdventure(adv);
}

async function setActive(userId, adventureId) {
  const all = await listAdventures(userId);
  for (const a of all) {
    const shouldBeActive = a.id === adventureId;
    // isActive が変わるものだけ書き込む（全件 upsert は無駄・D-16）
    if (a.isActive !== shouldBeActive) {
      await saveAdventure({ ...a, isActive: shouldBeActive });
    }
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
  saveAdventure,
  setActive,
  deleteAdventure,
  getActiveAdventure,
};
