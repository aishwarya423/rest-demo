# GraphQL Gateway Evaluation: Grafbase vs Hive Router — Spike Outcome

**Status:** Executed 2026-08-21 (single compressed session against the
3-week plan in [`GraphQL-Gateway-Evaluation-Spike-Plan.md`](./GraphQL-Gateway-Evaluation-Spike-Plan.md)).
**Author:** kandagatlahemanth0319@gmail.com (spike owner) · assisted execution
**Full evidence:** [`Docs/gateway-evaluation/`](./) (research notes, PoC code,
raw benchmark output, container logs)

---

## Executive Summary

**Recommendation: continue with Grafbase for the near term; keep Hive Router
on a 2-quarter watch list, gated on its caching RFC shipping.**

The two gateways are close on paper — the plan's own weighted matrix comes
out 3.65 (Grafbase) vs 3.45 (Hive Router), inside the tie-break zone the plan
defined in advance. What breaks the tie is not the score — it's that Hive
Router has **no caching layer at all** (confirmed: it's an unimplemented,
year-old open RFC, not a shipped feature) and **no native REST integration**
(it requires hand-writing or generating a GraphQL subgraph per REST service,
where Grafbase's REST extension does this declaratively). Both are real,
today, structural gaps — not benchmark noise. Hive Router's measured ~2x
throughput advantage is genuine but was measured with trivial mock backends
and a single test run; it is not yet strong enough evidence to trade away a
working caching layer and the REST-extension's lower ongoing engineering
cost for three services that are still REST, not GraphQL, at the source.

The spike also surfaced a finding that matters independently of which
gateway wins: the current Grafbase PoC's schema-generation pipeline has a
**silent-failure mode** — a newly-added REST field resolves as `null`
(not an error) until a human manually updates a jq selection allow-list.
This was reproduced live, not inferred. It's fixable in a day and should be
fixed regardless of the gateway decision — see Next Steps.

---

## Findings

**Federation capability — tied.** Both gateways were proven, hands-on, to
correctly compose and execute true Federation v2 across three independently
deployable subgraphs (accounts, policies, funds), including cross-subgraph
entity resolution (`Fund` referenced by stub key from two other subgraphs).
Identical query, byte-identical result, on both. Grafbase's existing
REST-extension PoC (REST aggregation, not true federation) also still works
as before — this spike proved Grafbase can do *either* topology, not that it
was limited to the REST-aggregation one it happened to start with.

**REST integration — Grafbase's clear structural advantage for this estate.**
Grafbase federates REST APIs declaratively (`@restEndpoint`/`@rest`
directives, jq response shaping) with no subgraph server to write, deploy, or
maintain. Hive Router has no equivalent; federating the same three REST
services required hand-writing two new subgraph facades from scratch
(`accounts-subgraph`, `policies-subgraph`, following the existing
`funds-subgraph` pattern) — real engineering effort with real ongoing
maintenance cost, three services here, more as the estate grows. (GraphQL
Mesh, a separate Guild project, could auto-generate these from OpenAPI —
untested in this spike, and the top follow-up item.)

**Schema-evolution automation — a nuanced result, verified live, not just
reasoned about.** A non-breaking REST field (`Fund.launchDate`) was added to
a live mock API and traced through both architectures:
- Grafbase's `schema:generate` pipeline picked up the new field
  **automatically** at the type level — zero hand-written GraphQL.
- But the field resolved as **`null` everywhere**, silently, because the
  REST-extension's jq response-shaping selection is an explicit allow-list
  that wasn't updated. No error, no warning — just wrong data, until fixed
  with a one-line jq addition.
- The true-federation subgraph path (available under *both* gateways) has no
  equivalent trap: adding the field to the subgraph's SDL (one line, zero
  resolver code) worked correctly immediately, because its resolver passes
  the REST response through rather than reshaping it.

This is the spike's most consequential finding, and it's a **gateway-neutral
architecture lesson**, not a point for either vendor: the REST-extension +
jq-shaping pattern needs a safety net (see Next Steps) regardless of which
gateway ships.

