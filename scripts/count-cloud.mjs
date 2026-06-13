#!/usr/bin/env node
// クラウド Cosmos の各 container のドキュメント数を表示する (debug 用)。
'use strict';

import { CosmosClient } from '@azure/cosmos';
import { execSync } from 'node:child_process';

const AZ = '"C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd"';
const SUB = 'f80766c9-6be7-43f9-8369-d492efceff1e';
const RG = 'rg-questara-prod';
const ACC = 'cosmos-ajq7cvepegncm';
const DB = 'cert-quiz';

const endpoint = execSync(
  `${AZ} cosmosdb show -g ${RG} -n ${ACC} --subscription ${SUB} --query documentEndpoint -o tsv`,
  { encoding: 'utf8' }
).trim();
const key = execSync(
  `${AZ} cosmosdb keys list -g ${RG} -n ${ACC} --subscription ${SUB} --query primaryMasterKey -o tsv`,
  { encoding: 'utf8' }
).trim();

const client = new CosmosClient({ endpoint, key });
const database = client.database(DB);

const containers = ['users', 'certifications', 'sessions', 'studyPlans'];
const rows = [];
for (const name of containers) {
  try {
    const { resources } = await database.container(name).items
      .query('SELECT VALUE COUNT(1) FROM c').fetchAll();
    rows.push({ container: name, count: resources[0] ?? 0 });
  } catch (err) {
    rows.push({ container: name, count: `ERR ${err.code || err.message}` });
  }
}
console.table(rows);
