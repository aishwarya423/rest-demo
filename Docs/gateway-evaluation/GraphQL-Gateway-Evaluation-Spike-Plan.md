# SPIKE: GraphQL Gateway Evaluation — Grafbase vs Hive Router

> **Executed 2026-08-21.** Results, evidence, and recommendation:
> [`CONFLUENCE-Outcome.md`](./CONFLUENCE-Outcome.md) (full supporting docs
> alongside this file).

Execution plan. Owner fills in Jira project key, sprint dates, and names before
import. Grounded in the current repo state as of 2026-08-21 (branch
`feature/entity-caching-testing`) — see cross-references to existing docs
throughout.

---

## 1. Executive Summary

### The real question behind the spike

The stated question is "Grafbase or Hive Router?" but the description surfaces
a sharper, more consequential one:

> When a REST API's request/response shape changes, how much of the GraphQL
> contract updates itself, and how much is a human editing files by hand?

That's not a gateway-performance question — it's a **schema-lifecycle**
question, and it needs to be a first-class evaluation category, not folded
into "developer experience." Today's pipeline
([`Docs/SCHEMA_GENERATION.md`](../SCHEMA_GENERATION.md)) is: edit
`openapi.yaml` → `npm run schema:generate` → **manually check/update the jq
selection in `manual/federation.graphql` if a new field is non-null** →
`npm run schema:validate:e2e` → `npm run schema:promote`. That's a good,
safe, semi-automated pipeline — but it is *not* "less or no changes," and the
manual jq-selection coupling is a documented, real failure mode (§5 and §8 of
that doc). Neither Grafbase nor Hive Router will make REST response drift
100% self-healing (a required-field addition is a genuine breaking-or-not
judgment call no tool can make for you), but they differ a lot in how much
tooling exists to detect, generate, and safely roll forward that drift. That
comparison is the spike's highest-value output — rank it above raw
throughput.

### Decision drivers, ranked

1. **Schema-evolution automation** — codegen quality from OpenAPI, drift
   detection, and how safely a generated schema can be composed/validated
   before promotion (your `schema:validate` step is the bar to beat, not just
   match).
2. **True federation vs REST aggregation** — you've already proven you need
   both: `insurance` (REST extension, in-process resolution) *and*
   `funds-subgraph` (a real Federation v2 subgraph) coexist today because
   that's what it took to make entity caching real
   ([`ENTITY-CACHING-WHY-NOOP.md`](../ENTITY-CACHING-WHY-NOOP.md)). Evaluate
   both topologies for each gateway, not just one.
3. **Operational cost at your actual scale** — self-hosted binary/container
   footprint, config-file complexity, upgrade path, and whether caching
   requires topology surgery (as it did here) to work at all.
4. **Performance** — p50/p95/p99 latency and throughput overhead the gateway
   itself adds over calling REST directly, under realistic fan-out (the
   account → policies → funds join, not a flat query).
5. **Caching model fit** — operation caching vs entity caching are different
   tools; you already have empirical proof they behave differently depending
   on subgraph topology. Confirm Hive Router's caching primitives map the
   same way before assuming parity.
6. **Ecosystem/strategic fit** — team familiarity, community/commercial
   backing trajectory, and 12–18 month roadmap risk (vendor lock-in,
   sunset risk, licensing changes).

### Risks to investigate first (before writing any code)

These are the ones that can invalidate the whole spike if discovered late —
front-load them in week 1:

- **Hive Router likely has no REST-extension equivalent.** Grafbase's REST
  extension resolves REST endpoints *inside* a virtual subgraph
  ([`REST_FEDERATION.md`](../REST_FEDERATION.md)). Hive Router is a
  Federation v2 gateway/router; it expects real GraphQL subgraphs upstream.
  The likely integration path is per-service subgraphs (hand-written, like
  `funds-subgraph`, or generated via a REST/OpenAPI-to-GraphQL layer such as
  GraphQL Mesh) sitting in front of each mock REST API. **Verify this against
  current Hive/Mesh docs in week 1** — if confirmed, the Hive Router PoC is
  structurally a 3-subgraph federation (like your `funds-subgraph` pattern
  generalized to all three services), not a REST-extension port. This
  changes PoC scope and effort estimates materially.
