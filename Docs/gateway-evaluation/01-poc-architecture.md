# GQL-102/103 — PoC Architecture: True Federation v2 for Both Gateways

What was built, why, and how to run it. Both gateways were pointed at the
**same three real GraphQL subgraphs** — the only way to make the comparison
apples-to-apples, since Hive Router has no REST-extension equivalent
(see [`00-research-findings.md`](./00-research-findings.md)).

## Topology

```
                    ┌──────────────┐        ┌──────────────┐
   client ───────►  │   Grafbase   │   or   │  Hive Router │
                    │   Gateway    │        │ (Rust, :4000)│
                    └──────┬───────┘        └──────┬───────┘
             ┌─────────────┼───────────────────────┼─────┐
             ▼              ▼                        ▼
   accounts-subgraph   policies-subgraph       funds-subgraph
     (:3010, NEW)         (:3011, NEW)         (:3009, existing)
             │              │                        │
             ▼              ▼                        ▼
   Accounts REST      Policies REST            Funds REST
     (:3001)             (:3003)                 (:3002)
```

`funds-subgraph` already existed in this repo (built for entity-caching
work). `accounts-subgraph` and `policies-subgraph` are new, built for this
spike, following the exact same pattern (GraphQL Yoga + `@apollo/subgraph`,
thin facade over the REST API, `__resolveReference` for entity resolution).

## What makes this *true* federation, not REST aggregation

`policies-subgraph` **extends** the `Account` entity owned by
`accounts-subgraph`:

```graphql
# policies-subgraph/policies.graphql
extend type Account @key(fields: "id") {
  id: ID! @external
  policies: [Policy!]!
}
```

Two independently deployable services contribute fields to the same logical
entity, merged by the query planner via `@key` — no gateway-level
`@derive`/`@require` directive needed (contrast with the REST-extension
approach in [`../REST_FEDERATION.md`](../REST_FEDERATION.md), which needs
those directives because everything resolves through one in-process
extension). `Fund` is referenced as an **unresolvable stub**
(`@key(fields: "id", resolvable: false)`) from both `accounts-subgraph` and
`policies-subgraph` — only `funds-subgraph` can resolve it fully, so the
query planner issues a real cross-subgraph `_entities` fetch for every `Fund`
field beyond `id`.

Files: [`accounts-subgraph/`](../../accounts-subgraph/),
[`policies-subgraph/`](../../policies-subgraph/).

## Composition — the piece Hive Router doesn't provide

[`hive-router/compose.mjs`](../../hive-router/compose.mjs) uses
`@apollo/composition` (the library Apollo's own `rover supergraph compose`
calls internally) to compose the three subgraph SDLs into a Federation v2
supergraph. Chosen over the Rover CLI binary to keep the pipeline
`npm install && npm run compose` — reproducible without a separate binary
download step.

```bash
cd hive-router
npm install
SUBGRAPH_HOST_MODE=host npm run compose        # subgraphs on localhost
SUBGRAPH_HOST_MODE=docker-to-host npm run compose  # router in Docker, subgraphs on host
SUBGRAPH_HOST_MODE=docker npm run compose      # everything in Docker (compose service names)
```

Verified output: real `join__type`/`join__field` federation directives, e.g.
`Account` merged from both `ACCOUNTS` and `POLICIES` graphs — see
[`evidence/hive-router-supergraph.graphql`](./evidence/hive-router-supergraph.graphql).

## Running Hive Router against it

```bash
docker run -d --name hive-router-poc -p 4000:4000 \
  -e SUPERGRAPH_FILE_PATH="/app/supergraph.graphql" \
  -v "$(pwd)/hive-router/supergraph.graphql:/app/supergraph.graphql" \
  ghcr.io/graphql-hive/router:latest
```

