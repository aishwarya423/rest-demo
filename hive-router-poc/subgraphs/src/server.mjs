/**
 * One image, three subgraphs. SUBGRAPH picks which schema to serve.
 *
 *   SUBGRAPH=accounts PORT=4001 REST_URL=http://accounts-rest:3001 node src/server.mjs
 */
import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { buildSubgraphSchema } from '@apollo/subgraph';

import { createRestClient } from './rest.mjs';
import { createResponseCachePlugin } from './cache.mjs';
import * as accounts from './accounts.mjs';
import * as policies from './policies.mjs';
import * as funds from './funds.mjs';

const MODULES = { accounts, policies, funds };

// Default TTLs, in milliseconds. Longest-lived data first.
//   funds    reference data, changes daily at most
//   policies changes on renewal
//   accounts balances move
const DEFAULT_TTL = { accounts: 30_000, policies: 120_000, funds: 300_000 };

const subgraph = process.env.SUBGRAPH;
const module = MODULES[subgraph];
if (!module) {
  console.error(`SUBGRAPH must be one of: ${Object.keys(MODULES).join(', ')} (got: ${subgraph})`);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 4001);
const restUrl = process.env.REST_URL;
if (!restUrl) {
  console.error('REST_URL is required');
  process.exit(1);
}

const rest = createRestClient({
  baseUrl: restUrl,
  apiKey: process.env.REST_API_KEY,
  label: subgraph,
});

// NOTE the array. buildSubgraphSchema normalizes a non-array argument as
// `[{ typeDefs: <whatever you passed> }]`, so passing the module object bare
// makes typeDefs the object itself and fails with "doc.definitions is not
// iterable". The array form is the supported shape.
const schema = buildSubgraphSchema([
  {
    typeDefs: module.typeDefs,
    resolvers: module.createResolvers(rest),
  },
]);

const plugins = [];
let redis;

if (process.env.CACHE_ENABLED !== '0') {
  const ttl = Number(process.env.CACHE_TTL_MS ?? DEFAULT_TTL[subgraph]);
  const created = createResponseCachePlugin({
    subgraph,
    redisUrl: process.env.REDIS_URL ?? 'redis://valkey:6379',
    ttl,
    // Per-type overrides within this subgraph. Mostly a no-op here because each
    // subgraph owns one main type, but it is the hook you would reach for.
    ttlPerType: {},
  });
  plugins.push(created.plugin);
  redis = created.redis;
  console.log(`[${subgraph}] response cache ON (ttl=${ttl}ms, redis=${process.env.REDIS_URL})`);
} else {
  console.log(`[${subgraph}] response cache OFF`);
}

const yoga = createYoga({
  schema,
  plugins,
  graphqlEndpoint: '/graphql',
  // Subgraphs are internal. Landing page off, introspection left on so the
  // composer can be pointed at them if you prefer that over local SDL.
  landingPage: false,
  maskedErrors: false,
});

const server = createServer(yoga);

server.listen(port, '0.0.0.0', () => {
  console.log(`[${subgraph}] subgraph ready on http://0.0.0.0:${port}/graphql -> ${restUrl}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    redis?.disconnect();
    process.exit(0);
  });
}
