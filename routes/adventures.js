'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const adventureService = require('../services/adventureService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');

const PRESETS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'adventure-presets.json'), 'utf8'));
const CERT_POSITIONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'certification-positions.json'), 'utf8'));

router.get('/', requireAuth, async (req, res) => {
  const list = await adventureService.listAdventures(req.user.id);
  if (list.length === 0) return res.redirect('/adventures/new');
  // pick active or first
  const active = list.find((a) => a.isActive) || list[0];
  res.redirect(`/adventures/${active.id}`);
});

router.get('/new', requireAuth, async (req, res) => {
  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const certIds = new Set(certs.map((c) => c.id));
  const presets = PRESETS.map((p) => ({
    ...p,
    dungeons: p.dungeons.map((d) => ({ ...d, available: certIds.has(d.certId) })),
    availableCount: p.dungeons.filter((d) => certIds.has(d.certId)).length,
  }));

  // 全プリセットで登場する資格を集計してノード一覧を作る
  const nodeMap = new Map();
  for (const p of presets) {
    for (const d of p.dungeons) {
      if (!nodeMap.has(d.certId)) {
        nodeMap.set(d.certId, {
          certId: d.certId,
          name: d.name,
          url: d.url,
          note: d.note,
          available: d.available,
          position: CERT_POSITIONS[d.certId] || null,
          presets: [],
        });
      }
      nodeMap.get(d.certId).presets.push(p.id);
    }
  }
  const nodes = [...nodeMap.values()].filter((n) => n.position);

  // ルートごとの折れ線座標（viewBox 座標）
  const routes = presets.map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    color: p.id === 'developer' ? '#ffc425' : p.id === 'infra' ? '#6fb6ff' : p.id === 'ai-engineer' ? '#ce93d8' : '#ffffff',
    points: p.dungeons
      .map((d) => CERT_POSITIONS[d.certId])
      .filter(Boolean),
  }));

  res.render('adventure-new', {
    title: '冒険を始める',
    presets,
    certs,
    nodes,
    routes,
  });
});

router.post('/preset', requireAuth, async (req, res) => {
  // presetIds は配列または単一、または旧 presetId を受け入れる
  let presetIds = req.body.presetIds || req.body.presetId || [];
  if (!Array.isArray(presetIds)) presetIds = [presetIds];
  presetIds = presetIds.filter(Boolean);

  const chosen = presetIds
    .map((id) => PRESETS.find((p) => p.id === id))
    .filter(Boolean);

  if (chosen.length === 0) {
    return res.status(400).render('error', { title: 'Bad Request', message: '少なくとも 1 つの道を選んでください' });
  }

  // 複数プリセットの dungeons を順序保持でマージ（重複は最初の出現位置のみ残す）
  const seen = new Set();
  const mergedDungeons = [];
  for (const p of chosen) {
    for (const d of p.dungeons) {
      if (!seen.has(d.certId)) {
        seen.add(d.certId);
        mergedDungeons.push(d);
      }
    }
  }

  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const certIds = new Set(certs.map((c) => c.id));
  const availableDungeons = mergedDungeons.filter((d) => certIds.has(d.certId));
  if (availableDungeons.length === 0) {
    return res.status(400).render('error', {
      title: 'Bad Request',
      message: '選択した道に含まれる資格がまだシステムに登録されていません。「マイ資格」から先に追加してください。',
    });
  }

  const name = chosen.length === 1
    ? chosen[0].name
    : `${chosen.map((p) => p.name).join(' × ')}`;
  const description = chosen.length === 1
    ? chosen[0].description
    : chosen.map((p) => `【${p.name}】${p.description}`).join(' ／ ');
  const citations = mergedDungeons
    .map((d) => ({ url: d.url, title: d.name }))
    .filter((c) => c.url);
  const rationale = chosen.length === 1
    ? `Microsoft Learn 公式の「${chosen[0].name}」ラーニングパスに沿って構成（${chosen[0].officialUrl || ''}）。`
    : `Microsoft Learn 公式の ${chosen.length} 本のラーニングパスを合流させた冒険：${chosen.map((p) => p.name).join('、')}。`;

  const adv = await adventureService.createAdventure({
    userId: req.user.id,
    name,
    description,
    source: 'preset',
    presetId: chosen.map((p) => p.id).join(','),
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
  });
  await adventureService.setActive(req.user.id, adv.id);
  res.redirect(`/adventures/${adv.id}`);
});

router.get('/:id', requireAuth, async (req, res) => {
  const adv = await adventureService.getAdventure(req.params.id, req.user.id);
  if (!adv) return res.status(404).render('error', { title: '404', message: '冒険が見つかりません' });

  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const certById = Object.fromEntries(certs.map((c) => [c.id, c]));
  const recommendedIndex = adv.dungeons.findIndex((d) => d.status === 'in-progress');
  res.render('adventure-detail', {
    title: adv.name,
    adventure: adv,
    certById,
    recommendedIndex,
  });
});

router.post('/:id/activate', requireAuth, async (req, res) => {
  await adventureService.setActive(req.user.id, req.params.id);
  res.redirect(`/adventures/${req.params.id}`);
});

router.post('/:id/delete', requireAuth, async (req, res) => {
  await adventureService.deleteAdventure(req.params.id, req.user.id);
  res.redirect('/adventures/new');
});

module.exports = router;
