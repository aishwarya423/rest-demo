# Entity-caching POC — how to run & test

Self-contained proof-of-concept for **entity caching** in a Grafbase federation.
It does **not** touch `schema-gen` or the root `schema.graphql`/`grafbase.toml` —
everything lives in this folder and its own `grafbase.poc.toml`.

> **Honest headline (read first).** This POC builds a *correct* multi-subgraph
> federation in which the gateway performs a **real cross-subgraph `_entities`
> fetch** — exactly the hop entity caching is meant to store. That fetch is
> **verified happening**. However, on the **self-hosted gateway 0.53.5** used
> here, entity caching **did not populate Redis** (0 `poc-entitycache*` keys) and
> **did not stop the repeat fetch**, while *operation* caching worked under the
> identical setup. See [Results](#results--what-was-actually-observed) and
> [What was tried](#what-was-tried-all-negative-for-entity-caching). The topology
> is entity-cache-ready; enabling the cache itself appears to need something more
> (most likely a newer gateway or Grafbase Platform hybrid mode) — see
> [Next steps](#likely-cause--next-steps).

---

## Why a second subgraph is required

Entity caching caches **gateway→subgraph `_entities` fetches**. The main project
is a *single* virtual (REST-extension) subgraph, resolved in-process, so there is
no such fetch (see [`../Docs/ENTITY-CACHING-WHY-NOOP.md`](../Docs/ENTITY-CACHING-WHY-NOOP.md)).
This POC therefore creates a genuine cross-subgraph `Fund @key` boundary:

```
account(id)              [accounts subgraph — virtual/REST extension]
  └─ fundHoldings
       └─ fund { id }    <- only the KEY is known here
             │
             │  gateway issues a real _entities fetch over HTTP
             ▼
       Fund { name, currency, ... }   [funds subgraph — REAL GraphQL server]
```

- **`accounts`** ([accounts.graphql](accounts.graphql)) — virtual REST-extension
  subgraph. Owns `Account`/`FundHolding`; references `Fund` by key only.
- **`funds`** ([funds.graphql](funds.graphql) + [funds-graphql-server.js](funds-graphql-server.js)) —
  a **real HTTP GraphQL federation subgraph** (zero-dependency Node; no
  graphql-yoga/apollo). It's a GraphQL facade over the funds REST mock and
  implements `_entities`, so the gateway's entity fetch is a real subgraph HTTP
  request — the cacheable unit.

## Files

| File | Role |
|---|---|
| [accounts.graphql](accounts.graphql) | `accounts` virtual subgraph (Account + Fund stub) |
| [funds.graphql](funds.graphql) | `funds` subgraph SDL (Apollo-federation, `Fund @key`) |
| [funds-graphql-server.js](funds-graphql-server.js) | zero-dep GraphQL subgraph server (`:3009`) |
| [grafbase.poc.toml](grafbase.poc.toml) | 2-subgraph config + `entity_caching`/`operation_caching` → Redis |

---

## Prerequisites

- Docker (for Redis), Node 18+ (the server uses global `fetch`), and the
  `grafbase` CLI + a `grafbase-gateway` binary.
- Get the production gateway if you don't have one (macOS/Linux):
  ```bash
  curl -fsSL https://grafbase.com/downloads/gateway | sh    # -> ./grafbase-gateway
  ```
  (`grafbase dev` will NOT work — it ignores caching. Use the production binary.)

## Steps

Run each block from the **repo root**.

### 1. Redis

```bash
docker rm -f redis-poc 2>/dev/null; docker run -d --name redis-poc -p 6379:6379 redis:7-alpine
docker exec redis-poc redis-cli ping        # -> PONG
```

### 2. Mock REST services (accounts :3001, funds :3002)

```bash
(cd mock-rest-apis/accounts && node server.js &)
(cd mock-rest-apis/funds && node server.js &)
```

### 3. The funds GraphQL subgraph (:3009)

```bash
node entity-caching-poc/funds-graphql-server.js &
curl -s localhost:3009/graphql -X POST -H 'content-type: application/json' \
  -d '{"query":"{ _service { sdl } }"}' | head -c 80        # sanity: returns SDL
```

### 4. Compose the federated schema

```bash
export ACCOUNTS_API_KEY=accounts-local-key FUNDS_API_KEY=funds-local-key
grafbase compose -c entity-caching-poc/grafbase.poc.toml > /tmp/poc-federated.graphql

# confirm the Fund entity is RESOLVABLE in the funds subgraph (the cacheable boundary):
grep -A2 'type Fund' /tmp/poc-federated.graphql
#   @join__type(graph: ACCOUNTS, key: "id", resolvable: false)
#   @join__type(graph: FUNDS,    key: "id")     <- resolvable (no `resolvable: false`)
```

### 5. Run the PRODUCTION gateway

```bash
export ACCOUNTS_API_KEY=accounts-local-key FUNDS_API_KEY=funds-local-key
./grafbase-gateway --config entity-caching-poc/grafbase.poc.toml \
                   --schema /tmp/poc-federated.graphql \
                   --listen-address 127.0.0.1:5098
```

### 6. Test the cross-subgraph query

In another terminal:

```bash
docker exec redis-poc redis-cli FLUSHALL
: > /tmp/poc-funds-gql.log        # reset the funds subgraph request log

Q='{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { name currency } } } }"}'
for i in 1 2 3; do curl -s localhost:5098/graphql -H 'content-type: application/json' -d "$Q" >/dev/null; done
```

Now observe:

```bash
# (a) TOPOLOGY PROOF — the gateway made a real cross-subgraph _entities fetch:
grep -c '_entities' /tmp/poc-funds-gql.log          # > 0  => the boundary works

# (b) OPERATION caching works (plans):
docker exec redis-poc redis-cli --scan --pattern 'poc-opcache*'      # -> a key

# (c) ENTITY caching — EXPECTED to appear, but does NOT on gateway 0.53.5:
docker exec redis-poc redis-cli --scan --pattern 'poc-entitycache*'  # -> (empty)
```

**If entity caching were working:** `poc-entitycache*` keys would appear, and the
`_entities` count in (a) would stop growing on the 2nd/3rd identical query (cache
hits). Neither happened here — see below.

---

## Results — what was actually observed

Gateway **0.53.5**, self-hosted, no Grafbase Platform connection:

| Signal | Expected if entity caching worked | Observed |
|---|---|---|
| `_entities` fetches for 3 identical queries | 1 (then cache hits) | **6** (re-fetched every time) |
| `poc-entitycache*` keys in Redis | present | **0** |
| `poc-opcache*` keys in Redis (operation caching) | present | **1** ✅ |
| The `_entities` requests themselves | — | byte-identical & cacheable |

So: the federation and the cross-subgraph entity fetch are **correct and
cacheable**, operation caching works, but **entity caching stored nothing**.

## What was tried (all negative for entity caching)

Every variation below left `poc-entitycache*` empty and did not reduce repeat
`_entities` fetches:

1. Two **virtual** (REST-extension) subgraphs with `@lookup` — composed as
   `resolvable: false` on both sides (in-process `@composite__lookup`, no HTTP
   fetch).
2. **Real HTTP** funds subgraph + `@derive`/`@is` reference on accounts.
3. **Real HTTP** funds subgraph + **plain federation reference** (this version) —
   composes `resolvable` on funds; real `_entities` fetch confirmed.
4. Added **`Cache-Control: max-age=300`** to the funds subgraph responses.
5. Added **per-subgraph** `[subgraphs.funds.entity_caching]` enablement.
6. Switched `storage` from `redis` to **`memory`** — still no cache hit.

Operation caching worked in all of the above.

## Likely cause & next steps

The config matches the docs and the topology is correct, yet entity caching is
inert while operation caching works. Most probable explanations, in order:

1. **Newer gateway required / version behavior.** 0.53.5 is what
   `downloads/gateway` served here. Try the latest gateway and re-run step 6.
2. **Grafbase Platform "hybrid mode."** Entity caching may require running the
   gateway connected to the Platform with a graph-ref + `GRAFBASE_ACCESS_TOKEN`
   (the gateway logs *"provide a valid graph-ref and access token"*). To try:
   ```bash
   export GRAFBASE_ACCESS_TOKEN=<org access token>
   ./grafbase-gateway --config entity-caching-poc/grafbase.poc.toml \
                      --schema /tmp/poc-federated.graphql \
                      --graph-ref <account>/<graph>@<branch> \
                      --listen-address 127.0.0.1:5098
   ```
   (Requires a Grafbase account — not attempted in this POC.)
3. **Confirm with Grafbase.** Given the docs don't state a requirement and the
   behavior contradicts them, this is worth a support/GitHub question, citing the
   evidence table above.

**Bottom line for the story:** the POC *proves the entity-fetch boundary and that
the setup is entity-cache-ready*, and cleanly demonstrates **operation caching**
on Redis. Actual entity-cache population could not be achieved on the self-hosted
0.53.5 gateway; closing that is gated on item 1 or 2 above.

## Cleanup

```bash
docker rm -f redis-poc
pkill -f funds-graphql-server
pkill -f "grafbase-gateway --config entity-caching-poc"
# stop the two mock servers (accounts/funds) you backgrounded in step 2
```
