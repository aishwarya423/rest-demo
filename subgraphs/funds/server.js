// =============================================================================
// `funds` federation subgraph — GraphQL Yoga + @apollo/subgraph.
//
// Facade over the funds REST API with the shared tag-aware cache. Fund data is
// the slowest-moving of the three services, hence the long default TTL.
//
//   PORT        FUNDS_SUBGRAPH_PORT  (default 3012)
//   MGMT PORT   MGMT_PORT            (default PORT + 1000 -> 4012)
//   REST        FUNDS_REST_URL       (default http://localhost:3002)
//   REST auth   FUNDS_API_KEY        (sent as X-Api-Key; optional locally)
//   CACHE       REDIS_URL            (default redis://localhost:6379)
//   TTL         CACHE_TTL            (seconds, default 300)
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

const serviceName = "funds";
const PORT = Number(process.env.FUNDS_SUBGRAPH_PORT || 3012);
const MGMT_PORT = Number(process.env.MGMT_PORT || PORT + 1000);
const REST_URL = process.env.FUNDS_REST_URL || "http://localhost:3002";
const API_KEY = process.env.FUNDS_API_KEY || "";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_TTL = Number(process.env.CACHE_TTL || 300);
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

const typeDefs = parse(readFileSync(join(__dirname, "funds.graphql"), "utf8"));

const resolvers = {
  Query: {
    fund: (_parent, { id }) => cachedRequestJson(`/funds/${encodeURIComponent(id)}`),
    funds: () => cachedRequestJson("/funds")
  },
  Fund: {
    // Federation entity resolver — one call per representation in `_entities`,
    // i.e. one `subgraph:funds:/funds/{id}` cache key per Fund in the query.
    __resolveReference: (ref) => cachedRequestJson(`/funds/${encodeURIComponent(ref.id)}`)
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
