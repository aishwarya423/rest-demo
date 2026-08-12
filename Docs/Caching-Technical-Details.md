# Grafbase Caching — Technical Details & Analysis

> Deep-dive companion to the Confluence page
> [**Enabling Valkey/Redis Caching for a Grafbase Local Federation Runtime**](./CONFLUENCE-Caching-Analysis.md).
> All the heavy technical detail lives here so the main page stays readable.
>
> Existing focused docs this file ties together:
> [`CACHING.md`](./CACHING.md) (setup + runnable verification),
> [`DEV-VS-GATEWAY-CACHING.md`](./DEV-VS-GATEWAY-CACHING.md) (why `dev` caches nothing),
> [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md) (why entity caching is inert here).

---

## 1. The two Grafbase caches — what each one actually stores

Grafbase Gateway exposes **two independent caches**. They are frequently
conflated; the whole analysis depends on keeping them separate.

| Cache | Config block | What it stores | Cuts REST round-trips? | State in this project |
|---|---|---|---|---|
| **Operation caching** | `[operation_caching]` | the **query plan** for each unique operation document | ❌ no (plans, not data) | ✅ **verified Redis-backed** |
| **Entity caching** | `[entity_caching]` | **subgraph fetch** responses (gateway → subgraph, keyed by `@key`) | would, but… | ❌ **no-op** in this topology |

**Operation caching** speeds up parse + validate + plan for repeated identical
operations. It does **not** cache response data and does **not** reduce load on
the mock REST services. Verified: two distinct queries (run twice each) produced
`insurance-opcache*` keys in Redis.

**Entity caching** caches the responses the gateway fetches from **downstream
subgraphs** when resolving `@key` entities across a subgraph boundary. Official
definition: *"Grafbase Gateway uses Entity Caching to cache requests to
subgraphs."* — [Entity Caching docs](https://grafbase.com/docs/gateway/performance/entity-caching).

## 2. Why entity caching is a no-op here (topology, not config)

The `[entity_caching]` config is correct. It still writes nothing to Redis
because this graph has **no cacheable subgraph fetch**:

- The project is a **single** virtual subgraph, `insurance`. `accounts`,
  `funds`, and `policies` are **REST endpoints inside it**, declared via the
  REST WASM extension — not separate subgraphs.
- Every field (including the `Fund @key` lookup fanned out by `@derive`/`@is`)
  is resolved by the **in-process REST extension**, i.e. an extension resolver
  call, **not** a gateway→subgraph HTTP fetch.
- Entity caching intercepts gateway→subgraph fetches. With none in this
  topology, there is nothing to store.

Verified: `grafbase-gateway` started clean against a **dead** Redis port and
served normally — it never even opened a Redis connection for entity caching.

Full reasoning + official references: [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md).

## 3. Why caching needs `grafbase-gateway`, not `grafbase dev`

There are **two independent reasons** caching can be inert in this project —
keep them apart:

1. **Wrong binary (applies to *both* caches):** the compose `grafbase` service
   runs `grafbase dev`, which is a **local development environment** and ignores
   the caching config entirely. Caching is a feature of the **production
   `grafbase-gateway` binary**.
2. **Wrong topology (entity caching only):** even under the correct binary,
   entity caching has no subgraph fetch to cache (section 2).

Operation caching only ever hits reason #1 — run it under `grafbase-gateway` and
it works. Proof: swapping *only* the binary (same `grafbase.toml`, same Redis)
turns operation caching from silent no-op into a working Redis-backed cache.

Full reasoning + official references: [`DEV-VS-GATEWAY-CACHING.md`](./DEV-VS-GATEWAY-CACHING.md).

## 4. Configuration reference

Root [`grafbase.toml`](../grafbase.toml):

```toml
[operation_caching]
enabled = true
limit = 1000

[operation_caching.redis]
url = "redis://redis:6379"          # concrete default; $REDIS_URL substituted at startup (see gotcha below)
key_prefix = "insurance-opcache"

[entity_caching]
enabled = true
ttl = "60s"
storage = "redis"                     # MUST be "redis" (default is "memory")

[entity_caching.redis]
url = "{{ env.REDIS_URL }}"
key_prefix = "insurance-entitycache"

# Per-subgraph override (this project's only subgraph)
[subgraphs.insurance.entity_caching]
enabled = true
ttl = "120s"
```

Notes:
- Presence of `[operation_caching.redis]` selects the Redis backend for
  operation caching (no `storage` key needed).
- Entity caching needs `storage = "redis"` explicitly (defaults to `memory`).
- Use a `rediss://` URL (+ a `[*.redis.tls]` table) for TLS.

### Env-driven Redis endpoint (important gotcha)

The endpoint comes from the `REDIS_URL` env var — **but not via Grafbase
templating.** Verified empirically on gateway **0.53.5**: `{{ env.REDIS_URL }}`
in the caching `redis.url` field writes **no keys** (the gateway does not
interpolate `{{ env.* }}` there — that only works for the REST-*extension*
config), whereas a concrete `redis://redis:6379` works. So the config holds a
concrete default and `REDIS_URL` is substituted into it at startup by our tooling:

| Environment | Mechanism |
|---|---|
| docker (`Dockerfile.gateway`) | `docker/gateway-entrypoint.sh` substitutes `$REDIS_URL` (default `redis://redis:6379`) into the config before launch |
| host-side testing | the `sed` in [`CACHING.md`](./CACHING.md) rewrites `redis://redis:6379` → `redis://localhost:6379` |

> ⚠️ Do **not** put `{{ env.* }}` in the caching `redis.url` — it silently
> disables Redis caching (no error, no keys). This was hit and fixed during
> implementation.

