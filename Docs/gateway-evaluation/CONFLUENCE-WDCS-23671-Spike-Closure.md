# WDCS-23671 — SPIKE: GraphQL Gateway Evaluation (Grafbase vs Hive)

**Jira:** WDCS-23671 · **Status:** Complete — ready for closure
**Domain:** Insurance APIs — Accounts, Policies, Funds
**Related:** [WDCS-25885 — Hive Capability Analysis](../Hive-docs/CONFLUENCE-WDCS-25885-Hive-Capability-Analysis.md) ·
[Detailed evaluation](./CONFLUENCE-WDCS-23671-Gateway-Evaluation.md)

---

## 1. Overview

This spike evaluated Grafbase and Hive as the GraphQL gateway in front of the
insurance REST APIs (Accounts, Policies, Funds). The goal was to compare
architecture, federation capability, REST integration, performance, operational
overhead and long-term fit before committing to an implementation.

The Hive platform has more than one runtime, so three options were looked at:

| Option | Runtime | What it is |
|---|---|---|
| **Grafbase Gateway** | Rust | Federation gateway with a declarative REST extension |
| **Hive Gateway** | Node.js | Federation gateway with a plugin system, response caching and REST support through GraphQL Mesh |
| **Hive Router** | Rust | High-performance federation router with Rust plugins and coprocessor support |

> **Note on the ticket wording.** Hive Router is not a rename of GraphQL Mesh.
> GraphQL Mesh is a build-time tool that generates a GraphQL schema from OpenAPI;
> Hive Gateway can serve what Mesh produces. Hive Router is a separate Rust router.

---

## 2. Background

- Clients today call three REST services and join the results themselves.
- A single GraphQL endpoint should resolve accounts, their policies and their
  fund holdings in one request.
- The REST services and their OpenAPI specs stay as they are; the gateway layer
  adapts to them.

**Grafbase product status.** The Guild, the company behind Hive, acquired
Grafbase on 2026-02-10. The Grafbase platform and dashboard have been sunset.
The Grafbase Gateway and CLI are in maintenance mode, scheduled for archive by
end of May 2026, and the Grafbase repository points users to Hive Router or
Hive Gateway. Grafbase's technical findings below are still accurate, but it is
not a long-term option.

---

## 3. Scope

| Scope item | Covered |
|---|---|
| Compare federation, REST integration and schema composition | ✅ |
| Evaluate developer experience, operational overhead and deployment model | ✅ |
| Produce comparison matrix, risks and recommendation | ✅ |

Working PoCs were built for all three options in this repository
(`grafbase` configs, `hive-poc/`, `hive-router-poc/`).

### 3.1 Proof of Concept & Demo

The Hive PoCs back up the findings in this page and can be run locally with Docker.

| PoC | Proves | Run (from repo root) |
|---|---|---|
| [`hive-poc/`](../../hive-poc/) — Hive Gateway + Mesh | REST APIs composed from OpenAPI with no subgraph servers, Redis response cache, tag-based explicit invalidation | `docker compose -f hive-poc/docker-compose.yml up --build -d` then [`hive-poc/demo/demo.sh`](../../hive-poc/demo/demo.sh) |
| [`hive-router-poc/`](../../hive-router-poc/) — Hive Router | Federation through the Rust router, subgraph-level caching with per-entity invalidation, router footprint | `docker compose -f hive-router-poc/docker-compose.yml up --build -d` then [`hive-router-poc/demo/demo.sh`](../../hive-router-poc/demo/demo.sh) |

Sample queries for each PoC are in `demo/queries.graphql`. Walkthrough notes for a
live demo are in [`hive-poc/SPEAKER-NOTES.md`](../../hive-poc/SPEAKER-NOTES.md).

---

## 4. Evaluation Summary

### 4.1 Grafbase Gateway

- Federation v2 works, including cross-service entity resolution.
- REST is integrated declaratively with `@rest` directives — no subgraph servers.
- Good developer experience: compose, validate and run from one CLI.
- Caching covers query plans only; it does not reduce REST calls and cache keys
  cannot be invalidated explicitly.
- Schema registry was part of the Grafbase platform, which no longer runs.
- **Product is end-of-life.**

### 4.2 Hive Gateway (Node.js)

- Federation v2 works.
- REST APIs are composed from the existing OpenAPI specs via GraphQL Mesh —
  zero subgraph servers to write or deploy.
- Response caching backed by Redis/Valkey, with custom cache keys, entity tags
  and explicit invalidation (90 ms miss → 2.5 ms hit in the PoC).
- TTLs can be set globally, per type or per field.
- Plugin system (Envelop/Yoga plugins) for auth, logging, caching and custom logic.
- Built-in Hive registry (CDN) client, usage reporting, tracing and persisted documents.
- Mature, v2.x, MIT licensed. Official image ~618 MB.

