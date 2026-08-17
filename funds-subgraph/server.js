// =============================================================================
// `funds` federation subgraph — GraphQL Yoga + @apollo/subgraph.
//
// A real, spec-compliant GraphQL federation subgraph that is a thin facade over
// the Funds REST API. `buildSubgraphSchema` generates the full federation
// contract (_service, _entities, _Any, _Entity union, __resolveReference), so
// the federated gateway resolves Fund via a standard `_entities` fetch — and
// THAT response is what entity caching stores in Redis.
//
// Run alongside the mocks + Redis + the PRODUCTION gateway (see README.md).
//   PORT           FUNDS_SUBGRAPH_PORT   (default 3009)
//   Funds REST     FUNDS_REST_URL        (default http://localhost:3002)
//   REST auth      FUNDS_API_KEY         (sent as X-Api-Key; optional locally)
// reference official grafbase docs https://grafbase.com/guides/introduction-to-graphql-federation
// =============================================================================
const { createServer } = require("http");
const { parse } = require("graphql");
const { createYoga } = require("graphql-yoga");
const { buildSubgraphSchema } = require("@apollo/subgraph");

const PORT = process.env.FUNDS_SUBGRAPH_PORT || 3009;
const FUNDS_REST = process.env.FUNDS_REST_URL || "http://localhost:3002";
const FUNDS_API_KEY = process.env.FUNDS_API_KEY || "";

const typeDefs = parse(/* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

  type Fund @key(fields: "id") {
    id: ID!
    isin: String!
    name: String!
    assetClass: AssetClass!
    currency: String!
    riskRating: Int!
    ongoingChargePercent: Float!
    oneYearReturnPercent: Float!
    threeYearReturnPercent: Float!
    sustainabilityLabel: SustainabilityLabel!
  }

  enum AssetClass { EQUITY FIXED_INCOME CASH }
  enum SustainabilityLabel { STANDARD SUSTAINABLE TRANSITION }

  type Query {
    fund(id: ID!): Fund
  }
`);

async function fetchFund(id) {
  const headers = FUNDS_API_KEY ? { "X-Api-Key": FUNDS_API_KEY } : {};
  const res = await fetch(`${FUNDS_REST}/funds/${encodeURIComponent(id)}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

const resolvers = {
  Query: {
    fund: (_parent, { id }) => fetchFund(id),
  },
  Fund: {
    // Federation entity resolver — one call per representation in `_entities`.
    __resolveReference: (ref) => fetchFund(ref.id),
  },
};

const yoga = createYoga({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/graphql",
  landingPage: false,
});

createServer(yoga).listen(PORT, () => {
  console.log(`funds federation subgraph on http://localhost:${PORT}/graphql -> ${FUNDS_REST}`);
});