## 5. Verification flow (summary)

Full runnable steps are in [`CACHING.md`](./CACHING.md). In short:

1. Start Redis (compose or standalone).
2. Start the mock REST services.
3. Compose the federated schema: `npx grafbase compose -c <config> > federated.graphql`.
4. Run the **production** gateway: `grafbase-gateway --config <config> --schema federated.graphql`
   (with `REDIS_URL` exported).
5. Fire a query twice, then watch keys appear:
   ```bash
   redis-cli --scan --pattern 'insurance-opcache*'
   # insurance-opcacheop.blake3.<hash>   <- one key per distinct operation
   ```

**Verified result:** `insurance-opcache*` keys appear; `insurance-entitycache*`
stays empty (topology no-op). Persistence: restart the gateway against the same
Redis — plans are already present (`DBSIZE > 0` before any query), so it warms
instantly. The `redis-data` volume persists keys across `docker compose down/up`.

## 6. Acceptance-criteria gap analysis

Status reflects the repo **after** the env-config, README, and
`docker-compose.gateway.yml` updates.

| # | Acceptance criterion | Status | Detail / how to fully close |
|---|---|---|---|
| AC1 | Valkey/Redis runs alongside grafbase via docker compose | ✅ Done | `redis:7-alpine`, persistence, health-checked |
| AC2 | Runtime uses Valkey-backed cache | ✅ Done (Docker) | [`docker-compose.gateway.yml`](../docker-compose.gateway.yml) runs the production `grafbase-gateway` in Docker — **verified** writing `insurance-opcache*` keys. The *default* `docker-compose.yml` still runs `grafbase dev` (no caching) by design. |
| AC3 | Repeat queries return cached response | ⚠️ Partial | Operation caching reuses the cached **plan** (verified). Response-**data** caching isn't available in this topology. Close with a REST-layer cache (see §7). |
| AC4 | TTL / tagging demonstrated | ⚠️ Configured only | TTLs set but no expiry demo. A clean TTL demo is easiest against a REST-layer cache (§7). |
| AC5 | Cache survives runtime restart (where applicable) | ✅ Done | Operation-plan cache + `redis-data` volume; **verified** key survives restarting both `redis` and `grafbase-gateway` |
| AC6 | README updated with cache config | ✅ Done | Caching section added to [`README.md`](../README.md) |
| — | (in-scope) Endpoint via environment config | ✅ Done | `REDIS_URL` substituted into the config by the entrypoint (gateway does not interpolate `{{ env.* }}` here — see §4 gotcha) |

## 7. Recommended caching strategy (for real performance)

The story's performance intent (fewer REST round-trips / entity-query
validation) is **not** served by either Grafbase cache in this topology. Ranked
recommendation:

1. **Keep operation caching on** — cheap parse/validate/plan win. Already working.
2. **REST-layer cache** *(not implemented — proposal)* — a Redis-backed caching
   proxy in front of the mock REST services is the only lever that caches
   response **data** and cuts round-trips (collapsing the `@derive` fan-out).
   This is also where a TTL demo is natural. **Do not confuse this with entity
   caching** — it sits between the extension and the REST APIs.
3. **Batch the fan-out** if the mock APIs allow it (`GET /funds?ids=…`) — cheaper
   than any cache because the round-trips never happen.
4. **Splitting into ≥2 real subgraphs** *only* if there's an independent reason
   (team ownership, separate deploy/scaling). Doing it *just* to make entity
   caching fire is not recommended.

## 8. Valkey vs Redis — migration analysis

Valkey is a **drop-in fork of Redis** (forked from Redis 7.2.4), protocol- and
port-compatible. Behaviour is identical; the swap is small.

**No change needed:**
- `grafbase.toml` — connection stays on the `redis://` scheme (there is **no
  `valkey://` scheme**); Valkey speaks RESP identically.
- Persistence (`/data`, RDB/AOF), port `6379`, key prefixes, TTLs — all identical.

**Changes required (compose + docs only):**

| Item | Redis | Valkey |
|---|---|---|
| Image | `redis:7-alpine` | `valkey/valkey:8-alpine` |
| Healthcheck | `["CMD", "redis-cli", "ping"]` | `["CMD", "valkey-cli", "ping"]` |
| CLI in docs | `redis-cli …` | `valkey-cli …` |

**The one real gotcha:** the official Valkey image ships **`valkey-cli`, not
`redis-cli`** — so the compose healthcheck and every `docker exec … redis-cli`
in the docs must be renamed. (A stock `redis-cli` from elsewhere *can* talk to a
Valkey server; the Valkey *image* just doesn't bundle it.)

Optional cosmetic: rename service `redis` → `valkey` and `REDIS_URL` →
`VALKEY_URL` (then the URL value becomes `redis://valkey:6379`).

References: [Valkey ↔ Redis migration](https://valkey.io/topics/migration/),
[valkey/valkey image](https://hub.docker.com/r/valkey/valkey/).

## 9. Official references

- Operation Caching — https://grafbase.com/docs/gateway/configuration/operation-caching
- Entity Caching — https://grafbase.com/docs/gateway/performance/entity-caching
- Entity Cache config — https://grafbase.com/docs/gateway/configuration/entity-cache
- `grafbase dev` (CLI) — https://grafbase.com/docs/reference/grafbase-cli/dev
- Gateway Docker deployment — https://grafbase.com/docs/gateway/deployment/docker
- Self-hosting the Gateway — https://grafbase.com/docs/platform/self-hosting/installation
- REST extension — https://grafbase.com/extensions/rest
- Valkey migration from Redis — https://valkey.io/topics/migration/
