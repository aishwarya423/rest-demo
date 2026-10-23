/**
 * ===========================================================================
 * SUPERGRAPH COMPOSITION
 * ===========================================================================
 * Hive Router consumes a composed Federation supergraph. It does not compose
 * one itself, and it will not run a GraphQL Mesh supergraph, because Mesh bakes
 * in @httpOperation / @resolveTo directives that only Hive Gateway executes.
 *
 * So we compose with @theguild/federation-composition, the same library the
 * Hive schema registry uses. Input is the three subgraph SDLs; output is one
 * supergraph.graphql that the router serves.
 *
 * This is a BUILD step. It runs once, writes to a shared volume and exits.
 *
 * Run: node compose.mjs [outputPath]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { print } from 'graphql';
import { composeServices } from '@theguild/federation-composition';

import * as accounts from '../subgraphs/src/accounts.mjs';
import * as policies from '../subgraphs/src/policies.mjs';
import * as funds from '../subgraphs/src/funds.mjs';

// Where the router will reach each subgraph. Baked into the supergraph, so it
// must match the compose service names (or localhost for a host-run stack).
const URLS = {
  accounts: process.env.ACCOUNTS_SUBGRAPH_URL ?? 'http://accounts-subgraph:4001/graphql',
  policies: process.env.POLICIES_SUBGRAPH_URL ?? 'http://policies-subgraph:4002/graphql',
  funds: process.env.FUNDS_SUBGRAPH_URL ?? 'http://funds-subgraph:4003/graphql',
};

const services = [accounts, policies, funds].map((module) => ({
  name: module.name,
  typeDefs: module.typeDefs,
  url: URLS[module.name],
}));

console.log('Composing supergraph from:');
for (const service of services) {
  console.log(`  ${service.name.padEnd(9)} -> ${service.url}`);
}

const result = composeServices(services);

if (result.errors?.length) {
  console.error(`\nComposition FAILED with ${result.errors.length} error(s):\n`);
  for (const error of result.errors) {
    console.error(`  - ${error.message}`);
  }
  process.exit(1);
}

const outputPath = resolve(process.argv[2] ?? '/out/supergraph.graphql');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.supergraphSdl, 'utf8');

// The public SDL is what clients see: the supergraph minus federation
// plumbing. Writing it next door makes the generated API easy to review.
const publicPath = outputPath.replace(/\.graphql$/, '.public.graphql');
writeFileSync(publicPath, result.publicSdl ?? print(result.publicDocumentNode), 'utf8');

const entityCount = (result.supergraphSdl.match(/join__type\([^)]*key:/g) ?? []).length;
console.log(`\nComposition OK`);
console.log(`  supergraph : ${outputPath} (${result.supergraphSdl.split('\n').length} lines)`);
console.log(`  public SDL : ${publicPath}`);
console.log(`  entity keys: ${entityCount}`);
