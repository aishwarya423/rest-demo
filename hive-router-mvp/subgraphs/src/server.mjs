/**
 * One image, three subgraphs. SUBGRAPH picks which schema to serve.
 *
 *   SUBGRAPH=accounts PORT=4001 REST_URL=http://accounts-rest:3001 node src/server.mjs
 */
import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { buildSubgraphSchema } from '@apollo/subgraph';

import { createRestClient } from './rest.mjs';
import * as accounts from './accounts.mjs';
import * as policies from './policies.mjs';
import * as funds from './funds.mjs';

const MODULES = { accounts, policies, funds };

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

const yoga = createYoga({
  schema,
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
    process.exit(0);
  });
}
