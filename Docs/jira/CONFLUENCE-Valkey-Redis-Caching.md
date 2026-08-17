# Enabling Valkey / Redis Caching for the Grafbase Local Federation Runtime

> **Jira Story:** `<PROJECT-KEY>` — Enable Valkey or Redis caching for a Grafbase local federation runtime
> **Status:** Done (POC) — all acceptance criteria met; verified on **both Redis and Valkey**
> **Owner:** Aishwarya
> **Repository:** `rest-demo` (`<repo URL>`) — branch `feature/entity-caching`
> **Last updated:** 2026-08-18

> 📎 Companion pages: [Redis vs Valkey comparison](../CONFLUENCE-Redis-vs-Valkey.md) ·
> [caching setup & testing](../CACHING.md) ·
> [entity-caching technical details](../Caching-Technical-Details.md) ·
> [why entity caching was a no-op originally](../ENTITY-CACHING-WHY-NOOP.md) ·
> [funds subgraph runbook](../../funds-subgraph/README.md)

---

## Overview

This story adds **Redis / Valkey caching** to the local Grafbase GraphQL
federation runtime and proves cache **feasibility, behaviour, and configuration
patterns** at POC level. The delivered POC:

- Runs a **Redis _or_ Valkey** cache alongside the gateway via Docker Compose,
  with persistence — the backend is **switchable with one env var**.
- Enables **operation caching** (query plans) **and entity caching** (subgraph
  responses), both backed by Redis/Valkey.
- **Verified end-to-end in Docker on both backends**: repeat queries are served
  from cache, cached entities carry a TTL, and cached keys survive a gateway
  restart.

The single most important learning: **entity caching only engages for a real,
spec-compliant GraphQL subgraph reached over HTTP** — not for a virtual
(REST-extension) subgraph resolved in-process. Delivering the story therefore
required splitting one entity (`Fund`) into a real GraphQL subgraph.

## Problem Statement

> As a platform engineer, I want to enable Valkey/Redis caching in the local
> Grafbase runtime so that we can validate cache behaviour for the local
> query-federation POC — proving cache feasibility, behaviour, and configuration
> patterns.

Concretely the POC had to answer:

- Can a Valkey/Redis cache run alongside the gateway via Docker Compose, with
  persistence, configured through environment?
- Does caching actually **engage** in this federation — repeat-query hits, TTL,
  restart survival — and can we observe it in the keyspace?
- Is **Valkey** a viable drop-in for Redis here (for the comparison / licensing
  conversation)?

## Solution Implemented

| Area | What was done |
|---|---|
| **Cache service (Redis/Valkey)** | `redis`/`valkey` service in [`docker-compose.gateway.yml`](../../docker-compose.gateway.yml) — env-switchable image + healthcheck CLI (`CACHE_IMAGE`, `CACHE_CLI`), `restart: unless-stopped`, `redis-data` volume for **persistence**. |
| **Production gateway** | Runs `grafbase-gateway` in Docker ([`Dockerfile.gateway`](../../Dockerfile.gateway) + [entrypoint](../../docker/gateway-entrypoint.sh)). `grafbase dev` ignores caching, so the production binary is used. |
| **Cache configuration** | `[operation_caching]` + `[entity_caching]` (Redis-backed, `storage="redis"`, `ttl`, `key_prefix`) in [`grafbase.toml`](../../grafbase.toml). |
| **Entity caching enabled** | `Fund` split into a **real GraphQL subgraph** — [`funds-subgraph/`](../../funds-subgraph/) (GraphQL Yoga + `@apollo/subgraph`). The gateway now resolves `Fund` via a real `_entities` fetch that gets cached. |
| **Env-driven endpoint** | `REDIS_URL` substituted into the config at startup by the entrypoint (the gateway does **not** interpolate `{{ env.* }}` in `redis.url`). |
| **Tooling** | `scripts/run-redis-cache-test.sh`, `scripts/run-valkey-cache-test.sh` (run + verify + report), `scripts/test-entity-caching.sh` (assert `redis`/`valkey`/`both`), `scripts/dump-redis-cache.sh` (inspect the keyspace, auto-detects Redis/Valkey). |
| **Documentation** | This page + the companion pages listed above; README/runbooks updated. |

### Acceptance-criteria coverage

