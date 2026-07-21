# Redis Caching — config + testing guide

## TL;DR

- Caching config lives in the **root [`grafbase.toml`](../grafbase.toml)** (the file
  the running gateway loads). Not in `schema-gen/validate/grafbase.toml` — that
  one only drives `grafbase compose`.
- The cache backend is **Redis** (`redis:7-alpine`, the `redis` service in
  [`docker-compose.yml`](../docker-compose.yml)).
- **Operation caching → Redis: VERIFIED WORKING.** Writes cached query plans to
  Redis; you can watch keys appear (guide below).
- **Entity caching → Redis: a no-op in this graph** (kept as a documented
  template). It caches *subgraph fetches*, and this graph's single `insurance`
  subgraph is resolved by the REST WASM extension — nothing to cache.
- **Caching only runs under the production gateway** (`grafbase-gateway`).
  `grafbase dev` ignores all caching, so the testing guide uses the production
  gateway binary.

## What each cache does (be precise about this)

| Cache | What it stores | Reduces REST calls? | Redis-backed here? |
|---|---|---|---|
| `operation_caching` | the **query plan** for each operation document | ❌ no (plans, not data) | ✅ yes — verified |
| `entity_caching` | downstream **subgraph fetch** responses | would, but… | ❌ no cacheable fetch in this topology |

So operation caching speeds up parse+validate+plan for repeated identical
operations; it does **not** cache response data and does **not** cut load on the
mock REST services. If your goal is fewer REST round-trips, cache at the REST
layer (a Redis/proxy cache in front of the mock services) — that's independent
of Grafbase.

## The config (root `grafbase.toml`)

```toml
# Operation caching — Redis-backed (presence of [operation_caching.redis]
# selects the Redis backend; no `storage` key needed).
[operation_caching]
enabled = true
limit = 1000

[operation_caching.redis]
url = "redis://redis:6379"          # `redis` = compose service; localhost for host tests
key_prefix = "insurance-opcache"

# Entity caching — correct format, but a no-op in this REST-extension graph.
# storage MUST be "redis" (defaults to "memory") to use the redis table.
[entity_caching]
enabled = true
ttl = "60s"
storage = "redis"

[entity_caching.redis]
url = "redis://redis:6379"
key_prefix = "insurance-entitycache"
```

`docker-compose.yml` runs a `redis:7-alpine` service (health-checked, with a
`redis-data` volume) that the gateway `depends_on`.

---

## Testing guide — see operation caching hit Redis

> These exact steps were run and verified (gateway 0.53.5). Because the
> docker-compose gateway runs `grafbase dev` (which ignores caching), the guide
> runs the **production gateway** locally against the same config.

### 1. Start Redis

```bash
docker run -d --name redis-test -p 6379:6379 redis:7-alpine
docker exec redis-test redis-cli ping        # -> PONG
```

### 2. Start the mock REST services

```bash
npm run mock-apis                            # accounts:3001 funds:3002 policies:3003
```

### 3. Make a host-runnable copy of the config

The production gateway needs a **pre-composed federated schema** and, for host
testing, `localhost` URLs instead of the docker service names.

```bash
# localhost schema (rewrite the docker baseURLs baked into schema.graphql)
sed -e 's|http://accounts-rest:3001|http://localhost:3001|' \
    -e 's|http://policies-rest:3003|http://localhost:3003|' \
    -e 's|http://funds-rest:3002|http://localhost:3002|' \
    schema.graphql > /tmp/schema.localhost.graphql

# config copy: point Redis + schema_path at localhost / the file above
sed -e 's|redis://redis:6379|redis://localhost:6379|g' \
    -e 's|schema_path = "schema.graphql"|schema_path = "/tmp/schema.localhost.graphql"|' \
    grafbase.toml > /tmp/grafbase.local.toml

# compose the federated schema the production gateway consumes
export ACCOUNTS_API_KEY=accounts-local-key POLICIES_API_KEY=policies-local-key FUNDS_API_KEY=funds-local-key
npx grafbase compose -c /tmp/grafbase.local.toml > /tmp/federated.graphql
```

### 4. Install and run the production gateway

```bash
curl -fsSL https://grafbase.com/downloads/gateway | sh     # -> ./grafbase-gateway
./grafbase-gateway --config /tmp/grafbase.local.toml \
                   --schema /tmp/federated.graphql \
                   --listen-address 127.0.0.1:5097
```

### 5. Watch the cache fill up

In another terminal:

```bash
# baseline
docker exec redis-test redis-cli FLUSHALL
docker exec redis-test redis-cli DBSIZE                     # -> 0

# fire a query
curl -s localhost:5097/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { name } } } }"}'

# the operation plan is now cached in Redis
docker exec redis-test redis-cli DBSIZE                     # -> grows
docker exec redis-test redis-cli --scan --pattern 'insurance-opcache*'
# insurance-opcacheop.blake3.<hash>   <- one key per distinct operation document
```

**Verified result:** two distinct queries (run twice each) produced
`insurance-opcache*` keys in Redis, while `insurance-entitycache*` stayed empty —
confirming operation caching is Redis-backed and entity caching is a no-op here.

### Live view while querying

```bash
docker exec redis-test redis-cli MONITOR       # then run queries in another shell
# you'll see GET/SET against insurance-opcache* keys
```

### 6. Prove the cache is being reused

Different Redis instances share the plan cache — that's the point of Redis over
in-memory. To see reuse on one instance, stop and restart the gateway pointing
at the same Redis: the plans from the previous run are already present (`DBSIZE`
> 0 before you send any query), so the new process warms instantly instead of
re-planning.

### Cleanup

```bash
docker rm -f redis-test
# stop the mocks (Ctrl-C the `npm run mock-apis` terminal)
rm -f ./grafbase-gateway
```

---

## Running caching in docker-compose (optional)

The `grafbase` service in `docker-compose.yml` currently runs `grafbase dev`,
which **ignores caching**. To get caching in docker you'd swap that service to
the production gateway: build/download `grafbase-gateway`, add a step that runs
`grafbase compose` to produce the federated schema, and change the command to
`grafbase-gateway --config grafbase.toml --schema <federated>.graphql`. The
`redis` service is already in place for it. (Left as a follow-up — the current
compose is unchanged apart from swapping valkey → redis.)

## Why entity caching does nothing here (recap)

Entity caching stores the responses the gateway fetches from **downstream
subgraphs** when resolving `@key` entities across subgraph boundaries. This
project is a **single** virtual subgraph (`insurance`); its fields — including
the `Fund @key` lookup fanned out by `@derive` — are resolved by the REST WASM
extension, not by an HTTP subgraph fetch. With no subgraph-fetch response to
store, nothing is written to Redis, even under the production gateway. Verified:
`grafbase-gateway` started clean against a **dead** Redis port and served
normally, i.e. it never even opened a Redis connection for entity caching in
this topology.