- **"Automatic schema update" is bounded by REST contract ambiguity, not
  tooling.** A newly-required field, a type change, or a removed field are
  genuinely breaking changes no generator can silently absorb. Set
  expectations with stakeholders now: the deliverable is "fastest, safest
  path from spec change to validated schema," not "zero-touch magic."
  Document this explicitly in the spike's DoD so it isn't read as a missed
  requirement later.
- **Licensing/support model drift.** Confirm current OSS license and any
  paid-tier gating for both gateways (self-hosted feature parity, support
  SLAs) — verify against current vendor docs/pricing pages, not memory;
  gateway product tiers change frequently.
- **Team Rust/Node runtime exposure.** Both projects lean on Rust binaries
  under the hood (Grafbase gateway, and Hive Router's Rust core if that's
  still its current architecture at spike time — confirm). Operational debug
  depth (reading gateway logs, building from source if ever needed) differs
  from a pure Node/TS stack. Note this as a DX/support-cost input, not a
  blocker.
- **Mock APIs are unauthenticated toys.** `X-Api-Key` headers today are
  static strings in `docker-compose.yml`. Don't let auth evaluation stop at
  "does header-forwarding work" — score both gateways on how they'd support
  your *actual* target auth model (OIDC/JWT, mTLS, per-tenant keys) even if
  the PoC itself only proves header passthrough.

### What success looks like

A written recommendation (§8 template below) that:
- States Grafbase or Hive Router with a one-sentence reason a VP could repeat.
- Is backed by two working, side-by-side PoCs federating the same three
  services, each with a benchmark report and a completed scoring matrix.
- Explicitly answers the schema-automation question with evidence (a demo:
  change `funds/openapi.yaml`, show what's automatic vs manual, in both
  gateways).
- Names the top 3 risks of the chosen path and a mitigation for each.
- Is reviewable by someone who reads only the Confluence page, not the code.

---

## 2. Week Plan

Default to **3 calendar weeks** (15 working days), compressible to 2 if the
Hive Router REST-integration risk above resolves quickly and cleanly.

| Week | Focus | Exit criteria |
|---|---|---|
| **1** | De-risk + Grafbase PoC hardening | Hive Router integration approach confirmed against current docs; schema-automation demo scripted for Grafbase; Grafbase PoC extended to 3-subgraph topology (accounts + policies + funds, mirroring `funds-subgraph`) for apples-to-apples entity caching |
| **2** | Hive Router PoC build | Hive Router federating the same 3 services, same queries resolvable, auth headers forwarded, caching configured (or documented as unsupported/different), Docker Compose runnable end-to-end |
| **3** | Benchmarks + comparison + writeup | Both PoCs load-tested with identical scenarios; scoring matrix filled in with evidence links; Confluence page published; recommendation reviewed with stakeholders |

Daily/async checkpoint: end-of-day note in the spike ticket (what ran, what
broke, what's blocked) — cheap insurance against a 3-week spike going quiet
and getting re-litigated at the end.

---

## 3. Jira Breakdown

Parent spike + 9 subtasks. Ticket keys are placeholders (`GQL-1xx`) — replace
with your project key on import.

### Parent

**GQL-100 — SPIKE: GraphQL Gateway Evaluation (Grafbase vs Hive Router)**
Type: Spike · Points: 13 (time-boxed 3 weeks) · Epic: GraphQL Platform

> Description: as provided by the user (paste verbatim from the ticket brief).
> Definition of Done for the parent is §3.10 below — link, don't duplicate.

### Subtasks

**GQL-101 — De-risk Hive Router + REST integration approach**
- Confirm current Hive Router architecture (Rust core? Federation v2
  compliant? current version) and its REST-to-GraphQL story against official
  docs (not assumptions) — GraphQL Mesh, hand-written subgraph facades, or a
  native REST directive equivalent.
- Confirm current OSS license and self-hosted feature parity for both
  gateways.
- **AC:** a short findings note (in the ticket, not a doc) stating the
  chosen Hive Router REST-integration pattern and why; if no viable path
  exists, escalate immediately — this blocks GQL-103.

**GQL-102 — Extend Grafbase PoC to 3-subgraph topology**
- Apply the `funds-subgraph` pattern (GraphQL Yoga + `@apollo/subgraph`,
  federation SDL, `@key`) to `accounts` and `policies` as well, so Grafbase's
  PoC is a genuine multi-subgraph federation, matching what Hive Router will
  require structurally. Keep the existing REST-extension (`insurance`
  virtual subgraph) topology alive in parallel — you need both data points
  (REST-aggregation *and* true federation) for Grafbase, per decision driver
  #2.
- **AC:** `InsurancePortfolio` query (existing, in `Docs/REST_FEDERATION.md`)
  resolves identically under both topologies; entity caching produces
  `insurance-entitycache*` keys for all three entity types, not just `Fund`.

**GQL-103 — Build Hive Router PoC**
- Stand up per-service GraphQL subgraphs (or Mesh-generated) for Accounts,
  Policies, Funds; compose under Hive Router; reproduce the
  `InsurancePortfolio` query.
- Docker Compose file mirroring `docker-compose.gateway.yml`'s shape (one
  command, one command to tear down).