**Verified result** (2026-08-21): the full three-way join query
(`account → policies → linkedFunds`, `account → fundHoldings → fund`)
resolved correctly — Anika Rao, £186,420.75, policy `ANN-RET-3002` linking
`Global Equity Index` + `Green Bond Income`, all three fund holdings
resolving their fund. **Byte-identical to the data Grafbase's REST-extension
topology has always produced** (the reference result documented in
[`../REST_FEDERATION.md`](../REST_FEDERATION.md) §7).

## Running Grafbase against the *same* true-federation topology

This is new — Grafbase's existing PoC only ever ran the REST-extension
topology (`insurance` virtual subgraph) plus the one real `funds` subgraph.
[`grafbase-federation/grafbase.toml`](../../grafbase-federation/grafbase.toml)
points Grafbase at all three real subgraphs with **no REST extension
involved at all**:

```toml
[subgraphs.accounts]
url = "http://localhost:3010/graphql"
schema_path = "../accounts-subgraph/accounts.graphql"
# ...policies, funds identically
```

```bash
npx grafbase dev --listen-address 127.0.0.1:5070 -c grafbase-federation/grafbase.toml
```

**Verified result:** identical output to Hive Router's, down to every field
value. This proves Grafbase Gateway is not limited to the REST-extension
topology — it composes and executes true Federation v2 just as correctly.
The REST-extension approach was a **choice** made when the original PoC was
built (probably right, for a REST-only estate — see
[`../REST_FEDERATION.md`](../REST_FEDERATION.md) §8 on why no custom
extension was needed), not a technical ceiling.

## Docker-vs-Docker control build (for fair benchmarking)

Running Grafbase natively on the host vs. Hive Router in Docker (reaching the
same host subgraphs via `host.docker.internal`) is not a fair performance
comparison — Docker's network bridge adds real overhead the native process
doesn't pay. [`grafbase-federation/Dockerfile`](../../grafbase-federation/Dockerfile)
builds a containerized production Grafbase gateway on the same network path
as the Hive Router container, so [`03-benchmark-results.md`](./03-benchmark-results.md)'s
numbers are controlled for this.

```bash
docker build -f grafbase-federation/Dockerfile -t grafbase-fed-poc .
docker run -d --name grafbase-fed-poc-run -p 5072:5072 grafbase-fed-poc
```

**Real, measured image-size difference** (not from docs — `docker images`
output, see [`evidence/image-sizes.txt`](./evidence/image-sizes.txt)):

| Image | Size | Why |
|---|---|---|
| `grafbase-fed-poc` (Grafbase) | **793MB** | Debian base + Node.js + npm + `grafbase` CLI (needed to run `grafbase compose` at build/start time) + the gateway binary |
| `ghcr.io/graphql-hive/router` (Hive Router) | **128MB** | Just the Rust binary — no composition tooling, because it never composes |

This is the direct operational shadow of finding #2 in
[`00-research-findings.md`](./00-research-findings.md): Grafbase carries its
composition toolchain into the runtime image; Hive Router pushes that entire
concern to a separate build step (this repo's own `hive-router/compose.mjs`,
run in CI in a real deployment) and ships a minimal runtime.

## Reproducing this from a clean checkout

```bash
# 1. mocks + all three subgraphs (host)
npm run mock-apis &
(cd accounts-subgraph && npm install && ACCOUNTS_API_KEY=accounts-local-key node server.js) &
(cd policies-subgraph && npm install && POLICIES_API_KEY=policies-local-key node server.js) &
(cd funds-subgraph && npm install && FUNDS_API_KEY=funds-local-key node server.js) &

# 2a. Grafbase true-federation
npx grafbase dev --listen-address 127.0.0.1:5070 -c grafbase-federation/grafbase.toml

# 2b. Hive Router
cd hive-router && npm install && SUBGRAPH_HOST_MODE=docker-to-host npm run compose && cd ..
docker run -d -p 4000:4000 -e SUPERGRAPH_FILE_PATH=/app/supergraph.graphql \
  -v "$(pwd)/hive-router/supergraph.graphql:/app/supergraph.graphql" \
  ghcr.io/graphql-hive/router:latest
```
