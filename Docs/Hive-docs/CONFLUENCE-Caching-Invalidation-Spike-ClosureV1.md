# SPIKE: Analyse Caching and Targeted Invalidation Support in Hive — Closure

**Jira:** _<add ticket id>_ · **Status:** Complete — ready for closure
**Domain:** Insurance APIs — Accounts, Policies, Funds
**Repository:** `rest-demo` · branch `hive-final-poc` · POC in [`hive-router-poc/`](../../hive-router-poc/)

> **Provenance.** **[Verified]** = executed against the running POC.
> **[Documented]** = read from vendor documentation, not exercised.
> Measurements are recorded in the repository and reproducible — see §3.1.

---

## Index

| § | Section |
|---|---|
| 1 | [Overview](#1-overview) |
| 2 | [Background](#2-background) |
| 3 | [Scope](#3-scope) |
| 3.1 | [Proof of Concept & Demo](#31-proof-of-concept--demo) |
| 4 | [Findings](#4-findings) |
| 4.1 | [What Hive Router caches natively](#41-what-hive-router-caches-natively) |
| 4.2 | [Response caching is not available in Hive Router](#42-response-caching-is-not-available-in-hive-router) |
| 4.3 | [Where the cache was placed, and why](#43-where-the-cache-was-placed-and-why) |
| 4.4 | [Targeted invalidation](#44-targeted-invalidation) |
| 4.5 | [Measured results](#45-measured-results) |
| 5 | [How it is implemented](#5-how-it-is-implemented) |
| 6 | [Risks](#6-risks) |
| 7 | [Recommendation](#7-recommendation) |
| 8 | [Next Steps](#8-next-steps) |
| 9 | [Spike Closure](#9-spike-closure) |

---

## 1. Overview

This spike asked what Hive caches for us, what it does not, and whether we can
clear one customer's cached data without discarding everyone else's.

> **Hive Router has five caches, and none of them is a response cache.**
> They make repeated *thinking* cheap — parsing, validating and planning a
> query. They remove **zero** calls to the backend services.

This is easy to get wrong: the router's configuration contains a block called
`cache` with sensible-looking settings and no warning that it is not the kind of
cache you were looking for.

Response caching was therefore built, placed **inside each of the three subgraph
services** rather than in front of them — the most valuable result of the spike,
because it is what makes invalidation precise rather than wholesale.

| Question | Answer |
|---|---|
| Does repeating a query avoid the REST calls? | **Yes** — 5 calls become **0** |
| Can we clear one account without clearing everything? | **Yes** |
| What does the next request then cost? | **2 REST calls, not 5** |
| Do unrelated cached responses survive? | **Yes**, with no orphaned references |

All eight acceptance criteria are met. Two gaps remain before production, both
out of scope by agreement and named in §6.

---

## 2. Background

- Three insurance REST APIs — **Accounts, Policies, Funds** — are presented as
  one GraphQL API through federation. They are owned elsewhere and cannot be
  modified.
- Every GraphQL field resolves to a REST call, so **the cost of this system is
  REST calls**. One realistic question — *"this account, its policies, and the
  funds behind them"* — costs **five**. Asked twice, ten.
- Earlier spikes selected Hive and settled schema delivery. Neither examined
  caching.

**Why "targeted" is the real requirement.** A cache that can only be cleared
wholesale forces a choice between stale data and a cold cache: if one customer's
details change, clearing everything makes every other customer's next request
pay full price. Removing that trade-off is what this spike set out to prove.

---

## 3. Scope

| # | Acceptance criterion | Outcome |
|---|---|---|
| 1 | Hive-supported caching mechanisms identified and documented | ✅ §4.1 — five, all operational |
| 2 | Difference between Router internal caching and response caching documented | ✅ §4.2 |
| 3 | Response caching POC implemented using Valkey | ✅ §4.3, §5 |
| 4 | Repeated requests demonstrate cache reuse by reducing REST calls | ✅ §4.5 — **5 → 0** |
| 5 | TTL expiry and cache-disabled scenarios validated | ✅ §3.1 steps 13–14 |
| 6 | Targeted invalidation demonstrated for the required scenarios | ✅ §4.4 — all four levels |
| 7 | Unrelated cached responses remain available after targeted invalidation | ✅ §4.4 |
| 8 | Findings, limitations and recommended approach documented | ✅ §6, §7 |

**Out of scope, as agreed:** production-ready cache implementation, production
authentication/security for the invalidation API, high availability and disaster
recovery, production performance and load testing, and automatic invalidation
triggered by backend data changes.

### 3.1 Proof of Concept & Demo

| Asset | What it is |
|---|---|
| [`hive-router-poc/`](../../hive-router-poc/) | The POC — REST APIs, GraphQL services, router, cache store, invalidation service |
| [`demo/demo.sh`](../../hive-router-poc/demo/demo.sh) | The whole story as one runnable walkthrough |
| [`subgraphs/src/cache.mjs`](../../hive-router-poc/subgraphs/src/cache.mjs) · [`invalidator/server.js`](../../hive-router-poc/invalidator/server.js) | The cache and the invalidation API |
| [`README.md`](../../hive-router-poc/README.md) | Setup, cache design, measured results |

**Everything below in two commands:**

```bash
docker compose -f hive-router-poc/docker-compose.yml up --build -d
cd hive-router-poc/demo && ./demo.sh
```

#### Test flow

> **The evidence of a cache hit is the REST log, not the clock.** Each service
> prints a line every time it calls its REST backend; on a hit it prints
> **nothing at all**. That is stronger than a stopwatch, because the mock
> services answer in microseconds and timings on one laptop are noise.

Set up two shortcuts and a log pane, then work down the tables.

```bash
# shortcuts used throughout
alias vk='docker compose -f hive-router-poc/docker-compose.yml exec -T valkey valkey-cli'
ask() { curl -s localhost:4000/graphql -H 'content-type: application/json' -d '{"operationName":"AccountOverview","query":"query AccountOverview($id: String!) { account(id: $id) { holderName policies { policyNumber } fundHoldings { fund { name } } } }","variables":{"id":"acct-1001"}}'; }
```

```bash
# leave this running in a second window — this is the evidence
docker compose -f hive-router-poc/docker-compose.yml logs -f \
  accounts-subgraph policies-subgraph funds-subgraph
```

**Part 1 — does caching work at all?**

| # | What you do | Expected result |
|---|---|---|
| 1 | `vk FLUSHALL` | Cache empty |
| 2 | `ask` | **Five** `REST GET` lines appear — count them aloud |
| 3 | `vk --scan --pattern 'sg:*'` | Four cached pieces, one per step the router took |
| 4 | `vk SMEMBERS Account:acct-1001` | The index showing which responses contain that account |
| 5 | **`ask`** again | **Nothing appears in the log.** Pause — that silence is five REST calls not made |
| 6 | `curl -s localhost:8090/cache/keys` | The same view through the invalidation API |

**Part 2 — targeted invalidation, the actual test.**

| # | What you do | Expected result |
|---|---|---|
| 7 | `curl -s localhost:4000/graphql ... FundDetail` (an unrelated fund) | Cached alongside the account responses |
| 8 | `curl -s localhost:8090/cache/entity/Account/acct-1001` | A **preview**: exactly what would be removed. Nothing changes |
| 9 | `curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001` | Confirmation of what was removed |
| 10 | `vk --scan --pattern 'sg:*'` | Account responses gone. **The unrelated fund response is still there** |
| 11 | `ask` | REST lines appear — but **two, not five**. Policy and fund data were never invalidated |

**Step 11 is the moment worth pausing on.** Two-not-five is the whole argument
for caching inside the services rather than in front of them.

**Part 3 — the remaining checks.**

| # | What you do | Expected result |
|---|---|---|
| 12 | The other three levels: `DELETE /cache/type/Fund`, `DELETE /cache/subgraph/accounts`, `DELETE "/cache/key?key=<id>"` | Each works independently; each has a `GET` preview |
| 13 | `ACCOUNTS_TTL_MS=5000 docker compose ... up -d --force-recreate accounts-subgraph`, then `ask` twice 6s apart | Entry expires on its own; the second call is a miss |
| 14 | `CACHE_ENABLED=0 docker compose ... up -d --force-recreate accounts-subgraph policies-subgraph funds-subgraph` | Every request calls REST — the clean baseline |
| 15 | `curl -s localhost:8090/cache/tags` | No orphaned references left behind |

`vk MONITOR` gives a live view of the cache — the most convincing thing to put
on screen during a walkthrough.

---

## 4. Findings

### 4.1 What Hive Router caches natively

Five caches, all in memory, local to one router process, and operational rather
than data caches.

| # | Cache | What it holds |
|---|---|---|
| 1 | **Parsing** | Parsed query documents, so the same query text is not re-parsed |
| 2 | **Validation** | The result of checking a query against the schema |
| 3 | **Normalization** | The tidied-up canonical form of a query |
| 4 | **Query plan** | The execution plan — which service to call, in what order |
| 5 | **Plugin supergraph runtimes** | Router instances for plugin-selected schema variants |

**[Verified]** 1–4 are configured in the POC; each takes a size limit and
expiry settings. **[Documented]** the fifth is from the vendor's cache
reference — a single count (default 10), no expiry — and it is the item listed
as *"runtime cache"* in this spike's scope. It holds **router instances, not
responses**.

```
   WHAT THE ROUTER'S FIVE CACHES ACTUALLY SAVE

   a repeated query arrives
            │
            ▼
   ┌───────────────────────────────────────────┐
   │  parse  ·  validate  ·  normalise  · plan │   saved: CPU work,
   │         all cached, all skipped           │   microseconds
   └─────────────────────┬─────────────────────┘
                         ▼
   ┌───────────────────────────────────────────┐
   │  call Accounts  ─────────────────────────►│   NOT saved: every backend
   │  call Policies  ─────────────────────────►│   call, every time
   │  call Funds     ─────────────────────────►│
   └───────────────────────────────────────────┘

   The expensive part is below the line. None of the five reaches it.
```

### 4.2 Response caching is not available in Hive Router

**[Verified]** against the running router and **[Documented]** against the
vendor's configuration reference: the reference's entire description of the
`cache` key is *"Tune in-memory caches"*, scoped to the five above. Nothing
caches response data; nothing skips a backend call. The documentation neither
promises response caching nor rules it out — treat it as **absent today**.

**The distinction** — acceptance criterion 2:

| | Router internal caching | Response / data caching |
|---|---|---|
| What is stored | Parsed queries, plans, validation results | The answer sent back to a client |
| What it saves | Computation inside the router | **Calls to the backend services** |
| Measured in | Microseconds of CPU | Requests not made |
| Scope | One router process, in memory | Shared across every instance |
| Can it serve stale data? | No — it never holds data | **Yes** — hence freshness windows and invalidation |
| Who provides it | **Hive Router, built in** | **Nobody** — we built it |

Worth being precise about in any summary: **Hive Gateway**, the separate Node.js
runtime, *does* ship a response cache. "Hive supports response caching" is true
of the product family and false of Hive Router specifically.

### 4.3 Where the cache was placed, and why

```
   OPTION A — cache in front (the obvious choice)

   client ──► [ CACHE ] ──► router ──► Accounts · Policies · Funds
                  │
                  └─ holds whole answers. One account changes
                     → the whole answer is discarded
                     → the next request costs all 5 REST calls


   OPTION B — cache inside each service   ◄── what the POC does

   client ──► router ──► [cache] Accounts
                     ──► [cache] Policies
                     ──► [cache] Funds
                              │
                              └─ holds each piece separately, and the router's
                                 own cross-service lookups pass through it too.
                                 One account changes
                                 → only the account piece is discarded
                                 → the next request costs 2 REST calls, not 5
```

Two further benefits follow from the same placement:

- **Each service owns the freshness of its own data**, which is where that
  decision belongs — fund reference data can be held far longer than a balance.
- **The runtime choice stays open.** Because the cache lives in the services, it
  works with Hive Router or Hive Gateway; adopting Gateway's built-in cache
  would tie caching to that runtime.

### 4.4 Targeted invalidation

A small standalone service exposes the invalidation API. **It talks only to the
cache store** and imports nothing from Hive or the subgraph services —
deliberate, so whatever system knows the data changed can drive it.

All four required levels, **[Verified]**:

| Level | Clears | Typical trigger |
|---|---|---|
| **Entity** | Everything containing one specific record | "This customer's details changed" |
| **Type** | Everything containing any record of a type | "All fund prices were repriced" |
| **Exact entry** | One single cached response | Surgical fix |
| **Subgraph** | Everything one service cached | That service was redeployed |

**Every destructive operation has a preview** — a read-only twin returning
exactly what *would* be removed. Showing the blast radius before acting is the
difference between a tool operations will use and one nobody is allowed to run.

**Invalidation is precise, not a search.** Responses are indexed by the records
inside them, so clearing one account looks it up directly: the cost depends on
how many responses contain that account, not on how large the cache has grown.

```
   WHAT ONE TARGETED CLEAR TOUCHES

   cached responses                index (what is inside what)

   ┌────────────────────┐
   │ account overview   │◄──┐
   └────────────────────┘   │    Account acct-1001   ──►  3 responses
   ┌────────────────────┐   ├──
   │ account name       │◄──┘    Fund global-equity  ──►  2 responses
   └────────────────────┘
   ┌────────────────────┐
   │ fund detail        │◄─────── (unrelated to the account)
   └────────────────────┘

   clear Account acct-1001
            ├──► the 3 responses containing it are removed
            ├──► every index entry pointing at them is tidied up
            └──► fund detail is UNTOUCHED  ✓
```

**Acceptance criterion 7 — [Verified].** The unrelated fund response survived,
and no orphaned references were left pointing at responses that no longer exist.
That tidy-up step is easy to omit and would have leaked silently.

### 4.5 Measured results

| Observation | Result |
|---|---|
| REST calls on a miss | 5 |
| **REST calls on a hit** | **0** |
| **REST calls after clearing one account** | **2, not 5** |
| Cached pieces per deep query | 4, one per router step |
| Clearing one account | 7 entries removed, 9 index entries updated, 3 responses gone |
| Unrelated fund response | Survived |
| Orphaned references afterwards | **None** |
| Response time — cold miss / warm hit | 6.1–8.5 ms / 2.6–2.9 ms |

**Quote the REST-call numbers, not the timings.** The timings look modest only
because the mock services answer in microseconds over loopback; against real
backends the saving is the backend's entire latency.

---

## 5. How it is implemented

A reference for whoever picks this up next. Two files hold almost all of it, and
both carry header comments explaining the reasoning.

| Concern | Where |
|---|---|
| Response cache and cache-key design | `subgraphs/src/cache.mjs` |
| Invalidation API | `invalidator/server.js` — standalone, talks only to the cache store |
| Freshness defaults | `subgraphs/src/server.mjs` |
| Cache store | `docker-compose.yml` — Valkey, a drop-in Redis alternative |

Components: Hive Router 0.3.16, `@graphql-yoga/plugin-response-cache` 3.26.1,
`@envelop/response-cache-redis` 4.5.1, `graphql-yoga` 5.24.1, Valkey 8.

**Freshness windows** — each service owns its own, overridable by configuration
without a code change:

| Service | Default | Why |
|---|---|---|
| Accounts | 30 seconds | Balances move |
| Policies | 2 minutes | Changes on renewal |
| Funds | 5 minutes | Reference data, changes daily at most |

Three design points worth knowing before changing anything here:

- **Cache entries are human-readable** — an entry names the service, the
  operation and the record. The router does not name its internal lookups, so
  without extra handling every entry would have read "anonymous" and the cache
  would have been undebuggable.
- **Failure behaviour is designed.** If the cache store is unavailable, errors
  are logged and **not raised**: the system degrades to "every request is a
  miss" — slower, never broken. **[Verified]**, and worth preserving.
- **Two internal settings must not be changed casually.** Both are documented in
  place; changing either makes type-level clearing silently remove nothing while
  still reporting success.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Nothing invalidates automatically when backend data changes** | **High** | The cache is only as fresh as its window. Production needs the REST tier, or an event from it, to call the invalidation API. **The single largest gap** |
| The invalidation API has no authentication | **High** for production | Out of scope by agreement; must be secured before any shared environment |
| The cache is shared across all users, no per-user separation | **High** if used for personalised data | Correct today — these payloads are not user-specific. If that changes, this work must come **first** |
| The response cache is ours to maintain; Hive Router provides none | **Medium** | Two documented files. Review on each Hive Router upgrade |
| Two internal settings, if changed, make type-level clearing silently do nothing | **Medium** | Documented in place; add to the review checklist |
| Single cache store instance, no high availability | **Medium** | Out of scope. Degrades to "always miss" rather than failing — confirm with a clustered store |
| Timings measured against mock services over loopback | **Low** | Quote REST-call counts, not milliseconds |
| Freshness windows are estimates, not derived from data | **Low** | Revisit against observed change rates |

---

## 7. Recommendation

**Keep response caching inside the subgraph services, backed by Valkey, with the
targeted invalidation API.**

1. **Hive Router will not do this for us.** Its five caches remove no backend
   calls, so any response caching is something we add. The only real question is
   *where*.
2. **Inside the services is measurably the better place.** Caching whole answers
   in front discards everything when any part changes; this placement means one
   record changing costs 2 REST calls instead of 5, and that advantage grows as
   queries get deeper.
3. **It keeps the runtime choice open**, because the cache is independent of
   which Hive runtime sits in front.

**Before production, two things must be built**, both in §6 and both out of
scope here: **automatic invalidation** driven by backend data changes, and
**authentication** on the invalidation API. Until the first exists the cache is
only as fresh as its window — acceptable for fund reference data, not for
balances.

**Confidence:** **High** on what Hive Router does and does not cache, on the
measured behaviour and on targeted invalidation — all executed. **Medium** on
production sizing and freshness values, measured against mock services.

---

## 8. Next Steps

1. **Design automatic invalidation** — decide how the REST tier signals a change
   (event, webhook, or change-data-capture) and have it call the invalidation
   API. This is the gap between a demo and a production cache.
2. **Secure the invalidation API** with authentication and an audit trail.
3. **Re-measure against real backends** and set freshness windows from observed
   change rates rather than estimates.
4. **Decide the personalised-data position** before any user-specific data is
   cached.
5. **Run a clustered cache store** and confirm degrade-to-miss survives failover.
6. **Add cache metrics** — hit rate, miss rate, evictions, invalidations — so the
   cache's value is visible rather than assumed.

---

## 9. Spike Closure

| # | Acceptance criterion | Outcome |
|---|---|---|
| 1 | Hive-supported caching mechanisms identified and documented | ✅ Done — §4.1, five mechanisms |
| 2 | Difference between Router internal caching and response caching documented | ✅ Done — §4.2 |
| 3 | Response caching POC implemented using Valkey | ✅ Done — §4.3, §5 |
| 4 | Repeated requests demonstrate cache reuse by reducing REST calls | ✅ Done — **5 → 0** |
| 5 | TTL expiry and cache-disabled scenarios validated | ✅ Done — §3.1 steps 13–14 |
| 6 | Targeted invalidation demonstrated for the required scenarios | ✅ Done — entity, type, exact entry, subgraph |
| 7 | Unrelated cached responses remain available after targeted invalidation | ✅ Done — no orphaned references |
| 8 | Findings, limitations and recommended approach documented | ✅ Done — §6, §7 |
| | **Decision** | **Adopt subgraph-level response caching on Valkey with targeted invalidation. Automatic invalidation and API security to follow as separate stories.** |

**Delivered beyond the stated criteria:** a preview mode on every destructive
operation; human-readable cache entries that make diagnosis possible without
tooling; and a verified degrade-to-miss failure mode.

**Outstanding, with reasons:** automatic invalidation, authentication on the
invalidation API, high availability and production load testing — all out of
scope by agreement, all carried into §8.

The spike can be closed.