**Performance — Hive Router ahead, but the evidence is thin.** Controlled
Docker-vs-Docker benchmarks (both gateways containerized identically, same
network path to the same subgraphs) showed Hive Router at roughly **2x the
throughput and less than half the latency** of Grafbase's production gateway,
on both a flat query and the full three-way join. This is a single run per
scenario against near-zero-latency mock backends — directionally credible
(matches Hive Router's own Rust-vs-JS-runtime performance claims) but not
yet the statistically rigorous, production-backend-realistic evidence the
original plan called for.

**Caching — decisive, in Grafbase's favor.** Grafbase's Redis-backed
operation and entity caching is verified working (pre-existing work in this
repo). Hive Router has no caching implementation — it's an open GitHub RFC,
opened over a year before this spike, still unimplemented. For a team that
has already run dedicated caching spikes for this platform, this is not a
minor gap.

**Deployment footprint — Hive Router ahead.** Measured, not estimated: the
Grafbase production image is **793MB** (it bundles Node.js, npm, and the
`grafbase` CLI just to run its composition step); Hive Router's image is
**128MB** (a pure Rust binary that never composes, because it always expects
a pre-built supergraph file). Hive Router's cold start, from its own logs, is
roughly 48ms.

**Auth & observability — inconclusive, flagged as gaps.** Both gateways
document native JWT support and OpenTelemetry/Prometheus integration; neither
was hands-on wired up and tested in this session. Genuinely unscored.

---

## Trade-offs

Choosing **Grafbase** (the recommendation) means: accepting a slower gateway
today (unverified at production scale), a heavier deployment image, and
living with the jq-allow-list schema-drift risk until it's explicitly fixed
(see Next Steps — this is on us regardless of gateway).

Choosing **Hive Router** now would mean: giving up working, verified caching
with nothing to replace it; taking on the engineering cost of hand-writing
(or standing up Mesh for) a subgraph per REST service; and betting on a
6-month-old, `v0.2.0`, still-RFC-stage project for a production insurance
platform's gateway layer.

---

## Risks

| Risk | Status |
|---|---|
| Hive Router has no caching | **Confirmed today.** Re-check when [#312](https://github.com/graphql-hive/router/issues/312) ships. |
| REST-extension jq allow-list silently drops fields on schema drift | **Confirmed, reproduced live.** Needs a fix independent of this decision — see Next Steps. |
| Performance numbers aren't production-representative | **Confirmed gap in this spike's rigor.** Needs a follow-up benchmark against realistic backend latency before the ~2x gap is treated as decision-grade. |
| REST-to-subgraph engineering cost for Hive Router is unknown at scale | **Open** — only 3 services were federated by hand; unclear how this scales to a larger REST estate, or whether GraphQL Mesh changes the calculus. |
| Both gateways are young/fast-moving; license and roadmap risk | **Open** — re-verify license terms and roadmap commitments immediately before any production commitment, not just at spike time. |

---

## Recommendation

**Continue with Grafbase.** It wins on the two categories that matter most
for this specific estate — REST integration cost (declarative vs. hand-written
subgraphs) and caching (working vs. nonexistent) — and the true-federation
capability this spike proved it has removes the main architectural reason to
look elsewhere. Hive Router's performance edge is real but not yet strong
enough, against thin single-run evidence and a missing caching layer, to
justify the switch.

**Confidence: Medium.** High confidence on the caching and REST-integration
findings (both hands-on verified, unambiguous). Lower confidence on the
performance comparison (single run, unrealistic backend) and on auth/
observability (not hands-on tested at all). This recommendation should be
revisited, not treated as final, once the Next Steps below are done.

---

## Next Steps

1. **Fix the jq-allow-list silent-failure risk now**, independent of the
   gateway decision — either (a) add a CI check that diffs each service's
   OpenAPI schema against its jq selection and fails on drift, or (b) migrate
   the REST-extension's field-shaping to a passthrough style where feasible.
   This is a real, live production-data-integrity risk today.
2. **Re-benchmark against a realistic backend** (added latency, occasional
   errors, real network hops) before treating Hive Router's performance edge
   as decision-relevant — the mock APIs in this spike return in under a
   millisecond, which no production REST service does.
3. **Watch [graphql-hive/router#312](https://github.com/graphql-hive/router/issues/312)**
   (response/entity caching RFC). If it ships with Redis backing and
   reasonable TTL/invalidation semantics, this recommendation should be
   re-run — caching was the single largest gap keeping Hive Router out of
   contention.
4. **Evaluate GraphQL Mesh** as a possible way to auto-generate Hive Router
   subgraphs from the same OpenAPI specs this repo already treats as source
   of truth — untested in this spike, and the most likely way to close Hive
   Router's REST-integration gap if the caching RFC ships and performance
   remains compelling.
5. **Hands-on test JWT auth and OTel/Prometheus wiring** on both gateways —
   both are currently scored from documentation only.
6. Rollout, if the above hold up: no urgent migration pressure. Keep the
   REST-extension PoC as-is with the jq-drift fix applied; treat true
   Federation v2 (the `accounts-subgraph`/`policies-subgraph`/`funds-subgraph`
   pattern this spike built) as the pattern to reach for the next time a REST
   service's data needs cross-service entity resolution beyond what
   `@derive`/`@require` cleanly express.

---

## What was actually built and run (for reproducibility)

- Two new real Federation v2 subgraphs: [`accounts-subgraph/`](../../accounts-subgraph/), [`policies-subgraph/`](../../policies-subgraph/)
- A Federation v2 composer for Hive Router: [`hive-router/compose.mjs`](../../hive-router/compose.mjs)
- A true-federation Grafbase config (no REST extension): [`grafbase-federation/`](../../grafbase-federation/)
- Full architecture notes, raw benchmark output, container logs, and the
  composed supergraph SDL: [`Docs/gateway-evaluation/`](./)

Every result in this document is traceable to one of those artifacts —
nothing here is projected or assumed.
