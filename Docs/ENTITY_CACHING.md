# Entity Caching + Redis — config, and a verified reality check

## Where the config goes

There are two `grafbase.toml` files in this repo:

| File | Role | Caching config? |
|---|---|---|
| [`grafbase.toml`](../grafbase.toml) (root) | the config the running gateway loads (`grafbase dev`, docker-compose) | **yes — put it here** |
| [`schema-gen/validate/grafbase.toml`](../schema-gen/validate/grafbase.toml) | only drives `grafbase compose` for schema validation; never runs the gateway | no (it would do nothing) |

## The config (root `grafbase.toml`)

```toml
[entity_caching]
enabled = true
ttl = "60s"
storage = "redis"          # REQUIRED — defaults to "memory"; without it Redis is never used

[entity_caching.redis]
url = "redis://valkey:6379" # compose service DNS; localhost for host-side dev
key_prefix = "insurance-gateway"

# per-subgraph override — the ONLY valid subgraph here is `insurance`
[subgraphs.insurance.entity_caching]
enabled = true
ttl = "120s"
```

### Two corrections vs the reference snippet that prompted this

1. **`storage = "redis"` was missing.** `storage` defaults to `"memory"`, so the
   original snippet (`[entity_caching]` + `[entity_caching.redis]` with no
   `storage`) would silently stay in-process and never touch Redis.
2. **`[subgraphs.accounts]` does not exist here.** That snippet assumes federated
   GraphQL subgraphs each with a `url`. This project is a **single** subgraph,
   `insurance`, declared with `schema_path`; accounts/funds/policies are REST
   *endpoints inside* it. The only valid per-subgraph target is
   `[subgraphs.insurance.entity_caching]`.

`docker-compose.yml` was also updated: the `valkey` (Redis-compatible) service is
enabled, the gateway `depends_on` it (`service_healthy`), and a `valkey-data`
volume persists the cache.

## ⚠️ Verified limitation — this does not actually cache anything here (yet)

I did not assume it worked — I installed the real gateway and measured it. Every
run below queried `account → fundHoldings → fund` (which triggers `Fund` entity
lookups) **twice** against a live `valkey` and watched Redis.

| Setup | Query resolves? | Redis keys written | Redis commands (MONITOR) |
|---|---|---|---|
| `grafbase dev` + Redis | ✅ yes | **0** | **0** |
| `grafbase-gateway` 0.53.5 (production) + Redis | ✅ yes | **0** | **0** |
| `grafbase-gateway` 0.53.5 + **dead** Redis port | ✅ yes, starts clean | — | gateway never even tries to connect |

The last row is the tell: with Redis pointed at a dead port the gateway starts
and serves **without any error or connection attempt** — so it is not wiring up
the Redis client from this config in this scenario.

### Why

1. **`grafbase dev` ignores entity caching.** It is a development server; entity
   caching is a production-gateway feature. Zero Redis traffic, confirmed.
2. **Entity caching caches *subgraph fetches*.** In a federated graph it caches
   the `_entities` responses the gateway fetches from downstream subgraphs. Here
   there is exactly one subgraph, `insurance`, and its fields (including the
   `Fund @key` lookup fanned out by `@derive`) are resolved by the **REST WASM
   extension**, not by an HTTP subgraph fetch. So there is no subgraph-fetch
   response for the entity cache to store — nothing lands in Redis.

In short: the config is the **documented-correct format** and is kept ready in
`grafbase.toml`, but in this single-subgraph + REST-extension topology it is a
no-op. It also does **not** break anything — `grafbase dev` runs fine with the
config present even when no Redis is available.

## What actually reduces REST calls in this architecture

Since entity caching targets subgraph fetches, consider these instead:

1. **Operation caching** (`[operation_caching]`) — caches whole GraphQL operation
   responses at the gateway. Best fit for read-heavy, low-churn data like this.
2. **Cache the REST layer** — a caching reverse proxy (or Redis-backed cache) in
   front of the mock REST services, keyed by URL. Independent of Grafbase.
3. **Extension-level caching** — if a future version of the `rest` extension
   exposes response caching, configure it there (per `@restEndpoint`).

If you want cross-subgraph entity caching to actually engage, the graph would
need real downstream GraphQL subgraphs (HTTP subgraph fetches), which is a
different architecture than the REST-extension approach used here.

## How to reproduce the test

```bash
# 1. Redis + mocks
docker run -d --name valkey-test -p 6379:6379 valkey/valkey:8-alpine
npm run mock-apis          # accounts:3001 funds:3002 policies:3003

# 2. compose a federated schema (production gateway needs this, not the subgraph SDL)
#    (point the redis url at localhost:6379 for host-side testing)
npx grafbase compose -c grafbase.toml > /tmp/federated.graphql

# 3. install + run the production gateway
curl -fsSL https://grafbase.com/downloads/gateway | sh   # -> ./grafbase-gateway
./grafbase-gateway --config grafbase.toml --schema /tmp/federated.graphql \
  --listen-address 127.0.0.1:5097

# 4. query twice, then inspect Redis
curl -s localhost:5097/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { name } } } }"}'
docker exec valkey-test valkey-cli DBSIZE          # -> 0 in this topology
docker exec valkey-test valkey-cli INFO stats | grep keyspace
```

> Note: the current docker-compose runs `grafbase dev`, which ignores caching.
> Activating caching in docker would mean switching that service to the
> production `grafbase-gateway` (config + pre-composed federated schema) — a
> larger change, and per the findings above it would still be a no-op for this
> single-subgraph/REST-extension graph until the topology changes.
