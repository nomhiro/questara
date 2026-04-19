import supertest from 'supertest';
import { createRequire } from 'node:module';
import { setupTestDb } from './db.mjs';

const require = createRequire(import.meta.url);
const jwtService = require('../../services/jwtService');
const { createApp } = require('../../app');

let cachedApp = null;

export async function getApp() {
  if (!cachedApp) {
    await setupTestDb();
    cachedApp = createApp();
  }
  return cachedApp;
}

function signCookieFor(user) {
  const token = jwtService.sign({
    userId: user.id,
    email: user.email,
    username: user.username,
  });
  return `${jwtService.COOKIE_NAME}=${token}`;
}

export async function authedAgent(user) {
  const app = await getApp();
  const cookie = signCookieFor(user);
  return {
    get: (url) => supertest(app).get(url).set('Cookie', cookie),
    post: (url) => supertest(app).post(url).set('Cookie', cookie),
    put: (url) => supertest(app).put(url).set('Cookie', cookie),
    delete: (url) => supertest(app).delete(url).set('Cookie', cookie),
  };
}

export async function anonAgent() {
  const app = await getApp();
  return supertest(app);
}

export { signCookieFor };
