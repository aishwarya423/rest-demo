// =============================================================================
// `accounts` federation subgraph — GraphQL Yoga + @apollo/subgraph.
//
// A thin GraphQL facade over the accounts REST API in which EVERY REST call
// goes through the shared tag-aware cache (../lib/cache.js), so the cache keys
// and tag SETs you see in `valkey-cli MONITOR` map 1:1 to REST routes:
//
//   get  "subgraph:accounts:/accounts/acct-1001"
//   set  "subgraph:accounts:/accounts/acct-1001" "{...}" "EX" "120"
//   sadd "tag:Account" "subgraph:accounts:/accounts/acct-1001"
//   sadd "tag:Account:acct-1001" "subgraph:accounts:/accounts/acct-1001"
//
//   PORT        ACCOUNTS_SUBGRAPH_PORT  (default 3011)
//   MGMT PORT   MGMT_PORT               (default PORT + 1000 -> 4011)
//   REST        ACCOUNTS_REST_URL       (default http://localhost:3001)
//   REST auth   ACCOUNTS_API_KEY        (sent as X-Api-Key; optional locally)
//   CACHE       REDIS_URL               (default redis://localhost:6379)
//   TTL         CACHE_TTL               (seconds, default 120)
//   TAG TTL     TAG_INDEX_TTL               (seconds, default 2x CACHE_TTL; keep it
//                                       IDENTICAL across all subgraphs)
// =============================================================================
const { readFileSync } = require("fs");
const { join } = require("path");
const { createServer } = require("http");
const { parse } = require("graphql");
const { createYoga } = require("graphql-yoga");
const { buildSubgraphSchema } = require("@apollo/subgraph");
const { createRestCache } = require("../lib/cache");

const serviceName = "accounts";
const PORT = Number(process.env.ACCOUNTS_SUBGRAPH_PORT || 3011);
const MGMT_PORT = Number(process.env.MGMT_PORT || PORT + 1000);
const REST_URL = process.env.ACCOUNTS_REST_URL || "http://localhost:3001";
const API_KEY = process.env.ACCOUNTS_API_KEY || "";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_TTL = Number(process.env.CACHE_TTL || 120);
// Shared by ALL subgraphs — see the note in lib/cache.js.
const TAG_INDEX_TTL = Number(process.env.TAG_INDEX_TTL || CACHE_TTL * 2);

const { cachedRequestJson, startMgmtServer } = createRestCache({
  serviceName,
  restUrl: REST_URL,
  apiKey: API_KEY,
  redisUrl: REDIS_URL,
  cacheTtl: CACHE_TTL,
  tagIndexTtl: TAG_INDEX_TTL,
  mgmtPort: MGMT_PORT
});

const typeDefs = parse(readFileSync(join(__dirname, "accounts.graphql"), "utf8"));

const resolvers = {
  Query: {
    account: (_parent, { id }) => cachedRequestJson(`/accounts/${encodeURIComponent(id)}`),
    accounts: () => cachedRequestJson("/accounts"),
    customerAccounts: (_parent, { customerId }) =>
      cachedRequestJson(`/customers/${encodeURIComponent(customerId)}/accounts`)
  },
  Account: {
    // Federation entity resolver — one call per representation in `_entities`.
    __resolveReference: (ref) => cachedRequestJson(`/accounts/${encodeURIComponent(ref.id)}`),
    // The REST payload carries fundHoldings[].fundId; the graph exposes a Fund
    // key instead, which the gateway turns into an `_entities` fetch on `funds`.
    fundHoldings: (account) =>
      (account.fundHoldings || []).map((holding) => ({ ...holding, fund: { id: holding.fundId } }))
  }
};

const yoga = createYoga({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
  graphqlEndpoint: "/graphql",
  landingPage: false
});

createServer(yoga).listen(PORT, () => {
  console.log(`${serviceName} federation subgraph on http://localhost:${PORT}/graphql -> ${REST_URL}`);
});

startMgmtServer();