- **AC:** identical query, identical response shape (fields may differ only
  where genuinely gateway-specific, e.g. extension metadata); documented in
  a `HIVE_ROUTER_FEDERATION.md` mirroring `REST_FEDERATION.md`'s structure.

**GQL-104 — Schema-automation demo (both gateways)**
- Add a non-breaking field (e.g. `launchDate` to Funds, per the existing
  worked example in `SCHEMA_GENERATION.md` §5) and a breaking one (new
  required field) to one `openapi.yaml`. Run each gateway's regeneration
  path. Record exactly what was automatic vs manual, and how each caught
  (or didn't) the breaking change before runtime.
- **AC:** side-by-side table (steps, time-to-safe-schema, human touchpoints)
  for both gateways, both change types (non-breaking, breaking).

**GQL-105 — Authentication & authorization evaluation**
- Grafbase: current header-forwarding (`X-Api-Key`) plus a stretch check —
  can Grafbase gateway itself enforce JWT/OIDC validation before the request
  reaches a subgraph/extension?
- Hive Router: equivalent check for its native auth plugins/directives.
- **AC:** a table: auth mechanism, where enforced (gateway vs subgraph vs
  REST service), config complexity (LOC/lines of TOML/YAML).

**GQL-106 — Caching evaluation (operation + entity)**
- Reuse existing Redis test scripts (`scripts/run-redis-cache-test.sh`,
  `scripts/test-entity-caching.sh`) as the pattern; adapt for Hive Router's
  cache config.
- Explicitly test: does entity caching require the same "real subgraph
  boundary" condition documented in
  [`ENTITY-CACHING-WHY-NOOP.md`](../ENTITY-CACHING-WHY-NOOP.md) for Hive
  Router too, or does its architecture differ?
- **AC:** cache-hit proof (key/log evidence) for both operation-level and
  entity-level caching in both gateways, or a documented reason one doesn't
  apply.

**GQL-107 — Performance benchmarking**
- Execute the plan in §5 against both PoCs.
- **AC:** raw results + charts committed (or linked) for both gateways under
  identical load levels and query shapes.

**GQL-108 — Observability evaluation**
- What ships out of the box: structured logs, tracing (OpenTelemetry
  support?), metrics endpoint (Prometheus?), per-subgraph error attribution.
- **AC:** a captured trace/log sample from both gateways for the same failed
  query (e.g. funds service down) and the same slow query.

**GQL-109 — Comparison matrix + recommendation writeup**
- Fill in §7's scoring matrix with evidence links (ticket, doc, or
  benchmark report) for every score — no un-sourced scores.
- Publish the Confluence page (§6 deliverables).
- **AC:** recommendation reviewed and acknowledged by at least one other
  senior engineer or the platform lead before the spike is closed.

### Definition of Done for the spike

- [ ] Both PoCs run end-to-end via a single `docker compose up` command,
      federating Accounts, Policies, and Funds identically.
- [ ] Schema-automation demo completed and documented for both gateways,
      covering one non-breaking and one breaking REST change.
- [ ] Benchmark report exists for both gateways under identical scenarios
      (§5), with p50/p95/p99, throughput, error rate, and resource usage.
- [ ] Comparison matrix (§7) fully scored with evidence links, no blank
      cells.
- [ ] Risk register (§6) reviewed, each risk has an owner and mitigation.
- [ ] Confluence page published with all deliverables in §6.
- [ ] A one-paragraph recommendation exists that a non-attendee could act on
      without reading the full page.
