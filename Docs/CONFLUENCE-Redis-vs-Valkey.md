# Redis vs Valkey — cache backend comparison (Grafbase federation caching)

> **Jira Story:** `<PROJECT-KEY>` — validate Valkey/Redis caching for the local federation runtime
> **Status:** Both verified working (Redis + Valkey), entity + operation caching
> **Owner:** Aishwarya
> **Repository:** `rest-demo` — branch `feature/entity-caching`
> **Last updated:** 2026-08-17

> 📎 Related pages: [caching setup & testing](./CACHING.md) ·
> [entity-caching technical details](./Caching-Technical-Details.md) ·
> [funds subgraph / entity caching](../funds-subgraph/README.md)

---

## TL;DR

- **Both Redis and Valkey work as the cache backend — with zero gateway config
  change.** Valkey is a **drop-in fork of Redis** (same RESP protocol, same port
  6379, same `redis://` URL scheme).
- **Verified in Docker** on this project: with each backend, a cross-subgraph
  query produced **3 `insurance-entitycache-*` keys** (one per Fund) + an
  operation-cache key, TTL 120s.
- **Switching is a one-line env change** — no file edits — thanks to
  `CACHE_IMAGE` / `CACHE_CLI` in `docker-compose.gateway.yml`:
  ```bash
  # Redis (default)
  docker compose -f docker-compose.gateway.yml up --build -d
  # Valkey
  CACHE_IMAGE=valkey/valkey:8-alpine CACHE_CLI=valkey-cli \
    docker compose -f docker-compose.gateway.yml up --build -d
  ```
- **The only real difference in wiring:** the Valkey image ships `valkey-cli`
  (not `redis-cli`) — so cache-inspection commands use `valkey-cli`. Everything
  the *gateway* touches is identical.

## What is Valkey, and why does it exist?

Valkey is an **open-source fork of Redis 7.2.4**, started in **March 2024** by
the community (under the **Linux Foundation**, backed by AWS, Google Cloud,
Oracle and others) after Redis Inc. moved Redis off its permissive BSD license to
a **source-available** license (RSALv2 / SSPLv1). Valkey continues Redis's
codebase under the permissive **BSD-3-Clause** license, so it remains true OSI
open source.

Because it forked from Redis 7.2, Valkey is **wire-, command-, and data-file
compatible** with Redis of that era — a genuine drop-in for most workloads,
including ours.

## Comparison

| Aspect | **Redis** (`redis:7-alpine`) | **Valkey** (`valkey/valkey:8-alpine`) |
|---|---|---|
| Origin | Original project (Redis Inc.) | Fork of Redis 7.2.4 (Mar 2024) |
| License | Source-available (RSALv2 / SSPLv1); Redis 8+ adds AGPLv3 | **BSD-3-Clause** (permissive, OSI open source) |
| Governance | Redis Inc. (commercial) | **Linux Foundation** (community; AWS, GCP, Oracle…) |
| Wire protocol | RESP2 / RESP3 | Same (RESP2 / RESP3) — compatible |
| Commands | Redis command set | Same command set (7.2 baseline + additions) |
| Data files | RDB / AOF | Compatible with Redis 7.2 RDB/AOF |
| URL scheme | `redis://` / `rediss://` | **Same `redis://`** (no `valkey://` scheme) |
| Default port | 6379 | 6379 |
| CLI / server bins | `redis-cli`, `redis-server` | `valkey-cli`, `valkey-server` (CLIs are cross-compatible) |
| Version reported | `redis_version` | `valkey_version` **and** `redis_version:7.2.x` (for compat) |
| Managed cloud | Widely available | Widely available (often cheaper, e.g. ElastiCache for Valkey) |

**Practical takeaway:** for this POC they are interchangeable. The choice is
driven by **licensing/governance and cost**, not by whether caching works.

## Compatibility with this project

- **Gateway config is identical.** `grafbase.toml` uses `url = "redis://…"` —
  Valkey speaks the same protocol, so **nothing in the gateway, entrypoint, or
  schema changes**. The gateway cannot even tell the difference.
- **Same cache keys.** Both backends produced byte-identical key names
  (`insurance-entitycache-<hash>`, `insurance-opcacheop.blake3.<hash>`) — the key
  scheme is computed by the gateway, not the backend.
- **Same persistence model.** Both use `/data` with RDB/AOF; the `redis-data`
  volume works for either.

