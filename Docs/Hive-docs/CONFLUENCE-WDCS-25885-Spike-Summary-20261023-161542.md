# WDCS-25885 — SPIKE: Hive Capability Analysis and Recommendation

**Jira:** WDCS-25885 · **Story points:** 3 · **Status:** Complete — ready for closure
**Date:** 2026-10-23
**Domain:** Insurance REST APIs — Accounts, Policies, Funds

---

## 1. Purpose

Analyse the Hive platform (Hive Gateway, Hive Router and Hive Console) and
decide whether it can be our long-term GraphQL federation platform. The two
requirements it has to meet:

1. **REST federation**: expose the existing Accounts, Policies and Funds REST
   APIs as one federated GraphQL API without rewriting them.
2. **Caching**: cache responses in Redis, with custom cache keys and explicit
   invalidation when an entity changes.

---

## 2. Hive Products at a Glance

Hive is an open-source GraphQL federation platform from The Guild. All its
products are **MIT licensed**.

| Product | Runtime | Role | Speciality |
|---|---|---|---|
| **Hive Gateway** | Node.js | Federation gateway (data plane) | REST-to-GraphQL from OpenAPI, response caching, JS/TS plugins |
| **Hive Router** | Rust | Federation router (data plane) | High performance, small footprint, Rust plugins and coprocessors |
| **Hive Console** | Web app + services | Schema registry and governance (control plane) | Schema checks, breaking-change detection, versioning, usage analytics |

Hive Gateway and Hive Router can both load the same supergraph from Hive Console,
so each workload can use whichever runtime suits it.

---

## 3. Federation v2 Support — ✅ Confirmed

- Hive fully supports **Apollo Federation v2**. Subgraphs use `federation/v2.3`,
  and the composed supergraph uses `join/v0.3`.
- `@key`, `@external` and `@key(resolvable: false)` work, and entities are merged
  across subgraphs.
- In the PoCs, both Hive Gateway and Hive Router ran a full Accounts → Policies →
  Funds federated query.
- Hive uses its own open-source composition library
  (`@theguild/federation-composition`).
- Advanced directives (`@interfaceObject`, `@composeDirective`, progressive
  `@override`) are supported but were not tested in this spike.

---

## 4. Hive Gateway (Node.js) — v2.x

### 4.1 REST federation

- Uses **GraphQL Mesh** to build a GraphQL schema directly from our existing
  `openapi.yaml` files.
- **No subgraph servers to write or deploy**: the REST APIs are federated as they
  are.
- Cross-API joins (account → policies → funds) are resolved in the gateway.

### 4.2 Caching

| Capability | Supported |
|---|---|
| Response caching (cache hit skips the REST calls) | ✅ Redis / Valkey backed |
| Custom cache keys | ✅ `buildResponseCacheKey` |
| Entity tags (cached responses tagged by `Account`, `Policy`, `Fund` id) | ✅ |
| Explicit invalidation (by key or by entity) | ✅ |
| TTL control | ✅ Global, per type or per field |
| Upstream HTTP response caching | ✅ `plugin-http-cache` |

**PoC result:** a cache miss took 90 ms and a cache hit took 2.5 ms. Invalidating one
account removed only the cached responses that contained it; other entries stayed.

### 4.3 Plugins

- Built on the **Envelop / GraphQL Yoga plugin system**, with hooks across the
  whole request lifecycle (parse, validate, execute, subgraph fetch, response).
- Plugins are written in **JavaScript / TypeScript**.
- Ready-made plugins cover response caching, JWT auth, rate limiting, persisted
  documents, OpenTelemetry, Prometheus and logging.
- Custom plugins can add our own logic, such as custom headers, auditing or tenant routing.

### 4.4 Other features

- Hive Console integration: schema from the CDN, usage reporting and tracing.
- Persisted documents (trusted operations).
- Schema polling (every 10 s by default) for zero-downtime schema updates.
- JWT / JWKS auth, OpenTelemetry and Prometheus.
- Official image: ~618 MB.

---

## 5. Hive Router (Rust) — v0.3.1

### 5.1 Speciality: performance

