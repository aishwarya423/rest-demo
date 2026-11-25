# SPIKE: Analyse Caching and Targeted Invalidation Support in Hive — Closure

**Jira:** _<add ticket id>_ · **Status:** Complete — ready for closure
**Domain:** Insurance APIs — Accounts, Policies, Funds
**Repository:** `rest-demo` · branch `hive-final-poc`
**Related:** [WDCS-25885 — Hive Capability Analysis closure](./CONFLUENCE-WDCS-25885-Spike-Closure.md) ·
[WDCS-27923 — Self-hosted registry closure](./CONFLUENCE-WDCS-27923-Spike-Closure.md)

> **Provenance.** Findings are **[Verified]** (executed against the running POC),
> **[Documented]** (stated in vendor documentation, read but not exercised) or
> **[Unverified]**. Nothing is asserted from memory. Versions are pinned.
> Measurements quoted here were taken during the POC and are recorded in the
> repository; they can be reproduced with one command — see §3.1.

---

## Index

| § | Section |
|---|---|
| 1 | [Overview](#1-overview) |
| 2 | [Background](#2-background) |
| 3 | [Scope](#3-scope) |
| 3.1 | [Proof of Concept & Demo](#31-proof-of-concept--demo) |
| 3.2 | [Test flow — how it was proved](#32-test-flow--how-it-was-proved) |
| 4 | [Evaluation Summary](#4-evaluation-summary) |
| 4.1 | [Hive Router native caching (Rust) — v0.3.16, MIT](#41-hive-router-native-caching-rust--v0316-mit) |
| 4.2 | [GraphQL response caching in Hive Router — Not supported](#42-graphql-response-caching-in-hive-router--not-supported) |
| 4.3 | [Response caching PoC — Valkey at the subgraph level, MIT](#43-response-caching-poc--valkey-at-the-subgraph-level-mit) |
| 4.4 | [Targeted invalidation — Demonstrated](#44-targeted-invalidation--demonstrated) |
| 4.5 | [Enterprise capability assessment](#45-enterprise-capability-assessment) |
| 5 | [Comparison Matrix](#5-comparison-matrix) |
| 6 | [Risks](#6-risks) |
| 7 | [Recommendation](#7-recommendation) |
| 8 | [Next Steps](#8-next-steps) |
| 9 | [Spike Closure](#9-spike-closure) |

---

## 1. Overview

This spike asked what Hive caches for us, what it does not, and whether we can
cache responses precisely enough to clear **one customer's data** without
throwing away everyone else's.

The headline finding is a correction, and it is the single most important
sentence in this page:

> **Hive Router has five caches, and none of them is a response cache.**
> They make repeated *thinking* cheap — parsing, validating and planning a
> query. They remove **zero** calls to the backend services. Turning them all
> up to maximum would not save a single REST call.

That is easy to get wrong, because the router's configuration file has a block
called `cache` with sensible-looking settings in it, and nothing in the product
warns you that it is not the kind of cache you were looking for.

So the response cache had to be built, and the POC puts it **inside each of the
three subgraph services** rather than in front of them. That placement turned
out to be the most valuable finding of the spike, because it is what makes
invalidation precise:

| Question | Answer |
|---|---|
| Does repeating a query avoid the REST calls? | **Yes** — 5 calls become **0** |
| Can we clear one account without clearing everything? | **Yes** |
| What does that cost us? | The next deep query makes **2 REST calls, not 5** — the fund and policy data it still holds is untouched |
| Do unrelated cached responses survive? | **Yes** — verified |

All eight acceptance criteria are met. The recommendation is to keep this
approach, with four named caveats in §6 before it goes anywhere near production.

---

## 2. Background

- Three insurance REST APIs — **Accounts, Policies, Funds** — are presented as
  one GraphQL API through federation.
- Those APIs are owned elsewhere and cannot be changed. Every GraphQL field
  bottoms out in a REST call, so **the cost of the system is REST calls**, and
  reducing them is the point of caching here.
- A single "give me an account with its policies and the funds behind them"
  question costs **five** REST calls across the three services. The same
  question asked twice a second costs ten.
- Earlier spikes chose Hive and settled schema delivery. Neither looked at
  caching. This spike does.

**Why "targeted" invalidation matters, in business terms.** A cache that can
only be cleared wholesale forces a choice between stale data and a cold cache.
If one customer updates their address, clearing the entire cache means every
other customer's next request pays full price. Targeted invalidation removes
that trade-off, and it is the capability this spike set out to prove.

---

## 3. Scope

| Acceptance criterion | Covered | Outcome |
|---|---|---|
| 1. Hive-supported caching mechanisms identified and documented | ✅ §4.1 | Pass — five, all operational |
| 2. Difference between Router internal caching and response caching documented | ✅ §4.2 | Pass |
| 3. Response caching POC implemented using Valkey | ✅ §4.3 | Pass |
| 4. Repeated requests demonstrate cache reuse by reducing REST calls | ✅ §4.3 | Pass — 5 → **0** |
| 5. TTL expiry and cache-disabled scenarios validated | ✅ §4.3 | Pass |
| 6. Targeted invalidation demonstrated for the required scenarios | ✅ §4.4 | Pass — all four levels |
| 7. Unrelated cached responses remain available after targeted invalidation | ✅ §4.4 | Pass |
| 8. Findings, limitations and recommended approach documented | ✅ §6, §7 | Pass |

**Out of scope, as agreed:** production-ready cache implementation, production
authentication and security for the invalidation API, high availability and
disaster recovery, production performance and load testing, and automatic
invalidation triggered by backend data changes.

### 3.1 Proof of Concept & Demo

Everything is in the existing `rest-demo` repository.

| Asset | What it is |
|---|---|
| [`hive-router-poc/`](../../hive-router-poc/) | The POC — three mock REST APIs, three GraphQL services, the router, Valkey and the invalidation service |
| [`hive-router-poc/subgraphs/src/cache.mjs`](../../hive-router-poc/subgraphs/src/cache.mjs) | The response cache |
| [`hive-router-poc/invalidator/server.js`](../../hive-router-poc/invalidator/server.js) | The invalidation API |
| [`hive-router-poc/demo/demo.sh`](../../hive-router-poc/demo/demo.sh) | The whole story as one runnable walkthrough |
| [`hive-router-poc/README.md`](../../hive-router-poc/README.md) | Setup, cache design, measured results |

**Demo in two commands.** Start the stack, then run the walkthrough:

```
docker compose -f hive-router-poc/docker-compose.yml up --build -d
cd hive-router-poc/demo && ./demo.sh
```

It takes about a minute and walks miss → hit → targeted purge → miss, counting
the REST calls at each step.

### 3.2 Test flow — how it was proved

The whole proof rests on one idea, and it is worth stating before the steps:

> **The evidence of a cache hit is the REST log, not the clock.**

Each of the three services prints a line every time it calls its REST backend.
On a cache hit it prints **nothing at all**. That is a far stronger signal than
a stopwatch, because the mock services answer in microseconds and timings on one
laptop are noise. Put that log on screen and the demo tells itself.

**Set up the view.** Open a second window showing the three services' logs, and
leave it visible. Everything below is read from that window.

| # | What you do | What you should see |
|---|---|---|
| 1 | Clear the cache, to start from nothing | Cache is empty |
| 2 | Ask for an account with its policies and funds | **Five** `REST GET` lines appear. Count them aloud |
| 3 | Look at what the cache now holds | Four cached pieces, one per step the router took, plus a tag index naming the account, policies and funds inside them |
| 4 | **Ask the exact same question again** | **Nothing appears in the log.** Let the silence sit for a second before explaining it — that silence is five REST calls not made |
| 5 | Ask two more questions: the same account's name, and an unrelated fund | Both cached alongside the first |

**The targeted invalidation, which is the actual test.**

| # | What you do | What you should see |
|---|---|---|
| 6 | Preview what clearing that one account *would* affect | A plan listing exactly which cached responses are involved — and nothing is changed yet |
| 7 | Clear that one account — standing in for "this customer's data changed" | Confirmation of what was removed |
| 8 | Look at the cache again | The account-derived responses are gone. **The unrelated fund response is still there** |
| 9 | Ask the original question again | REST lines appear — but **two, not five**. The policy and fund data were never invalidated, so only the account was refetched |

**Step 9 is the moment worth pausing on.** Two-not-five is the entire argument
for caching inside the services rather than in front of them, and it is the most
persuasive thing in the demo.

**The remaining checks.**

| # | What you do | What you should see |
|---|---|---|
| 10 | Clear a whole type, an exact single entry, and one service's cache | Each works independently; previews available for all |
| 11 | Wait past a service's TTL without touching anything | The entry expires on its own and the next request is a miss |
| 12 | Restart with caching switched off | Every request calls REST — the clean baseline |
| 13 | Check the tag index after all the purging | No orphaned references left behind |

---

## 4. Evaluation Summary

### 4.1 Hive Router native caching (Rust) — v0.3.16, MIT

Hive Router has **five** caches. All five are in memory, local to one router
process, and operational rather than data caches.

| # | Cache | What it holds | Tunable |
|---|---|---|---|
| 1 | **Parsing** | Parsed query documents, so the same query text is not re-parsed | size, time-to-live, idle timeout |
| 2 | **Validation** | The result of checking a query against the schema | size, idle timeout |
| 3 | **Normalization** | The tidied-up canonical form of a query | size, idle timeout |
| 4 | **Query plan** | The execution plan — which service to call, in what order | size, idle timeout |
| 5 | **Plugin supergraph runtimes** | Router runtimes for plugin-selected schema variants | a count only (default 10); no TTL applies |

**[Verified]** 1–4 are configured in the POC's router configuration.
**[Documented]** the fifth is from the vendor's cache reference; it is a single
number, evicted oldest-first, and is the item listed as "runtime cache" in this
spike's scope. It is **not** a data cache — it holds router instances, not
responses.

The honest summary of all five: they make a repeated query **cheaper to think
about**. The router still calls every backend service, every time.

```
   WHAT THE ROUTER'S FIVE CACHES ACTUALLY SAVE

   a repeated query arrives
            │
            ▼
   ┌───────────────────────────────────────────────┐
   │  parse it        ← cached, skipped            │
   │  validate it     ← cached, skipped            │   saved: CPU work,
   │  normalise it    ← cached, skipped            │   measured in microseconds
   │  plan it         ← cached, skipped            │
   └───────────────────────┬───────────────────────┘
                           │
                           ▼
   ┌───────────────────────────────────────────────┐
   │  call Accounts  ─────────────────────────────►│
   │  call Policies  ─────────────────────────────►│   NOT saved: every single
   │  call Funds     ─────────────────────────────►│   backend call, every time
   └───────────────────────────────────────────────┘

   The expensive part is below the line. None of the five caches reaches it.
```

### 4.2 GraphQL response caching in Hive Router — Not supported

**[Verified]** against the running router and **[Documented]** against the
vendor's own configuration reference: **Hive Router has no response cache.** The
reference's entire description of the `cache` key is *"Tune in-memory caches"*,
and the caching page scopes those caches to parsing, validation, normalization,
query plans and the plugin runtime pool. Nothing caches response data; nothing
skips a backend call.

The documentation does not say response caching is planned, nor that it is
rejected. It is simply silent — so this should be treated as **absent today,
with no commitment either way**.

**The distinction, in plain terms** — this is acceptance criterion 2:

| | Router internal / operational caching | GraphQL response / data caching |
|---|---|---|
| What is stored | Parsed queries, plans, validation results | The actual answer sent back to a client |
| What it saves | Repeated computation inside the router | **Calls to the backend services** |
| Measured in | Microseconds of CPU | Requests not made |
| Scope | One router process, in memory | Shared across every instance, via Valkey |
| Can it serve stale data? | No — it never holds data | **Yes** — hence TTL and invalidation |
| Who provides it | **Hive Router, built in** | **Nobody** — we built it |

The last row is the finding. Note also that **Hive Gateway**, the separate
Node.js runtime, *does* ship a response cache — so "Hive supports response
caching" is true of the product family and false of Hive Router specifically.
That ambiguity is worth being precise about in any summary of this spike.

### 4.3 Response caching PoC — Valkey at the subgraph level, MIT

The cache was built into **each of the three subgraph services**, backed by a
shared **Valkey** store. Components, all MIT:

| Component | Version | Role |
|---|---|---|
| `@graphql-yoga/plugin-response-cache` | 3.26.1 | Caching behaviour |
| `@envelop/response-cache-redis` | 4.5.1 | Redis-backed storage with tags |
| `graphql-yoga` | 5.24.1 | The subgraph servers |
| Valkey | 8 | The shared cache store (a drop-in Redis fork) |

**Why inside the services and not in front of them.** This was a design decision
with a measurable payoff, and it is the part of this spike most worth carrying
forward:

```
   OPTION A — cache in front (the obvious choice)

   client ──► [ CACHE ]──► router ──► Accounts · Policies · Funds
                 │
                 └─ holds whole answers. One account changes
                    → the whole answer is thrown away
                    → the next request costs all 5 REST calls


   OPTION B — cache inside each service  ◄── what the POC does

   client ──► router ──► [cache] Accounts
                     ──► [cache] Policies
                     ──► [cache] Funds
                              │
                              └─ holds each piece separately, and the router's
                                 own cross-service lookups go through it too.
                                 One account changes
                                 → only the account piece is thrown away
                                 → the next request costs 2 REST calls, not 5
```

**[Verified] results**, measured on the deep `InsurancePortfolio` query and
recorded in the POC's README:

| Observation | Result |
|---|---|
| REST calls on a miss | 5 |
| **REST calls on a hit** | **0** |
| Cached pieces per deep query | 4, one per step the router takes |
| Response time, cold miss | 6.1 – 8.5 ms |
| Response time, warm hit | 2.6 – 2.9 ms |

Quote the REST-call numbers, not the timings. The timings look unimpressive only
because the mock services answer in microseconds over loopback; against real
backends the gap is the backend's entire latency.

**TTL — acceptance criterion 5.** Each service owns the freshness of its own
data, which is where that decision belongs:

| Service | Default | Why |
|---|---|---|
| Accounts | 30 seconds | Balances move |
| Policies | 2 minutes | Changes on renewal |
| Funds | 5 minutes | Reference data, changes daily at most |

Each is overridable by configuration without a code change, expiry was verified,
and a per-type override hook exists for when one type inside a service needs
different freshness from the rest. **Caching can also be switched off entirely**
with one setting, which is how the baseline measurements were taken.

**Cache keys are deliberately human-readable**, so that debugging a miss does not
require a decoder:

```
sg:accounts:AccountById:id=acct-1001:3f21ab09
```

This took real work — the router does not name the internal lookups it makes, so
without extra handling every key would have read `anonymous`.

### 4.4 Targeted invalidation — Demonstrated

A small standalone service exposes the invalidation API. **It talks only to
Valkey** and imports nothing from Hive or from the subgraphs — deliberate, so
that whatever system knows the data changed can drive it.

All four required levels, **[Verified]**:

| Level | Clears | Typical trigger |
|---|---|---|
| **Entity** | Everything containing one specific record | "This customer's details changed" |
| **Type** | Everything containing any record of a type | "All fund prices were repriced" |
| **Exact entry** | One single cached response | Surgical fix |
| **Subgraph** | Everything one service cached | That service was redeployed |

Two properties worth highlighting to anyone reviewing this for production use:

**Every destructive operation has a preview.** Each purge has a read-only twin
that returns exactly what *would* be removed, changing nothing. Being able to
show the blast radius before pulling the trigger is the difference between a
usable operational tool and one nobody is allowed to run.

**Invalidation is precise, not a scan.** Cached responses are filed under tags —
one per record and one per type they contain — so clearing one account looks up
that account's tag directly. The cost depends on how many responses contain that
account, not on how big the cache is. Key lookups use a cursor-based scan,
never the blocking command that would stall the store in a request path.

```
   WHAT ONE TARGETED PURGE TOUCHES

   cached responses                 tags (who is inside what)

   ┌──────────────────────┐
   │ account overview     │◄──┐
   └──────────────────────┘   │     Account:acct-1001  ──►  3 responses
   ┌──────────────────────┐   ├──
   │ account name         │◄──┘     Fund:global-equity ──►  2 responses
   └──────────────────────┘
   ┌──────────────────────┐
   │ fund detail          │◄─────── (unrelated to the account)
   └──────────────────────┘

   clear Account:acct-1001
            │
            ├──► the 3 responses containing it are removed
            ├──► every tag that pointed at them is tidied up
            └──► fund detail is UNTOUCHED  ✓

   Verified: 7 keys removed, 9 tag indexes updated, 3 responses gone,
   the unrelated response survived, and no orphaned references left behind.
```

**Acceptance criterion 7 — [Verified].** The unrelated fund response survived
the purge, and a follow-up check confirmed no orphaned references were left
pointing at responses that no longer exist. That tidy-up step is easy to omit
and would have leaked silently; it is tested.

### 4.5 Enterprise capability assessment

**Licensing.** Every component is **MIT**, except the cache store: Valkey is
**BSD-3-Clause** **[Documented]**, a Linux Foundation project forked from Redis
after Redis changed its licence. No licence cost, and no licence risk of the
kind that prompted that fork.

**What is Hive's and what is ours.** This matters for maintenance planning:

| Capability | Provided by |
|---|---|
| Query planning, execution, cross-service lookups | **Hive Router** |
| Parse / validate / plan caching | **Hive Router** |
| Response caching mechanics and tag storage | **Open-source plugins** (MIT) |
| Cache key design, TTL policy, invalidation API | **Ours** |
| Response caching in the router | **Nobody — does not exist** |

The third and fourth rows are the maintenance commitment: roughly two files,
both documented, but ours to own.

**Operational footprint.** One extra container for the cache store and one small
service for invalidation. The cache store is already a familiar operational
component. Nothing here needs new infrastructure skills.

**Failure behaviour.** Deliberately designed, and **[Verified]**: if the cache
store is unavailable, cache errors are logged and **not raised**. The system
degrades to "every request is a miss" — slower, never broken. That property
should be preserved in any production version.

---

## 5. Comparison Matrix

| Capability | Hive Router alone | Router + cache in front | **Router + cache in the services (POC)** | Hive Gateway's own cache |
|---|---|---|---|---|
| Avoids repeated backend calls | ❌ | ✅ | ✅ | ✅ |
| Cost of a repeated deep query | 5 REST calls | 0 | **0** | 0 |
| Cost after one record changes | 5 | 5 — whole answer discarded | **2** | 5 |
| Clear one record only | n/a | ❌ | ✅ | ✅ |
| Clear one type / one service | n/a | ❌ | ✅ | partial |
| Preview before clearing | n/a | ❌ | ✅ | ❌ |
| Per-service freshness policy | n/a | ❌ one policy for all | ✅ | ✅ |
| Shared across instances | n/a | depends | ✅ Valkey | ✅ Redis |
| Who maintains it | Hive | us | **plugins + us** | Hive |
| Runtime required | Router | any | Router | **Gateway only** |

The last row is the strategic point: the POC's approach works with **either**
runtime, because the cache sits in the services. Choosing Hive Gateway's built-in
cache instead would tie the caching strategy to that runtime.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The response cache is ours to maintain — Hive Router does not provide one and has made no commitment to | **Medium** | Two documented files; review on each Hive Router upgrade. Revisit if a native cache ships |
| **Nothing invalidates automatically when backend data changes** — out of scope here, but required in production | **High** | Today the cache goes stale until TTL expires. Production needs the REST tier, or an event from it, to call the invalidation API. **This is the single largest gap** |
| The invalidation API has no authentication — anyone who can reach it can clear the cache | **High** for production | Out of scope here by agreement. Must be secured before any shared environment |
| The cache is shared across all users, with no per-user separation | **High** if ever used for personalised data | Correct today, because these payloads are not user-specific. If personalised data is introduced this must change first — do not assume it still holds |
| Two internal settings must not be changed casually, or type-level purges silently clear nothing | **Medium** | Documented in both files with the reasoning. The failure is silent, so it is a review item |
| Single cache store instance, no high availability | **Medium** | Out of scope. System degrades to "always miss" rather than failing — verify that still holds with a clustered store |
| Timings measured against mock services over loopback | **Low** | Quote REST-call counts, not milliseconds. Re-measure against real backends before setting expectations |
| TTL values are starting guesses, not derived from data | **Low** | Revisit against real change rates and traffic |
| Porting this design to Hive Gateway's cache would hit an undocumented constraint | **Low** | Gateway's cache handles keys differently; a colon in a key breaks its invalidation silently. Noted so it is not rediscovered |

---

## 7. Recommendation

**Keep response caching in the subgraph services, backed by Valkey, with the
targeted invalidation API. The approach is proven; the gaps are known and
mostly out of scope by agreement.**

Three points behind that:

1. **Hive Router will not do this for us.** Its five caches are operational and
   remove no backend calls. Any response caching is something we add, so the
   only real question is where to add it.
2. **Inside the services is measurably the better place.** The alternative —
   caching whole answers in front — discards everything when any part changes.
   The POC's placement means one record changing costs 2 REST calls instead of
   5, and that advantage grows as queries get deeper.
3. **It keeps the runtime choice open.** Because the cache lives in the
   services, it works with Hive Router or Hive Gateway. Adopting Gateway's
   built-in cache instead would tie caching to that runtime and give up the
   per-record precision.

**Before production, two things must be built** (both out of scope here and both
named in §6): **automatic invalidation** driven by backend data changes, and
**authentication** on the invalidation API. Until the first exists, the cache is
only as fresh as its TTL — which is acceptable for reference data and is not
acceptable for balances.

**Confidence:** **High** on what Hive Router does and does not cache, on the
measured cache behaviour, and on targeted invalidation — all executed. **Medium**
on production sizing and TTL values, which were measured against mock services
rather than real backends.

---

## 8. Next Steps

1. **Design automatic invalidation.** Decide how the REST tier signals a change —
   an event, a webhook, or a change-data-capture feed — and have it call the
   invalidation API. This is the gap between a demo and a production cache.
2. **Secure the invalidation API** with authentication and an audit trail of who
   cleared what.
3. **Re-measure against real backends** to get honest cache-hit value, and set
   TTLs from observed change rates rather than estimates.
4. **Decide the personalised-data position.** If any cached data will ever be
   user-specific, the per-user separation work must happen before, not after.
5. **Run a clustered cache store** and confirm the degrade-to-miss behaviour
   still holds when it fails over.
6. **Add cache metrics** — hit rate, miss rate, evictions, invalidations — so the
   cache's value is visible rather than assumed.
7. **Re-check on each Hive Router upgrade** whether a native response cache has
   appeared; if one does, re-evaluate against the per-record precision this
   approach gives.

---

## 9. Spike Closure

| Acceptance criterion | Outcome |
|---|---|
| 1. Hive-supported caching mechanisms identified and documented | ✅ Done — §4.1, five mechanisms |
| 2. Difference between Router internal caching and response caching documented | ✅ Done — §4.2 |
| 3. Response caching POC implemented using Valkey | ✅ Done — §4.3 |
| 4. Repeated requests demonstrate cache reuse by reducing REST calls | ✅ Done — **5 → 0** |
| 5. TTL expiry and cache-disabled scenarios validated | ✅ Done — per-service TTL, off switch |
| 6. Targeted invalidation demonstrated for the required scenarios | ✅ Done — entity, type, exact entry, subgraph |
| 7. Unrelated cached responses remain available after targeted invalidation | ✅ Done — verified, no orphaned references |
| 8. Findings, limitations and recommended approach documented | ✅ Done — §6, §7 |
| **Decision** | **Adopt subgraph-level response caching on Valkey with targeted invalidation. Automatic invalidation and API security to follow as separate stories.** |

**Delivered beyond the stated criteria:**

- A preview mode on every destructive operation, so blast radius can be shown
  before anything is cleared.
- Human-readable cache keys, which made debugging possible without tooling.
- A verified degrade-to-miss failure mode: a dead cache slows the system, it
  does not break it.
- A runnable one-command demo of the whole story.

**Outstanding, with reasons:** automatic invalidation from backend changes,
authentication on the invalidation API, high availability, and production load
testing — all out of scope by agreement, all carried into §8.

The spike can be closed.
