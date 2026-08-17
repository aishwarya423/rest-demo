# Demo script — Valkey / Redis caching for the Grafbase federation runtime

Presenter runbook for demoing the story
[`JIRAStory.md`](./JIRAStory.md) /
[Confluence page](./CONFLUENCE-Valkey-Redis-Caching.md). Two versions:
**Short (~5 min)** and **Medium (~12–15 min)**.

Legend: **[SAY]** = talking point · **[RUN]** = command to run live ·
**[POINT]** = what to highlight on screen.

---

## Pre-flight checklist (do this BEFORE the meeting)

Avoids slow builds / port clashes during the live demo.

```bash
# 1. from the repo root
cd rest-demo

# 2. pre-build images + pre-pull both cache images (so nothing downloads live)
docker compose -f docker-compose.gateway.yml build
docker pull redis:7-alpine
docker pull valkey/valkey:8-alpine

# 3. make sure the ports are free (kill leftover HOST mock servers if any)
for p in 3001 3002 3003 3009 6379 5060; do
  pid=$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill "$pid"
done

# 4. (short demo only) pre-start the Redis stack so queries are instant
docker compose -f docker-compose.gateway.yml up -d
docker compose -f docker-compose.gateway.yml ps       # all healthy?
```

Have open in tabs: the [Confluence page](./CONFLUENCE-Valkey-Redis-Caching.md)
(for the architecture diagram) and a terminal at the repo root.

Reusable query (copy to clipboard):

```bash
Q='{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { id name currency } } } }"}'
```

---

# SHORT DEMO (~5 min)

**Goal of the 5 minutes:** show caching works, show the cached keys, and show
Valkey is a drop-in. Stack is already up on Redis from pre-flight.

### 1. The pitch (30s)

> **[SAY]** "This story adds Redis — or Valkey — caching to our local Grafbase
> GraphQL federation. I'll show a query being cached, the cached entries in the
> keyspace, and that Valkey is a one-line drop-in for Redis. Everything runs in
> Docker."

### 2. A query resolves across two subgraphs (45s)

**[RUN]**
```bash
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" | jq .
```
> **[SAY]** "`account` comes from our REST-backed subgraph; each `fund` is
> resolved from a **separate real GraphQL subgraph** — that cross-subgraph hop is
> what we cache."
> **[POINT]** the `fund` objects in the response.

### 3. Caching engaged — look at the keyspace (90s)

**[RUN]**
```bash
docker compose -f docker-compose.gateway.yml exec redis redis-cli FLUSHALL
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-entitycache*'
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-opcache*'
```
> **[SAY]** "After one query: **one entity-cache key per Fund** plus an
> operation-cache key (the query plan)."
> **[POINT]** the 3 `insurance-entitycache-*` keys + 1 `insurance-opcache*` key.

### 4. Prove it's a real cache hit — TTL keeps counting down (60s)

**[RUN]**
```bash
K=$(docker compose -f docker-compose.gateway.yml exec -T redis redis-cli --scan --pattern 'insurance-entitycache*' | head -1 | tr -d '\r')
docker compose -f docker-compose.gateway.yml exec redis redis-cli TTL "$K"   # e.g. 118
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null   # repeat query
docker compose -f docker-compose.gateway.yml exec redis redis-cli TTL "$K"   # e.g. 114 — NOT reset
```
> **[SAY]** "The TTL keeps **counting down** on the repeat query — it wasn't
> rewritten. That means the second query was **served from cache**, not re-fetched."

### 5. Valkey — one env var, same result (60s)

**[RUN]**
```bash
docker compose -f docker-compose.gateway.yml down -v
CACHE_IMAGE=valkey/valkey:8-alpine CACHE_CLI=valkey-cli \
  docker compose -f docker-compose.gateway.yml up -d
sleep 12
docker compose -f docker-compose.gateway.yml exec redis valkey-cli FLUSHALL
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null
docker compose -f docker-compose.gateway.yml exec redis valkey-cli --scan --pattern 'insurance-entitycache*'
docker compose -f docker-compose.gateway.yml exec redis valkey-cli INFO server | grep -i valkey_version
```
> **[SAY]** "Same stack, only the image + CLI changed — **the gateway config is
> identical**. Same cache keys, now on Valkey. It's a genuine drop-in."

### 6. Close (15s)

> **[SAY]** "So: operation and entity caching, verified on both Redis and Valkey,
> fully in Docker. Details and the comparison are on the Confluence page."

**[RUN]** (cleanup) `docker compose -f docker-compose.gateway.yml down -v`

---

# MEDIUM DEMO (~12–15 min)

Adds the *why* (federation topology + the entity-caching insight), persistence,
the tooling, and the Redis-vs-Valkey talking points.

### 1. Context & problem (2 min) — slide/Confluence

> **[SAY]** "Goal of the story: validate Redis/Valkey caching for our local
> Grafbase federation POC — prove it's feasible, see the behaviour, and settle
> Redis vs Valkey."
> **[POINT]** the **Architecture / Flow** diagram on the Confluence page.
> **[SAY]** "Two subgraphs: an **`insurance`** subgraph (accounts/policies via a
> REST extension) and a **`funds`** subgraph that owns the `Fund` entity. The key
> insight — and the tricky part — is coming up."