| Acceptance criterion | Status | Evidence |
|---|---|---|
| Valkey/Redis runs alongside grafbase via docker compose | ✅ | `redis`/`valkey` + gateway services in `docker-compose.gateway.yml` |
| Runtime uses Valkey-backed cache | ✅ | Verified on **Valkey 8.1.9** (and Redis 7.4.10) — same keys |
| Repeat queries return cached response | ✅ | 2nd/3rd identical query served from cache — no re-fetch to `funds` |
| Cache TTL / tagging demonstrated | ✅ | Entity keys carry TTL **120s** (`[subgraphs.funds.entity_caching]`) |
| Cache survives runtime restart | ✅ | Keys retained after restarting `redis`+`gateway` (`redis-data` volume) |
| README updated with cache config | ✅ | `funds-subgraph/README.md`, `Docs/CACHING.md`, this page |
| (in-scope) endpoint via environment config | ✅ | `REDIS_URL` / `CACHE_IMAGE` / `CACHE_CLI` |

## Directives used

The caching outcome depends on the **federation topology**, which is expressed
with these directives:

| Directive | Where | Purpose |
|---|---|---|
| `@link` | both subgraphs | imports the REST extension, composite-schemas, and Apollo-federation specs |
| `@restEndpoint` | `insurance` | declares the accounts / policies REST endpoints |
| `@rest` | `insurance` | maps a GraphQL field to a REST call (+ `jq` `selection`) |
| `@key(fields: "id")` | `Fund` (both subgraphs) | marks `Fund` as a federation **entity** — the cacheable unit |
| `@require` | `Account.policies` | injects the parent `id` into the REST path |
| `@inaccessible` | `fundId` / `fundIds` | hides internal join fields from the public schema |
| `__resolveReference` | `funds` subgraph (Apollo) | resolves a `Fund` from its key during an `_entities` fetch |

> Note: the original single-subgraph schema used `@derive` / `@is` / `@lookup` to
> resolve `Fund` **in-process**. For entity caching to engage, that was replaced
> with a **plain cross-subgraph entity reference** (`fund: { id }` produced in the
> `@rest` selection) resolved by the real `funds` subgraph.

## Project Architecture / Flow

```
                         GraphQL client
                               │
                               ▼
                    ┌───────────────────────┐        ┌──────────────────────┐
                    │   Grafbase Gateway     │  ⇄     │  Redis / Valkey       │
                    │  (production binary)   │        │  operation + entity   │
                    └───────────┬───────────┘        │  cache (persisted)    │
             plan cache ────────┘        └───────────┴──────────────────────┘
                    │                                   ▲ entity-cache write/read
   ┌────────────────┴───────────────┐                   │ (the `_entities` hop)
   ▼                                ▼                   │
┌───────────────────────────┐   ┌───────────────────────┴───────┐
│ insurance subgraph        │   │ funds subgraph (REAL GraphQL,  │
│ (REST-extension, virtual) │   │  Yoga + @apollo/subgraph)      │
│  accounts + policies      │   │  owns Fund @key                │
│  Fund = stub (@key only)  │   └───────────────┬───────────────┘
└───────────┬───────────────┘                   ▼
            ▼                             ┌─────────────┐
   accounts / policies REST         ────▶ │ funds REST  │
   (mock services)                        └─────────────┘
```

- **`insurance`** — a virtual (REST-extension) subgraph: `accounts`, `policies`,
  and a `Fund` **stub** (key only).
- **`funds`** — a **real HTTP GraphQL subgraph** that owns the full `Fund`; the
  gateway resolves it via `_entities`. **This is the hop entity caching stores.**
- **Redis / Valkey** sits beside the gateway; the volume persists cached keys.

## How the Project Works

1. A client sends a GraphQL operation to the gateway.
2. **Operation caching** — the gateway looks up the operation's **query plan** in
   the cache (`insurance-opcache*`); on a miss it plans once and stores it.
3. The plan runs: `accounts`/`policies` fields resolve via the REST extension;
   each `Fund` reference carries only its key.
4. **Entity resolution** — to fill `fund.*` fields, the gateway issues an
   `_entities` fetch to the **`funds`** subgraph over HTTP.
5. **Entity caching** — that response is cached (`insurance-entitycache*`), **one
   key per Fund**, with the configured TTL. A repeat query is served from cache
   with **no re-fetch** to `funds`.
6. **Persistence** — keys live in Redis/Valkey and survive gateway restarts (and
   `down`/`up`, via the `redis-data` volume).

## What are Grafbase REST Extensions?

Grafbase **REST extensions** let you expose an existing REST API as a GraphQL
**virtual subgraph**, declaratively, with **no separate server**:

- `@restEndpoint(name, baseURL, headers)` declares a REST endpoint.
- `@rest(endpoint, http, selection)` maps a GraphQL field to an HTTP call and
  shapes the JSON with a `jq` selection.
- A WebAssembly extension runs **inside the gateway** and resolves those fields
  by calling the REST API directly.