- Written in Rust for high throughput and low latency.
- **135 MB** image and **~48 ms** cold start.
- Suited to high-traffic, latency-sensitive paths.

### 5.2 REST federation and caching

- Hive Router federates **GraphQL subgraphs only**. Each REST API needs a thin
  GraphQL subgraph in front of it.
- It has **no built-in response cache**; the `cache:` setting only covers query
  plans. Response caching can be done inside the subgraphs (verified in the PoC
  with per-entity invalidation) or through a coprocessor or plugin.

### 5.3 Plugins and coprocessors

| Extension | What it is | Use for |
|---|---|---|
| **Rust plugins** | Native code compiled into the router, hooking into the request lifecycle. `on_http_request` and `on_graphql_params` can stop a request early | Fast custom logic: auth checks, header handling, request rejection |
| **Coprocessor** | The router calls an external HTTP service at chosen stages of the request | Custom logic in **any language** (Node, Java, Python) without changing the router, such as auth, policy, auditing or a custom cache lookup |

The coprocessor lets teams extend the router without writing Rust.

### 5.4 Other features

- Built-in config for JWT, CORS, CSRF, rate limiting and demand control.
- Persisted documents, including an L2 cache.
- Loads the supergraph from Hive Console (CDN), S3 storage or a file, polling
  for updates.
- OpenTelemetry (OTLP, Datadog) and Prometheus.
- Pre-1.0, so its config can still change between versions.

---

## 6. Hive Console — Schema Registry

Hive Console is Hive's **schema registry and governance layer**. It is available
as **Hive Console Cloud** (managed) or **self-hosted**.

### 6.1 Schema registry features

| Feature | Description |
|---|---|
| Schema registry | Central store of every subgraph schema and the composed supergraph |
| Schema checks in CI | `hive schema:check` runs on every PR; GitHub merge-queue support |
| Breaking-change detection | Flags breaking changes, using **real usage data** so that removing a field no client uses is not reported as breaking |
| Composition validation | Validates federation composition before publishing (`--fail-on-composition-error`) |
| Schema policy | Lint rules, each set to warning or error |
| Versioning and changelog | Every publish records author, date, diff and commit |
| Promotion and rollback | Promote schemas between environments and roll back to an earlier version |
| Usage analytics | Operation- and field-level usage reported by the gateway / router |
| Persisted documents | Central store of trusted operations |

### 6.2 How the gateway / router gets the schema

| Deployment | Delivery | Runtime config |
|---|---|---|
| Hive Console Cloud | High-availability CDN that always serves the latest **valid** supergraph | Router `source: hive` · Gateway `--hive-cdn-endpoint` |
| Self-hosted Hive Console | S3-compatible storage | Router `source: storage` |

**Verified in `hive-registry-poc/`:** Hive Router loaded the supergraph from S3
and hot-reloaded a newly published version in about 2 s with no restart.
`poll_interval` must be set explicitly for this to happen.

### 6.3 End-to-end integration path

```
Subgraph PR ──► hive schema:check ──► Merge ──► hive schema:publish ──► Hive Console ──► CDN / S3 ──► Gateway / Router
                (CI gate)                       --fail-on-composition-error   (composes        (supergraph     (polls and
                                                                              supergraph)      artifact)       hot-reloads)
```

| Step | Where | What happens |
|---|---|---|
| 1. Check | CI, on every subgraph PR | `hive schema:check` validates composition, schema policy and breaking changes against real usage. The PR fails if the check fails |
| 2. Publish | CI, on merge to main | `hive schema:publish --fail-on-composition-error` registers the new subgraph version. An invalid schema is rejected, not recorded |
| 3. Compose | Hive Console | Composes all subgraphs into a new supergraph version, with a changelog and diff |
| 4. Deliver | CDN (Cloud) or S3 (self-hosted) | The new supergraph artifact is published for the runtimes to fetch |
| 5. Load | Hive Gateway / Hive Router | The runtime polls (every 10 s by default) and hot-reloads the new supergraph with no restart |
| 6. Report | Gateway / Router → Hive Console | Operation usage is reported back and feeds breaking-change detection for future checks |
| Rollback | Hive Console | `hive schema:promote --version <id>` restores an earlier version, which the runtimes pick up on their next poll |

