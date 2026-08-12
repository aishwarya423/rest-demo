# Enabling Valkey / Redis Caching for a Grafbase Local Federation Runtime

> **Jira Story:** `<PROJECT-KEY>` — Enable Valkey or Redis caching for a Grafbase local federation runtime
> **Status:** Implemented (POC) — with documented caveats
> **Owner:** Aishwarya
> **Repository:** `rest-demo` (`<repo URL>`) — branch `feature/caching`
> **Last updated:** 2026-08-12

> 📎 **Deep technical detail** (cache internals, full gap analysis, config
> reference, Valkey migration table, verification walkthrough) lives in the
> companion page: [**Grafbase Caching — Technical Details & Analysis**](./Caching-Technical-Details.md).
> This page stays at analysis/summary altitude.

---

## Overview

This story adds **Redis-backed caching** to the local Grafbase federation
runtime and proves cache feasibility, behaviour, and configuration patterns at
**POC level**. The goal is to validate how Valkey/Redis-backed caching behaves in
a local query-federation setup — not to ship production caching.

The headline outcome: **operation caching is verified working and Redis-backed**;
**entity caching is correctly configured but inert in this topology**; and
caching **only runs under the production gateway binary**, not `grafbase dev`.
These are properties of the architecture, and are documented so the POC result
isn't mistaken for a misconfiguration.

## Problem Statement

As a platform engineer, I want to enable Valkey/Redis caching in the local
Grafbase runtime so we can validate cache behaviour for the local query-
federation POC — proving cache feasibility, behaviour, and configuration
patterns.

Concretely, the POC needs to answer:

- Can a Valkey/Redis cache run alongside the gateway via Docker Compose, with
  persistence?
- Can the runtime be pointed at that cache through environment config?
- Does caching actually engage (repeat queries, TTL, restart survival)?
- What are the limits of caching in *this* federation topology?

## Solution Implemented

| Area | What was done |
|---|---|
| **Cache container** | `redis:7-alpine` service in [`docker-compose.yml`](../docker-compose.yml) — `restart: unless-stopped`, health-checked, with a `redis-data` volume so keys **persist across `docker compose down/up`**. |
| **Gateway cache config** | `[operation_caching]` (Redis-backed, **verified**) and `[entity_caching]` (Redis-backed, correct but a no-op here) in [`grafbase.toml`](../grafbase.toml). |
| **Docker gateway (verified)** | [`docker-compose.gateway.yml`](../docker-compose.gateway.yml) + [`Dockerfile.gateway`](../Dockerfile.gateway) run the **production `grafbase-gateway`** in Docker so caching actually engages — verified writing `insurance-opcache*` keys and surviving restart. |
| **Env-driven endpoint** | Redis URL comes from the `REDIS_URL` env var. The gateway does **not** interpolate `{{ env.* }}` in the caching `redis.url`, so the entrypoint substitutes `$REDIS_URL` into a concrete default at startup. |
| **Verification** | End-to-end steps that show `insurance-opcache*` keys filling Redis under the production gateway, plus restart persistence. See [`CACHING.md`](./CACHING.md). |
| **Documentation** | [`CACHING.md`](./CACHING.md), [`DEV-VS-GATEWAY-CACHING.md`](./DEV-VS-GATEWAY-CACHING.md), [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md), and a Caching section in [`README.md`](../README.md). |

### Cache configuration used

*(This story is caching-focused; the analogue of "directives" here is the
gateway cache config blocks.)*

- `[operation_caching]` + `[operation_caching.redis]` — caches query plans.
- `[entity_caching]` + `[entity_caching.redis]` — caches subgraph fetches (`storage = "redis"`).
- `[subgraphs.insurance.entity_caching]` — per-subgraph override (`ttl = "120s"`).

