// =============================================================================
// Entity-caching POC — minimal ZERO-DEPENDENCY GraphQL federation subgraph for
// "funds". Pure Node http; no graphql-yoga, no apollo, no graphql package.
//
// It is a real HTTP GraphQL subgraph (a GraphQL facade over the funds REST mock
// at :3002). The federated gateway resolves Fund entities by POSTing an
// `_entities` query here — and because that is a real subgraph HTTP fetch, the
// gateway's entity caching stores the response in Redis.
//
// Handles exactly the queries the gateway/composer send:
//   * `_service { sdl }`  -> returns this subgraph's SDL (federation SDL query)
//   * `_entities(representations: [...])` -> resolves Fund by key (the cached hop)
//   * `fund(id:)`          -> convenience direct query
// Requests are logged to /tmp/poc-funds-gql.log so the shape is observable.
// =============================================================================
const http = require("http");
const fs = require("fs");

const PORT = process.env.FUNDS_GQL_PORT || 3009;
const FUNDS_REST = process.env.FUNDS_REST_URL || "http://localhost:3002";
const LOG = "/tmp/poc-funds-gql.log";

// The SDL returned by the federation `_service` query (must match funds.graphql).
const SDL = `
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

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

type Query { fund(id: ID!): Fund }
`;

function log(msg) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

async function fetchFund(id) {
  const res = await fetch(`${FUNDS_REST}/funds/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const f = await res.json();
  return { __typename: "Fund", ...f };
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { _health: "ok" } }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let payload = {};
    try { payload = JSON.parse(body || "{}"); } catch (_) {}
    const query = payload.query || "";
    const variables = payload.variables || {};
    log(`REQ ${JSON.stringify({ query: query.replace(/\s+/g, " ").trim().slice(0, 300), variables })}`);

    const send = (obj) => {
      // Cache-Control tells the gateway the response is cacheable — some entity
      // caches only store responses that carry an explicit max-age.
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "max-age=300",
      });
      res.end(JSON.stringify(obj));
      log(`RES ${JSON.stringify(obj).slice(0, 300)}`);
    };

    try {
      // Federation SDL query (used by composition / health).
      if (query.includes("_service")) {
        return send({ data: { _service: { sdl: SDL } } });
      }
      // Entity resolution — THE cacheable hop.
      if (query.includes("_entities")) {
        const reps = variables.representations || [];
        const entities = await Promise.all(
          reps.map((r) => (r && r.id != null ? fetchFund(r.id) : null))
        );
        return send({ data: { _entities: entities } });
      }
      // Direct fund(id:) query (convenience).
      if (query.includes("fund")) {
        const id = variables.id;
        const fund = id != null ? await fetchFund(id) : null;
        return send({ data: { fund } });
      }
      return send({ data: {} });
    } catch (e) {
      log(`ERR ${e.stack || e}`);
      send({ errors: [{ message: String(e) }] });
    }
  });
});

server.listen(PORT, () => {
  fs.writeFileSync(LOG, "");
  log(`funds GraphQL subgraph listening on http://localhost:${PORT}/graphql -> ${FUNDS_REST}`);
  console.log(`funds GraphQL subgraph on :${PORT}`);
});