- [ ] Recommendation reviewed with at least one other senior engineer/lead.

---

## 4. Technical Evaluation Plan

Each row: what to test, using which existing artifact as the baseline, and
the pass bar. "Baseline" columns point at what already exists in this repo so
Grafbase evaluation is largely a rerun/extension of proven work; Hive Router
columns are net-new.

### 4.1 Grafbase evaluation

| Area | What to test | Baseline in this repo | Bar |
|---|---|---|---|
| Federation | REST-extension (virtual subgraph) *and* real subgraph (`funds-subgraph`) topologies, side by side | [`REST_FEDERATION.md`](../REST_FEDERATION.md), [`funds-subgraph/README.md`](../funds-subgraph/README.md) | Both resolve `InsurancePortfolio` identically; document when you'd choose one topology over the other |
| REST integration | REST WASM extension: `@restEndpoint`, `@rest`, jq `selection`, `@require`/`@derive`/`@is` joins | `schema.graphql`, `REST_FEDERATION.md` §2–4 | Confirm no custom Rust extension needed for your join shapes (already proven — re-verify still true) |
| Auth | `X-Api-Key` header forwarding via `grafbase.toml` config | `REST_FEDERATION.md` §5 | Extend to a JWT-validation check at the gateway |
| Authorization | Field-level `@inaccessible`, any policy/claims-based directive support | `schema.graphql` (`@inaccessible` usage) | Document whether authZ beyond hide/show is possible without custom extensions |
| Caching | Operation caching (proven) + entity caching (proven, conditional on real subgraph) | [`CACHING.md`](../CACHING.md), [`ENTITY-CACHING-WHY-NOOP.md`](../ENTITY-CACHING-WHY-NOOP.md) | Extend entity caching proof to all 3 entities post-GQL-102 |
| Performance | See §5 | `docker-compose.gateway.yml` | — |
| Observability | Gateway logs, any native tracing/metrics | `docker/gateway-entrypoint.sh`, gateway logs | Capture one log sample per failure mode |
| Deployment | Binary + Docker image size, startup time, config surface (`grafbase.toml` complexity) | `Dockerfile.gateway` | Note image size, cold-start time |
| Dev experience | `grafbase dev` local loop, `grafbase compose` validation, schema-gen pipeline | `SCHEMA_GENERATION.md` | Time a full edit→validate→promote cycle |

### 4.2 Hive Router evaluation

| Area | What to test | Bar |
|---|---|---|
| Federation | Compose 3 real subgraphs (Accounts, Policies, Funds) under Hive Router; confirm Federation v2 directive support (`@key`, `@requires`, `@provides` if needed) | Same `InsurancePortfolio` query resolves |
| REST integration | Confirmed pattern from GQL-101 (Mesh, hand-written facade subgraphs, or native support if it exists) | Document effort delta vs Grafbase's declarative `@rest` directive — this is likely the single biggest DX gap either direction |
| Auth | Native auth plugin/directive support, or reliance on subgraph-level enforcement | Same header-forwarding proof at minimum |
| Authorization | Equivalent to `@inaccessible`/field-level hiding; any policy-based authZ | Document parity or gap |
| Caching | Native operation/entity/response caching support and backend options (Redis?) | Reuse existing Redis scripts' pattern; prove cache hits |
| Performance | See §5 | — |
| Observability | OpenTelemetry, Prometheus metrics, structured logs — verify current support against docs | Same log/trace sample as Grafbase |
| Deployment | Binary/image footprint, config format, startup time | Compare image size and cold-start directly against Grafbase's numbers |
| Dev experience | Local dev loop, schema composition/validation tooling equivalent to `grafbase compose` | Time the same edit→validate→promote cycle |

### 4.3 Proof-of-concept architecture (both gateways)

Build **identical** topologies so the comparison isn't confounded by scope
differences:

```
                    ┌─────────────┐
   client ────────► │   Gateway   │  (Grafbase | Hive Router)
                    └──────┬──────┘
             ┌─────────────┼─────────────┐
             ▼              ▼              ▼
      accounts-subgraph  policies-subgraph  funds-subgraph
             │              │              │
             ▼              ▼              ▼
      Accounts REST     Policies REST   Funds REST
        (:3001)           (:3003)         (:3002)
```

