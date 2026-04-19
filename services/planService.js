'use strict';

const cosmosService = require('./cosmosService');
const questionService = require('./questionService');
const progressService = require('./progressService');

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MIN_QUESTIONS_PER_WEEK = 10;

async function generateSchedule({ certificationId, examDate, userId }) {
  const cert = await questionService.readCertification(certificationId);
  if (!cert) throw new Error(`Certification not found: ${certificationId}`);

  const now = new Date();
  const exam = new Date(examDate);
  const weeksLeft = Math.max(1, Math.ceil((exam - now) / MS_PER_WEEK));

  const stats = await progressService.calcDomainStats(certificationId, userId);

  const priorities = cert.domains.map((d) => {
    const rate = (stats[d.id]?.rate ?? 0) / 100;
    return { id: d.id, name: d.name, priority: d.weight * (1 - rate) };
  });
  priorities.sort((a, b) => b.priority - a.priority);

  const totalQuestions = cert.domains.reduce((acc, d) => acc + d.questions.length, 0);
  const perWeek = Math.max(MIN_QUESTIONS_PER_WEEK, Math.ceil(totalQuestions / weeksLeft));

  const schedule = [];
  for (let w = 1; w <= weeksLeft; w++) {
    const idx = (w - 1) % priorities.length;
    const primary = priorities[idx];
    const secondary = priorities[(idx + 1) % priorities.length];
    const ids = [primary?.id, secondary?.id].filter(Boolean);
    schedule.push({
      week: w,
      domains: [...new Set(ids)],
      targetQuestions: perWeek,
    });
  }
  return schedule;
}

async function upsertPlan({ userId, certificationId, examDate }) {
  const schedule = await generateSchedule({ certificationId, examDate, userId });
  const plan = {
    id: `${userId}-${certificationId}`,
    userId, certificationId, examDate,
    schedule,
    createdAt: new Date().toISOString(),
  };
  await cosmosService.upsert('studyPlans', plan);
  return plan;
}

async function listPlans(userId) {
  return cosmosService.query(
    'studyPlans',
    {
      query: 'SELECT * FROM c WHERE c.userId = @userId',
      parameters: [{ name: '@userId', value: userId }],
    },
    { partitionKey: userId }
  );
}

async function getPlan(userId, certificationId) {
  return cosmosService.read('studyPlans', `${userId}-${certificationId}`, userId);
}

async function deletePlan(userId, certificationId) {
  await cosmosService.remove('studyPlans', `${userId}-${certificationId}`, userId);
}

function currentWeek(plan) {
  if (!plan) return null;
  const created = new Date(plan.createdAt);
  const now = new Date();
  const weeksElapsed = Math.floor((now - created) / MS_PER_WEEK) + 1;
  return plan.schedule.find((s) => s.week === weeksElapsed) || plan.schedule[plan.schedule.length - 1];
}

module.exports = {
  generateSchedule, upsertPlan, listPlans, getPlan, deletePlan, currentWeek,
  MS_PER_WEEK, MIN_QUESTIONS_PER_WEEK,
};
