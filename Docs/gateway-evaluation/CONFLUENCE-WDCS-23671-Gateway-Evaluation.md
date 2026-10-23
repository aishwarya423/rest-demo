# WDCS-23671 — SPIKE: GraphQL Gateway Evaluation (Grafbase vs Hive)

**Jira:** WDCS-23671 · **Status:** Ready for review / spike closure
**Evaluation period:** 2026-08-21 (initial execution) · 2026-10-23 (re-verification and consolidation)
**Repository:** `rest-demo` · branch `gateway-evaluation`
**Supporting evidence:** [`Docs/gateway-evaluation/`](./) · [`Docs/Hive-docs/`](../Hive-docs/)

> **Reviewer's note on provenance.** Every number and behaviour in this page was
> executed on a developer machine and is traceable to a file in this repository.
> Items that were **not** tested are labelled as such and listed in §11. Nothing
> here is taken from vendor marketing.

> ## ⚠️ Amendment — 2026-10-23: Grafbase is end-of-life
>
> A later spike, [WDCS-25885](../Hive-docs/CONFLUENCE-WDCS-25885-Hive-Capability-Analysis.md),
> established a fact this page does not account for:
>
> **The Guild — the company that builds Hive — acquired Grafbase on 2026-02-10.
> The Grafbase platform and dashboard have sunsetted and are no longer
> operational. The Grafbase Gateway and CLI are in maintenance mode and were
> scheduled for archive by end of May 2026. Grafbase's own repository directs
> users to Hive Router or Hive Gateway.**
>
> **What this changes.** Everywhere below that treats Grafbase as the "incumbent
> fallback" should be read as **end-of-life**. Its capability findings remain
> accurate and were re-verified on 2026-10-23, but it is no longer a viable
> long-term option, and its proprietary schema registry no longer runs at all.
> The recommendation of **Hive Gateway** is unchanged and, in light of this,
> strengthened — see WDCS-25885 §6.1 and §11.

---

## 1. Overview

We needed to choose a GraphQL gateway to put in front of three existing
insurance REST APIs — Accounts, Policies and Funds — so clients make one
GraphQL request instead of three REST calls and their own client-side joins.

The spike compared **Grafbase** (already in use in this repo) against **Hive**.
During execution the single most important discovery was that the spike's
premise contained a factual error that changed the scope:

> The ticket describes *"Hive Router (formerly The Guild's GraphQL Mesh)."*
> **This is incorrect.** Hive Router is not a rename of GraphQL Mesh. They are
> three separate products, and the difference decides the outcome:

| Product | Runtime | Consumes REST? | Response caching? |
|---|---|---|---|
| **Hive Router** | Rust | ❌ no — needs a GraphQL subgraph per service | ❌ no — plan cache only |
| **Hive Gateway** | Node.js | ⚠️ yes, via a Mesh-composed supergraph | ✅ yes, Redis/Valkey |
| **GraphQL Mesh** | Node.js (build-time tool) | ✅ reads OpenAPI | n/a — it is a compiler, not a server |

Evaluating only "Grafbase vs Hive Router" would have produced a misleading
recommendation, because Hive Router is the one Hive product that cannot consume
REST or cache responses. The evaluation was therefore widened to a **three-way
comparison**, and working proofs of concept were built and verified for all three.

**Bottom line.** Caching, which the ticket did not list in scope, turned out to be
the deciding criterion. Weighted scores on criteria fixed before scoring:

| Candidate | Score | One-line verdict |
|---|---|---|
| **Hive Gateway** | **4.05** | **Recommended.** REST integration generated from our OpenAPI specs, zero subgraph servers, response cache with explicit invalidation |
| Hive Router | 3.75 | Runner-up. Fastest and smallest, and caches more precisely — but needs 3 hand-written subgraphs and 15 containers |
| Grafbase | 3.35 | Incumbent. Best developer experience, but its caches do not reduce REST load and its keys cannot be invalidated |

The 0.30 margin falls inside the tie-break zone defined in advance, so this is a
**close decision settled on schema automation and maturity**, not a landslide.
Full reasoning in §12.

---

## 2. Problem Statement

Three REST services exist and must not be significantly rewritten:

| Service | Port | Owns |
|---|---|---|
| Accounts | 3001 | `Account`, embedded `fundHoldings` |
| Funds | 3002 | `Fund` |
| Policies | 3003 | `Policy` |

Clients currently fan out to all three and join the results themselves. We want
one GraphQL endpoint that resolves a query such as:

```graphql
query InsurancePortfolio {
  account(id: "acct-1001") {
    id holderName totalValue
    policies { id policyNumber linkedFunds { id name } }
    fundHoldings { allocationPercent fund { id name isin } }
  }
}
```

Four constraints shaped the evaluation:

1. **No significant change to the REST services.** Their OpenAPI specs are the
   source of truth and should stay that way.
2. **Schema drift must be safe.** When a REST contract gains a field, the path
   from spec change to a correct, validated GraphQL schema must be fast and must
   not fail silently.
3. **Caching must reduce REST load.** Repeated identical queries should not
   re-hit the REST tier.
4. **Cache invalidation must be explicit.** When underlying data changes, we must
   be able to identify and delete the affected cache entries, not wait for a TTL.

Constraint 4 is the one that separates the candidates, and it was the least
obvious at the start.

---

## 3. Evaluation Objectives and Criteria

Objectives, taken from the ticket scope:

- Compare Grafbase and Hive for federation, REST integration and schema composition.
- Evaluate developer experience, operational overhead and deployment model.
- Produce a comparison matrix, risk register and recommendation.

Criteria and weights were fixed **before** scoring, in
[`GraphQL-Gateway-Evaluation-Spike-Plan.md`](./GraphQL-Gateway-Evaluation-Spike-Plan.md) §8.1,
so the weighting could not be retrofitted to a preferred answer:

| Criterion | Weight | Why it carries this weight |
|---|---|---|
| Schema-evolution automation | 20% | The original business ask behind the ticket |
| True federation capability | 15% | Needed for cross-service entity resolution |
| REST integration effort | 15% | Three services today, more later |
| Performance | 15% | Gateway overhead above direct REST calls |
| Caching model fit | 10% | Raised to decisive during execution — see §10 |
| Operational overhead | 10% | Image size, startup, upgrade path |
| Developer experience | 10% | Edit → validate → promote loop |
| Observability | 5% | Logs, traces, metrics |

**Decision rule, also fixed in advance:** if the weighted gap exceeds 0.5 points
the aggregate decides. If it is 0.5 or less, the aggregate is treated as a tie
and the decision falls to the highest-weighted criterion plus the risk register.

