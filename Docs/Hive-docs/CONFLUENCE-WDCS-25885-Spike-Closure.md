# WDCS-25885 — SPIKE: Hive Capability Analysis and Recommendation

**Jira:** WDCS-25885 · **Status:** Complete — ready for closure
**Domain:** Insurance APIs — Accounts, Policies, Funds
**Related:** [WDCS-23671 — Gateway Evaluation closure](../gateway-evaluation/CONFLUENCE-WDCS-23671-Spike-Closure.md) ·
[Detailed analysis](./CONFLUENCE-WDCS-25885-Hive-Capability-Analysis.md)

---

## 1. Overview

This spike investigated Hive Gateway, Hive Router and the Hive schema registry
(Hive Console) to determine whether Hive can support the long-term GraphQL
federation architecture currently implemented with Grafbase. It covered
Federation 2 compatibility, schema governance, licensing and production
deployment patterns.

The Hive platform is made up of three components:

| Component | Runtime | Role |
|---|---|---|
| **Hive Gateway** | Node.js | Data plane — federation gateway with plugins, response caching and REST support through GraphQL Mesh |
| **Hive Router** | Rust | Data plane — high-performance federation router with Rust plugins and coprocessor support |
| **Hive Console** | Node.js + stateful services | Control plane — schema registry, schema checks, versioning and usage analytics |

---

## 2. Background

- Three insurance REST APIs (Accounts, Funds, Policies) are federated into one
  GraphQL API, currently with Grafbase.
- The earlier spike, WDCS-23671, compared gateway runtimes. Registry, governance,
  licensing and deployment were not covered there and are the focus of this spike.

**Grafbase product status.** The Guild, the company behind Hive, acquired
Grafbase on 2026-02-10. The Grafbase platform and dashboard (including its
schema registry) have been sunset. The Grafbase Gateway and CLI are in
maintenance mode, scheduled for archive by end of May 2026, and the Grafbase
repository points users to Hive Router, Hive Gateway and Hive Console. Hive is
the vendor-designated successor.

---

## 3. Scope

| Acceptance criterion | Covered |
|---|---|
| Document Hive Gateway capabilities | ✅ §4.1 |
| Document Hive Router capabilities | ✅ §4.2 |
| Confirm or reject Federation 2 support | ✅ §4.3 — **Confirmed** |
| Identify Schema Registry integration path | ✅ §4.4 |
| Complete enterprise capability assessment | ✅ §4.5 |
| Produce recommendation | ✅ §7 |

### 3.1 Proof of Concept & Demo

Existing PoCs from WDCS-23671 were reused for Gateway and Router capabilities.
One small PoC was added to validate the self-hosted registry delivery path.

| PoC | Proves | Run (from repo root) |
|---|---|---|
| [`hive-poc/`](../../hive-poc/) — Hive Gateway + Mesh | REST composed from OpenAPI, response caching, explicit invalidation | `docker compose -f hive-poc/docker-compose.yml up --build -d` then [`hive-poc/demo/demo.sh`](../../hive-poc/demo/demo.sh) |
| [`hive-router-poc/`](../../hive-router-poc/) — Hive Router | Federation 2 through the Rust router, subgraph-level caching | `docker compose -f hive-router-poc/docker-compose.yml up --build -d` then [`hive-router-poc/demo/demo.sh`](../../hive-router-poc/demo/demo.sh) |
| [`hive-registry-poc/`](../../hive-registry-poc/) — S3 artifact delivery | Hive Router loading the supergraph from S3 and hot-reloading on republish (~2 s, no restart) | Requires `hive-router-poc` running, then `docker compose -f hive-registry-poc/docker-compose.yml up -d` — see its [README](../../hive-registry-poc/README.md) |

---

## 4. Evaluation Summary

### 4.1 Hive Gateway (Node.js) — v2.x, MIT

- Federation 2 execution.
- REST APIs composed from existing OpenAPI specs via GraphQL Mesh — no subgraph servers.
- Redis/Valkey response caching with custom keys, entity tags and explicit
  invalidation; TTL per type or field.
- Plugin system for auth, logging, caching and custom logic.
- Registry integration via Hive CDN flags; also supports Apollo GraphOS.
- Usage reporting, tracing and persisted documents built in.
- JWT/JWKS and OpenTelemetry/Prometheus documented.
- Official image ~618 MB.

### 4.2 Hive Router (Rust) — v0.3.1, MIT

- Federation 2 execution; roughly 2× the throughput of Grafbase in WDCS-23671.
- 135 MB image, ~48 ms cold start.
- Extensible through Rust plugins and an HTTP coprocessor.
- First-class config for JWT, CORS, CSRF, rate limiting, demand control and
  persisted documents.
- OpenTelemetry (OTLP, Datadog) and Prometheus documented.
- Supergraph sources: Hive registry, S3 storage, Apollo GraphOS or file, with polling.
- Consumes GraphQL subgraphs only (no direct REST); no built-in response cache.
- Pre-1.0 — config surface still changing.

### 4.3 Federation 2 — Confirmed

- Subgraphs declare `federation/v2.3`; the composed supergraph uses `join/v0.3`.
- `@key`, `@external` and `@key(resolvable: false)` used, with entities merged
  across subgraphs.
- Both Hive Gateway and Hive Router executed the full three-way federated query.
- Hive uses its own composition library (`@theguild/federation-composition`).
  Advanced directives (`@interfaceObject`, `@composeDirective`, progressive
  `@override`) are not used here and were not tested.

### 4.4 Schema Registry integration path — Hive Console, MIT

**Governance capabilities:**

- Breaking-change detection, including conditional breaking changes based on
  real usage data.
