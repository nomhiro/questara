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

  const certs = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const certIds = new Set(certs.map((c) => c.id));
  const payload = adventureService.buildAdventureFromPresets(chosen, certIds);
  if (!payload) {
    return res.status(400).render('error', {
      title: 'Bad Request',
      message: '選択した道に含まれる資格がまだシステムに登録されていません。「マイ資格」から先に追加してください。',
    });
  }

  const adv = await adventureService.createAdventure({ userId: req.user.id, ...payload });
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
