'use strict';

const fs = require('fs');
const path = require('path');
const cosmosService = require('../services/cosmosService');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certifications');

(async () => {
  await cosmosService.init();
  const files = fs.readdirSync(CERT_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(CERT_DIR, f), 'utf-8'));
    const cert = {
      ...data,
      createdBy: 'system',
      creatorName: 'system',
      isPublic: true,
      publishedAt: new Date().toISOString(),
      usedByCount: 0,
    };
    await cosmosService.upsert('certifications', cert);
    console.log(`✅ Seeded: ${cert.id} (${cert.name})`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