- `hive schema:check` in CI with GitHub merge-queue support.
- Composition validation and publish gating (`--fail-on-composition-error`).
- Schema policy linting, versioning, changelog, promotion and rollback.
- Operation-level usage analytics.

**Delivery to the runtime:**

| Deployment | Artifact delivery | Runtime config |
|---|---|---|
| Hive Console Cloud | High-availability CDN, serves the latest valid supergraph | Router `source: hive` · Gateway `--hive-cdn-endpoint` |
| Self-hosted Hive Console | S3-compatible storage (no HA CDN) | Router `source: storage` — verified in `hive-registry-poc` |

When using S3, `poll_interval` must be set explicitly; without it the router
loads the schema once and does not pick up new versions.

### 4.5 Enterprise capability assessment

**Licensing**

| Component | Licence | Cost |
|---|---|---|
| Hive Gateway | MIT | Free |
| Hive Router | MIT | Free |
| Hive Console | MIT | Free self-hosted; Cloud is usage-based with a free tier |
| Grafbase Gateway | MPL-2.0 | Maintenance mode, archive scheduled |
| Grafbase registry | Proprietary | Platform sunset |

**Deployment**

- Data plane is lightweight: Router 135 MB, Gateway 618 MB.
- Self-hosted Hive Console needs PostgreSQL, ClickHouse, Redis, Redpanda and
  S3-compatible storage — around 15 containers.
- Docker Compose is the only documented install; no Helm chart and no bundled
  monitoring. The vendor describes the reference stack as not production-ready
  as shipped.
- Hive Console Cloud removes this operational overhead.

---

## 5. Comparison Matrix

| Capability | Grafbase | Hive Gateway | Hive Router | Hive Console |
|---|---|---|---|---|
| Product status | End-of-life | Active | Active | Active |
| Licence | MPL-2.0 / proprietary | MIT | MIT | MIT |
| Role | Gateway + registry | Data plane | Data plane | Control plane |
| Federation 2 | ✅ | ✅ | ✅ | ✅ composes |
| REST integration | ✅ `@rest` | ✅ via Mesh | ❌ needs subgraphs | n/a |
| Response caching | ❌ | ✅ | ❌ (subgraph-level only) | n/a |
| Extensibility | WASM extensions | ✅ Plugins | ✅ Rust plugins + coprocessors | n/a |
| Schema governance | Platform gone | n/a | n/a | ✅ checks, policy, versioning |
| Registry client | n/a | ✅ CDN | ✅ Hive / S3 / file | n/a |
| Footprint | 793 MB | 618 MB | 135 MB | ~15 containers |
| Maturity | Archived | v2.x | Pre-1.0 | Active |

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Grafbase is end-of-life; registry no longer runs | High | Move to Hive |
| `poll_interval` omitted on S3 source silently serves a stale schema | High | Always set it; add a config check |
| Self-hosted Hive Console is not production-ready as shipped | High | Use managed Postgres/ClickHouse/Redis/Kafka and add monitoring, or use Hive Console Cloud |
| No HA CDN when self-hosting | Medium | Use the S3 path and gate publishes in CI |
| No Helm chart for Hive Console | Medium | Author charts if the target is Kubernetes |
| Default publish records an invalid schema instead of rejecting it | Medium | Use `--fail-on-composition-error` and `schema:check` in PRs |
| Governance features documented, not exercised | Medium | Validate against a running Hive Console in the follow-up story |
| Hive Router is pre-1.0 | Medium | Pin versions; re-check config on upgrade |
| JWT and OTel/Prometheus not wired up | Medium | Validate during implementation |

---

## 7. Recommendation

**Hive can support the long-term GraphQL federation architecture and is the
recommended platform.**

- **Hive Gateway** — for REST-heavy paths: REST composed from OpenAPI, response
  caching with explicit invalidation and a plugin system.
- **Hive Router** — for high-throughput paths: fast, lightweight Rust router with
  plugins and coprocessor support.
- **Hive Console** — for schema governance: registry, checks, policy, versioning
  and usage analytics, used by both runtimes.

All three are MIT licensed and share one supergraph and one registry, so Gateway
and Router can be chosen per workload. The main decision left is whether to run
Hive Console as **Cloud** (managed, usage-based) or **self-hosted** (free licence,
more operational effort). If self-hosted, deliver schemas through S3 with
`poll_interval` set, and gate publishes in CI.

**Confidence:** High on Federation 2, licensing and the registry integration path.
Medium on the operational cost of self-hosting Hive Console, which was assessed
from documentation.

---

## 8. Next Steps

1. Decide Hive Console Cloud vs self-hosted.
2. Stand up Hive Console and validate schema checks, policy linting and breaking-change detection with the three subgraphs.
3. Add `schema:check` and `schema:publish --fail-on-composition-error` to CI.
4. Wire up and test JWT auth and OpenTelemetry/Prometheus.
5. Benchmark Hive Gateway against realistic REST backends.
6. Author Helm charts for Hive Console if deploying to Kubernetes.

---

## 9. Spike Closure

| Acceptance criterion | Outcome |
|---|---|
| Document Hive Gateway capabilities | ✅ Done — §4.1 |
| Document Hive Router capabilities | ✅ Done — §4.2 |
| Confirm or reject Federation 2 support | ✅ **Confirmed** — §4.3 |
| Identify Schema Registry integration path | ✅ Done — §4.4, S3 path verified |
| Complete enterprise capability assessment | ✅ Done — §4.5 |
| Produce recommendation | ✅ Done — §7 |
| **Decision** | **Adopt Hive (Gateway / Router + Console)** |

The spike can be closed. Implementation and the Hive Console validation continue
in follow-up stories.
