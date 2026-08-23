// =============================================================================
// `accounts` federation subgraph — GraphQL Yoga + @apollo/subgraph.
//
// A real, spec-compliant GraphQL federation subgraph that is a thin facade
// over the Accounts REST API. Built alongside `funds-subgraph` and
// `policies-subgraph` so both Grafbase and Hive Router can federate a true
// multi-subgraph topology (accounts + policies + funds) for the gateway
// evaluation spike, distinct from the REST-extension single-virtual-subgraph
// topology in the root schema.graphql.
//
//   PORT           ACCOUNTS_SUBGRAPH_PORT   (default 3010)
//   Accounts REST  ACCOUNTS_REST_URL        (default http://localhost:3001)
//   REST auth      ACCOUNTS_API_KEY         (sent as X-Api-Key; optional locally)
// =============================================================================
const { createServer } = require("http");
const { parse } = require("graphql");
const { createYoga } = require("graphql-yoga");
const { buildSubgraphSchema } = require("@apollo/subgraph");
const fs = require("fs");
const path = require("path");

const PORT = process.env.ACCOUNTS_SUBGRAPH_PORT || 3010;
const ACCOUNTS_REST = process.env.ACCOUNTS_REST_URL || "http://localhost:3001";
const ACCOUNTS_API_KEY = process.env.ACCOUNTS_API_KEY || "";

const typeDefs = parse(fs.readFileSync(path.join(__dirname, "accounts.graphql"), "utf8"));

async function fetchAccount(id) {
  const headers = ACCOUNTS_API_KEY ? { "X-Api-Key": ACCOUNTS_API_KEY } : {};
  const res = await fetch(`${ACCOUNTS_REST}/accounts/${encodeURIComponent(id)}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

const resolvers = {
  Query: {
    account: (_parent, { id }) => fetchAccount(id),
  },
  Account: {
    __resolveReference: (ref) => fetchAccount(ref.id),
  },
  FundHolding: {
    // Federation reference — only the key travels; funds-subgraph resolves the rest.
    fund: (holding) => ({ id: holding.fundId }),
  },
};

const yoga = createYoga({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/graphql",
  landingPage: false,
});

createServer(yoga).listen(PORT, () => {
  console.log(`accounts federation subgraph on http://localhost:${PORT}/graphql -> ${ACCOUNTS_REST}`);
});
