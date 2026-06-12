'use strict';

const cosmosService = require('./cosmosService');

async function readCertification(certId) {
  return cosmosService.read('certifications', certId, certId);
}

/**
 * 資格にアクセスしてよいか判定する (D-17)。
 * 公開資格は全員、非公開資格は作成者のみ。cert が null の場合は false。
 * @param {object|null} cert - readCertification の戻り値
 * @param {string} userId
 * @returns {boolean}
 */
function canAccessCertification(cert, userId) {
  if (!cert) return false;
  return cert.isPublic === true || cert.createdBy === userId;
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
    isPublic: data.isPublic,
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

async function appendDomainQuestions(certId, domainId, newQuestions) {
  const cert = await readCertification(certId);
  if (!cert) throw new Error(`Certification not found: ${certId}`);
  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Domain not found: ${domainId}`);

  const existingIds = new Set(domain.questions.map((q) => q.id));
  const toAppend = newQuestions.filter((q) => !existingIds.has(q.id));

  domain.questions = [...domain.questions, ...toAppend];
  domain.generatedAt = new Date().toISOString();
  await writeCertification(cert);
  return { appended: toAppend.length, skipped: newQuestions.length - toAppend.length };
}

async function deleteCertification(certId) {
  await cosmosService.remove('certifications', certId, certId);
}

async function getCertDomainCounts() {
  const certs = await cosmosService.query('certifications', { query: 'SELECT * FROM c' });
  const map = {};
  for (const c of certs) {
    if (c?.id && Array.isArray(c.domains)) {
      map[c.id] = c.domains.length;
    }
  }
  return map;
}

module.exports = {
  readCertification,
  canAccessCertification,
  writeCertification,
  listCertifications,
  getDomain,
  getAllQuestions,
  getQuestionsByDomain,
  getQuestionsByIds,
  appendDomainQuestions,
  deleteCertification,
  getCertDomainCounts,
};