## How to switch — the env-variable way (verified)

The cache service in `docker-compose.gateway.yml` is env-driven:

```yaml
  redis:
    image: ${CACHE_IMAGE:-redis:7-alpine}
    healthcheck:
      test: ["CMD", "${CACHE_CLI:-redis-cli}", "ping"]
```

### Option A — inline env vars (one-off)

```bash
# Redis (default — no env needed)
docker compose -f docker-compose.gateway.yml up --build -d

# Valkey
CACHE_IMAGE=valkey/valkey:8-alpine CACHE_CLI=valkey-cli \
  docker compose -f docker-compose.gateway.yml up --build -d
```

### Option B — a `.env` file (persistent choice)

Docker Compose auto-loads a `.env` file next to the compose file. To make Valkey
the default, create `.env`:

```dotenv
CACHE_IMAGE=valkey/valkey:8-alpine
CACHE_CLI=valkey-cli
```

Then just `docker compose -f docker-compose.gateway.yml up --build -d`. Delete
the file (or the two lines) to go back to Redis.

### Inspect the cache (CLI differs)

```bash
# Redis
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-entitycache*'
# Valkey
docker compose -f docker-compose.gateway.yml exec redis valkey-cli --scan --pattern 'insurance-entitycache*'

# dump the cache to a file — auto-detects the container AND redis-cli/valkey-cli:
scripts/dump-redis-cache.sh
```

## Where all to change (full checklist)

| Place | Redis → Valkey change | Needed? |
|---|---|---|
| `docker-compose.gateway.yml` cache image | `CACHE_IMAGE=valkey/valkey:8-alpine` (env) | ✅ via env |
| `docker-compose.gateway.yml` healthcheck CLI | `CACHE_CLI=valkey-cli` (env) | ✅ via env |
| Cache-inspection commands / dump script | `redis-cli` → `valkey-cli` (`REDIS_CLI=valkey-cli`) | ✅ |
| **`grafbase.toml` cache config** (`redis.url`) | **none** — keep `redis://` | ❌ no change |
| Gateway image / entrypoint / schema | **none** | ❌ no change |
| Host standalone testing (funds-subgraph/README) | `docker run redis:7-alpine` → `docker run valkey/valkey:8-alpine`; `redis-cli` → `valkey-cli` | ✅ if used |

So the gateway/application layer needs **zero** changes; only the container image,
the healthcheck CLI, and the inspection CLI differ — all env-switchable.

## Verification results (Docker, gateway 0.53.5)

Reproduce with one command (brings up the stack, queries, asserts, tears down):

```bash
scripts/test-entity-caching.sh both     # runs redis then valkey; prints PASS/FAIL
```

Same query on each backend:
`{ account(id:"acct-1001"){ fundHoldings { fund { id name currency } } } }`

| | Redis (`redis:7-alpine`) | Valkey (`valkey/valkey:8-alpine`) |
|---|---|---|
| Backend version | `redis_version:7.4.10` | `valkey_version:8.1.9` (`redis_version:7.2.4`) |
| Healthcheck | `redis-cli ping` → healthy | `valkey-cli ping` → healthy |
| `insurance-entitycache-*` keys | **3** ✅ | **3** ✅ |
| `insurance-opcache*` key | **1** ✅ | **1** ✅ |
| Entity key TTL | ~120s ✅ | ~120s ✅ |
| Automated test | **PASS** ✅ | **PASS** ✅ |
| Gateway config changes | none | none |

## Recommendation

Both are production-viable and interchangeable here. Choose on **licensing,
governance, and cost**:

- **Valkey** if you want a permissive **BSD-3 / OSI open-source** cache under
  neutral (Linux Foundation) governance, or cheaper managed offerings — with no
  loss of Redis compatibility.
- **Redis** if you're standardized on Redis Inc. tooling/support or need a
  feature only in newer Redis (e.g. bundled modules) that Valkey hasn't matched.

For this federation caching POC, **Valkey is a safe drop-in** and the env switch
makes A/B testing trivial.

## References

- Valkey project — https://valkey.io/
- Valkey ↔ Redis migration — https://valkey.io/topics/migration/
- Valkey Docker image — https://hub.docker.com/r/valkey/valkey/
- Grafbase entity caching — https://grafbase.com/docs/gateway/performance/entity-caching
- This repo: `docker-compose.gateway.yml`, `Docs/CACHING.md`, `funds-subgraph/README.md`
