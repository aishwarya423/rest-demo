// =============================================================================
// `policies` federation subgraph — GraphQL Yoga + @apollo/subgraph.
//
// Facade over the policies REST API with the shared tag-aware cache. The
// interesting tag here is `Account:{id}`: this subgraph registers
// `subgraph:policies:/accounts/{id}/policies` under it, and the accounts
// subgraph registers `subgraph:accounts:/accounts/{id}` under the SAME tag —
// so one purge invalidates both services' entries.
//
//   PORT        POLICIES_SUBGRAPH_PORT  (default 3013)
//   MGMT PORT   MGMT_PORT               (default PORT + 1000 -> 4013)
//   REST        POLICIES_REST_URL       (default http://localhost:3003)
//   REST auth   POLICIES_API_KEY        (sent as X-Api-Key; optional locally)
//   CACHE       REDIS_URL               (default redis://localhost:6379)
//   TTL         CACHE_TTL               (seconds, default 30 — policies churn)
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

const serviceName = "policies";
const PORT = Number(process.env.POLICIES_SUBGRAPH_PORT || 3013);
const MGMT_PORT = Number(process.env.MGMT_PORT || PORT + 1000);
const REST_URL = process.env.POLICIES_REST_URL || "http://localhost:3003";
const API_KEY = process.env.POLICIES_API_KEY || "";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_TTL = Number(process.env.CACHE_TTL || 30);
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

const typeDefs = parse(readFileSync(join(__dirname, "policies.graphql"), "utf8"));

const resolvers = {
  Query: {
    policy: (_parent, { id }) => cachedRequestJson(`/policies/${encodeURIComponent(id)}`),
    policies: () => cachedRequestJson("/policies")
  },
  Policy: {
    __resolveReference: (ref) => cachedRequestJson(`/policies/${encodeURIComponent(ref.id)}`),
    linkedFunds: (policy) => (policy.fundIds || []).map((id) => ({ id }))
  },
  Account: {
    // Nothing to fetch for the stub itself — the key IS the whole reference;
    // the REST call happens lazily in `policies` below, only if it is selected.
    __resolveReference: (ref) => ({ id: ref.id }),
    policies: (account) =>
      cachedRequestJson(`/accounts/${encodeURIComponent(account.id)}/policies`)
  },
  Fund: {
    __resolveReference: (ref) => ({ id: ref.id }),
    policies: (fund) => cachedRequestJson(`/funds/${encodeURIComponent(fund.id)}/policies`)
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
