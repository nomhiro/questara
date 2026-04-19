'use strict';

const express = require('express');
const router = express.Router();
const questionService = require('../services/questionService');
const certificationParser = require('../services/certificationParser');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const all = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const myCerts = all.filter((c) => c.createdBy === req.user.id);
  res.render('my-certifications', {
    title: 'マイ資格',
    certs: myCerts,
    userEmail: res.locals.userEmail,
  });
});

router.get('/new', requireAuth, (req, res) => {
  res.render('certification-form', {
    title: '資格を追加',
    mode: 'new',
    cert: { id: '', name: '', studyGuideUrl: '', courseUrl: '', domains: [] },
    error: null,
    userEmail: res.locals.userEmail,
  });
});

router.post('/extract', requireAuth, async (req, res) => {
  try {
    const { studyGuideUrl } = req.body;
    const accessToken = await userService.getGithubAccessToken(req.user.id);
    const domains = await certificationParser.extractDomains(studyGuideUrl, { accessToken });
    res.json({ domains });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/new', requireAuth, async (req, res) => {
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
  const cert = {
    id, name, studyGuideUrl: studyGuideUrl || '', courseUrl: courseUrl || '',
    createdBy: req.user.id,
    creatorName: req.user.username,
    isPublic: false,
    publishedAt: null,
    usedByCount: 0,
    domains: domains.map((d, i) => ({
      id: d.id || `domain-${i + 1}`,
      name: d.name || `Domain ${i + 1}`,
      weight: Math.round(Number(d.weight) || 0),
      generatedAt: null,
      questions: [],
    })),
  };
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
});

router.post('/:certId/publish', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ公開できます');
  cert.isPublic = true;
  cert.publishedAt = new Date().toISOString();
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
});

router.post('/:certId/unpublish', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ操作できます');
  cert.isPublic = false;
  await questionService.writeCertification(cert);
  res.redirect('/my/certifications');
});

router.post('/:certId/delete', requireAuth, async (req, res) => {
  const cert = await questionService.readCertification(req.params.certId);
  if (!cert) return res.status(404).send('資格が見つかりません');
  if (cert.createdBy !== req.user.id) return res.status(403).send('作成者のみ削除できます');
  await questionService.deleteCertification(cert.id);
  res.redirect('/my/certifications');
});

module.exports = router;
