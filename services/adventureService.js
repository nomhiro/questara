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

/**
 * 選択されたプリセット群から冒険の payload を組み立てる（D-09）。
 * 複数プリセットの dungeons を順序保持でマージ（重複 certId は最初の出現のみ）し、
 * システムに登録済み(knownCertIds)の資格だけで構成する。利用可能資格が 0 件なら null。
 * userId は呼び出し側で付与する。
 * @param {Array} chosenPresets - adventure-presets.json のプリセットオブジェクト配列
 * @param {Set<string>} knownCertIds - システムに登録済みの certId 集合
 * @returns {object|null}
 */
function buildAdventureFromPresets(chosenPresets, knownCertIds) {
  const seen = new Set();
  const mergedDungeons = [];
  for (const p of chosenPresets) {
    for (const d of p.dungeons) {
      if (!seen.has(d.certId)) {
        seen.add(d.certId);
        mergedDungeons.push(d);
      }
    }
  }

  const availableDungeons = mergedDungeons.filter((d) => knownCertIds.has(d.certId));
  if (availableDungeons.length === 0) return null;

  const name = chosenPresets.length === 1
    ? chosenPresets[0].name
    : chosenPresets.map((p) => p.name).join(' × ');
  const description = chosenPresets.length === 1
    ? chosenPresets[0].description
    : chosenPresets.map((p) => `【${p.name}】${p.description}`).join(' ／ ');
  const citations = mergedDungeons
    .map((d) => ({ url: d.url, title: d.name }))
    .filter((c) => c.url);
  const rationale = chosenPresets.length === 1
    ? `Microsoft Learn 公式の「${chosenPresets[0].name}」ラーニングパスに沿って構成（${chosenPresets[0].officialUrl || ''}）。`
    : `Microsoft Learn 公式の ${chosenPresets.length} 本のラーニングパスを合流させた冒険：${chosenPresets.map((p) => p.name).join('、')}。`;

  return {
    name,
    description,
    source: 'preset',
    presetId: chosenPresets.map((p) => p.id).join(','),
    userPrompt: null,
    dungeons: availableDungeons.map((d, i) => ({
      certificationId: d.certId,
      order: i + 1,
      status: 'in-progress',
      unlockedAt: new Date().toISOString(),
      clearedAt: null,
    })),
    rationale,
    citations,
    verificationStatus: 'verified',
    isActive: true,
  };
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
  buildAdventureFromPresets,
  listAdventures,
  getAdventure,
  createAdventure,
  saveAdventure,
  setActive,
  deleteAdventure,
  getActiveAdventure,
};
