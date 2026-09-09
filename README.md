# REST extension example

This example demonstrates how to use the [REST extension](https://grafbase.com/extensions/rest) to integrate the [REST Countries API](https://restcountries.com/) declaratively with the Grafbase Gateway.

## Quickstart

- Start the Grafbase development server: `npx grafbase dev`
- Explore the GraphQL API: `http://localhost:5000`


https://github.com/grafbase/grafbase/tree/main/examples/rest-extension


Useful cmds
add this line in schema . graphql

@restEndpoint(name: "countries", baseURL: "http://localhost:3004")

npx grafbase dev --port 5050

docker compose up --build -d
main----
docker compose down && docker compose up --build -d && sleep 5 && docker compose ps

docker compose build --no-cache grafbase

docker useful cmds

docker compose down --remove-orphans && lsof -iTCP:3001 -sTCP:LISTEN | grep -v COMMAND | awk '{print $2}' | xargs kill -9 2>/dev/null || true && sleep 2 && docker compose up --build -d && sleep 5 && docker compose ps

---

## REST caching with readable keys (forked `rest` extension)

The gateway's entity cache is TTL-only and its keys are opaque hashes, so nothing
outside the gateway can invalidate one fund. [`extensions/rest-cached/`](extensions/rest-cached/)
is a fork of the official `rest` extension that caches REST responses in
Valkey/Redis under the URL instead:

```
rest:funds:/funds/fund-green-bond
```

so a system that updates that fund invalidates it with `DEL` — no purge service,
no JavaScript. Config-only per new REST API (TTLs and tag rules live in
[`grafbase.cached.toml`](grafbase.cached.toml)).

```bash
npm run cached:up          # stack on http://localhost:5065/graphql
npm run cached:monitor     # watch the cache live
npm run cached:test        # clean-slate build + 17 assertions + report
```

Usage guide: [`Docs/EXTENSION-CACHE.md`](Docs/EXTENSION-CACHE.md) · design record:
[`Docs/rest-cache-fork/CONFLUENCE-REST-Cache-Fork.md`](Docs/rest-cache-fork/CONFLUENCE-REST-Cache-Fork.md) ·
demo runbook: [`Docs/rest-cache-fork/DEMO-SCRIPT.md`](Docs/rest-cache-fork/DEMO-SCRIPT.md).
Run it *instead of* the stack below — they share ports 3001-3003 and 6379.

---

## Caching (Redis)

This project uses **Redis** as the cache backend for the Grafbase gateway. Full
setup, testing, and verification steps live in [`Docs/CACHING.md`](Docs/CACHING.md);
this is the quick reference.

### What's configured

- **Redis service** — `redis:7-alpine` in [`docker-compose.yml`](docker-compose.yml),
  `restart: unless-stopped`, health-checked, with a `redis-data` volume so cached
  keys **persist across `docker compose down/up`**.
- **Gateway cache config** — in the root [`grafbase.toml`](grafbase.toml):
  - `[operation_caching]` (Redis-backed) — caches the **query plan** per unique
    operation. **Verified working** under the production gateway.
  - `[entity_caching]` (Redis-backed, `storage = "redis"`) — caches **subgraph
    fetch responses**. Correctly configured but a **no-op in this topology** (see
    below).

### Env-driven Redis endpoint

The Redis endpoint comes from the `REDIS_URL` env var. **Note:** the gateway
(0.53.5) does *not* interpolate `{{ env.* }}` in the caching `redis.url` field, so
`grafbase.toml` holds a concrete default (`redis://redis:6379`) and `REDIS_URL` is
substituted into it at startup by our tooling:

| Environment | Mechanism |
|---|---|
| docker (`Dockerfile.gateway`) | `docker/gateway-entrypoint.sh` substitutes `$REDIS_URL` (defaults to `redis://redis:6379`) |
| host-side testing | the `sed` step in `Docs/CACHING.md` rewrites `redis://redis:6379` → `redis://localhost:6379` |

Use a `rediss://` URL (plus a `[*.redis.tls]` table) for TLS.

### Important caveats

- **Caching only runs under the production gateway** (`grafbase-gateway`).
  The default docker-compose `grafbase` service runs `grafbase dev`, which
  **ignores all caching** — so `docker compose up` alone caches nothing. Why:
  [`Docs/DEV-VS-GATEWAY-CACHING.md`](Docs/DEV-VS-GATEWAY-CACHING.md).
- **Entity caching is a no-op here.** This graph is a single virtual subgraph
  resolved by the REST WASM extension, so there is no gateway→subgraph fetch to
  cache. Why: [`Docs/ENTITY-CACHING-WHY-NOOP.md`](Docs/ENTITY-CACHING-WHY-NOOP.md).

### Verify it the Docker way (recommended)

Use the production-gateway compose file — this runs `grafbase-gateway` (not
`grafbase dev`), so caching actually engages. **Verified end-to-end.**

```bash
docker compose -f docker-compose.gateway.yml up --build -d
# GraphQL: http://localhost:5060/graphql

# fire a query, then watch the operation-plan key appear in Redis
curl -s localhost:5060/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName } }"}'
docker compose -f docker-compose.gateway.yml exec redis \
  redis-cli --scan --pattern 'insurance-opcache*'
# insurance-opcacheop.blake3.<hash>   <- one key per distinct operation
```

Cache **persistence** survives restarts (verified): the key remains after
`docker compose -f docker-compose.gateway.yml restart redis grafbase-gateway`
thanks to the `redis-data` volume.