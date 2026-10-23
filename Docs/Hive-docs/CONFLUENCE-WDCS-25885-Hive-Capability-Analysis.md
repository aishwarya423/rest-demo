# WDCS-25885 — SPIKE: Hive Capability Analysis and Recommendation

**Jira:** WDCS-25885 · **Status:** Ready for review / spike closure
**Date of investigation:** 2026-10-23
**Repository:** `rest-demo` · branch `gateway-evaluation`
**Related spike:** [WDCS-23671 — GraphQL Gateway Evaluation](../gateway-evaluation/CONFLUENCE-WDCS-23671-Gateway-Evaluation.md)

> **Provenance.** Findings are labelled **[Verified]** (executed on a developer
> machine or read from shipped package source), **[Documented]** (stated in
> official vendor documentation, not exercised here) or **[Unverified]**. Nothing
> is asserted from memory. Versions are pinned throughout.

---

## 1. Overview

This spike asked whether Hive can support the long-term GraphQL federation
architecture currently implemented through Grafbase, and to validate Federation
2.0 compatibility, schema governance, licensing and production deployment
patterns.

The investigation produced one finding that reframes the question entirely:

> **The Guild — the company that builds Hive — acquired Grafbase on 2026-02-10.
> The Grafbase platform and dashboard have already sunsetted. The Grafbase
> Gateway and CLI are in maintenance mode and were scheduled for archive by end
> of May 2026, a date now five months past. Grafbase's own repository directs
> users to Hive Router or Hive Gateway.** [Verified]

So this is not a competitive evaluation between two live options. Grafbase is
end-of-life, Hive is its vendor-designated successor, and the two products now
share an owner. The spike's real question becomes: **is Hive adequate for the
long-term architecture, and what does migration cost?**

The answer is yes, with a clear-eyed view of what self-hosting costs. All six
acceptance criteria are addressed in §13.

---

## 2. Problem Statement

The current architecture federates three insurance REST APIs — Accounts (`:3001`),
Funds (`:3002`) and Policies (`:3003`) — into a single GraphQL API, implemented
with Grafbase and documented across this repository.

Three things needed establishing before any long-term commitment:

1. **Continuity.** Can the current approach be sustained, and if not, what
   replaces it?
2. **Capability parity.** Does Hive cover federation, REST composition, schema
   governance and registry functions that the architecture depends on?
3. **Operational and commercial fit.** What does running Hive in production
   require, and what does it cost in licensing and operational effort?

The prior spike (WDCS-23671) compared gateway runtimes. It did **not** examine
Hive Registry, schema governance, licensing or production deployment patterns.
Those four areas are the substance of this spike.

---

## 3. Objectives and Scope

### In scope

| Objective | Source |
|---|---|
| Document Hive Gateway capabilities | AC 1 |
| Document Hive Router capabilities | AC 2 |
| Confirm or reject Federation 2 support | AC 3 |
| Identify Schema Registry integration path | AC 4 |
| Enterprise capability assessment — governance, licensing, observability, deployment | AC 5 |
| Produce recommendation | AC 6 |

### Out of scope

- Re-running the gateway performance benchmarks from WDCS-23671.
- Re-verifying caching and cache invalidation, completed under WDCS-23671.
- A production migration plan. This spike sizes the work; it does not schedule it.
- Standing up a full self-hosted Hive Console (justification in §7).

---

## 4. Existing Implementation and Investigation

Substantial prior work was reused rather than repeated.

| Artefact | What it already establishes | Reused how |
|---|---|---|
| [`hive-poc/`](../../hive-poc/) | Hive Gateway + GraphQL Mesh federating all three REST APIs with no subgraph servers; Redis/Valkey response caching with entity tags and explicit invalidation | Source for AC 1 |
| [`hive-router-poc/`](../../hive-router-poc/) | Hive Router over three Yoga subgraphs, with subgraph-level response caching | Source for AC 2; its composed supergraph feeds this spike's MVP |
| [`hive-router/compose.mjs`](../../hive-router/compose.mjs) | Federation v2 composition via `@apollo/composition` 2.9.3 | Federation evidence |
| `accounts-subgraph/`, `policies-subgraph/`, `funds-subgraph/` | Three Federation v2 subgraphs | Federation evidence; reused by the MVP |
| [`Docs/Hive-docs/HIVE-EVALUATION.md`](./HIVE-EVALUATION.md) | Hive Gateway caching internals, Redis key layout, invalidation semantics | Source for AC 1 |
| [`Docs/Hive-docs/CONFLUENCE-REST-Integration-Options.md`](./CONFLUENCE-REST-Integration-Options.md) | Gateway can call REST directly; Router cannot | Source for AC 1 and AC 2 |
| [`WDCS-23671 outcome`](../gateway-evaluation/CONFLUENCE-WDCS-23671-Gateway-Evaluation.md) | Gateway vs Router runtime comparison, benchmarks, image sizes | Context |