Full annotated config: [Technical Details §4](./Caching-Technical-Details.md#4-configuration-reference).

## Project Architecture / Flow

```
GraphQL client
      │  query
      ▼
Grafbase Gateway  ──────────────►  Redis  (operation-plan cache: insurance-opcache*)
      │
      │  (in-process REST WASM extension — NOT a subgraph fetch)
      ▼
Mock REST services  (accounts / funds / policies)
```

Key architectural facts that drive the whole analysis:

- **One virtual subgraph** (`insurance`). `accounts`/`funds`/`policies` are REST
  endpoints *inside* it, resolved by the REST extension — **not** separate
  subgraphs.
- Redis sits **beside the gateway** for the operation-plan cache.
- Entity caching would sit on the **gateway → subgraph fetch** hop — which does
  not exist in this single-subgraph topology.

## How the Project Works

1. A client sends a GraphQL operation to the gateway.
2. **Operation caching:** the gateway looks up the operation document's **query
   plan** in Redis (`insurance-opcache*`). On a hit it skips
   parse/validate/plan; on a miss it plans once and writes the plan to Redis.
3. The plan executes: the **REST WASM extension** makes HTTP calls to the mock
   REST services and maps JSON back to GraphQL fields.
4. **Persistence:** plans survive gateway restarts (shared Redis) and survive
   `docker compose down/up` (the `redis-data` volume).

Operation caching caches the **plan**, not the response data — so it speeds up
planning but does **not** reduce REST round-trips.

## What is Grafbase Caching? (Operation vs Entity)

Grafbase Gateway offers two independent caches:

- **Operation caching** — stores the **query plan** per unique operation
  document. Backend: memory or Redis. *In this project: verified Redis-backed.*
- **Entity caching** — stores **subgraph fetch responses** the gateway makes
  when resolving `@key` entities across subgraph boundaries. Backend: memory or
  Redis. *In this project: a no-op — there is no cross-subgraph fetch to cache.*

Both are features of the **production `grafbase-gateway` binary**. `grafbase dev`
(the local development server) ignores caching by design.

Why each behaves as it does:
[entity no-op](./ENTITY-CACHING-WHY-NOOP.md) ·
[dev vs gateway](./DEV-VS-GATEWAY-CACHING.md).

## Key Benefits

- **Faster repeat operations** — cached query plans skip parse/validate/plan.
- **Shared + persistent cache** — Redis lets multiple gateway instances share
  plans; the volume retains keys across restarts (validates the persistence AC).
- **Config-driven & env-driven** — caching is toggled/pointed via `grafbase.toml`
  + `REDIS_URL`, with no code changes.
- **Drop-in Valkey compatibility** — the same setup runs on Valkey with only an
  image + CLI-name change (see below).
- **Clear POC evidence** — the behaviour (and its limits) is documented and
  reproducible.

## Official References

- Operation Caching — https://grafbase.com/docs/gateway/configuration/operation-caching
- Entity Caching — https://grafbase.com/docs/gateway/performance/entity-caching
- `grafbase dev` (CLI) — https://grafbase.com/docs/reference/grafbase-cli/dev
- Gateway Docker deployment — https://grafbase.com/docs/gateway/deployment/docker
- REST extension — https://grafbase.com/extensions/rest
- Valkey ↔ Redis migration — https://valkey.io/topics/migration/

Full reference list: [Technical Details §9](./Caching-Technical-Details.md#9-official-references).

## Future Scope

- **Make the production gateway the default (optional):** caching in Docker is
  already delivered via [`docker-compose.gateway.yml`](../docker-compose.gateway.yml)
  (verified). A remaining nice-to-have is folding it into the *default*
  `docker-compose.yml` (e.g. via a compose profile) so a single `up` runs the
  gateway — today it's a separate, explicit compose file by design.
- **Cache response data / cut REST round-trips:** add a REST-layer Redis proxy
  cache in front of the mock services (the only lever that caches data in this
  topology; also enables a clean TTL demo). *Proposal — not implemented.*
- **Batch the `@derive` fan-out** (`GET /funds?ids=…`) to avoid round-trips
  entirely where the mock APIs allow.
- **Valkey swap** — if the story standardises on Valkey, apply the small
  image/CLI change (below).

## Limitations / Known Considerations

- **Caching runs only under `grafbase-gateway`.** The compose default runs
  `grafbase dev`, which ignores all caching — so `docker compose up` alone caches
  nothing. ([why](./DEV-VS-GATEWAY-CACHING.md))
- **Entity caching is a no-op** in this single-subgraph REST-extension topology —
  correct config, but no subgraph fetch to cache. ([why](./ENTITY-CACHING-WHY-NOOP.md))
- **Operation caching caches plans, not response data** — it does not reduce load
  on the mock REST services.
- **Cold-miss dependency (from the story):** if the backend mock APIs are down,
  cache-validation queries fail because source data can't be fetched on the
  initial miss. Accepted for local POC feasibility.
- **Valkey vs Redis:** functionally identical (drop-in fork). Only changes:
  image `redis:7-alpine` → `valkey/valkey:8-alpine`, and `redis-cli` →
  `valkey-cli` in the healthcheck/docs (the Valkey image ships `valkey-cli`, not
  `redis-cli`). `grafbase.toml` needs **no change** — keep the `redis://` scheme.
  Full table: [Technical Details §8](./Caching-Technical-Details.md#8-valkey-vs-redis--migration-analysis).

## Summary

The POC **succeeds at its stated goal**: a Valkey/Redis cache runs alongside the
gateway via Docker Compose with persistence, the runtime is pointed at it through
environment config, and **operation caching is verified Redis-backed and survives
restart**. The important nuance — and the main analytical finding — is that in
*this* federation topology **caching only engages under the production
`grafbase-gateway`**, and **entity caching cannot engage at all** because there
is no cross-subgraph fetch to cache. Both are documented as architectural
properties, not defects. Remaining acceptance-criteria items (running caching in
the compose default, demonstrating response-data caching / TTL) are captured as
scoped follow-ups in **Future Scope**, with the full gap analysis in the
[technical companion page](./Caching-Technical-Details.md#6-acceptance-criteria-gap-analysis).