### 4.3 Hive Router (Rust)

- Federation v2 works.
- Fastest option: roughly **2× the throughput at under half the latency** of
  Grafbase in the PoC benchmark.
- Smallest footprint: **135 MB** image, ~48 ms cold start.
- Extensible through **Rust plugins** and an **HTTP coprocessor**, so custom
  logic can run in any language outside the router.
- First-class config for JWT, CORS, CSRF, rate limiting, demand control,
  persisted documents, OpenTelemetry and Prometheus.
- Loads the supergraph from the Hive registry, S3 or a file, with polling.
- Does not consume REST directly; each REST service needs a GraphQL subgraph
  (three were built for the PoC). Response caching can live in those subgraphs
  and was verified working with precise per-entity invalidation.
- Pre-1.0 (v0.3.1), MIT licensed; the config surface is still changing.

---

## 5. Comparison Matrix

| Capability | Grafbase | Hive Gateway | Hive Router |
|---|---|---|---|
| Product status | End-of-life | Actively developed | Actively developed |
| Licence | MPL-2.0 / proprietary registry | MIT | MIT |
| Federation v2 | ✅ | ✅ | ✅ |
| REST integration | ✅ `@rest` extension | ✅ generated from OpenAPI (Mesh) | ⚠️ needs a subgraph per service |
| Subgraph servers needed | 0 | 0 | 3 |
| Response caching | ❌ | ✅ Redis/Valkey | ⚠️ in subgraphs, not the router |
| Explicit cache invalidation | ❌ | ✅ entity tags | ✅ via subgraph caches |
| Extensibility | WASM extensions | ✅ Plugins (JS/TS) | ✅ Rust plugins + coprocessors |
| Performance | baseline | baseline class | ✅ ~2× faster |
| Image size | 793 MB | 618 MB | ✅ 135 MB |
| Schema registry | Platform shut down | ✅ Hive Console / CDN | ✅ Hive Console / S3 |
| Observability | OTel | OTel, Prometheus, Hive tracing | OTel, Prometheus, Datadog |
| Maturity | Established, archived | v2.x | Pre-1.0 |

**Weighted score** (criteria fixed before scoring, see the detailed page §3 and §8):

| Option | Score |
|---|---|
| Hive Gateway | **4.05** |
| Hive Router | 3.75 |
| Grafbase | 3.35 |

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Grafbase is archived; no fixes or security patches | High | Do not build further on Grafbase |
| Hive Router is pre-1.0 and its config is still changing | Medium | Pin versions; review release notes on upgrade |
| Hive Router needs a subgraph per REST service | Medium | Use Hive Gateway + Mesh for REST-heavy paths, or generate subgraphs from OpenAPI |
| Hive Router logs one INFO line per request by default | Low | Tune log level before production |
| Benchmarks used mock backends, single run | Medium | Re-benchmark against realistic REST latency |
| JWT and OTel/Prometheus were documented, not wired up | Medium | Validate during implementation |
| Self-hosted Hive Console is Docker Compose only (no Helm) | Medium | Plan deployment in the follow-up story |

---

## 7. Recommendation

**Hive is the best fit for the insurance GraphQL gateway.**

Within one ecosystem, under one MIT licence, Hive offers:

- **Hive Gateway** — REST integration generated from our OpenAPI specs, response
  caching with explicit invalidation, and a rich plugin system.
- **Hive Router** — a fast, lightweight Rust router for high-throughput paths,
  with Rust plugins and coprocessor support for custom logic.
- **Hive Console** — schema registry, schema checks and usage reporting that both
  runtimes connect to.

Both runtimes consume the same supergraph from the same registry, so the choice
between Gateway and Router can be made per workload and changed later without
re-doing schema work. Grafbase is no longer a viable long-term option given its
end-of-life status.

**Confidence:** Medium-High. Federation, REST integration, caching and footprint
were verified hands-on; performance at production scale and auth/observability
wiring remain to be confirmed.

---

## 8. Next Steps

1. Create an implementation story for the Hive gateway layer (Gateway, Router or
   both) against the three insurance APIs.
2. Set up the Hive schema registry and wire the chosen runtime to it.
3. Run a production-like benchmark against realistic REST backends.
4. Wire up and test JWT auth and OpenTelemetry/Prometheus.
5. Plan migration away from the Grafbase PoC configuration.

---

## 9. Spike Closure

| Item | Outcome |
|---|---|
| Federation, REST integration and schema composition compared | ✅ Done — PoCs for all three options |
| Developer experience, operational overhead and deployment evaluated | ✅ Done |
| Comparison matrix, risks and recommendation produced | ✅ Done — §5, §6, §7 |
| **Decision** | **Hive (Gateway and/or Router)** |

The spike can be closed. Implementation continues in a follow-up story.
