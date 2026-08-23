# GQL-101 — Research Findings: What Hive Router Actually Is

De-risking task from the spike plan, completed before any PoC code was
written. Sourced from the project's own README, blog post, docs, and GitHub
issues (fetched 2026-08-21) — not from training-data assumptions, because the
spike plan flagged this as a place stale knowledge could silently derail
scope.

## 1. Two different products share "Hive" branding — don't conflate them

| | **Hive Gateway** | **Hive Router** (what the spike asked for) |
|---|---|---|
| Language | JavaScript/Node | Rust |
| npm package | `@graphql-hive/gateway` (v2.11.2 at research time) | none — binary/Docker only |
| Composition | Can integrate with GraphQL Mesh for REST/OpenAPI → subgraph | None built in |
| Maturity | Established, v2 | Young — `v0.2.0` observed at research time, 1,061 commits on main |
| License | MIT | MIT |

The spike's title says "Hive Router," so that's what was built and tested
throughout this evaluation. Hive Gateway (the older JS product, which has a
documented GraphQL Mesh integration path for REST/OpenAPI sources) is noted
here because it's the more natural comparison point if "auto-generate a
subgraph from OpenAPI" turns out to matter more than raw router performance —
see the Follow-ups note in the outcome doc.

Sources: [Hive Router GitHub](https://github.com/graphql-hive/router),
[Welcome Hive Router blog post](https://the-guild.dev/graphql/hive/blog/welcome-hive-router),
[Hive Gateway GitHub](https://github.com/graphql-hive/gateway).

## 2. Hive Router is a query-plan *executor*, not a composer — confirmed, and this reshaped the whole PoC

Straight from the README's Quick Start:

```yaml
# router.config.yaml
supergraph:
  source: file
  path: ./supergraph.graphql
```

Hive Router loads a **pre-composed supergraph SDL file** (or fetches one via
`SUPERGRAPH_FILE_PATH`/schema registry) and executes queries against it. It
does not talk to REST APIs, does not read OpenAPI specs, and does not compose
subgraphs itself. There is no equivalent of Grafbase's `grafbase compose` or
the REST WASM extension.

**Consequence for this spike:** federating three REST services under Hive
Router requires (a) a real GraphQL subgraph per REST service, and (b) an
external Federation-compliant composer to produce the supergraph file. Both
had to be built from scratch — see
[`01-poc-architecture.md`](./01-poc-architecture.md). This confirmed the
biggest risk flagged in the original spike plan before a single line of PoC
code was written, and it's the reason the PoC scope became "build two missing
subgraphs + a composition script," not "port the REST extension config."

## 3. REST/OpenAPI integration

No native REST directive equivalent to Grafbase's `@restEndpoint`/`@rest`
exists for Hive Router. The documented path for turning REST/OpenAPI into a
federated subgraph is **GraphQL Mesh** (a separate Guild project,
`@graphql-mesh/transport-rest`), which generates a subgraph from an OpenAPI
spec automatically — analogous in spirit to this repo's own
`schema-gen/generate.mjs`, but for a different target (a live subgraph server,
not GraphQL types to hand-wire into REST-extension directives).

Mesh was **not** used in this PoC — the two new subgraphs
(`accounts-subgraph`, `policies-subgraph`) were hand-written, following the
existing `funds-subgraph` pattern already in this repo, to keep the
comparison controlled and because standing up Mesh's OpenAPI handler was out
of scope for a time-boxed execution. **This is a real gap, not a finding** —
whether Mesh's generated subgraphs handle schema drift better or worse than
this repo's hand-written ones is unanswered and is the top follow-up item.

Source: [GraphQL Mesh v1 / Hive Gateway v1 announcement](https://the-guild.dev/graphql/hive/blog/graphql-mesh-v1-hive-gateway-v1).

## 4. Caching — confirmed NOT implemented

Checked the current (2026-08-21) Hive Router configuration reference
directly. Documented top-level config sections: `authorization`, `cors`,
`csrf`, `headers`, `http`, `jwt`, `log`, `override_subgraph_urls`,
`persisted_documents`, `storages`, `override_labels`, `query_planner`,
`response_extensions`, `supergraph`, `traffic_shaping`, `telemetry`,
`introspection`, `limits`, `subscriptions`, `demand_control`, `laboratory`.

**No `cache`, `caching`, or `responseCaching` section exists.** Response/entity
caching is an **open RFC** —
[graphql-hive/router#312](https://github.com/graphql-hive/router/issues/312),
opened 2025-08-07, still open at research time a year later. The proposal
sketches a Redis-backed design (`globalTtl`, `ttlByCoordinate`,
`@cacheControl` support, `@key`-derived entity identity) that is direct
functional overlap with Grafbase's `entity_caching`/`operation_caching` — but
it is not shipped code today.

This directly contradicts an implicit assumption in the original spike
description (that caching would be a like-for-like comparison). It isn't —
see [`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md)
for the full implication.

Source: [Configuration reference | Hive Router](https://the-guild.dev/graphql/hive/docs/router/configuration),
[RFC: Response Caching #312](https://github.com/graphql-hive/router/issues/312).

## 5. Auth — parity on paper

Both gateways have a documented native JWT/JWKS mechanism:

- **Hive Router:** `jwt` is a first-class top-level config section (per the
  config reference above).
- **Grafbase Gateway:** the `extensions.jwt` extension, configured with a
  JWKS URL, expected `iss`/`aud`, and a header template — same shape as Hive
  Router's approach. Field-level authorization is available via
  `@authenticated`/`@requires-scopes` directives.

Neither was wired up and tested in this PoC (time-boxed out); both are
sourced from docs, not hands-on-verified here. Flagged as a follow-up.

Sources: [JWT extension — Grafbase](https://grafbase.com/extensions/jwt),
[Authentication — Grafbase docs](https://grafbase.com/docs/gateway/configuration/authentication).

## 6. Observability — both claim OTel + Prometheus; only log format was hands-on verified

Hive Router's docs claim OpenTelemetry tracing and a Prometheus scrape
endpoint, plus metrics on "traffic, error rate, latency, **cache behavior**,
and supergraph reloads" (the "cache behavior" metric exists even though
caching itself doesn't ship yet — likely forward-looking for the RFC in #312).
This PoC did verify, hands-on, that Hive Router emits **structured JSON logs**
by default (`{"timestamp":...,"level":"INFO","target":"router::core","message":...}`)
and that it logs one line per request at `INFO` by default — under the
benchmark load in this spike that produced a 677,000-line container log for
roughly 677,000 requests (see `evidence/hive-router-container-logs.txt`,
trimmed). Grafbase's production gateway, under the same request volume across
this session, did **not** produce comparable per-request log volume — its
default verbosity is lower. Both are real, hands-on observations; the OTel/
Prometheus wiring itself was not tested. Full detail in
[`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md).