### 2. The key insight (2 min) — talk track

> **[SAY]** "Grafbase **entity caching** caches the responses the gateway fetches
> from a subgraph when it resolves an entity by key. Our REST-extension subgraphs
> resolve **in-process** — there's no subgraph fetch to cache, so entity caching
> did nothing. The fix: make `Fund` a **real GraphQL subgraph** over HTTP, so the
> gateway makes a real `_entities` fetch we can cache. **Operation caching**
> (query plans) worked all along; **entity caching** needed this topology."

### 3. Bring the stack up (1 min)

**[RUN]**
```bash
docker compose -f docker-compose.gateway.yml up --build -d
docker compose -f docker-compose.gateway.yml ps
```
> **[POINT]** the services: mocks, **`funds-subgraph`** (the real GraphQL
> subgraph), **`redis`**, and **`grafbase-gateway`** (the *production* gateway —
> `grafbase dev` ignores caching).

### 4. Query + operation cache + entity cache (3 min)

**[RUN]**
```bash
docker compose -f docker-compose.gateway.yml exec redis redis-cli FLUSHALL
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" | jq '.data.account.fundHoldings[].fund'
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-*'
```
> **[SAY]** "One query → the query plan is cached (`opcache`) and each Fund is
> cached (`entitycache`)."
> **[POINT]** the two key families.

**[RUN]** — cache-hit via TTL countdown (same as short demo step 4):
```bash
K=$(docker compose -f docker-compose.gateway.yml exec -T redis redis-cli --scan --pattern 'insurance-entitycache*' | head -1 | tr -d '\r')
docker compose -f docker-compose.gateway.yml exec redis redis-cli TTL "$K"
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null
docker compose -f docker-compose.gateway.yml exec redis redis-cli TTL "$K"   # lower, not reset => cache HIT
```

### 5. Persistence across restart (2 min)

> **[SAY]** "The cache is Redis-backed with a volume, so it survives restarts."

**[RUN]**
```bash
docker compose -f docker-compose.gateway.yml exec redis redis-cli DBSIZE
docker compose -f docker-compose.gateway.yml restart redis grafbase-gateway
sleep 8
docker compose -f docker-compose.gateway.yml exec redis redis-cli DBSIZE   # still > 0
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-entitycache*'
```
> **[POINT]** `DBSIZE` unchanged, entity keys still present — **no query re-fired**.

### 6. Redis → Valkey, drop-in (2 min)

**[RUN]**
```bash
docker compose -f docker-compose.gateway.yml down -v
CACHE_IMAGE=valkey/valkey:8-alpine CACHE_CLI=valkey-cli \
  docker compose -f docker-compose.gateway.yml up -d
sleep 12
docker compose -f docker-compose.gateway.yml exec redis valkey-cli FLUSHALL
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null
docker compose -f docker-compose.gateway.yml exec redis valkey-cli --scan --pattern 'insurance-entitycache*'
docker compose -f docker-compose.gateway.yml exec redis valkey-cli INFO server | grep -iE 'server_name|valkey_version'
```
> **[SAY]** "Only the image and CLI changed — the `redis://` URL and all gateway
> config are identical. Valkey is a BSD-licensed, Linux-Foundation fork of Redis;
> for us it's a drop-in. Same cache keys, now on Valkey."
> **[POINT]** `server_name:valkey`, and identical entity keys.

### 7. The tooling (1–2 min)

> **[SAY]** "For repeatable testing we have one-command scripts that run, verify,
> and write a report."

**[RUN]** (pick one)
```bash
scripts/run-valkey-cache-test.sh     # run + assert + writes valkey-cache-test-report.txt
# or inspect the keyspace at any time (auto-detects Redis/Valkey):
scripts/dump-redis-cache.sh
```
> **[POINT]** the `RESULT: PASS`, and the report file / dump summary.

### 8. Wrap: caveats + what's next (1 min)

> **[SAY]** "Two things to know: caching only runs under the **production
> gateway** (not `grafbase dev`), and entity caching needs a **real** GraphQL
> subgraph — a virtual REST-extension subgraph isn't entity-cached. Next steps:
> fold this into the default compose, add cache metrics, and benchmark Redis vs
> Valkey. Full write-up and the comparison are on Confluence."

**[RUN]** (cleanup) `docker compose -f docker-compose.gateway.yml down -v`

---

## If something goes wrong (quick recovery)

| Symptom | Fix |
|---|---|
| `port ... already in use` | leftover host mocks — run the pre-flight port-free loop |
| gateway not answering yet | give it ~10–15s to compose + start; `... logs grafbase-gateway` |
| no keys after a query | confirm you ran the **cross-subgraph** query (`fund { ... }` selected) |
| `redis-cli: not found` (Valkey) | use `valkey-cli` in `exec` commands |
| totally stuck | `docker compose -f docker-compose.gateway.yml down -v` and start over |

## One-liner fallback (if live commands wobble)

Just run the scripted test and narrate its output:

```bash
scripts/test-entity-caching.sh both     # runs Redis then Valkey, prints PASS/FAIL
```