---

## 4. Solution Implemented

Three complete, independently runnable proofs of concept, all federating the
same three REST APIs and all answering the same `InsurancePortfolio` query.

### PoC A — Grafbase, two topologies

1. **REST-extension topology** (pre-existing in this repo): one virtual subgraph,
   REST calls made in-process by a WASM extension driven by `@restEndpoint` and
   `@rest` directives with jq response shaping.
2. **True Federation v2 topology** (built for this spike):
   [`grafbase-federation/grafbase.toml`](../../grafbase-federation/grafbase.toml)
   points Grafbase at three real GraphQL subgraphs with no REST extension at all.

Topology 2 exists to isolate the REST-integration question from the
federation-execution question, so Grafbase and Hive Router could be compared as
pure Federation v2 executors.

### PoC B — Hive Router, with three hand-written subgraphs

Hive Router cannot call REST, so three GraphQL Yoga subgraphs were written to sit
in front of the REST APIs, plus an external composer because the router does not
compose:

- [`accounts-subgraph/`](../../accounts-subgraph/), [`policies-subgraph/`](../../policies-subgraph/), [`funds-subgraph/`](../../funds-subgraph/)
- [`hive-router/compose.mjs`](../../hive-router/compose.mjs) — Federation v2 composition via `@apollo/composition`
- [`hive-router-poc/`](../../hive-router-poc/) — the fully containerised version, which additionally puts a **response cache inside each subgraph** to work around the router having none

### PoC C — Hive Gateway with GraphQL Mesh

[`hive-poc/`](../../hive-poc/) — the path the August evaluation listed as its top
untested follow-up, now built and verified:

- Mesh reads the three existing `openapi.yaml` files at **build time** and emits
  one federated supergraph. No subgraph servers exist at all.
- Hive Gateway serves it with Redis/Valkey-backed response caching, custom cache
  keys and entity tags.
- A standalone invalidator service deletes cache entries by entity, importing
  nothing from Hive.

### Reconciling the two earlier recommendations

This consolidation resolves an apparent contradiction between the two bodies of
prior work in this repo. They do not actually disagree; they answer different
questions:

| Prior document | Question it answered | Its recommendation |
|---|---|---|
| [`CONFLUENCE-Outcome.md`](./CONFLUENCE-Outcome.md) | Grafbase vs Hive **Router** | Grafbase — Router has no cache and no REST path |
| [`HIVE-EVALUATION.md`](../Hive-docs/HIVE-EVALUATION.md) | Grafbase vs Hive **Gateway** | Hive Gateway — it can invalidate cache entries; Grafbase cannot |

Both conclusions hold within their own scope. This consolidation adds the
evidence neither had: PoC B was re-run containerised with subgraph-level caching
(§9.6), which shows the August verdict on Hive Router's caching was too harsh.
Combined and re-scored, the ranking for this estate is
**Hive Gateway (4.05) > Hive Router (3.75) > Grafbase (3.35)**.

---

## 5. Architecture and Implementation Details

### PoC C — Hive Gateway (the recommendation)

```
                      GraphQL client
                            │ one query
                            ▼
              ┌──────────────────────────┐        ┌──────────────┐
              │   Hive Gateway :4000     │◄──────►│   Valkey     │
              │   responseCaching        │  keys  │   :6379      │
              │   cache: {type: redis}   │        └──────▲───────┘
              └──────────┬───────────────┘               │ DEL
                         │ on cache MISS only            │
          ┌──────────────┼──────────────┐         ┌──────┴───────┐
          ▼              ▼              ▼         │ invalidator  │
   accounts-rest  policies-rest   funds-rest      │   :8090      │
      :3001           :3003          :3002        └──────────────┘
          ▲              ▲              ▲
          └── openapi.yaml ×3 ──────────┘
                         │
          ┌──────────────┴───────────────┐
          │ mesh-compose (build, exits)  │──► supergraph.graphql
          └──────────────────────────────┘
```

Nine compose services, **zero subgraph servers**. The gateway calls REST
in-process through the Mesh REST transport.

Federation metadata is **inferred, not authored**. Because each OpenAPI spec
exposes `GET /<resource>/{id}`, Mesh marks `Account`, `Fund` and `Policy` as
federation entities with `key: "id"` and wires the by-id route as the entity
resolver. Cross-service joins are declared once in `additionalTypeDefs`:

```graphql
extend type Account {
  policies: [Policy!]!
    @resolveTo(
      sourceName: "Policies"
      sourceTypeName: "Query"
      sourceFieldName: "policiesByAccount"
      requiredSelectionSet: "{ id }"
      sourceArgs: { accountId: "{root.id}" }
    )
}
```

### PoC B — Hive Router

```
                      GraphQL client
                            ▼
                 Hive Router :4000  (Rust, no response cache)
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 accounts-subgraph   policies-subgraph   funds-subgraph
     :4001               :4002               :4003
        │ response cache    │ response cache    │ response cache
        └─────────┬─────────┴─────────┬─────────┘──► Valkey :6379
                  ▼                   ▼
          accounts-rest  policies-rest  funds-rest
```

Fifteen compose services. Three more than PoC C, purely because the router
cannot speak REST. The cache had to be pushed down into the subgraphs.

### PoC A — Grafbase REST extension

One virtual subgraph; the gateway's WASM extension performs the REST calls and
reshapes responses with jq. Documented in [`../REST_FEDERATION.md`](../REST_FEDERATION.md).

### Implementation effort, measured

| | PoC A (Grafbase REST ext.) | PoC B (Hive Router) | PoC C (Hive Gateway) |
|---|---|---|---|
| Compose services | 7 | **15** | **9** |
| Subgraph servers to write and run | 0 | **3** | **0** |
| Lines of code/config written | ~310 SDL (hand-authored) | **916** | **630** |
| REST mapping authored by | a human, in SDL | a human, in 3 Yoga servers | **generated from OpenAPI** |

---

## 6. Grafbase Evaluation

**Federation — strong.** Proven hands-on to compose and execute true Federation
v2 across three independently deployable subgraphs, including cross-subgraph
entity resolution. Grafbase is not limited to the REST-extension topology it
happened to start with; that was a design choice, not a ceiling.

**REST integration — best of the three.** Declarative `@restEndpoint`/`@rest`
directives, no subgraph server to write, deploy or maintain. For a REST-only
estate this is genuinely the lowest-friction option.

**Schema evolution — automatic at the type level, with a silent trap.** This was
tested by adding a real nullable field (`Fund.launchDate`) to a live mock API:

- `npm run schema:generate` picked up the new OpenAPI property automatically,
  inferred the `Date` scalar, preserved nullability and carried the description
  through. Zero hand-written GraphQL.
- **But the field resolved as `null` everywhere**, for funds that had real data,
  with no error and no warning. The REST extension's jq `selection` is an
  explicit allow-list; a field absent from it is dropped.
- One line added to the jq selection fixed it.

This is a **data-integrity risk that exists in the repo today** and is
independent of the gateway decision. See §11 and §12.

**Caching — present, but it does not do what the requirement needs.**

| Grafbase cache | Stores | Reduces REST calls? | Keys |
|---|---|---|---|
| `operation_caching` | query plans | ❌ **no** | opaque `op.blake3.<hash>` |
| `entity_caching` | subgraph fetch responses | would, but | opaque |

`operation_caching` is verified Redis-backed and working, but caching a plan is
not caching data — it never removes an upstream call. `entity_caching` is
correctly configured yet a **structural no-op** in the REST-extension topology,
because that topology makes no gateway-to-subgraph fetch to intercept. This was
established by earlier work in this repo
([`ENTITY-CACHING-WHY-NOOP.md`](../ENTITY-CACHING-WHY-NOOP.md)) and is not a
configuration error.

**There is no supported way to enumerate or delete a specific Grafbase cache
entry.** Keys are opaque hashes. Constraint 4 cannot be met.

**Operational overhead — heaviest.** The true-federation production image
measured **793 MB**, because it bundles Debian, Node.js, npm and the `grafbase`
CLI solely to run the composition step. In this repo's deployment pattern that
composition runs at *container startup*, not build time.

**Developer experience — best.** `grafbase dev` hot-recomposed a subgraph schema
change with no restart during the session.

**Licence.** Source-available, with a paid platform tier.

---

## 7. Hive Evaluation

Because "Hive" is three products, they are assessed separately.

### 7.1 Hive Router (Rust)

**Federation — excellent and verified.** Re-confirmed on 2026-10-23: composed
and executed the full three-way join correctly (§9).

**REST integration — none, and not extensible to add it.** The router consumes
federated GraphQL subgraphs over HTTP only. There is no REST transport, no
extension mechanism that adds one, and coprocessors hook request/response stages
without being able to synthesise REST-backed fields. Federating three REST
services cost three hand-written subgraph servers.

**Composition — not provided.** The router loads a pre-composed supergraph file.
An external composer must exist somewhere; this repo supplies
[`hive-router/compose.mjs`](../../hive-router/compose.mjs).