Steps 1–3 need a Hive access token (registry) in CI. Steps 5–6 need a CDN key
(or S3 credentials) and a usage-reporting token in the runtime.

---

## 7. Enterprise Capabilities

| Area | Capability |
|---|---|
| **Licensing** | Gateway, Router and Console are all **MIT**. Self-hosting is free. Hive Console Cloud is usage-based (not per seat), with a free tier |
| **Schema governance** | Schema checks, policy linting, usage-aware breaking-change detection, versioning, promotion and rollback |
| **Security** | JWT / JWKS auth, CORS, CSRF, rate limiting, demand control, persisted documents (only trusted operations allowed) |
| **Observability** | OpenTelemetry tracing (OTLP, Datadog), Prometheus metrics, Hive usage reporting and tracing |
| **Extensibility** | Gateway: JS/TS plugins. Router: Rust plugins and language-neutral coprocessors |
| **High availability** | Cloud CDN keeps serving the last valid schema through a bad publish. Gateway and router poll for schema updates with no downtime |
| **Deployment** | Gateway and Router run as containers on any platform. Self-hosted Console needs PostgreSQL, ClickHouse, Redis, Kafka (Redpanda) and S3; Docker Compose is documented, Helm is not |

---

## 8. Fit Against Our Requirements

| Requirement | Hive Gateway | Hive Router |
|---|---|---|
| Federation v2 | ✅ | ✅ |
| Federate REST APIs without rewriting them | ✅ from OpenAPI, no subgraphs | ⚠️ needs a subgraph per API |
| Response caching in Redis | ✅ built in | ⚠️ in subgraphs or a coprocessor |
| Custom cache keys | ✅ | ⚠️ custom-built |
| Explicit / entity invalidation | ✅ | ✅ via subgraph cache |
| Custom logic | ✅ JS/TS plugins | ✅ Rust plugins + coprocessor |
| Performance and footprint | Good (618 MB) | ✅ Best (135 MB) |
| Schema registry | ✅ Hive Console | ✅ Hive Console |

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Self-hosted Hive Console is not production-ready as shipped | High | Use Hive Console Cloud, or managed databases plus monitoring |
| If `poll_interval` is not set on the S3 source, the router never picks up new schemas | High | Always set it; add a config check |
| Hive Router is pre-1.0 | Medium | Pin versions and review release notes |
| Governance, JWT and observability were assessed from documentation, not tested | Medium | Validate in the implementation story |

---

## 10. Recommendation

**Hive meets our REST federation, caching and governance needs. Adopt it as the
long-term GraphQL federation platform.**

- **Hive Gateway** as the primary runtime: it federates our REST APIs directly from
  OpenAPI and covers the caching requirement (Redis, custom keys, entity
  invalidation) out of the box.
- **Hive Router** for high-throughput paths, extended with plugins or a coprocessor
  where needed.
- **Hive Console** as the schema registry and governance layer for both.

**Open decision:** Hive Console Cloud vs self-hosted.

---

## 11. Next Steps

1. Decide between Hive Console Cloud and self-hosted.
2. Set up Hive Console and publish the Accounts, Policies and Funds schemas.
3. Add `schema:check` and `schema:publish --fail-on-composition-error` to CI.
4. Productionise the Hive Gateway Redis caching and invalidation setup.
5. Wire up JWT auth and OpenTelemetry/Prometheus.

---

## 12. Spike Closure

| Acceptance criterion | Outcome |
|---|---|
| Document Hive Gateway capabilities | ✅ §4 |
| Document Hive Router capabilities | ✅ §5 |
| Confirm or reject Federation 2 support | ✅ **Confirmed** — §3 |
| Identify Schema Registry integration path | ✅ §6 — end-to-end path in §6.3, S3 delivery verified |
| Complete enterprise capability assessment | ✅ §7 |
| Produce recommendation | ✅ §10 |
| **Decision** | **Adopt Hive (Gateway / Router + Hive Console)** |
