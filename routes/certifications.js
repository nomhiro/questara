'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const certificationParser = require('../services/certificationParser');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = await userService.getUserById(userId);
  let stats = user?.stats || {};

  if (!stats.favoritesInitialized) {
    const all = await questionService.listCertifications({ includePrivate: true, userId });
    const ownIds = all.filter((c) => c.createdBy === userId).map((c) => c.id);
    const updated = await userService.initializeFavorites(userId, ownIds);
    stats = updated?.stats || stats;
  }

  const favorites = await questionService.listCertificationsByIds(stats.favoriteCertifications || [], userId);
  const passedIds = new Set((stats.passedCertifications || []).map((p) => p.certId));

  res.render('my-certifications', {
    title: 'マイ資格',
    favorites,
    passedIds,
    currentUserId: userId,
    userEmail: res.locals.userEmail,
  });
}));

router.get('/new', requireAuth, (req, res) => {
  res.render('certification-form', {
    title: '資格を追加',
    mode: 'new',
    cert: { id: '', name: '', studyGuideUrl: '', courseUrl: '', domains: [] },
    error: null,
    userEmail: res.locals.userEmail,
  });
});

router.post('/extract', requireAuth, asyncHandler(async (req, res) => {
  try {
    const { studyGuideUrl } = req.body;
    const accessToken = await userService.getGithubAccessToken(req.user.id);
    const domains = await certificationParser.extractDomains(studyGuideUrl, { accessToken });
    res.json({ domains });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

router.post('/new', requireAuth, asyncHandler(async (req, res) => {
  const { id, name, studyGuideUrl, courseUrl, domainsJson } = req.body;
  if (!id || !name) {
    return res.status(400).render('certification-form', {
      title: '資格を追加', mode: 'new',
      cert: { id, name, studyGuideUrl, courseUrl, domains: [] },
      error: 'ID と名前は必須です', userEmail: res.locals.userEmail,
    });
  }
  const existing = await questionService.readCertification(id);
  if (existing) {
    return res.status(400).render('certification-form', {
      title: '資格を追加', mode: 'new',
      cert: { id, name, studyGuideUrl, courseUrl, domains: [] },
      error: `資格ID "${id}" は既に使用されています`, userEmail: res.locals.userEmail,
    });
  }
  let domains = [];
  try { domains = JSON.parse(domainsJson || '[]'); } catch { domains = []; }
  const cert = questionService.buildCertification({
    id, name, studyGuideUrl, courseUrl,
    createdBy: req.user.id,
    creatorName: req.user.username,
    domains,
  });
  await questionService.writeCertification(cert);
  await userService.addFavorite(req.user.id, cert.id);
  res.redirect('/my/certifications');
}));

router.post('/:certId/publish', requireAuth, asyncHandler(async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ公開できます');
  cert.isPublic = true;
  cert.publishedAt = new Date().toISOString();
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
}));

router.post('/:certId/unpublish', requireAuth, asyncHandler(async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ操作できます');
  cert.isPublic = false;
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
}));

router.post('/:certId/delete', requireAuth, asyncHandler(async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ削除できます');
  await questionService.deleteCertification(cert.id);
  await userService.removeFavorite(req.user.id, cert.id);
  await userService.unmarkPassed(req.user.id, cert.id);
  res.redirect('/my/certifications');
}));

function safeReturnTo(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return '/my/certifications';
}

router.post('/:certId/favorite', requireAuth, asyncHandler(async (req, res) => {
  await userService.addFavorite(req.user.id, req.params.certId);
  res.redirect(safeReturnTo(req.body.returnTo));
}));

router.post('/:certId/unfavorite', requireAuth, asyncHandler(async (req, res) => {
  await userService.removeFavorite(req.user.id, req.params.certId);
  res.redirect(safeReturnTo(req.body.returnTo));
}));

router.post('/:certId/pass', requireAuth, asyncHandler(async (req, res) => {
  await userService.markPassed(req.user.id, req.params.certId, new Date().toISOString());
  res.redirect(safeReturnTo(req.body.returnTo));
}));

router.post('/:certId/unpass', requireAuth, asyncHandler(async (req, res) => {
  await userService.unmarkPassed(req.user.id, req.params.certId);
  res.redirect(safeReturnTo(req.body.returnTo));
}));

module.exports = router;
