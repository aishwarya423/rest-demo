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
mock REST services. If your goal is fewer REST round-trips — or invalidation that
is not just a TTL — cache at the REST layer. That is what
[`EXTENSION-CACHE.md`](EXTENSION-CACHE.md) does: a fork of the `rest` extension
caches each REST response in Valkey under its URL
(`rest:funds:/funds/fund-green-bond`), so an external writer can invalidate one
fund with a plain `DEL` (`npm run cached:up`).

## The config (root `grafbase.toml`)

```toml
# Operation caching — Redis-backed (presence of [operation_caching.redis]
# selects the Redis backend; no `storage` key needed).
[operation_caching]
enabled = true
limit = 1000

[operation_caching.redis]
url = "redis://redis:6379"          # concrete default; env-overridable (see below)
key_prefix = "insurance-opcache"

# Entity caching — correct format, but a no-op in this REST-extension graph.
# storage MUST be "redis" (defaults to "memory") to use the redis table.
[entity_caching]
enabled = true
ttl = "60s"
storage = "redis"

[entity_caching.redis]
url = "redis://redis:6379"          # concrete default; env-overridable (see below)
key_prefix = "insurance-entitycache"
```

**Env-driven endpoint — but not via `{{ env.* }}`.** The gateway (0.53.5) does
**not** interpolate `{{ env.* }}` in the caching `redis.url` field (that
templating only works for the REST-extension config). Verified empirically: a
`{{ env.REDIS_URL }}` value writes **no** keys, while a concrete
`redis://redis:6379` works. So the URL is a concrete default, and the `REDIS_URL`
env var is substituted into it at startup by our tooling:

- **docker (`Dockerfile.gateway`):** `docker/gateway-entrypoint.sh` substitutes
  `$REDIS_URL` (defaults to `redis://redis:6379`, the `redis` compose service).
  Set it on the `grafbase-gateway` service in `docker-compose.gateway.yml`.
- **host testing:** the `sed` step below rewrites `redis://redis:6379` →
  `redis://localhost:6379` before the gateway runs.

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

# config copy: point Redis + schema_path at localhost / the file above.
# (The gateway does NOT interpolate {{ env.* }} in redis.url, so rewrite the
#  literal redis://redis:6379 -> localhost here.)
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

## Running caching in Docker — `docker-compose.gateway.yml` (verified, all-Docker)

The default `docker-compose.yml` runs `grafbase dev`, which **ignores caching**.
A dedicated compose file runs the **production gateway** plus the `funds`
subgraph so **both operation AND entity caching engage** — no host tools needed:

```bash
# 1. run the whole stack (mocks + funds subgraph + redis + production gateway)
docker compose -f docker-compose.gateway.yml up --build -d
docker compose -f docker-compose.gateway.yml ps        # wait until healthy
#   GraphQL : http://localhost:5060/graphql

# 2. clear the cache
docker compose -f docker-compose.gateway.yml exec redis redis-cli FLUSHALL

# 3. query across the subgraph boundary (account -> fund lives in `funds`)
curl -s localhost:5060/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name currency } } } }"}'

# 4. ENTITY cache keys appear (one per Fund) + operation-cache key
docker compose -f docker-compose.gateway.yml exec redis \
  redis-cli --scan --pattern 'insurance-entitycache*'
docker compose -f docker-compose.gateway.yml exec redis \
  redis-cli --scan --pattern 'insurance-opcache*'

# 5. dump the whole cache to a file (auto-detects the container + CLI)
scripts/dump-redis-cache.sh

# persistence: keys survive a restart (redis-data volume)
docker compose -f docker-compose.gateway.yml restart redis grafbase-gateway
docker compose -f docker-compose.gateway.yml exec redis redis-cli DBSIZE   # still > 0
```

How it works (see [`Dockerfile.gateway`](../Dockerfile.gateway),
[`docker/gateway-entrypoint.sh`](../docker/gateway-entrypoint.sh),
[`funds-subgraph/`](../funds-subgraph/)): the `funds-subgraph` service runs the
real GraphQL subgraph; the gateway image installs `grafbase-gateway`, and at
startup the entrypoint rewrites the REST `baseURL`s + the funds subgraph URL to
the compose service names, substitutes `$REDIS_URL`, runs `grafbase compose`, and
execs the production gateway. Run it **instead of** the default
`docker-compose.yml` (they share ports 3001–3003 / 3009 / 6379).

**Verified end-to-end in Docker** (gateway 0.53.5): 3 `insurance-entitycache-*`
keys (one per Fund) + an `insurance-opcache*` key, entity keys carry the 120s
TTL, and keys survive restarting `redis` + `grafbase-gateway`.

### Redis or Valkey (drop-in, env-switchable)

The cache backend is env-driven — Redis by default, or **Valkey** (a drop-in
Redis fork; the gateway config is identical, `redis://` scheme unchanged):

```bash
# Valkey instead of Redis (verified — same keys, same TTL)
CACHE_IMAGE=valkey/valkey:8-alpine CACHE_CLI=valkey-cli \
  docker compose -f docker-compose.gateway.yml up --build -d
# inspect with valkey-cli:
docker compose -f docker-compose.gateway.yml exec redis valkey-cli --scan --pattern 'insurance-entitycache*'
```

Full comparison, change-points, and `.env` option:
[`CONFLUENCE-Redis-vs-Valkey.md`](./CONFLUENCE-Redis-vs-Valkey.md).

## Entity caching now works — via the `funds` subgraph

Entity caching stores the responses the gateway fetches from **downstream
subgraphs** when resolving `@key` entities across a subgraph boundary. The graph
used to be a **single** virtual subgraph (`insurance`) with `Fund` resolved
in-process by the REST extension — so there was no subgraph fetch to cache (the
original rationale is in [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md)).

`Fund` has since been **split into a real GraphQL subgraph** (`funds`, GraphQL
Yoga — see [`funds-subgraph/README.md`](../funds-subgraph/README.md)). The gateway
now resolves `Fund` via a real `_entities` fetch, and those responses **are cached
in Redis** (`insurance-entitycache*`). Note it must be a *spec-compliant*
federation subgraph — a hand-rolled `_entities` responder is not cached.
