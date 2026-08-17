# `funds` subgraph — enables entity caching for the insurance graph

This is a **real GraphQL federation subgraph** (GraphQL Yoga + `@apollo/subgraph`)
that owns the `Fund` entity. Splitting `Fund` out of the single `insurance`
subgraph is what makes **entity caching actually work**: the gateway now resolves
`Fund` via a real `_entities` fetch to this subgraph, and those responses are
cached in Redis.

- `server.js` — the subgraph (a thin facade over the Funds REST API at :3002)
- `funds.graphql` — the subgraph SDL (`grafbase compose` reads this via `schema_path`)
- Wired in the root `grafbase.toml` as `[subgraphs.funds]` (`url = http://localhost:3009/graphql`)

## Topology

```
account(id) ─ fundHoldings.fund ─┐   policies.linkedFunds ─┐
                                 │                          │   only the KEY here
   [insurance subgraph — accounts + policies via REST extension; Fund is a stub]
                                 │                          │
                                 ▼  gateway _entities fetch (cached in Redis)
                     [funds subgraph — THIS server ─► Funds REST API :3002]
```

## Install (once)

```bash
cd funds-subgraph && npm install
```

## Run the whole thing (entity caching works only under the PRODUCTION gateway)

`grafbase dev` ignores caching — use the `grafbase-gateway` binary. From the repo root:

```bash
# 0. gateway binary (if you don't have ./grafbase-gateway)
curl -fsSL https://grafbase.com/downloads/gateway | sh

# 1. Redis
docker rm -f redis-cache 2>/dev/null; docker run -d --name redis-cache -p 6379:6379 redis:7-alpine

# 2. mocks + this subgraph
export ACCOUNTS_API_KEY=accounts-local-key POLICIES_API_KEY=policies-local-key FUNDS_API_KEY=funds-local-key
(cd mock-rest-apis/accounts && node server.js &)
(cd mock-rest-apis/policies && node server.js &)
(cd mock-rest-apis/funds && node server.js &)
node funds-subgraph/server.js &          # :3009

# 3. host config (gateway does NOT interpolate {{ env.* }} in redis.url) + compose
sed 's|redis://redis:6379|redis://localhost:6379|g' grafbase.toml > .grafbase.local.toml
grafbase compose -c .grafbase.local.toml > /tmp/federated.graphql

# 4. production gateway
./grafbase-gateway --config .grafbase.local.toml --schema /tmp/federated.graphql \
                   --listen-address 127.0.0.1:5100
```

## Prove entity caching

```bash
docker exec redis-cache redis-cli FLUSHALL
Q='{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name currency } } } }"}'
curl -s localhost:5100/graphql -H 'content-type: application/json' -d "$Q" >/dev/null

docker exec redis-cache redis-cli --scan --pattern 'insurance-entitycache*'   # one key per Fund
docker exec redis-cache redis-cli TTL "$(docker exec redis-cache redis-cli --scan --pattern 'insurance-entitycache*' | head -1)"
```

**Verified:** one `insurance-entitycache*` key per Fund, repeat queries served from
cache (no re-fetch), TTL = 120s (the `[subgraphs.funds.entity_caching]` override),
keys survive a gateway restart (shared Redis).

## Inspect the Redis cache

Find your Redis container name first (`docker ps` — e.g. `redis-cache`, or
`rest-demo-redis-1` for docker-compose), then substitute it below.

### Quick peek (inline)

```bash
# list every cached key
docker exec redis-cache redis-cli --scan --pattern '*'

# only entity-cache keys / only operation-cache keys
docker exec redis-cache redis-cli --scan --pattern 'insurance-entitycache*'
docker exec redis-cache redis-cli --scan --pattern 'insurance-opcache*'

# one key's TTL + value (values are serialized/compressed blobs)
docker exec redis-cache redis-cli TTL 'insurance-entitycache-<hash>'
docker exec redis-cache redis-cli --no-raw GET 'insurance-entitycache-<hash>'
```

If you have `redis-cli` installed on the host (port 6379 is published), drop the
`docker exec redis-cache` prefix and run `redis-cli ...` directly.

### Dump the whole cache to a file

[`../scripts/dump-redis-cache.sh`](../scripts/dump-redis-cache.sh) writes every
matching key with **KEY · TYPE · TTL · VALUE** plus a count-by-prefix summary.

```bash
# host has redis-cli (port 6379 published):
scripts/dump-redis-cache.sh

# no host redis-cli — run inside the container instead:
REDIS_CONTAINER=redis-cache scripts/dump-redis-cache.sh

# only entity-cache keys, custom output file:
scripts/dump-redis-cache.sh 'insurance-entitycache*' entity-keys.txt
```

Defaults: pattern `*`, output `redis-cache-dump-<timestamp>.txt` in the current
dir. Connection is `127.0.0.1:6379` unless you set `REDIS_HOST` / `REDIS_PORT` or
`REDIS_CONTAINER`. The readable signal is the **key names, TYPE and TTL** — the
cached values are serialized blobs.

## Caveats

- **Production gateway only.** `grafbase dev` (and thus `npm start` /
  `docker compose up` today) ignore caching. They will also try to reach this
  subgraph at `localhost:3009`; when running the gateway *inside* Docker you must
  run this server as a service and change the URL to its service name.
- **`schema.graphql` was hand-edited** for the Fund split; `schema-gen` was not
  updated, so regenerating overwrites it (see the banner in `schema.graphql`).
- **Keep `funds.graphql`, `server.js`, and the Funds REST fields in sync.**