- Query set: reuse the existing Bruno collection
  ([`bruno/01-graphql-queries`](../../bruno/01-graphql-queries)) unchanged —
  running the *same* `.bru` requests against both gateways is itself
  evidence of behavioral parity.
- Must measure: query correctness (byte-diffable response bodies modulo
  gateway-specific metadata), cache-hit behavior, auth enforcement, cold
  start, and the four benchmark metrics in §5.
- Success criteria: a PoC "passes" if it resolves the full Bruno collection
  correctly, both cache types demonstrate a hit, and it survives a full
  `docker compose down && up` with cache persistence — the exact bar already
  cleared for Grafbase (`CACHING.md`, `funds-subgraph/README.md`).

---

## 5. Benchmark Plan

### Scenarios

| # | Query | Shape | Why it matters |
|---|---|---|---|
| B1 | `account(id)` — flat fields only | Single REST call | Gateway overhead floor (no joins) |
| B2 | `account(id) { fundHoldings { fund { ... } } }` | 1 root + N deduped fan-out | Dataloader/batching effectiveness |
| B3 | Full `InsurancePortfolio` (account → policies → linkedFunds + fundHoldings → fund) | 3-way join, cross-entity dedup | Realistic worst case; the query already used as the PoC's proof query |
| B4 | B3 repeated identically | Same as B3 | Operation + entity cache hit path |
| B5 | `listAccounts` × N different ids, concurrent | Fan-out breadth | Concurrency/connection-pool behavior |

### Load levels

- **Cold** — 1 request, cache flushed, gateway just started (startup +
  first-request latency).
- **Warm single-user** — 50 sequential requests, cache warm (steady-state
  per-request cost).
- **Concurrent** — ramp 1 → 10 → 50 → 100 virtual users (VUs), 60s per
  step, using `k6` or `autocannon` (pick one, keep it identical across both
  gateways).
- **Soak** — 20 VUs sustained for 15 minutes, to catch memory growth or
  connection leaks the short runs won't show.

### Metrics to collect (every run)

- Latency: p50, p95, p99, max
- Throughput: requests/sec sustained
- Error rate (%), broken out by cause (timeout, 5xx, GraphQL error)
- Gateway process CPU % and RSS memory (via `docker stats` sampled every 5s)
- Cold-start time (process start → first successful response)
- Cache hit ratio for B4 specifically (compare cached vs uncached p50)

### Method

- Run all benchmarks against **both gateways on the same machine, same mock
  REST APIs, same Docker resource limits** (pin CPU/memory in Compose so
  neither gateway gets an unfair host advantage).
- Flush caches before each "cold" and "warm" run; leave warm for concurrent
  and soak runs (real-world steady state).
- 3 repetitions per scenario/load combination, report median — single runs
  are noise, not evidence.
- Store raw tool output (k6 JSON summary or equivalent) alongside the
  Confluence tables so numbers are traceable, not just narrated.

---

## 6. Risk Register

| Risk | Category | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| Hive Router has no direct REST-extension equivalent; PoC effort balloons | Technical | High | High | De-risk in week 1 (GQL-101) before committing full PoC scope; if effort is prohibitive, that itself is a valid, documented finding | Spike owner |
| Breaking REST changes can't be made "fully automatic" in either tool, disappointing the automation ask | Architectural | High | Medium | Set expectations explicitly in the executive summary and demo (GQL-104); frame as "fastest safe path," not "zero-touch" | Spike owner |
| Entity caching requires real subgraph boundaries — true of Grafbase, unknown for Hive Router | Technical | Medium | Medium | Explicit test in GQL-106; don't assume parity | Spike owner |
| Benchmark results skewed by host resource contention (shared dev machine) | Operational | Medium | Medium | Pin CPU/memory limits per container; run gateways sequentially, not simultaneously, during benchmarking | Spike owner |
| Licensing/commercial terms shift mid-spike or post-decision (both are fast-moving OSS projects) | Operational | Low | High | Capture license + version pinned at spike time in the Confluence page; re-verify before production commit | Platform lead |
| Mock REST APIs don't represent real backend latency/failure characteristics, so PoC numbers don't transfer to production | Architectural | Medium | Medium | Note explicitly as a limitation in the recommendation; recommend a follow-up spike against a staging-like backend before full production commit | Spike owner |
| Team unfamiliarity with Rust-based gateway internals slows incident response post-adoption | Operational | Medium | Medium | Score "operational debuggability" explicitly in §7 matrix; weight team ramp-up time into DX category | Platform lead |
| Spike scope creeps into building a production-ready gateway instead of a PoC | Operational | Medium | Medium | Time-box hard at 3 weeks (§2); DoD explicitly bounds deliverables | Spike owner |

