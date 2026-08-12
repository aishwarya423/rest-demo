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

The Redis URL is **not hardcoded** — the gateway interpolates `{{ env.REDIS_URL }}`
in `grafbase.toml` at startup. Set `REDIS_URL` per environment:

| Environment | Value |
|---|---|
| docker-compose | `redis://redis:6379` (set on the `grafbase` service; the `redis` compose service name) |
| host-side testing | `export REDIS_URL=redis://localhost:6379` |

Use a `rediss://` URL (plus a `[*.redis.tls]` table) for TLS.

### Important caveats

- **Caching only runs under the production gateway** (`grafbase-gateway`).
  The default docker-compose `grafbase` service runs `grafbase dev`, which
  **ignores all caching** — so `docker compose up` alone caches nothing. Why:
  [`Docs/DEV-VS-GATEWAY-CACHING.md`](Docs/DEV-VS-GATEWAY-CACHING.md).
- **Entity caching is a no-op here.** This graph is a single virtual subgraph
  resolved by the REST WASM extension, so there is no gateway→subgraph fetch to
  cache. Why: [`Docs/ENTITY-CACHING-WHY-NOOP.md`](Docs/ENTITY-CACHING-WHY-NOOP.md).

### Verify it (short version)

Run the production gateway against the same config (see
[`Docs/CACHING.md`](Docs/CACHING.md) for the full walkthrough), fire a query
twice, then watch keys appear in Redis:

```bash
docker exec redis-test redis-cli --scan --pattern 'insurance-opcache*'
# insurance-opcacheop.blake3.<hash>   <- one key per distinct operation
```