**Caching — no response cache. Note the trap.** The August research recorded no
`cache` key at all in the config reference (router `v0.2.0`). By `v0.3.1` a
top-level `cache` key **does** exist, and it is easy to mistake for the answer.
It is **in-memory only, with no external store**, and caches parsing, validation,
normalisation and query plans. It never stores response data and never removes an
upstream call — the same category as Grafbase's `operation_caching`. Response
caching remains open RFC
[graphql-hive/router#312](https://github.com/graphql-hive/router/issues/312),
opened 2025-08-07 and still open.

Consequence: in PoC B the response cache lives **inside the subgraphs**, with a
separate invalidator service. This was verified working (§9.6) and it is more
than a consolation prize — the cache unit becomes a *subgraph fetch* rather than
a whole client response, so invalidating one entity re-fetches only the affected
slice. Measured: after purging one account, the next query made **2 upstream REST
calls instead of 5**, because the funds fetch was still cached. It also uses real
Redis SET tags, making invalidation O(tag size) rather than O(keyspace).

So the honest statement is: **Hive Router cannot cache, but the Hive Router
architecture can, and does it with better granularity than Hive Gateway.** What
the router costs is not caching capability — it is three subgraph servers, 916
lines of code we own, and six extra containers.

**Operational overhead — lightest runtime.** Image measured **135 MB** on
2026-10-23 (128 MB in August), a pure Rust binary with no composition toolchain.
Cold start roughly 48 ms from its own logs. The cost is a CI composition step
that must exist and be maintained.

**Observability — structured JSON logs, but very noisy by default.** One INFO
line per request; the August benchmark produced a ~677,000-line container log for
~677,000 requests. Log level needs explicit tuning before production.

**Maturity — the main risk.** `v0.3.1` at re-verification, up from `v0.2.0` in
August. Still pre-1.0.

### 7.2 Hive Gateway (Node.js) + GraphQL Mesh

**REST integration — no subgraph servers, generated from OpenAPI.** Mesh reads
the existing specs and emits `@httpOperation` directives; the gateway makes the
REST calls in-process. This is a near-exact analogue of the Grafbase REST
extension, with one meaningful difference:

| | Grafbase | Hive Gateway + Mesh |
|---|---|---|
| When the mapping is produced | runtime | **build time** |
| Who authors it | a human, by hand in SDL | **generated from `openapi.yaml`** |

The OpenAPI specs stay the source of truth and a spec change flows through on
recompose. The cost is a build step in CI.

**Caching — the decisive advantage, and the reason for the recommendation.**
Hive Gateway's `responseCaching` caches the **final GraphQL response**. A cache
hit returns before query planning and before any REST call. It writes three Redis
key shapes, verbatim, with no prefix of its own:

```
response-cache:<responseId>                 the cached JSON body
response-cache:<Type>.<id>:<responseId>     entity   → response   (the tag)
response-cache:<responseId>:<Type>.<id>     response → entity     (reverse tag)
```

Those tag keys are an entity-to-response index — exactly the cache-tag design the
caching requirement called for.

**Custom cache keys are supported** via `buildResponseCacheKey`, so keys are
readable and predictable rather than opaque hashes. **With one undocumented
constraint:** the key must not contain a colon, because the invalidation routine
recovers the response id by splitting the tag key on `:` and taking index 2. A
colon shifts that index and invalidation silently deletes nothing. The POC
therefore uses dot separators.

**Explicit invalidation works, and from outside Hive.** Because the keys are
plain, prefix-structured Redis strings, anything holding a Redis connection can
invalidate. The POC's invalidator imports nothing from Hive.

**Operational overhead — heaviest image of all, as built.** Measured 2026-10-23:
the POC's gateway image is **1.86 GB** because it runs `npm install` at build
time. The official `ghcr.io/graphql-hive/gateway:latest` is **618 MB**. The POC
image is not optimised and should not be read as the achievable footprint.

**Licence.** MIT, self-hostable.

---

## 8. Grafbase vs. Hive Comparison

### 8.1 Capability matrix

| Capability | Grafbase | Hive Router | Hive Gateway |
|---|---|---|---|
| Consumes REST directly | ✅ WASM extension | ❌ none | ✅ Mesh REST transport |
| Subgraph servers required | 0 | **3** | 0 |
| REST mapping source | hand-authored SDL | hand-written subgraphs | **generated from OpenAPI** |
| True Federation v2 | ✅ verified | ✅ verified | ✅ verified |
| Composition built in | ✅ `grafbase compose` | ❌ external | ✅ Mesh (build step) |
| Caches query plans | ✅ Redis | ✅ in-memory only | ✅ in-memory |
| **Caches response data** | ❌ | ⚠️ not in the router — **in the subgraphs** | ✅ **in the gateway** |
| **Reduces REST calls** | ❌ | ✅ verified (subgraph caches) | ✅ verified |
| **Custom cache keys** | ❌ opaque | ✅ (we define them) | ✅ `buildResponseCacheKey` |
| **Cache tags** | ❌ | ✅ **real Redis SETs** | ✅ key-per-pair + `SCAN` |
| **Explicit invalidation** | ❌ | ✅ our invalidator | ✅ built in + externally scriptable |
| Cache granularity | n/a | **per subgraph fetch (finer)** | per whole response (coarser) |
| TTL control | global | per subgraph plugin | global / per-type / per-field |
| Runtime image | 793 MB | **135 MB** | 618 MB official (1.86 GB as built here) |
| Cold start | composition at startup | **~48 ms** | not measured |
| Default log volume | low | **one line per request** | low |
| Licence | source-available + paid tier | MIT | MIT |
| Maturity | established | **pre-1.0 (v0.3.1)** | established (v2.x) |

### 8.2 Weighted scoring

Scores and weights per §3. Grafbase and Hive Router scores are carried forward
from [`05-comparison-matrix.md`](./05-comparison-matrix.md); the Hive Gateway
column is new to this consolidation.

Hive Router is scored **as deployed in PoC B** — router plus subgraph-level
caching — because that is the only configuration in which it meets the stated
constraints. Scoring the bare router would be scoring something we would never
ship.

| Criterion | Weight | Grafbase | Hive Router (+ subgraph caches) | Hive Gateway |
|---|---|---|---|---|
| Schema-evolution automation | 20% | 3 | 4 | **5** |
| True federation capability | 15% | 5 | 5 | 5 |
| REST integration effort | 15% | **5** | 2 | **5** |
| Performance | 15% | 2 | **5** | 2 |
| Caching model fit | 10% | 2 | 4 | **5** |
| Operational overhead | 10% | 2 | **4** | 2 |
| Developer experience | 10% | **4** | 2 | 4 |
| Observability | 5% | 3 | 3 | 3 |
| **Weighted total (of 5)** | 100% | 3.35 | 3.75 | **4.05** |

Three scores changed from the August matrix, each for a stated reason:

- **Grafbase caching: 5 → 2.** August credited "operation + entity caching
  verified working," which is accurate but measures the wrong thing against
  constraints 3 and 4. Neither cache reduces REST load in the topology in use,
  and neither supports explicit invalidation.
- **Hive Router caching: 1 → 4.** August scored the router in isolation, where 1
  is correct. PoC B shows the subgraph-level workaround satisfies both caching
  constraints with *finer* granularity than Hive Gateway (§9.6). It is not a 5
  only because it is code we own rather than a gateway feature.
- **Hive Gateway schema automation: 5.** The OpenAPI specs remain the source of
  truth, with no hand-authored mapping layer and no silent-drop allow-list.

**Applying the pre-agreed decision rule.** Hive Gateway leads Hive Router by
**0.30 points**. That is inside the 0.5 tie-break zone, so **the aggregate does
not decide**. Per the rule fixed in advance, the decision falls to the
highest-weighted criterion — schema-evolution automation, 20% — plus the risk
register.

On schema automation, Hive Gateway scores 5 and Hive Router 4: Mesh generates the
REST mapping from specs we already maintain, whereas Hive Router needs three
hand-written subgraphs kept in step by humans. On risk, Hive Gateway is v2.x and
established while Hive Router is pre-1.0 at v0.3.1, with its config surface
visibly shifting between v0.2.0 and v0.3.1. **Both tie-breakers point the same
way, so the recommendation is Hive Gateway — but as a close decision, not a
knockout.**

Grafbase now places third on the aggregate. Its gap to Hive Router is 0.10, also
inside the tie-break zone, so the two are effectively level and separated only by
which criterion you privilege: Grafbase on REST integration and developer
experience, Hive Router on performance, footprint and cache granularity.

---

## 9. Testing and Validation Results

Two execution rounds. August built and measured the Grafbase/Hive Router
comparison. October re-verified it from a clean checkout and tested the paths
August left open.

### 9.1 Re-verification, 2026-10-23

Run from a clean checkout on branch `gateway-evaluation`: dependencies installed
for all three subgraphs and the composer, three mock REST APIs started, three
Yoga subgraphs started, supergraph composed, both gateways queried.

| Check | Result |
|---|---|
| `npm install` across 3 subgraphs + composer | ✅ all four succeeded |
| Mock REST APIs on :3001/:3002/:3003 | ✅ all `200` on `/health` |
| Subgraphs on :3009/:3010/:3011 | ✅ all `200` on `/graphql` |
| Federation composition (`compose.mjs`) | ✅ `Composition OK`, 25 `join__field` directives |
| `Account` merged across two subgraphs | ✅ `@join__type(graph: ACCOUNTS, key:"id")` + `@join__type(graph: POLICIES, key:"id", extension: true)` |
| Hive Router serves `InsurancePortfolio` | ✅ correct, full three-way join |
| Grafbase serves the same query on the same subgraphs | ✅ correct |
| Hive Router container startup | ✅ `supergraph loaded successfully` |

Both gateways returned Anika Rao, £186,420.75, two policies with
`ANN-RET-3002` linking Global Equity Index and Green Bond Income, and all three
fund holdings resolving their fund. **The August federation findings reproduce.**

### 9.2 Correction to a prior claim

The August documents state the two gateways' responses were **"byte-identical."**
Re-testing with a normalised diff shows this is **not quite true**:

```
< "allocationPercent": 45,      ← Hive Router
> "allocationPercent": 45.0,    ← Grafbase
```

The two outputs are **semantically identical** (parsed JSON compares equal) and
differ **only** in `Float` serialisation: Grafbase emits a trailing `.0` for
whole-number floats, Hive Router does not. Confirmed as the sole difference by
diffing with float formatting normalised; response sizes 1,122 vs 1,128 bytes.

Minor, but worth recording: a contract test that string-compares response bodies
would fail when switching gateways, for a reason that has nothing to do with
correctness.

### 9.3 Performance, August (unchanged, and still only a pilot)

**Methodology caveat first.** One run per scenario, single developer machine, no
CPU/memory pinning, trivial in-memory mock REST APIs with sub-millisecond
responses. The plan called for three repetitions with median reporting, pinned
containers and cold/warm/concurrent/soak levels. **None of that rigour was
applied.** Treat the pattern as signal and the exact numbers as illustrative.

Both gateways containerised identically, same network path to the same subgraphs,
no caching enabled in either. Tool: `autocannon -c 20 -d 20`.

**B1 — flat query**

| | Grafbase | Hive Router |
|---|---|---|
| p50 / p99 latency | 1 ms / 3 ms | 0 ms / 1 ms |
| Avg latency | 1.20 ms | 0.17 ms |
| Throughput | 11,748 req/s | **23,922 req/s** |

**B3 — full three-way join**

| | Grafbase | Hive Router |
|---|---|---|
| p50 / p99 latency | 3 ms / 6 ms | 1 ms / 3 ms |
| Avg latency | 3.34 ms | 1.44 ms |
| Throughput | 5,221 req/s | **9,932 req/s** |

Hive Router is roughly **2× the throughput at under half the latency**. This is
directionally consistent with a purpose-built Rust executor versus a gateway
carrying a WASM extension runtime. At these volumes neither gateway is the
bottleneck in a real deployment; REST backends and network hops dominate.

Raw output: [`evidence/`](./evidence/).

### 9.4 Deployment footprint, measured 2026-10-23

| Image | Size | Contents |
|---|---|---|
| `ghcr.io/graphql-hive/router` | **135 MB** | Rust binary only |
| `ghcr.io/graphql-hive/gateway` | 618 MB | official Node gateway |
| Grafbase true-federation build | 793 MB (August) | Debian + Node + npm + `grafbase` CLI + gateway |
| `hive-poc-hive-gateway` (ours) | 1.86 GB | **unoptimised** — `npm install` at build time |
| `hive-router-poc-*-subgraph` ×3 | 373 MB each | Yoga subgraph |

The 1.86 GB figure is our Dockerfile's fault, not Hive Gateway's. The official
image is the number to plan against.

### 9.5 Hive Gateway caching and invalidation, verified 2026-10-23

The full stack was built and started from this branch
(`docker compose -f hive-poc/docker-compose.yml up --build -d`): nine services,
`mesh-compose` exiting `0` after emitting the supergraph, gateway and invalidator
both healthy. The scripted walkthrough
([`hive-poc/demo/demo.sh`](../../hive-poc/demo/demo.sh)) was then run end to end.

| Step | Observed result |
|---|---|
| First `AccountOverview` call (cache MISS) | **90 ms**, all three REST services called |
| Identical call again (cache HIT) | **2.5 ms — roughly 36× faster**, zero REST traffic |
| Redis keys written by that one query | **13** — 1 response body, 6 entity tags, 6 reverse tags |
| Entities tagged, with no annotation authored by us | `Account.acct-1001`, `Policy.pol-life-3001`, `Policy.pol-annuity-3002`, `Fund.fund-global-equity`, `Fund.fund-green-bond`, `Fund.fund-cash-plus` |
| After adding 2 more operations | 19 keys, 3 distinct cached response bodies |
| `DELETE /cache/entity/Account/acct-1001` | **16 keys deleted**, spanning **both** account operations |
| Unrelated `FundDetail` response | ✅ **survived**, with its tags intact (3 keys remaining) |
| Re-query after invalidation | ✅ MISS, refetched from REST, repopulated to 16 keys |

Three things this establishes beyond the design description in §10:

1. **Entity tagging crosses service boundaries.** One query produced tags for
   entities owned by all three REST APIs, so a single policy or fund change can
   invalidate exactly the responses that embedded it.
2. **Invalidation is selective, not a flush.** Deleting one account's tag removed
   both operations that touched it and left an unrelated fund response untouched.
3. **Invalidation works from outside the gateway.** The invalidator service holds
   only a Redis connection and imports nothing from Hive.

### 9.6 Hive Router caching via subgraph-level caches, verified 2026-10-23

This test changed the recommendation's shape, so it is reported in full.

Hive Router has no response cache. PoC B therefore pushes the cache **down into
the three subgraphs** (`@graphql-yoga/plugin-response-cache` +
`@envelop/response-cache-redis`), with a separate invalidator. The question was
whether that workaround actually satisfies constraints 3 and 4. It does — and on
one axis it beats Hive Gateway.

Fifteen services started; `supergraph-compose` exited `0`; router reported
`version: 0.3.1` and `supergraph loaded successfully`.

| Step | Observed result |
|---|---|
| First call (MISS) | **46.7 ms**, **5 upstream REST calls** |
| Identical call again (HIT) | **5.4 ms**, **0 new REST calls** |
| Cached bodies written | **3** — one per subgraph operation, not one per client response |
| Tag storage | **real Redis SETs**, e.g. `Account:acct-1001 → [2 response ids]` |
| `DELETE` purge of `Account:acct-1001` | 3 response bodies removed; DBSIZE 19 → 8 |
| Unrelated fund responses | ✅ **survived** |
| Re-query after purge | MISS, but only **2 REST calls**, not 5 |

**Proof of a cache hit is the REST call count, not the latency.** The subgraphs
log every upstream call; the hit added zero.

Two findings here that favour the Router topology:

1. **Finer invalidation granularity.** The cache unit is a *subgraph fetch*, not
   a whole client response. Purging the account removed the accounts and policies
   fetches but left the funds fetch cached — so the next query re-fetched **2 of
   5** REST calls instead of all 5. Hive Gateway's response cache is coarser: one
   whole response per key, so any one tagged entity changing discards everything
   that response touched.
2. **Real Redis SET tags.** The subgraph plugin uses `SADD`/`SMEMBERS`, making
   invalidation O(tag size). Hive Gateway's adapter uses one key per
   (entity, response) pair and a keyspace `SCAN`, which is O(total keys) — see
   §10.4.

**The correction this forces.** The August conclusion that Hive Router "cannot
meet the caching requirement" is too strong. The *router* cannot cache, which is
true and unchanged. But the *architecture* can, the workaround is sound, and its
granularity is better. What Hive Router costs is not caching capability — it is
three subgraph servers, 916 lines of code we own, and six extra containers.

### 9.7 Schema-automation demo, August

A real nullable field (`Fund.launchDate`) was added to the Funds OpenAPI spec and
mock server, then traced through both architectures.

| | Grafbase REST extension | Passthrough subgraphs (both gateways) |
|---|---|---|
| Type appears in GraphQL schema | ✅ automatic | manual, one line of SDL |
| Field returns real data | ❌ **silently `null`** | ✅ immediately correct |
| Root cause | jq `selection` is an explicit allow-list | resolver returns the whole REST object |
| Fix | one line in the jq selection | none needed |
| Caught by existing validation | ❌ **no** — `null` is type-valid | n/a |
| Propagation | `grafbase dev` hot-reloaded, no restart | Hive Router needs recompose + restart |

**This is an architecture finding, not a vendor finding.** Both gateways executed
the passthrough topology correctly and identically.

---

## 10. Caching and Performance Findings

Caching was not originally a headline criterion. Execution made it decisive, so
it gets its own section.

### 10.1 The distinction that decides the evaluation

Three different things get called "caching," and only one satisfies the
requirement:

| Cache type | What it stores | Removes a REST call? | Grafbase | Hive Router | Hive Gateway |
|---|---|---|---|---|---|
| Plan / operation cache | parsed+planned query | ❌ **never** | ✅ Redis | ✅ in-memory | ✅ in-memory |
| Entity cache | subgraph fetch response | ✅ when a subgraph boundary exists | ⚠️ no-op in REST-extension topology | ✅ **as built in PoC B's subgraphs** | n/a |
| **Response cache** | the final GraphQL response | ✅ **always** | ❌ | ❌ in the router | ✅ **Redis/Valkey** |

Both Grafbase's `operation_caching` and Hive Router's `cache` key look like
answers and are not. Each caches *plans*. A plan cache makes repeat planning
cheap; it does nothing for repeat data. Mistaking one for the other is the single
easiest way to conclude a gateway satisfies constraint 3 when it does not.

Of the three gateways, **only Hive Gateway ships a response cache**. Hive Router
reaches the same outcome by caching one layer lower, in subgraphs we write
(§9.6). Grafbase has no path to either.

### 10.2 Cache key design, as verified

With `buildResponseCacheKey` overridden, one `AccountOverview` query for
`acct-1001` produces readable keys:

```
response-cache:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Policy.pol-life-3001:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Fund.fund-global-equity:gql.AccountOverview.id-acct-1001.737e0759
...plus the reverse-index keys
```

One query tags entities from **all three REST services**, so a change to any
single policy or fund can invalidate precisely the responses that embedded it.

**The undocumented constraint, restated because it will bite whoever touches
this next:** the response id must contain no colon. Invalidation recovers it with
`key.split(':')[2]`. A colon shifts the index and invalidation silently deletes
nothing. Entity ids must be colon-free too.

### 10.3 Invalidation, as verified

Invalidation is four Redis commands and needs nothing from Hive:

```
SCAN 0 MATCH response-cache:Account.acct-1001:*
     → responseId = key.split(':')[2]
DEL  response-cache:<responseId>                      the body
DEL  response-cache:Account.acct-1001:<responseId>    the forward tag
SCAN 0 MATCH response-cache:<responseId>:*  → DEL     the reverse tags
```

### 10.4 Scaling caveat on tags

Worth knowing before production:

| Path | Tag storage | Invalidation cost |
|---|---|---|
| Hive Gateway (`@graphql-mesh/plugin-response-cache`) | one key per (entity, response) pair | `SCAN` over the keyspace — **O(total keys)** |
| GraphQL Yoga / envelop direct (`@envelop/response-cache-redis`) | real Redis SETs via `SADD` | `SMEMBERS` — **O(tag size)** |

Both confirmed from the shipped package sources. Hive Gateway does **not** use
the SET-based implementation; it adapts a generic key-value cache interface with
no set primitives. Irrelevant at POC scale, and fixable without forking Hive by
wrapping the cache object — see [`hive-poc/gateway/tagged-cache.ts`](../../hive-poc/gateway/tagged-cache.ts).

### 10.5 Caching the REST calls themselves

`@graphql-mesh/plugin-http-cache` caches raw upstream responses under a fully
predictable key (`http-cache-<url>-<method>-<body>`). **It enforces RFC 9111**,
so a REST response with no `Cache-Control` header is treated as immediately stale
and nothing is stored. Enabling it means adding a response header to the three
REST services — small, but it *is* a change to them, so it is off by default in
the POC and the "no REST changes required" claim holds for the response cache.

---

## 11. Limitations and Risks

### 11.1 What was not tested

| Gap | Impact on the recommendation |
|---|---|
| **Breaking** schema change (new required field, removed field, type change) | Only the non-breaking case was executed. Both paths are expected to fail loudly, but this is inferred from architecture, not verified |
| Multi-repetition benchmarks, soak tests, CPU/memory-pinned containers | Performance evidence is a single-run pilot, not decision-grade |
| B2 and B5 benchmark scenarios; any load above 20 connections | Concurrency behaviour unknown |
| Cache-hit benchmark (B4) as a load-tested cross-gateway comparison | Not run under load. Single-request MISS/HIT timings were captured for both Hive paths (§9.5, §9.6); Grafbase has no response cache to compare |
| JWT/OIDC auth, hands-on, on any gateway | All three document native JWT/JWKS. Scored from docs only |
| OpenTelemetry / Prometheus wiring | Documented by all three, verified on none |
| Production-realistic backend latency and failure injection | Mocks answer in well under a millisecond, which no real service does |
| Hive Gateway performance | Never benchmarked. Its performance column in §8.2 is inferred from being the same Node runtime class as Grafbase, **not measured** |

### 11.2 Risks

| # | Risk | Severity | Status / mitigation |
|---|---|---|---|
| 1 | **Grafbase jq allow-list silently drops new REST fields** | **High** | Confirmed, reproduced live. A live data-integrity risk in the repo today, independent of the gateway choice. Fix with a CI check diffing each OpenAPI spec against its jq selection, or migrate to passthrough shaping |
| 2 | Performance evidence is not production-representative | Medium | Confirmed gap. Re-benchmark against realistic backend latency before the ~2× figure informs anything |
| 3 | Hive Gateway's colon constraint in cache keys fails silently | Medium | Documented in code comments and §10.2. Keep the comment in `gateway.config.ts` |
| 4 | `SCAN`-based invalidation is O(keyspace) | Low now, Medium at scale | Wrap the cache for SET-based tags before production volume |
| 5 | Response-cache granularity is coarse | Medium | The unit is a whole response, so a query touching 40 funds is invalidated by any one changing. Cache narrow, repeated operations; set TTL 0 on wide ad-hoc queries |
| 6 | Cache scope and auth | **High if ignored** | The POC uses `session: () => null`, one shared bucket. Correct only because this data is not user-specific. Anything per-user needs a validated session key and `PRIVATE` scope or the cache leaks across users |
| 7 | Hive Router is pre-1.0 (`v0.3.1`) | Medium | Confirmed moving fast — the `cache` key appeared between v0.2.0 and v0.3.1, mid-evaluation. This is one of the two tie-breakers that settled the recommendation against it, so it matters even though it is the runner-up |
| 8 | Build-time composition is a new CI dependency | Low | Both Hive paths need a composition step in CI. Grafbase does not |
| 9 | Licence and roadmap drift | Medium | Re-verify terms immediately before any production commitment. Hive is MIT; Grafbase is source-available with a paid tier |
| 10 | Our Hive Gateway image is 1.86 GB | Low | An unoptimised POC Dockerfile, not a product property. Official image is 618 MB |
| 11 | Mesh `@omnigraph/openapi` is pre-1.0 (v0.112.4) | Medium | The gateway itself is v2.x and mature; the OpenAPI loader is the younger dependency |
| 12 | Pre-existing bug in the funds mock service | Low | `GET /accounts/{id}/funds` dereferences a non-existent `accounts` array and crashes the process. It is declared in `openapi.yaml`, so generated clients will call it. The Hive Gateway POC routes around it via `fundHoldings`. Worth fixing regardless |

---

## 12. Recommendation and Rationale

### Recommendation

**Adopt Hive Gateway with GraphQL Mesh.** Keep the Hive Router topology as the
documented fallback if performance or cache granularity later dominate. Grafbase
places third and should not be extended further for this use case.

This is a **close decision reached on a tie-break**, not a landslide. Stated
plainly so nobody reads more certainty into it than the evidence supports.

### Rationale

**Why Hive Gateway.** It satisfies all four constraints with the least machinery.
It federates the three REST APIs with **no subgraph servers at all**, keeps the
existing OpenAPI specs as the source of truth, caches the final GraphQL response
in Redis/Valkey so repeated queries stop reaching REST, and exposes a readable
key format with entity tags so specific entries can be deleted on demand. Nine
services, 630 lines, and the REST mapping is generated rather than written.

Weighted score **4.05**, ahead of Hive Router by 0.30 — inside the tie-break
zone, so the aggregate does not decide. The two tie-breakers fixed in advance
both favour it: on schema-evolution automation (the 20% criterion) it scores 5 to
Hive Router's 4, because Mesh regenerates the REST mapping from specs we already
maintain; and on risk it is v2.x and established where Hive Router is pre-1.0.

**Why Hive Router is the runner-up, not a rejection.** The August finding that it
"cannot meet the caching requirement" was too strong and is corrected here. The
router genuinely has no response cache, but PoC B proves the architecture caches
effectively one layer down, in the subgraphs — and with **finer granularity than
Hive Gateway**, re-fetching 2 of 5 REST calls after an invalidation instead of
all 5, using real Redis SET tags. Add its measured ~2× throughput and 135 MB
image and it is a legitimate choice. What rules it out *for now* is cost of
ownership, not capability: three hand-written subgraph servers, 916 lines, 15
containers, and composition and caching both being code we maintain.

**Choose Hive Router instead if** either of two things becomes true: gateway
throughput turns out to matter at production volume, or the coarse
whole-response invalidation granularity of Hive Gateway proves too blunt in
practice. Both are measurable, and neither is known yet.

**Why not Grafbase.** It has the best developer experience and the most elegant
REST integration, and if caching were not a requirement this would be the
pragmatic incumbent choice. But caching is a requirement, and Grafbase fails
constraints 3 and 4 outright: neither of its caches reduces REST load in the
topology in use, and its keys are opaque hashes with no supported way to
enumerate or delete a specific entry. The jq allow-list silent-drop (risk 1) is a
second, independent mark against the REST-extension pattern.

### Trade-offs we are accepting

Stated plainly, because a recommendation without them is not credible:

- **Performance.** Hive Gateway runs on Node, like Grafbase. We are giving up
  Hive Router's measured ~2× throughput. Mitigating factor: cache hits
  short-circuit before query planning, so the cached path is fast regardless —
  but Hive Gateway's throughput was **never benchmarked**, which is an honest
  gap, not a reassurance.
- **Cache granularity.** Hive Gateway's cache unit is a whole response, so any
  one tagged entity changing discards everything that response touched. The Hive
  Router topology invalidates per subgraph fetch and re-fetched 2 of 5 REST calls
  where Hive Gateway would re-fetch all of them. We are accepting the blunter
  instrument in exchange for not running three subgraph servers.
- **A build step.** Mesh composition must run in CI. Grafbase needs no such step.
- **A generated artifact.** The supergraph is generated, not authored. Nothing
  stops hand-editing it, but it is not a supported authoring surface.
- **Custom code we own.** The invalidator service, roughly 150 lines. This is
  arguably a feature: invalidation triggered by REST-side updates, a CDC stream
  or an ops runbook, without going through the gateway.
- **Migration cost.** The existing Grafbase REST-extension work does not port
  directly. The OpenAPI specs do.

### Confidence: Medium-High

High on caching and REST integration — both hands-on verified and unambiguous,
and they are the criteria that decide it. Medium on performance, which is a
single-run pilot that never included Hive Gateway at all. Low on auth and
observability, tested on nothing.

### Next steps, in priority order

1. **Fix the jq allow-list silent-failure risk now**, independent of this
   decision. It is a live data-integrity issue. Add a CI check diffing each
   OpenAPI spec against its jq selection, or move to passthrough shaping.
2. **Benchmark Hive Gateway**, cold and cache-warm, against the same scenarios.
   It is the recommended option and the only one with no performance data.
3. **Re-benchmark all candidates against a realistic backend** with real latency
   and failure injection before any performance number informs a decision.
4. **Wire JWT auth and OTel/Prometheus hands-on** on Hive Gateway. Both are
   currently documentation-only across the board.
5. **Decide the cache scope model** before production. Per-user data needs a
   validated session key and `PRIVATE` scope, or the cache leaks across users.
6. **Fix the funds mock service bug** (risk 12).
7. **Pilot** on the narrowest useful surface — one high-read query path with a
   clear invalidation trigger — before broader migration.

---

## 13. Conclusion

The spike asked whether to use Grafbase or Hive Router. The answerable question
turned out to be different, because the ticket's premise that Hive Router is a
rename of GraphQL Mesh is incorrect. Hive Router is a Rust Federation v2 executor
that speaks only GraphQL and caches only query plans. Evaluating it alone against
Grafbase would have missed the option that actually wins.

The correct comparison is three-way, and all three paths were built and run.
Federation capability is effectively tied — all three compose and execute true
Federation v2 correctly, with responses differing only in `Float` serialisation.
The separation is in REST integration, caching and cost of ownership:

- **Hive Gateway — 4.05.** Generates its REST integration from the OpenAPI specs
  we already maintain, with zero subgraph servers, and ships a response cache with
  predictable keys, entity tags and explicit invalidation.
- **Hive Router — 3.75.** Fastest and smallest runtime, and its subgraph-level
  cache invalidates more precisely than Hive Gateway's. Costs three hand-written
  subgraph servers, 916 lines and 15 containers.
- **Grafbase — 3.35.** Best developer experience and the most elegant REST
  integration, but its caches do not reduce REST load and its keys cannot be
  enumerated or deleted.

**Hive Gateway is the recommendation**, on weights fixed before scoring. The
0.30-point margin sits inside the pre-agreed tie-break zone, so the decision rests
on the highest-weighted criterion (schema-evolution automation, where it leads 5
to 4) and the risk register (v2.x and established versus pre-1.0). It is a
defensible close call, not a landslide, and §12 names the two measurable
conditions under which Hive Router would be the better answer.

Three findings matter independently of the choice:

1. **The Grafbase jq allow-list can silently drop a newly-added REST field**,
   returning `null` for data that exists. Reproduced live, caught by no existing
   validation step. A live data-integrity risk in the repo today.
2. **"Caching" is three different features.** Plan caches, entity caches and
   response caches are not substitutes, and two of the three candidates ship only
   the kind that never removes an upstream call. Both Grafbase's
   `operation_caching` and Hive Router's `cache` key invite exactly this mistake.
3. **Where the cache sits changes how precisely you can invalidate.** Caching at
   the gateway is simpler to configure; caching in subgraphs invalidates more
   surgically. That is a real architectural trade-off, not an implementation
   detail.

Confidence is **Medium-High** and the recommendation should be revisited once
Hive Gateway has been benchmarked — it is the recommended option and the only one
with no performance data at all.

---

## 14. Jira Story Closure Summary

**WDCS-23671 — SPIKE: GraphQL Gateway Evaluation**

### Scope delivered

| Ticket scope item | Status | Evidence |
|---|---|---|
| Compare Grafbase and Hive for federation | ✅ Complete | §6, §7, §9.1 — all three verified on true Federation v2 |
| Compare REST integration | ✅ Complete | §5, §7 — three working PoCs, effort measured |
| Compare schema composition | ✅ Complete | §9.5 — real field addition traced end to end |
| Evaluate developer experience | ✅ Complete | §6, §7 |
| Evaluate operational overhead | ✅ Complete | §9.4 — image sizes and startup measured |
| Evaluate deployment model | ✅ Complete | §5, §9.4 |
| Produce comparison matrix | ✅ Complete | §8 |
| Produce risk register | ✅ Complete | §11.2 — 12 risks |
| Produce recommendation | ✅ Complete | §12 |

### Scope exceeded

- A third candidate (Hive Gateway) was evaluated after the ticket's premise was
  found to be factually wrong. **This changed the recommendation.**
- Caching and cache invalidation were evaluated to implementation depth, with two
  working invalidation services, though the ticket did not list caching in scope.
  Caching then became the deciding criterion.

### Corrections made to prior findings

Both were found by re-running the earlier work rather than re-reading it:

| Prior claim | Correction |
|---|---|
| The two gateways' responses are "byte-identical" | **Not quite.** Semantically identical, but Grafbase emits a trailing `.0` on whole-number `Float`s and Hive Router does not (§9.2). A string-comparing contract test would fail on a gateway switch |
| Hive Router "cannot meet the caching requirement" | **Too strong.** The router cannot cache, but PoC B's subgraph-level cache meets both caching constraints with *finer* granularity than Hive Gateway (§9.6). Its caching score moved 1 → 4 and the gap to Hive Gateway narrowed into the tie-break zone |
| Hive Router config has no `cache` key (v0.2.0, August) | **Changed.** v0.3.1 has one. It is in-memory plan caching only, verified accepted by the running router — easy to mistake for a response cache |
| GraphQL Mesh "not evaluated — top follow-up item" | **Now closed.** Built, run and verified as PoC C (§9.5) |

### Deliverables

| Artefact | Location |
|---|---|
| **This page** | [`Docs/gateway-evaluation/CONFLUENCE-WDCS-23671-Gateway-Evaluation.md`](./CONFLUENCE-WDCS-23671-Gateway-Evaluation.md) |
| Grafbase vs Hive Router detail | [`Docs/gateway-evaluation/`](./) (`00`–`05`, `CONFLUENCE-Outcome.md`) |
| Hive Gateway detail | [`Docs/Hive-docs/HIVE-EVALUATION.md`](../Hive-docs/HIVE-EVALUATION.md) |
| REST integration options | [`Docs/Hive-docs/CONFLUENCE-REST-Integration-Options.md`](../Hive-docs/CONFLUENCE-REST-Integration-Options.md) |
| PoC A — Grafbase true federation | [`grafbase-federation/`](../../grafbase-federation/) |
| PoC B — Hive Router | [`hive-router-poc/`](../../hive-router-poc/), [`hive-router/`](../../hive-router/), `*-subgraph/` |
| PoC C — Hive Gateway | [`hive-poc/`](../../hive-poc/) |
| Raw benchmark output, logs, supergraph SDL | [`Docs/gateway-evaluation/evidence/`](./evidence/) |
| Demo scripts | `hive-poc/demo/demo.sh`, `hive-router-poc/demo/demo.sh` |

### Known gaps carried out of the spike

Listed in full in §11.1. The four that should become their own tickets:

1. Benchmark Hive Gateway — the recommended option has no performance data.
2. Re-benchmark all candidates against a realistic backend.
3. Hands-on JWT and OTel/Prometheus verification.
4. Fix the Grafbase jq allow-list drift risk (risk 1) — the only item that is a
   live production-data concern rather than an evaluation gap.

### Closure recommendation

The spike's questions are answered with working evidence and a decision rule
applied as agreed in advance. **Ready to close**, with items 1–4 above raised as
follow-up tickets. Per the original plan's definition of done, the recommendation
should be reviewed by one other senior engineer or the platform lead before the
spike is formally closed.
