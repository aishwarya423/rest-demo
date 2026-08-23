// =============================================================================
// Composes accounts-subgraph + policies-subgraph + funds-subgraph into a
// Federation v2 supergraph.graphql for Hive Router.
//
// Why this file exists at all: Hive Router (github.com/graphql-hive/router)
// is a pure query-plan EXECUTOR — it loads a pre-composed supergraph file
// (SUPERGRAPH_FILE_PATH) and has no built-in composition or REST/OpenAPI
// integration of its own (confirmed against the project README and Hive
// docs during GQL-101; see Docs/gateway-evaluation/01-research-findings.md).
// Grafbase's `grafbase compose` does this step internally; Hive Router
// requires an external Federation-compliant composer (Apollo Rover, GraphQL
// Mesh, or — as used here — the `@apollo/composition` library directly,
// which is what Rover itself calls under the hood). Using the library
// instead of the Rover binary keeps this reproducible with plain `npm i`,
// no extra binary download/telemetry opt-out step.
//
// Usage:
//   npm install
//   SUBGRAPH_HOST_MODE=host npm run compose      # localhost URLs (host testing)
//   SUBGRAPH_HOST_MODE=docker npm run compose    # docker service-name URLs
// =============================================================================
import { composeServices } from "@apollo/composition";
import { parse } from "graphql";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const mode = process.env.SUBGRAPH_HOST_MODE || "host";
const urlsByMode = {
  // full docker-compose: subgraphs reached by compose service name
  docker: {
    accounts: "http://accounts-subgraph:3010/graphql",
    policies: "http://policies-subgraph:3011/graphql",
    funds: "http://funds-subgraph:3009/graphql",
  },
  // subgraphs run on the host, router (or gateway) runs in Docker (macOS/Windows
  // Docker Desktop's host-bridge hostname)
  "docker-to-host": {
    accounts: "http://host.docker.internal:3010/graphql",
    policies: "http://host.docker.internal:3011/graphql",
    funds: "http://host.docker.internal:3009/graphql",
  },
  // everything on the host, nothing in Docker
  host: {
    accounts: "http://localhost:3010/graphql",
    policies: "http://localhost:3011/graphql",
    funds: "http://localhost:3009/graphql",
  },
};
const urls = urlsByMode[mode];
if (!urls) {
  console.error(`Unknown SUBGRAPH_HOST_MODE=${mode}. Valid: ${Object.keys(urlsByMode).join(", ")}`);
  process.exit(1);
}

const subgraphs = [
  { name: "accounts", url: urls.accounts, file: "accounts-subgraph/accounts.graphql" },
  { name: "policies", url: urls.policies, file: "policies-subgraph/policies.graphql" },
  { name: "funds", url: urls.funds, file: "funds-subgraph/funds.graphql" },
].map((s) => ({
  name: s.name,
  url: s.url,
  typeDefs: parse(readFileSync(path.join(root, s.file), "utf8")),
}));

const result = composeServices(subgraphs);

if (result.errors && result.errors.length > 0) {
  console.error(`Composition FAILED with ${result.errors.length} error(s):`);
  for (const err of result.errors) {
    console.error(`  - ${err.message}`);
  }
  process.exit(1);
}

const outPath = path.join(__dirname, "supergraph.graphql");
writeFileSync(outPath, result.supergraphSdl, "utf8");
console.log(`Composition OK (mode=${mode}) -> ${outPath}`);
if (result.hints && result.hints.length) {
  console.log(`${result.hints.length} composition hint(s):`);
  for (const h of result.hints) console.log(`  - [${h.definition.code}] ${h.message}`);
}
