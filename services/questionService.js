'use strict';

const fs = require('fs');
const path = require('path');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certifications');

function readCertification(certId) {
  const file = path.join(CERT_DIR, `${certId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeCertification(certData) {
  const file = path.join(CERT_DIR, `${certData.id}.json`);
  fs.writeFileSync(file, JSON.stringify(certData, null, 2), 'utf-8');
}

function listCertifications() {
  const files = fs.readdirSync(CERT_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(CERT_DIR, f), 'utf-8'));
    return {
      id: data.id,
      name: data.name,
      domainCount: data.domains.length,
      questionCount: data.domains.reduce((acc, d) => acc + d.questions.length, 0),
    };
  });
}

function getDomain(certId, domainId) {
  const cert = readCertification(certId);
  if (!cert) return null;
  return cert.domains.find((d) => d.id === domainId) || null;
}

/**
 * 全問題リストをフラットに返す (domainId 付き)
 */
function getAllQuestions(certId) {
  const cert = readCertification(certId);
  if (!cert) return [];
  return cert.domains.flatMap((domain) =>
    domain.questions.map((q) => ({ ...q, domainId: domain.id, domainName: domain.name }))
  );
}

/**
 * ドメイン指定の問題リストを返す
 */
function getQuestionsByDomain(certId, domainId) {
  const domain = getDomain(certId, domainId);
  if (!domain) return [];
  return domain.questions.map((q) => ({ ...q, domainId: domain.id, domainName: domain.name }));
}

/**
 * 問題IDリストで絞り込んで返す
 */
function getQuestionsByIds(certId, questionIds) {
  const all = getAllQuestions(certId);
  const idSet = new Set(questionIds);
  return all.filter((q) => idSet.has(q.id));
}

/**
 * ドメインの問題を新しい問題配列で置き換える
 */
function replaceDomainQuestions(certId, domainId, newQuestions) {
  const cert = readCertification(certId);
  if (!cert) throw new Error(`Certification not found: ${certId}`);
  const domain = cert.domains.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Domain not found: ${domainId}`);
  domain.questions = newQuestions;
  domain.generatedAt = new Date().toISOString();
  writeCertification(cert);
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
