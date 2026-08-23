// =============================================================================
// `policies` federation subgraph — GraphQL Yoga + @apollo/subgraph.
//
// A real, spec-compliant GraphQL federation subgraph that is a thin facade
// over the Policies REST API. Contributes `Account.policies` onto the
// Account entity owned by accounts-subgraph — a genuine cross-subgraph
// entity extension (see policies.graphql header for why this matters).
//
//   PORT           POLICIES_SUBGRAPH_PORT   (default 3011)
//   Policies REST  POLICIES_REST_URL        (default http://localhost:3003)
//   REST auth      POLICIES_API_KEY         (sent as X-Api-Key; optional locally)
// =============================================================================
const { createServer } = require("http");
const { parse } = require("graphql");
const { createYoga } = require("graphql-yoga");
const { buildSubgraphSchema } = require("@apollo/subgraph");
const fs = require("fs");
const path = require("path");

const PORT = process.env.POLICIES_SUBGRAPH_PORT || 3011;
const POLICIES_REST = process.env.POLICIES_REST_URL || "http://localhost:3003";
const POLICIES_API_KEY = process.env.POLICIES_API_KEY || "";

const typeDefs = parse(fs.readFileSync(path.join(__dirname, "policies.graphql"), "utf8"));

function headers() {
  return POLICIES_API_KEY ? { "X-Api-Key": POLICIES_API_KEY } : {};
}

async function fetchPolicy(id) {
  const res = await fetch(`${POLICIES_REST}/policies/${encodeURIComponent(id)}`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

async function fetchPoliciesForAccount(accountId) {
  const res = await fetch(`${POLICIES_REST}/accounts/${encodeURIComponent(accountId)}/policies`, { headers: headers() });
  if (!res.ok) return [];
  return res.json();
}

const resolvers = {
  Query: {
    policy: (_parent, { id }) => fetchPolicy(id),
  },
  Policy: {
    __resolveReference: (ref) => fetchPolicy(ref.id),
    linkedFunds: (policy) => (policy.fundIds || []).map((id) => ({ id })),
  },
  Account: {
    // Reference resolver for the entity we're EXTENDING (not owning) — just
    // pass the key representation through so the `policies` field resolver
    // below can read `.id` off it.
    __resolveReference: (ref) => ref,
    policies: (account) => fetchPoliciesForAccount(account.id),
  },
};

const yoga = createYoga({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/graphql",
  landingPage: false,
});

createServer(yoga).listen(PORT, () => {
  console.log(`policies federation subgraph on http://localhost:${PORT}/graphql -> ${POLICIES_REST}`);
});