**Gap identified:** nothing in the repository referenced a schema registry,
schema publishing, schema checks or governance. `grep -rl "registry\|schema:publish\|schema:check"`
across tracked sources returns no matches outside this spike's own output. Hive
Registry was entirely unexamined, which is where the new work went.

---

## 5. Approach Evaluated

1. **Establish continuity facts first.** Verify the state of Grafbase directly
   from the vendor's repository and announcement, because a capability comparison
   is worthless if one option is discontinued.
2. **Confirm Federation 2 from artefacts, not claims.** Read the spec version
   out of the subgraph SDLs and the composed supergraph in this repository.
3. **Map the registry integration path** for both Hive runtimes, from official
   configuration references, and corroborate against the shipped CLI.
4. **Assess enterprise posture** — governance, licensing, observability,
   deployment — from official documentation and repository metadata.
5. **Build the smallest MVP that closes a real evidence gap**, rather than one
   that re-demonstrates what already works (§7).

---

## 6. Findings and Evidence

### 6.1 Continuity: Grafbase is end-of-life — the decisive finding

Verbatim from [`grafbase/grafbase/README.md`](https://github.com/grafbase/grafbase):

> "The Grafbase platform, dashboard and app has sunsetted and no longer
> operational. If you are looking for an alternative schema registry, please
> refer to Hive Console by The Guild."
>
> "Grafbase Gateway, Grafbase CLI and other components in this repository are
> currently on maintenance mode. During maintenance mode, only high severity
> security releases and fixes will be made."
>
> "Grafbase Gateway, Grafbase CLI, and this repository will be archived by end of
> May 2026. If you are looking for a performant and Federation-compatible GraphQL
> router, please refer to Hive Router or Hive Gateway"

Corroborating evidence [Verified]:

| Check | Result |
|---|---|
| GitHub repo description | `[Acquired by The Guild] The Grafbase GraphQL Federation Gateway` |
| Repo `archived` flag | `false` — not yet formally archived |
| Repo `pushed_at` | `2026-07-01` — no commits in ~16 weeks |
| Repo licence | **MPL-2.0** (note: not MIT, unlike Hive) |
| Acquisition announcement | The Guild's Hive blog, dated **2026-02-10** |
| The Guild's own site | "Acquired Stellate (2024) and Grafbase (2026)" |

The announcement states the Grafbase dashboard is being folded into Hive Console
and the Grafbase Rust router into Hive Router, that "we're now open sourcing the
entire stack," and that existing users may migrate at their own pace. [Documented]

**Implication.** The Grafbase schema registry — the governance component this
spike was asked to find a Hive equivalent for — **no longer exists as a running
service**. There is no "stay as we are" option for the registry layer. This also
corrects WDCS-23671, which scored Grafbase as a viable incumbent fallback; that
assessment predates this finding (see §10, risk 1).

### 6.2 AC 3 — Federation 2 support: **CONFIRMED**

Read directly from artefacts in this repository [Verified]:

| Evidence | Value |
|---|---|
| Subgraph SDL spec link (all three subgraphs) | `@link(url: "https://specs.apollo.dev/federation/v2.3", import: [...])` |
| Composed supergraph spec links | `specs.apollo.dev/join/v0.3`, `specs.apollo.dev/link/v1.0` |
| Composition libraries used | `@apollo/composition` 2.9.3; `@theguild/federation-composition` 0.27.0 ("Open Source Composition library for Apollo Federation") |
| Federation 2 directives exercised | `@key`, `@external`, and `@key(resolvable: false)` unresolvable stubs |
| Entity merge across subgraphs | `Account` carries `@join__type(graph: ACCOUNTS, key: "id")` **and** `@join__type(graph: POLICIES, key: "id", extension: true)` |

`join/v0.3` is the Federation 2 supergraph spec; `federation/v2.3` is an explicit
Federation 2 subgraph declaration. Both Hive Router **0.3.1** and Hive Gateway
**2.x** executed this supergraph correctly, returning the full three-way join
(re-verified 2026-10-23 under WDCS-23671 §9.1 and again here via the MVP).

**Verdict: Federation 2 is confirmed, not merely claimed.** Hive composes and
executes Federation 2.3 subgraphs including cross-subgraph entity resolution.

One nuance worth recording: Hive maintains its **own** Federation composition
library (`@theguild/federation-composition`) rather than depending on Apollo's.
Independent implementations can diverge on edge cases. No divergence was observed
on the directives this architecture uses, but advanced features not exercised
here — `@interfaceObject`, `@composeDirective`, progressive `@override` — were
**not tested**. [Unverified]

### 6.3 AC 1 — Hive Gateway capabilities

Node.js runtime, `@graphql-hive/gateway` v2.x, **MIT** licensed.

| Capability | Status | Evidence |
|---|---|---|
| Federation 2 execution | ✅ | §6.2 |
| **REST composition without subgraph servers** | ✅ | Mesh `@omnigraph/openapi` generates the mapping from existing `openapi.yaml`; `hive-poc` runs 9 services and **zero** subgraph servers [Verified] |
| Response caching (removes upstream calls) | ✅ | Redis/Valkey backed; 90 ms miss → 2.5 ms hit [Verified, WDCS-23671 §9.5] |
| Custom cache keys | ✅ | `buildResponseCacheKey`; keys readable, not opaque hashes [Verified] |
| Cache tags + explicit invalidation | ✅ | Entity tag keys; 16 keys purged for one entity, unrelated entries survived [Verified] |
| TTL control | ✅ | Global, per-type and per-field |
| Schema registry integration | ✅ | `--hive-cdn-endpoint` / `--hive-cdn-key`, or `supergraph.type: "hive"` [Verified: flags present in shipped CLI] |
| Apollo GraphOS uplink | ✅ | `--apollo-graph-ref`, `--apollo-key`, `--apollo-uplink` [Verified: flags present] |
| Usage reporting to Hive | ✅ | `--hive-target` + `--hive-access-token` [Verified: flags present] |
| Hive tracing | ✅ | `--hive-trace-access-token` [Verified: flag present] |
| Persisted documents | ✅ | `--hive-persisted-documents-endpoint`, with cache TTL flags [Verified: flags present] |
| Schema polling | ✅ | Default 10 s, `--polling` |
| JWT / JWKS auth | ⚠️ | [Documented] — not wired up or tested |
| OpenTelemetry / Prometheus | ⚠️ | [Documented] — not wired up or tested |

**Caveat on footprint.** The official `ghcr.io/graphql-hive/gateway` image measures
**618 MB**. This repository's POC build measures **1.86 GB** because it runs
`npm install` at image build time — a defect in our Dockerfile, not a product
property. [Verified: `docker images`, 2026-10-23]

### 6.4 AC 2 — Hive Router capabilities

Rust runtime, `hive-router` **0.3.1**, **MIT** licensed.

| Capability | Status | Evidence |
|---|---|---|
| Federation 2 execution | ✅ | §6.2 |
| **REST composition** | ❌ **None** | Consumes federated GraphQL subgraphs over HTTP only. No REST transport, no extension point that adds one. Federating these three REST APIs cost **three hand-written Yoga subgraphs, 916 lines, 15 containers** [Verified] |
| Schema composition | ❌ Not provided | Loads a pre-composed supergraph. An external composer must exist in CI |
| **Response caching** | ❌ **None** | Open RFC [#312](https://github.com/graphql-hive/router/issues/312), opened 2025-08-07, still open |
| Plan/parse/validation cache | ✅ in-memory only | A `cache:` config key exists and is easy to mistake for a response cache. It never stores response data and never removes an upstream call [Verified: config accepted by 0.3.1] |
| Registry integration (`source: hive`) | ✅ | `endpoint`, `key`, `poll_interval` (default 10 s), comma-separated fallback endpoints [Documented] |
| Apollo GraphOS uplink | ✅ | `source: apollo_graphos` [Documented] |
| **S3 artifact source** | ✅ | `source: storage` + `storages.<id>.type: s3` — **verified end to end in this spike's MVP** (§7, §8) |
| Supergraph from file, with polling | ✅ | `source: file` |
| OpenTelemetry tracing | ✅ [Documented] | Exporters: `otlp` (HTTP/gRPC), `stdout`, `datadog`; plus Hive Console tracing |
| Prometheus metrics | ✅ [Documented] | `kind: prometheus`, configurable port and path; per-instrument attribute control |
| JWT, CORS, CSRF, rate limiting, demand control | ✅ [Documented] | First-class config sections |
| Persisted documents | ✅ [Documented] | Including an L2 cache |
| Extensibility | ⚠️ | Rust plugins (only `on_http_request` and `on_graphql_params` can short-circuit) plus an HTTP coprocessor |
| Runtime image | ✅ **135 MB** | Pure Rust binary; ~48 ms cold start [Verified] |
| Default log verbosity | ⚠️ | One INFO line per request. A benchmark produced ~677,000 log lines for ~677,000 requests. Needs level tuning before production [Verified, WDCS-23671] |
| Maturity | ⚠️ | **Pre-1.0.** The `cache` key did not exist at v0.2.0 and does at v0.3.1 — the config surface is still moving |

**Observability is a genuine upgrade over the prior assessment.** WDCS-23671
recorded OTel/Prometheus as "claimed, not verified." The configuration surface is
now documented concretely, including native Datadog export. Still not wired up
here, so it remains [Documented].

### 6.5 AC 4 — Schema Registry integration path

**Hive Console** is the registry (`graphql-hive/console`, **MIT**, actively
developed — last push 2026-10-23 [Verified]).

**Governance capabilities** [Documented]:

| Capability | Detail |
|---|---|
| Breaking-change detection | Schema diff via GraphQL-Inspector |
| **Conditional breaking changes** | Uses real operation data from the gateway: removing a field no client requests is **not** treated as breaking |
| Schema checks in CI | `hive schema:check`, with `--baseline` for merge queues; GitHub merge-queue support |
| Composition validation | Federation projects validated against composition rules and the subgraph spec |
| Publish gating | `hive schema:publish --fail-on-composition-error` rejects a publish that fails composition. **Default behaviour records an invalid version instead** |
| Schema Policy linting | Configurable rules, each as warning or error; errors fail the check |
| Versioning | Every publish records author, date, SDL, status, optional git commit; Changelog and Diff views |
| Promotion and rollback | `hive schema:promote --from <target> --to <target>`, and `--version <id>` to roll back |
| Usage analytics | Operation-level usage collected from the gateway |

**Delivery to the runtime — two paths, and the distinction matters:**

| Deployment | Artifact delivery | Runtime config |
|---|---|---|
| **Hive Console Cloud** | High-Availability CDN, which "serves the latest **valid** supergraph" so gateways keep running through a bad publish | Router `source: hive`; Gateway `--hive-cdn-endpoint` |
| **Self-hosted Hive Console** | **HA CDN not available.** Falls back to artifact endpoints on the `server` service, with artifacts in S3-compatible storage | Router `source: storage` over S3 — **verified in §8** |

Verbatim from the self-hosting documentation: **"The High-Availability CDN and
billing integrations are not available."**

This is the single most consequential operational difference between cloud and
self-hosted Hive, and it is the gap the MVP was built to close.

### 6.6 AC 5 — Enterprise capability assessment

#### Licensing

| Component | Licence | Commercial terms |
|---|---|---|
| Hive Router | **MIT** [Verified] | Free, self-hosted |
| Hive Gateway | **MIT** [Verified] | Free, self-hosted |
| Hive Console (registry) | **MIT** [Verified] | **Self-hosting is free and open source.** Paid plans apply only to managed cloud, priced on usage rather than seats, with a free Hobby tier [Documented] |
| Grafbase Gateway | MPL-2.0 [Verified] | Open source, **in maintenance mode, archive scheduled** |
| Grafbase Enterprise Platform (registry) | Proprietary | **Custom-priced, contact sales**, 60-day trial [Documented] — and the platform has **sunsetted** |

**This is a strict commercial improvement.** The governance layer moves from a
proprietary, sales-negotiated product that no longer runs, to an MIT-licensed one
that can be self-hosted at no licence cost. One documented inconsistency: vendor
marketing claims no features are paywalled, while the self-hosting docs state the
HA CDN and billing are unavailable. **Trust the docs.**

#### Self-hosted deployment reality

The community Docker Compose stack requires [Documented]:

- **PostgreSQL 16** — users, organisations, projects, targets, schemas
- **ClickHouse** — operation usage data
- **Redis** — caching
- **Redpanda** — Kafka-compatible broker for usage reports
- **MinIO + Caddy** — S3-compatible artifact and audit-log storage
- Nine Hive services: `app`, `server`, `schema`, `policy`, `workflows`, `usage`,
  `usage-ingestor`, plus one-shot `migrations` and `s3_provision_buckets`

Roughly **15 containers** for the control plane alone, before any gateway.

Its own documentation is explicit about the limits:

- The bundled stack is single-instance with local filesystem storage and is
  offered **"not as a production-ready architecture."**
- Compose is wired for `localhost`; remote deployment needs overridden public
  URLs, an HTTPS reverse proxy and routing for app, API, artifacts and usage API.
- Single-node databases and the broker **should be replaced** with managed or
  properly operated equivalents, with backups configured.
- **"The community stack does not include Prometheus, Grafana, an OpenTelemetry
  Collector, or Sentry"** — monitoring is the adopter's problem.
- **Helm/Kubernetes is not documented.** Compose is the only documented method.
- MinIO and Redpanda ports must be restricted from public exposure.

**Assessment:** the data plane (Router or Gateway) is genuinely lightweight — a
135 MB binary or a 618 MB Node image. The **control plane is a serious
undertaking**: five stateful dependencies, no Helm chart, no bundled monitoring,
and an explicit disclaimer against the reference topology. Options are to operate
it properly, use Hive Console Cloud, or adopt a gateway-only deployment with
composition in CI and artifacts in S3 — which is exactly what the MVP validates.

---

## 7. MVP Implemented — and why one was necessary

**An MVP was justified, but only a narrow one.**

Five of the six acceptance criteria are satisfied by documentation and by
artefacts already in this repository. Federation 2 (AC 3) was verifiable from
existing SDL. Gateway and Router capabilities (AC 1, AC 2) were established by
`hive-poc` and `hive-router-poc`. Rebuilding any of that would have duplicated
work, which the spike explicitly forbids.

One question could not be answered from documentation, and it is load-bearing for
the recommendation:

> Self-hosted Hive Console has **no HA CDN**. Its artifacts live in S3-compatible
> storage. Can Hive Router actually consume a supergraph from that store, and
> pick up a new version when one is published?

If the answer were no, self-hosted Hive would have no viable schema-delivery
mechanism, and the recommendation would have to change. That warranted a test.

### What was built

[`hive-registry-poc/`](../../hive-registry-poc/) — three services:

| Service | Role |
|---|---|
| `s3` | S3-compatible artifact store, standing in for the self-hosted Hive artifact bucket |
| `publish-artifact` | One-shot `aws s3 cp`, standing in for `hive schema:publish` plus Console-side composition |
| `hive-router-registry` | Hive Router 0.3.1 on `:4100` with `supergraph.source: storage` |

Scope discipline:

- **Hive Console was deliberately not deployed.** Testing the delivery mechanism
  does not require the control plane that produces the artifact, and standing up
  15 containers would have been disproportionate.
- **Nothing was duplicated.** The three subgraphs and the composed supergraph come
  from `hive-router-poc` via an external Docker network and an external volume.
- The router runs on `:4100` so it coexists with the existing POC on `:4000`.

### Image availability, recorded because it affects reproducibility

Hive's `storages` documentation offers MinIO and LocalStack as examples. Neither
is freely pullable any more [Verified 2026-10-23]:

| Image | Result |
|---|---|
| `minio/minio`, `minio/mc` | `401 pull access denied` |
| `quay.io/minio/minio`, `quay.io/minio/mc` | `401 UNAUTHORIZED` |
| `localstack/localstack:latest` | exits 55 — licence required, Pro only |
| `localstack/localstack:s3-latest` | exits 1 — "discontinued with the release of v2026.03", Pro only |
| `adobe/s3mock:latest` | ✅ runs anonymously |

Adobe S3Mock was used to keep the test reproducible without a licence. **The
router configuration is unchanged for MinIO or real AWS S3** — only `endpoint`
differs, and `allow_http` is dropped behind TLS.

---

## 8. Results and Validation

Executed 2026-10-23, `hive-router` 0.3.1. Reproduction steps:
[`hive-registry-poc/README.md`](../../hive-registry-poc/README.md).

| # | Check | Result |
|---|---|---|
| 1 | Artifact published to `s3://router-artifacts/supergraph/current.graphql` | ✅ 5,055 bytes |
| 2 | Router boots with `supergraph.source: storage` | ✅ `supergraph loaded successfully with changes, updating...` |
| 3 | Full three-way federated query via the S3-sourced router | ✅ Anika Rao, £186,420.75, 2 policies, 3 fund holdings resolved |
| 4 | Republish **without** `poll_interval` | ❌ **no reload observed in 80 s** |
| 5 | Republish **with** `poll_interval: 10s` | ✅ **live in ~2 s, no restart** |
| 6 | Federated data correct after two hot reloads | ✅ unchanged |

### The finding that matters for production

`poll_interval` is documented under `supergraph.source: hive`. It is **not shown
in the `storage` example**, and omitting it produced a router that loaded the
artifact once at startup and **never again — with no error and no warning.**
Check 4 is that failure, reproduced deliberately.

The router does accept `poll_interval` under `source: storage`, and with it the
rollout was effectively immediate. **Set it explicitly.** A self-hosted
deployment that omits it will appear healthy while silently serving a stale
schema after every publish.

### Other validation performed

| Check | Command | Result |
|---|---|---|
| Hive Gateway registry flags | `hive-gateway supergraph --help` | ✅ `--hive-cdn-endpoint`, `--hive-cdn-key`, `--hive-target`, `--hive-access-token`, `--hive-trace-access-token`, `--apollo-graph-ref`, `--apollo-key` all present |
| Licences | GitHub API on `graphql-hive/{console,router,gateway}` | ✅ MIT, MIT, MIT |
| Grafbase status | GitHub API + README on `grafbase/grafbase` | ✅ MPL-2.0, `pushed_at 2026-07-01`, sunset notice |
| Federation spec versions | `grep` over subgraph SDL and supergraph | ✅ `federation/v2.3`, `join/v0.3` |
| Router accepts `cache` key | `hive-router-poc` startup with `cache:` block | ✅ 0.3.1 starts cleanly |
| Compose file validity | `docker compose config -q` | ✅ no errors |

### Not validated

Hive Console was never run. Schema checks, breaking-change detection, conditional
breaking changes, policy linting, promotion, rollback and usage analytics are
**[Documented] only**. The publish step is an `aws s3 cp`, not `hive schema:publish`.
No auth, TLS or signature verification was tested; S3Mock ignores credentials.
Hot reload was verified with an additive SDL change only — behaviour on an
invalid artifact was not tested, and notably the CDN's documented guarantee to
serve the latest **valid** supergraph is a Console-side property this S3 path
does **not** reproduce.

---

## 9. Comparison and Trade-offs

### 9.1 Decision matrix — the three Hive components

| Capability | Hive Router | Hive Gateway | Hive Console |
|---|---|---|---|
| Runtime | Rust | Node.js | Node.js + 5 stateful deps |
| Licence | MIT | MIT | MIT |
| Role | data plane | data plane | control plane |
| Federation 2 | ✅ | ✅ | ✅ composes |
| REST composition | ❌ needs subgraphs | ✅ via Mesh, none needed | n/a |
| Response caching | ❌ | ✅ Redis/Valkey | n/a |
| Registry client | ✅ `source: hive`/`storage` | ✅ CDN flags | n/a |
| Schema governance | n/a | n/a | ✅ checks, policy, versioning |
| Throughput | ~2× Gateway class | baseline | n/a |
| Footprint | 135 MB | 618 MB official | ~15 containers |
| Maturity | pre-1.0 (0.3.1) | v2.x established | actively developed |

### 9.2 Hive versus the status quo

| Dimension | Grafbase (current) | Hive | Verdict |
|---|---|---|---|
| Product status | **Sunsetted platform; gateway archive scheduled** | Actively developed, pushed today | **Hive** |
| Registry licence | Proprietary, contact sales | **MIT, free self-hosted** | **Hive** |
| Gateway licence | MPL-2.0 | MIT | Hive |
| REST composition | `@rest` WASM extension, declarative | Mesh from OpenAPI, generated | Comparable; Hive keeps specs as source of truth |
| Response caching | ❌ plan cache only | ✅ Gateway caches responses | **Hive** |
| Explicit cache invalidation | ❌ opaque keys | ✅ entity tags | **Hive** |
| Federation 2 | ✅ | ✅ | Tie |
| Schema governance | Platform gone | Checks, policy, conditional breaking changes | **Hive** |
| Self-hosted control plane | Helm on Kubernetes [Documented] | **Compose only, no Helm** | **Grafbase was ahead here** |
| HA artifact CDN | S3-backed object storage service | **Cloud only; S3 fallback self-hosted** | Comparable |

### 9.3 Trade-offs of adopting Hive

Stated plainly:

- **Control-plane operational burden.** Five stateful dependencies, no Helm
  chart, no bundled monitoring, and a documented disclaimer against the reference
  topology. This is the single largest cost.
- **No managed HA CDN when self-hosting.** The S3 path works (§8) but does not
  reproduce the CDN's "serve the last valid supergraph" safety property.
- **Router/Gateway is a real either-or.** Router is faster and smaller but cannot
  touch REST and cannot cache responses. Gateway does both but runs on Node.
  WDCS-23671 recommended Gateway for this estate; nothing here changes that.
- **Hive's own Federation composition library.** Independent of Apollo's, so
  edge-case divergence is possible. Untested on advanced directives.
- **Router is pre-1.0.** Its config surface moved between 0.2.0 and 0.3.1 during
  these two spikes.
- **Migration is not free.** Grafbase's `@rest`/`@restEndpoint` schema does not
  port. The OpenAPI specs do, which is the point of the Mesh path.

---

## 10. Limitations and Risks

| # | Risk / limitation | Severity | Status and mitigation |
|---|---|---|---|
| 1 | **WDCS-23671 treats Grafbase as a viable fallback. It is not — the platform has sunsetted.** | **High** | Confirmed here. That document's Grafbase column should be read as end-of-life. A note has been added to it pointing at this spike |
| 2 | `poll_interval` omitted under `source: storage` silently serves a stale schema | **High** | Reproduced (§8 check 4). Always set it. Add a startup assertion or config lint |
| 3 | Self-hosted Hive Console has no HA CDN | Medium | Confirmed. Use the S3 path (validated) and accept that invalid-publish protection must come from `--fail-on-composition-error` in CI instead |
| 4 | Self-hosted control plane is not production-ready as shipped | **High** | Vendor-documented. Replace single-node Postgres/ClickHouse/Redis/Redpanda with managed equivalents; add monitoring; author Helm charts or evaluate Hive Console Cloud |
| 5 | No Helm/Kubernetes deployment documented for Hive Console | Medium | Compose only. Grafbase documented Helm, so this is a regression for a Kubernetes estate |
| 6 | Registry governance features are documented, not exercised | Medium | Schema checks, policy linting, conditional breaking changes and analytics are all [Documented]. A follow-up spike should run them against a real Console |
| 7 | Default publish records an invalid schema version rather than rejecting it | Medium | Pass `--fail-on-composition-error` and run `hive schema:check` in PRs |
| 8 | Hive Router is pre-1.0 | Medium | Config surface still moving. Pin versions; re-verify config on upgrade |
| 9 | Hive's Federation composition library is independent of Apollo's | Low-Medium | No divergence seen on `@key`/`@external`. `@interfaceObject`, `@composeDirective`, progressive `@override` untested |
| 10 | Auth and observability untested on any Hive component | Medium | Carried forward unresolved from WDCS-23671. Both are well documented; neither is wired up |
| 11 | MinIO and LocalStack images are no longer freely pullable | Low | Affects local reproducibility only. Recorded in §7; real deployments use managed S3 |
| 12 | Vendor statements on self-hosted feature parity conflict | Low | Marketing says nothing is paywalled; docs say HA CDN and billing are unavailable. Trust the docs |

---

## 11. Recommendation

### Recommendation

**Adopt Hive. Treat it as a migration, not an evaluation, because the current
Grafbase platform has already been discontinued by the vendor that now owns Hive.**

Specifically:

1. **Data plane — Hive Gateway with GraphQL Mesh.** It composes the three REST
   APIs from the OpenAPI specs already maintained here, needs no subgraph servers,
   and is the only Hive runtime with a response cache and explicit invalidation.
   This is unchanged from WDCS-23671 and is reinforced here: Hive Router would
   require three hand-written subgraph servers purely because it cannot speak REST.
2. **Control plane — Hive Console for schema governance**, but **decide
   deliberately between Cloud and self-hosted.** Self-hosting is MIT and free of
   licence cost but is a genuine platform-engineering commitment: five stateful
   dependencies, no Helm chart, no bundled monitoring, and no HA CDN. Hive Console
   Cloud removes all of that for a usage-based fee.
3. **Schema delivery — if self-hosting, use the S3 artifact path**, validated in
   §8, and **set `poll_interval` explicitly.**
4. **Gate publishes in CI** with `hive schema:check` on pull requests and
   `hive schema:publish --fail-on-composition-error` on merge, since the default
   records an invalid version rather than rejecting it.

### Rationale

Federation 2 is confirmed from artefacts, not claims (§6.2). Hive covers every
capability the current architecture depends on, and adds two it lacks entirely:
response caching that removes upstream REST calls, and a schema registry that is
MIT-licensed rather than proprietary. The registry integration path is identified
and its self-hosted delivery leg is tested working.

The decisive argument is not capability, though. It is that **there is no
alternative worth weighing.** Grafbase's platform is sunsetted, its gateway is in
maintenance mode with an archive date already past, and its own repository points
to Hive. Staying put is not a stable option; the only real choice is whether to
migrate to Hive deliberately or be forced into it later.

### Confidence: High on direction, Medium on operational sizing

High on continuity, Federation 2, licensing and the registry integration path —
all verified from primary sources or executed here. Medium on the operational
cost of self-hosting Hive Console, which is assessed from documentation rather
than from having run it. Low on governance feature quality, which is documented
and untested.

### Recommended next steps

1. **Decide Hive Console Cloud versus self-hosted.** This is the largest open
   question and it is commercial as much as technical.
2. **Run a Hive Console spike** — publish the three subgraphs, break one
   deliberately, and verify schema checks, policy linting and conditional
   breaking changes actually behave as documented.
3. **Wire JWT auth and OTel/Prometheus** on Hive Gateway. Unresolved across two
   spikes now.
4. **Benchmark Hive Gateway.** Still the recommended runtime with no performance
   data (carried from WDCS-23671).
5. **Add a config guard for `poll_interval`** if the S3 delivery path is adopted.
6. **Author Helm charts** for Hive Console if the target is Kubernetes.

---

## 12. Conclusion

Hive can support the long-term GraphQL federation architecture. Federation 2.3 is
confirmed from the SDL and composed supergraph in this repository and executes
correctly on both Hive runtimes. The schema registry integration path is
identified for both, and its self-hosted leg — S3 artifact delivery, which exists
precisely because the HA CDN is cloud-only — was built and verified working,
including hot reload on republish.

Two findings should change how this decision is framed.

**The first is that the question has already been answered by the market.** The
Guild acquired Grafbase in February 2026, the Grafbase platform and dashboard have
sunsetted, the gateway is in maintenance mode with an archive date five months
past, and Grafbase's own repository directs users to Hive. This is a migration,
and WDCS-23671's framing of Grafbase as a viable incumbent fallback is now
obsolete.

**The second is that Hive's cost is operational, not commercial.** All three
components are MIT licensed, and self-hosting the registry carries no licence fee
where Grafbase's equivalent was proprietary and sales-negotiated. But the
self-hosted control plane needs PostgreSQL, ClickHouse, Redis, Redpanda and
S3-compatible storage across roughly fifteen containers, ships no Helm chart and
no monitoring, and is described by its own documentation as "not as a
production-ready architecture." The licence is free; the platform engineering is
not. That trade — and not capability — is the decision actually in front of the
team.

---

## 13. Acceptance Criteria and Completion Status

| # | Acceptance criterion | Status | Where |
|---|---|---|---|
| 1 | Document Hive Gateway capabilities | ✅ **Complete** | §6.3 — 13 capabilities, verified vs documented separated |
| 2 | Document Hive Router capabilities | ✅ **Complete** | §6.4 — including the `cache`-key trap and the REST gap |
| 3 | Confirm or reject Federation 2 support | ✅ **Complete — CONFIRMED** | §6.2 — `federation/v2.3` + `join/v0.3` read from artefacts; executed on both runtimes |
| 4 | Identify Schema Registry integration path | ✅ **Complete** | §6.5 — both runtimes; cloud CDN vs self-hosted S3; S3 path **verified** in §8 |
| 5 | Complete enterprise capability assessment | ✅ **Complete** | §6.6 — licensing, governance, observability, deployment topology, with documented limits |
| 6 | Produce recommendation | ✅ **Complete** | §11 |

### Additional findings beyond the stated criteria

- **Grafbase is end-of-life** and owned by Hive's vendor (§6.1). Materially changes
  the decision and supersedes part of WDCS-23671.
- **`poll_interval` silent-staleness defect** on the S3 delivery path (§8),
  reproduced deliberately.
- **Self-hosted Hive Console has no HA CDN** (§6.5), which is why the MVP exists.
- **MinIO and LocalStack community images are no longer freely pullable** (§7).

### Outstanding, with reasons

| Item | Why it remains open |
|---|---|
| Registry governance features exercised against a live Hive Console | Needs ~15 containers; disproportionate to this spike and not required by any AC. Recommended as a follow-up (§11) |
| JWT auth, OTel/Prometheus wiring | Documented for all components; hands-on wiring is a separate task. Open since WDCS-23671 |
| Hive Gateway performance benchmark | Carried from WDCS-23671; out of scope here |
| Advanced Federation 2 directives (`@interfaceObject`, `@composeDirective`, progressive `@override`) | Not used by this architecture |
| Cloud versus self-hosted decision | Commercial decision for the team, not a technical finding |

---

## 14. References

### Official documentation

- [Hive Schema Registry](https://the-guild.dev/graphql/hive/docs/schema-registry)
- [Self-Hosting Hive Console](https://the-guild.dev/graphql/hive/docs/schema-registry/self-hosting/get-started)
- [Hive Router — configuration reference](https://the-guild.dev/graphql/hive/docs/router/configuration)
- [Hive Router — supergraph sources](https://the-guild.dev/graphql/hive/docs/router/configuration/supergraph)
- [Hive Router — storages](https://the-guild.dev/graphql/hive/docs/router/configuration/storages)
- [Hive Router — telemetry](https://the-guild.dev/graphql/hive/docs/router/configuration/telemetry)
- [Hive Gateway — supergraph source](https://the-guild.dev/graphql/hive/docs/gateway/supergraph-proxy-source)
- [Hive — Apollo Federation getting started](https://the-guild.dev/graphql/hive/docs/get-started/apollo-federation)
- [The Guild has acquired Grafbase (2026-02-10)](https://the-guild.dev/graphql/hive/blog/acquired-grafbase)
- [RFC: Response Caching — graphql-hive/router#312](https://github.com/graphql-hive/router/issues/312)

### Repositories and licences

- [`graphql-hive/console`](https://github.com/graphql-hive/console) — MIT
- [`graphql-hive/router`](https://github.com/graphql-hive/router) — MIT
- [`graphql-hive/gateway`](https://github.com/graphql-hive/gateway) — MIT
- [`grafbase/grafbase`](https://github.com/grafbase/grafbase) — MPL-2.0, sunset notice

### Versions pinned at investigation

| Component | Version |
|---|---|
| `hive-router` | 0.3.1 |
| `@graphql-hive/gateway` | 2.x |
| `@theguild/federation-composition` | 0.27.0 |
| `@apollo/composition` | 2.9.3 |
| Apollo Federation subgraph spec | v2.3 |
| Supergraph join spec | v0.3 |

### Repository artefacts

| Path | Contents |
|---|---|
| [`hive-registry-poc/`](../../hive-registry-poc/) | **This spike's MVP** — S3 artifact delivery, with results |
| [`hive-poc/`](../../hive-poc/) | Hive Gateway + Mesh + caching |
| [`hive-router-poc/`](../../hive-router-poc/) | Hive Router + subgraphs + caching |
| [`Docs/Hive-docs/HIVE-EVALUATION.md`](./HIVE-EVALUATION.md) | Hive Gateway caching internals |
| [`Docs/Hive-docs/CONFLUENCE-REST-Integration-Options.md`](./CONFLUENCE-REST-Integration-Options.md) | REST integration options |
| [`Docs/gateway-evaluation/CONFLUENCE-WDCS-23671-Gateway-Evaluation.md`](../gateway-evaluation/CONFLUENCE-WDCS-23671-Gateway-Evaluation.md) | Prior gateway evaluation |

### Reproduction

```bash
# MVP: S3 artifact delivery (requires hive-router-poc running)
docker compose -f hive-router-poc/docker-compose.yml up -d
docker compose -f hive-registry-poc/docker-compose.yml up -d
curl -s localhost:4100/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName policies{ policyNumber } } }"}'

# Federation 2 spec versions
grep -h "@link" accounts-subgraph/accounts.graphql policies-subgraph/policies.graphql funds-subgraph/funds.graphql
grep -oE 'specs\.apollo\.dev/[a-z]+/v[0-9.]+' hive-router/supergraph.graphql | sort -u

# Hive Gateway registry integration flags
(cd hive-poc/gateway && npx hive-gateway supergraph --help | grep -E 'hive-cdn|hive-target|apollo-')
```
