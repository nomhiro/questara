'use strict';

const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = process.env.COSMOS_DATABASE || 'cert-quiz';

const CONTAINERS = {
  users: { id: 'users', partitionKey: '/id' },
  certifications: { id: 'certifications', partitionKey: '/id' },
  sessions: { id: 'sessions', partitionKey: '/userId' },
  studyPlans: { id: 'studyPlans', partitionKey: '/userId' },
  adventures: { id: 'adventures', partitionKey: '/userId' },
};

let client;
const containers = {};

function getClient() {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) throw new Error('COSMOS_ENDPOINT and COSMOS_KEY are required');
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

async function init() {
  const c = getClient();
  const { database: db } = await c.databases.createIfNotExists({ id: DATABASE_ID });
  for (const [key, def] of Object.entries(CONTAINERS)) {
    const { container } = await db.containers.createIfNotExists(def);
    containers[key] = container;
  }
}

function getContainer(name) {
  if (!containers[name]) throw new Error(`Container "${name}" not initialized. Did you call init()?`);
  return containers[name];
}

async function upsert(containerName, item) {
  const { resource } = await getContainer(containerName).items.upsert(item);
  return resource;
}

async function read(containerName, id, partitionKey) {
  try {
    const { resource } = await getContainer(containerName).item(id, partitionKey).read();
    return resource || null;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

async function remove(containerName, id, partitionKey) {
  try {
    await getContainer(containerName).item(id, partitionKey).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

async function query(containerName, querySpec, options = {}) {
  const { resources } = await getContainer(containerName).items.query(querySpec, options).fetchAll();
  return resources;
}

module.exports = { init, upsert, read, remove, query, getContainer };