**Why this matters for caching:** because a virtual subgraph resolves
**in-process, without an external subgraph fetch**, the gateway's **entity
caching has nothing to intercept** for it (see
[`ENTITY-CACHING-WHY-NOOP.md`](../ENTITY-CACHING-WHY-NOOP.md)). That is exactly
why `Fund` had to be promoted to a **real GraphQL subgraph** — so a genuine
`_entities` fetch exists to cache. Operation caching, by contrast, works for the
REST-extension subgraph because it caches the **plan**, not a subgraph response.

## Key Benefits

- **Faster repeat operations** — cached query plans skip parse/validate/plan.
- **Fewer upstream fetches** — entity caching serves repeat entity reads from the
  cache instead of re-hitting the `funds` subgraph.
- **Shared + persistent cache** — Redis/Valkey can be shared across gateway
  instances; the volume retains keys across restarts.
- **Backend flexibility** — **Redis or Valkey** with a one-env-var switch; no
  gateway/config change (Valkey is a licensing/cost-friendly drop-in).
- **Config- and env-driven** — caching is toggled via `grafbase.toml`, endpoint
  via `REDIS_URL`; no code changes.
- **Reproducible & tested** — the whole stack runs in Docker; scripts assert the
  behaviour and write report files.

## Official References

- Entity Caching — https://grafbase.com/docs/gateway/performance/entity-caching
- Operation Caching — https://grafbase.com/docs/gateway/configuration/operation-caching
- Entity Cache config — https://grafbase.com/docs/gateway/configuration/entity-cache
- REST extension — https://grafbase.com/extensions/rest
- GraphQL Federation (intro) — https://grafbase.com/guides/introduction-to-graphql-federation
- `grafbase dev` (CLI) — https://grafbase.com/docs/reference/grafbase-cli/dev
- Gateway Docker deployment — https://grafbase.com/docs/gateway/deployment/docker
- Apollo Federation `@key` / subgraph — https://www.apollographql.com/docs/federation/
- Valkey — https://valkey.io/ · Redis→Valkey migration — https://valkey.io/topics/migration/

## Future Scope

- **Teach `schema-gen` the `Fund` split** so `schema.graphql` isn't hand-edited
  (today, regenerating overwrites it).
- **Fold the `funds` subgraph + production gateway into the default compose** (or
  a compose profile) so a single `up` runs the cached setup.
- **REST-layer caching** in front of the mock APIs to cut upstream round-trips
  (entity caching caches subgraph responses, not the extension's REST calls).
- **Observability** — cache hit/miss metrics, key counts, latency deltas.
- **Security/scale** — TLS (`rediss://`), header-based cache scoping / tenancy,
  and a Redis-vs-Valkey performance benchmark.

## Limitations / Known Considerations

- **Production gateway only.** `grafbase dev` (and thus `npm start` /
  `docker compose up` on the default file) **ignore caching** — use
  `docker-compose.gateway.yml`.
- **Entity caching needs a real, spec-compliant GraphQL subgraph.** Virtual
  (REST-extension) subgraphs resolve in-process and are **not** entity-cached; a
  hand-rolled `_entities` responder is also not cached (only a real subgraph via
  GraphQL Yoga + Apollo `buildSubgraphSchema` worked).
- **`schema.graphql` is hand-edited** for the `Fund` split; `schema-gen` was not
  updated, so regenerating overwrites it.
- **No `{{ env.* }}` in `redis.url`.** Gateway 0.53.5 does not interpolate env in
  the caching URL — `REDIS_URL` is substituted by our tooling instead.
- **Cold-miss dependency (from the story).** If the backend mock APIs are down,
  cache-validation queries fail because source data can't be fetched on the
  initial miss. Accepted for local POC feasibility.
- **Redis vs Valkey.** Interchangeable here; only the container **image** and the
  **CLI** differ (the Valkey image ships `valkey-cli`, not `redis-cli`).
- **Port conflicts.** Leftover host mock servers on `3001–3003` clash with the
  compose mocks — free those ports (or don't run host mocks) before `up`.

## Summary

The POC **meets every acceptance criterion** and proves the story's goal: a
Valkey/Redis cache runs alongside the Grafbase federation gateway via Docker
Compose with persistence, configured through environment, and **both operation
and entity caching are verified working — on Redis and on Valkey**, with repeat
queries served from cache, a demonstrated TTL, and keys that survive a gateway
restart. The key architectural insight — **entity caching requires a real
GraphQL subgraph, not a virtual REST-extension subgraph** — is captured and
implemented via the `funds` subgraph. Valkey is confirmed a **drop-in** for
Redis, switchable with a single environment variable, making it a safe,
licensing-friendly option for this runtime. Remaining items (schema-gen
integration, default-compose wiring, observability, REST-layer caching) are
captured under **Future Scope**.