---

## 7. Confluence Deliverables

Publish one Confluence page (or a page tree) with:

**Diagrams**
- Current-state architecture (reuse the ASCII diagram in
  `REST_FEDERATION.md` §6, redrawn cleanly)
- Target-state PoC architecture, both gateways, side by side (§4.3 diagram)
- Schema-generation pipeline flow (reuse `SCHEMA_GENERATION.md` §1's
  diagram, extended to show where each gateway's tooling plugs in)

**Screenshots**
- GraphQL Explorer/Playground for both gateways showing the same successful
  `InsurancePortfolio` response
- Redis `--scan` output showing entity + operation cache keys for both
  gateways (mirror the existing evidence style in `CACHING.md`)
- A load-test dashboard/summary screenshot per gateway (k6 or equivalent)

**Benchmark results**
- One results table per scenario (§5) with both gateways' numbers in
  adjacent columns, deltas called out
- Latency distribution charts (p50/p95/p99) for B3 and B4 specifically —
  these are the queries stakeholders will recognize

**Architecture documentation**
- `HIVE_ROUTER_FEDERATION.md` (new, mirrors `REST_FEDERATION.md`'s
  structure exactly, so readers can diff the two documents to see the real
  divergence)
- Updated `CACHING.md`-equivalent for Hive Router, or an explicit note that
  caching behavior is documented inline in the comparison matrix instead

**Comparison tables**
- The full scoring matrix (§8.1) with evidence links per cell
- The schema-automation side-by-side table from GQL-104

---

## 8. Recommendation Framework

### 8.1 Weighted scoring matrix

Score 1–5 per gateway per category; weight reflects decision-driver ranking
from §1. Every score must link to evidence (a ticket, doc section, or
benchmark row) — an unsourced score doesn't count.

| Category | Weight | Grafbase (1–5) | Hive Router (1–5) | Evidence |
|---|---|---|---|---|
| Schema-evolution automation | 20% | | | GQL-104 |
| True federation capability | 15% | | | GQL-102, GQL-103 |
| REST integration effort | 15% | | | §4.1/4.2 REST rows |
| Performance (p95 under B3/B4) | 15% | | | GQL-107 |
| Caching model fit | 10% | | | GQL-106 |
| Operational overhead (deploy, upgrade, debug) | 10% | | | §4 deployment rows |
| Developer experience | 10% | | | §4 dev-experience rows |
| Observability | 5% | | | GQL-108 |
| **Weighted total** | 100% | | | |

Decision methodology: compute the weighted total; if the gap is **>0.5
points**, that's the recommendation. If the gap is **≤0.5**, the decision
should be made on the *highest-weight* category alone (schema-evolution
automation) plus the risk register — not on the aggregate score, since a
near-tie means the weights, not the math, should decide.

### 8.2 Final recommendation template

```markdown
# Recommendation: GraphQL Gateway — [Grafbase | Hive Router]

## Executive Summary
[One paragraph. Gateway chosen, weighted score, single strongest reason.
Written so a VP reading only this paragraph can repeat the decision.]

## Findings
- Schema automation: [what's automatic, what's manual, for both]
- Federation: [REST-aggregation vs true federation findings]
- Performance: [p95 numbers for B3/B4, both gateways]
- Caching: [what worked, what didn't, for both]

## Trade-offs
[What you give up by choosing the winner — be specific and honest. A
recommendation with no stated trade-off is not credible.]

## Risks
[Top 3 from §6, carried forward, each with its mitigation and owner]

## Recommendation
[Grafbase | Hive Router], because [decision-driver-ranked reason].
Confidence: [High | Medium | Low] — [why, e.g. "High on performance data,
Medium on 12-month roadmap risk since both projects ship fast"].

## Next Steps
1. [Production hardening items not covered by PoC scope]
2. [Follow-up spike needed, if any — e.g. real backend latency profile]
3. [Rollout plan sketch: pilot service, cutover criteria, rollback plan]
```
