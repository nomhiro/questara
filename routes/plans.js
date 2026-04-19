'use strict';

const express = require('express');
const router = express.Router();
const planService = require('../services/planService');
const questionService = require('../services/questionService');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const plans = await planService.listPlans(req.user.id);
  const allCerts = await questionService.listCertifications({ includePrivate: true, userId: req.user.id });
  const plansWithCert = plans.map((p) => ({
    ...p,
    cert: allCerts.find((c) => c.id === p.certificationId) || null,
    currentWeek: planService.currentWeek(p),
  }));
  res.render('plan', {
    title: '学習計画',
    plans: plansWithCert,
    allCerts,
    userEmail: res.locals.userEmail,
  });
});

router.post('/', requireAuth, async (req, res) => {
  const { certificationId, examDate } = req.body;
  if (!certificationId || !examDate) {
    return res.status(400).send('資格と試験日は必須です');
  }
  try {
    await planService.upsertPlan({ userId: req.user.id, certificationId, examDate });
    res.redirect('/plans');
  } catch (err) {
    res.status(400).send(err.message);
  }
});

router.post('/:certId/delete', requireAuth, async (req, res) => {
  await planService.deletePlan(req.user.id, req.params.certId);
  res.redirect('/plans');
});

module.exports = router;
