'use strict';

const cosmosService = require('./cosmosService');

async function readCertification(certId) {
  return cosmosService.read('certifications', certId, certId);
}

async function writeCertification(certData) {
  await cosmosService.upsert('certifications', certData);
}

async function listCertifications({ includePrivate = false, userId = null } = {}) {
  let querySpec;
  if (includePrivate && userId) {
    querySpec = {
      query: 'SELECT * FROM c WHERE c.isPublic = true OR c.createdBy = @userId',
      parameters: [{ name: '@userId', value: userId }],
    };
  } else {
    querySpec = { query: 'SELECT * FROM c WHERE c.isPublic = true' };
  }
  const certs = await cosmosService.query('certifications', querySpec);
  return certs.map((data) => ({
    id: data.id,
    name: data.name,
    domainCount: data.domains.length,
    questionCount: data.domains.reduce((acc, d) => acc + d.questions.length, 0),
    createdBy: data.createdBy,
    creatorName: data.creatorName,
  }));
}

async function getDomain(certId, domainId) {
  const cert = await readCertification(certId);
  if (!cert) return null;
  return cert.domains.find((d) => d.id === domainId) || null;
}

async function getAllQuestions(certId) {
  const cert = await readCertification(certId);
  if (!cert) return [];
  return cert.domains.flatMap((domain) =>
    domain.questions.map((q) => ({ ...q, domainId: domain.id, domainName: domain.name }))
  );
}

async function getQuestionsByDomain(certId, domainId) {
  const domain = await getDomain(certId, domainId);
  if (!domain) return [];
  return domain.questions.map((q) => ({ ...q, domainId: domain.id, domainName: domain.name }));
}

async function getQuestionsByIds(certId, questionIds) {
  const all = await getAllQuestions(certId);
  const idSet = new Set(questionIds);
  return all.filter((q) => idSet.has(q.id));
}

async function replaceDomainQuestions(certId, domainId, newQuestions) {
  const cert = await readCertification(certId);
  if (!cert) throw new Error(`Certification not found: ${certId}`);
  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Domain not found: ${domainId}`);
  domain.questions = newQuestions;
  domain.generatedAt = new Date().toISOString();
  await writeCertification(cert);
}

module.exports = {
  readCertification,
  writeCertification,
  listCertifications,
  getDomain,
  getAllQuestions,
  getQuestionsByDomain,
  getQuestionsByIds,
  replaceDomainQuestions,
};
