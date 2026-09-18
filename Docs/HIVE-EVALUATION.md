# Hive for REST → unified GraphQL + Redis caching — evaluation

> Scope: can Hive replace the Grafbase setup in this repo for 3 REST APIs behind
> one GraphQL API, with **custom Redis cache keys and explicit invalidation**?
>
> Verified against: `hive-router` **0.2.15** (2026-09-16), `@graphql-hive/gateway`
> **2.14.2**, `@graphql-mesh/compose-cli` **1.8.2**, `@omnigraph/openapi`
> **0.112.4**, `@graphql-mesh/cache-redis` **0.108.1**,
> `@graphql-mesh/plugin-http-cache` **0.108.1**.
>
> Everything marked ✅ VERIFIED was read out of the shipped package source or
> reproduced locally in [`../hive-poc`](../hive-poc), not inferred from docs.

---

## 0. The one thing to know first

**"Hive" is two different products, and only one of them can do this job.**

| | Hive **Router** | Hive **Gateway** |
|---|---|---|
| Language | Rust | Node.js |
| Package | `hive-router` 0.2.15 | `@graphql-hive/gateway` 2.14.2 |
| Consumes REST? | ❌ federated GraphQL subgraphs only | ⚠️ indirectly, via a Mesh-composed supergraph |
| Response caching | ❌ **none at all** | ✅ built in |
| Redis/Valkey | ❌ not a config option | ✅ first-class |
| Custom cache keys | ❌ n/a | ✅ `buildResponseCacheKey` |
| Entity invalidation | ❌ n/a | ✅ built in |

Hive Router's full top-level config key list is `authorization`, `cors`, `csrf`,
`headers`, `http`, `jwt`, `log`, `override_subgraph_urls`, `persisted_documents`,
`storages`, `override_labels`, `query_planner`, `response_extensions`,
`supergraph`, `traffic_shaping`, `telemetry`, `introspection`, `limits`,
`subscriptions`. There is **no cache key**. ✅ VERIFIED

Response caching for the Router is an *open RFC*
([graphql-hive/router#312](https://github.com/graphql-hive/router/issues/312)),
still at the design stage. Its `storages` block looks like a cache but is not —
it is **S3-only** and loads the supergraph and persisted documents at startup,
explicitly "not re-evaluated per-request".

**Conclusion: build this POC on Hive Gateway. Hive Router cannot satisfy
requirement 2, 3 or 4 today at any price short of writing a Rust plugin.**

---

## 1. REST → GraphQL: how the three APIs get in

Neither Hive product speaks REST at runtime. The REST→GraphQL step is a
**build-time** concern handled by **Mesh Compose**:

```
accounts/openapi.yaml ─┐
policies/openapi.yaml ─┼─► mesh-compose ─► supergraph.graphql ─► Hive Gateway
funds/openapi.yaml    ─┘   (build time)      (one artifact)       (runtime)
```

`loadOpenAPISubgraph` reads each existing `openapi.yaml` and emits a subgraph
whose fields carry `@httpOperation` directives describing the REST call. The
gateway executes those directly — there is **no separate subgraph process to
run**. Three REST APIs, one gateway container, zero new services.

### Federation is not something you configure — Mesh infers it

Composing this repo's three specs produced, with no manual annotation:

```graphql
type Account @join__type(graph: ACCOUNTS, key: "id") { ... }
type Fund    @join__type(graph: FUNDS,    key: "id") { ... }
type Policy  @join__type(graph: POLICIES, key: "id") { ... }

account(id: String!): Account @merge(subgraph: "Accounts", keyField: "id", keyArg: "id")
```

✅ VERIFIED — Mesh recognised `GET /accounts/{id}` as an entity resolver and
marked the type as a federation entity with `key: "id"` automatically.

**So: yes, federation works, and no, you do not have to hand-write it.** You get
real entities, which matters far beyond composition — entity identity is exactly
what the cache tags and invalidation are keyed on (section 3).

### Cross-service relationships

The joins the client actually wants are declared once, in `additionalTypeDefs`:

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

`requiredSelectionSet` tells the gateway which parent fields to fetch first;
`sourceArgs` maps them onto the target call. The client sees one graph and the
gateway does the fan-out. ✅ VERIFIED — the target query from the brief composes
and resolves.

**Schema stitching vs federation:** this is federation. Mesh emits a real
Federation supergraph (`@join__type`, `@join__field`, `join__Graph`). Stitching
is the older Mesh v0 model and is not what v1 produces. The practical benefit is
portability: the same `supergraph.graphql` would load into Apollo Router or Hive
Router unchanged — only the caching would be lost.

---

## 2. What Hive Gateway caches, precisely

This is where the Grafbase experience in this repo transfers directly. The
lesson from [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md) — that
a cache which stores *subgraph fetches* is useless when there are no subgraph
fetches — **does not repeat here**, because Hive's cache stores something else.

| Layer | What it stores | Cuts REST calls? | Redis? | Keys predictable? |
|---|---|---|---|---|
| `responseCaching` | the **final GraphQL response** | ✅ **yes, completely** | ✅ | ✅ **you choose them** |
| `plugin-http-cache` | raw **upstream REST responses** | ✅ yes | ✅ | ✅ (fixed format) |
| Parse/validate cache | parsed documents | ❌ | in-memory | n/a |

The important contrast with the Grafbase POC:

- Grafbase `operation_caching` cached **query plans**. Useful, but it never
  removed a single REST call, and its keys were opaque (`op.blake3.<hash>`).
- Grafbase `entity_caching` was a structural no-op in the single-virtual-subgraph
  topology.
- Hive `responseCaching` caches the **answer**. A cache hit returns before query
  planning and before any HTTP call to the REST tier. That is the behaviour the
  brief asks for.

---

## 3. Cache keys and invalidation — the critical requirement

### 3.1 The Redis layout, exactly

Hive Gateway's response cache writes **three key shapes**, and
`@graphql-mesh/cache-redis` passes them to Redis **verbatim with no prefix of
its own** (✅ VERIFIED in `cache-redis` source — `set()` calls
`client.set(key, …)` directly):

```
response-cache:<responseId>                    STRING   the cached JSON body
response-cache:<Type>.<id>:<responseId>        STRING   entity   → response   (the tag)
response-cache:<responseId>:<Type>.<id>        STRING   response → entity     (reverse tag)
```

Concretely, after one query for `acct-1001`:

```
response-cache:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Policy.pol-life-3001:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Fund.fund-global-equity:gql.AccountOverview.id-acct-1001.737e0759
response-cache:gql.AccountOverview.id-acct-1001.737e0759:Account.acct-1001
...
```

**This is already the tag design from the brief.** `response-cache:Account.acct-1001:*`
*is* `tag:account:123 → [cache-key-1, cache-key-2]`, expressed as one Redis key
per pair instead of one Redis SET.

### 3.2 Custom cache keys — yes

`responseCaching` is typed as
`Omit<ResponseCacheConfig, keyof GatewayConfigContext>` where
`ResponseCacheConfig = Omit<UseResponseCacheParameter, 'cache'> & { cache }`.
✅ VERIFIED — that means `buildResponseCacheKey` is available directly in the
gateway config:

```ts
buildResponseCacheKey: async ({ documentString, variableValues, operationName, sessionId }) =>
  `gql.${operationName}.${fingerprint(variableValues)}.${sha256(documentString).slice(0, 8)}`
```

The default is an opaque SHA-256. Override it and the Redis key becomes anything
you want. The `<Type>.<id>` half of the tag keys is separately controllable via
`idFields`.

### 3.3 ⚠️ The one constraint nobody documents

**Your custom response key must not contain a colon.**

Hive's invalidation routine finds tagged responses by prefix and then parses the
key positionally (✅ VERIFIED in `@graphql-mesh/plugin-response-cache` source):

```js
const [, , responseId] = cacheEntryName.split(':');
```

With a key like `response-cache:Account.acct-1001:account:123`, index `[2]`
resolves to `"account"` instead of `"account:123"`, and invalidation silently
deletes nothing. This is why the POC uses `gql.account.acct-1001` and not the
`graphql:account:123` shape sketched in the brief. Same readability, dots
instead of colons. **Entity ids must also be colon-free** — `acct-1001` is fine.

### 3.4 Explicit deletion and entity invalidation — yes, and from outside Hive

Because the keys are plain, prefix-structured Redis strings, *anything* holding a
Redis connection can invalidate. The POC ships a standalone
[`invalidator`](../hive-poc/invalidator/server.js) service that imports nothing
from Hive:

```
DELETE /cache/entity/Account/acct-1001     # invalidate everything touching that account
GET    /cache/entity/Account/acct-1001     # dry run: show what would be deleted
DELETE /cache/key?key=response-cache:...   # explicit single-key delete
DELETE /cache/rest?url=...                 # drop one upstream REST response
```

The algorithm is four Redis commands:

```
SCAN  0 MATCH response-cache:Account.acct-1001:* COUNT 500
      → responseId = key.split(':')[2]
DEL   response-cache:<responseId>                      # the body
DEL   response-cache:Account.acct-1001:<responseId>    # forward tag
SCAN  0 MATCH response-cache:<responseId>:*  → DEL     # reverse tags
```

That answers the brief's core requirement literally: *identify affected entity →
DEL the keys → next request misses → REST refetch → re-cache.*

### 3.5 Where SETs would beat the built-in design

The brief asks specifically about Redis SETs for tag→keys. Worth being precise
about which Hive path you are on:

| Path | Tag storage | Invalidate cost |
|---|---|---|
| **Hive Gateway** (`@graphql-mesh/plugin-response-cache`) | one key per (entity, response) pair | `SCAN` over the keyspace — **O(total keys)** |
| GraphQL Yoga / envelop direct (`@envelop/response-cache-redis`) | real Redis SETs via `SADD` | `SMEMBERS` — **O(tag size)** |

✅ VERIFIED both, from source. The envelop Redis cache does exactly what the
brief proposes (`SADD <Type>:<id> <responseId>`), but **Hive Gateway does not use
it** — it adapts the generic `KeyValueCache` instead, which has no set
primitives.

For a POC this is irrelevant: `SCAN` against a few thousand keys is
sub-millisecond. At production scale with millions of keys it is the one thing to
fix, and it is fixable without forking Hive — wrap the cache object so that
writes to `response-cache:<tag>:<responseId>` also `SADD tag:<tag> <responseId>`,
and let `getKeysByPrefix` answer from `SMEMBERS`. See
[`hive-poc/gateway/tagged-cache.ts`](../hive-poc/gateway/tagged-cache.ts).

### 3.6 TTL

Three levels, most-specific wins, all in milliseconds:

```ts
ttl: 60_000,                       // global default
ttlPerSchemaCoordinate: {
  Fund: 300_000,                   // reference data
  Policy: 120_000,
  Account: 30_000,                 // volatile
  'Query.now': 0,                  // never cache
}
```

`@cacheControl(maxAge:)` in the subgraph SDL works too, but needs
`@composeDirective` plumbing — not worth it for a POC when the config block above
is equivalent and easier to read.

### 3.7 Caching the REST calls themselves

`@graphql-mesh/plugin-http-cache` caches raw upstream responses under a fully
predictable key (✅ VERIFIED in source):

```
http-cache-<url>-<method>-<body>
http-cache-http://accounts-rest:3001/accounts/acct-1001-GET-undefined
```

**Caveat that decides whether you use it:** it enforces RFC 9111 via
`http-cache-semantics`. A REST response with no `Cache-Control` header is
treated as immediately stale and nothing is stored. Enabling this layer means
adding a response header to the three REST services — small, but it *is* a
change to them. The POC leaves it off by default (`ENABLE_HTTP_CACHE=0`) so the
headline claim "no REST changes required" holds.

### 3.8 What the POC actually measured

Not a projection — this is the observed output of
[`hive-poc/demo/demo.sh`](../hive-poc/demo/demo.sh) against Hive Gateway 2.14.2
and Valkey 8, with all three REST services live.

| Observation | Docker Compose | Host processes |
|---|---|---|
| First `AccountOverview` call (MISS) | **105 ms**, all three REST services called | 4–7 ms |
| Repeat call (HIT) | **2.4 ms — 43× faster**, zero REST traffic | ~1 ms |
| Redis keys written by that one query | 13 — 1 body, 6 entity tags, 6 reverse tags | same |
| Entities tagged, with no annotation from us | `Account.acct-1001`, `Policy.pol-life-3001`, `Policy.pol-annuity-3002`, 3 × `Fund.*` | same |
| `DELETE /cache/entity/Account/acct-1001` | 16 keys removed, spanning **two** distinct cached operations | same |
| Unrelated `FundDetail` response | survived with its tags intact | same |
| Re-query after invalidation | MISS, refetched, repopulated | same |

The host column is compressed because the mock services answer in microseconds
over loopback. The Docker column, with a real network hop, is the honest
indication — and the number that matters either way is REST calls per cache hit:
zero.

Note the entity row. A single query tagged entities from **all three** REST
services, so a change to any one policy or fund can invalidate exactly the
responses that embedded it. That cross-service tagging is what the Grafbase
topology could not offer.

---

## 4. Architecture comparison

Mapping the brief's options onto what actually exists:

**Option A — Hive Router + native caching.** Not possible. Hive Router has no
cache of any kind. Rules itself out.

**Option B — Hive Router + a custom Redis layer.** Possible but expensive. The
Router's plugin hooks can only short-circuit at `on_http_request` and
`on_graphql_params` (✅ VERIFIED), so a cache lookup must happen before parsing
and the write-back must hang off a later hook — in **Rust**, in a custom router
build. The coprocessor interface (`stages: router.request/response`,
`graphql.request/analysis/response`) lets you do it in any language, at the cost
of an extra network hop on every request. Real, but a month of work and a bespoke
artifact to maintain.

**Option C — Mesh + Hive Gateway + Redis.** ✅ **Recommended.** Mesh composes at
build time, the gateway serves and caches at runtime. Everything the brief asks
for is configuration, not code.

**Option D — hand-written GraphQL subgraphs with Redis in the resolvers.** Total
control, but you write and operate three new services, reimplement DataLoader
batching, entity resolution and cache coherency by hand, and lose the generated
schema. Pick this only if the cache logic must be per-field and business-rule
driven.

**Option E (not in the brief) — Mesh + Hive Gateway + Redis + a standalone
invalidator.** Option C plus one ~150-line service that owns invalidation. This
is what the POC implements. It costs almost nothing and buys the thing the brief
actually cares about: invalidation that your REST services, a CDC stream, or an
ops runbook can trigger without going through the gateway.

### Scorecard

| Criteria | A: Router native | B: Router + custom | C: Mesh + Gateway | D: Custom subgraphs | **E: C + invalidator** |
|---|---|---|---|---|---|
| REST API integration | ❌ none | ⚠️ still needs Mesh | ✅ OpenAPI, zero code | ✅ manual | ✅ OpenAPI, zero code |
| Federation/composition | ✅ excellent | ✅ excellent | ✅ auto-derived | ⚠️ hand-written | ✅ auto-derived |
| Unified GraphQL API | ✅ | ✅ | ✅ | ✅ | ✅ |
| Redis/Valkey support | ❌ | ✅ your code | ✅ native | ✅ your code | ✅ native |
| Custom cache keys | ❌ | ✅ total | ✅ `buildResponseCacheKey` | ✅ total | ✅ `buildResponseCacheKey` |
| Explicit deletion | ❌ | ✅ | ✅ keys are plain | ✅ | ✅ via HTTP endpoint |
| Cache invalidation | ❌ | ✅ | ✅ entity-level, built in | ✅ | ✅ built in **+ external** |
| Cache tags | ❌ | ✅ | ✅ key-per-pair | ✅ | ✅ (+ SET upgrade path) |
| TTL | ❌ | ✅ | ✅ 3 levels | ✅ | ✅ 3 levels |
| Entity-level invalidation | ❌ | ⚠️ you rebuild it | ✅ | ⚠️ you rebuild it | ✅ |
| Implementation complexity | n/a | 🔴 high (Rust) | 🟢 low | 🔴 high | 🟢 low |
| POC effort | n/a | weeks | **hours** | weeks | **hours** |
| Production suitability | ❌ | ⚠️ bespoke | ✅ | ✅ | ✅ |
| Performance | ✅ fastest router | ✅ minus a hop | ⚠️ Node, but hits skip planning | ⚠️ depends on you | ⚠️ same as C |
| Operational overhead | low | 🔴 custom build | 🟢 2 containers | 🔴 3+ services | 🟢 3 containers |
| Debugging | n/a | 🔴 hard | 🟢 readable keys | 🟡 yours | 🟢 readable keys + dry-run API |
| Maintainability | n/a | 🔴 fork risk | 🟢 config only | 🟡 code you own | 🟢 config + 150 lines |
| Hive compatibility | native | native | native | native | native |

---

## 5. The 15 questions, answered

| # | Question | Answer |
|---|---|---|
| 1 | Can Hive Router directly consume REST APIs? | **No.** Federated GraphQL subgraphs only. |
| 2 | Recommended REST → GraphQL adapter? | **Mesh Compose + `@omnigraph/openapi`**, at build time, from your existing `openapi.yaml`. |
| 3 | Federation between REST-derived subgraphs? | **Yes**, and it is auto-derived — `GET /x/{id}` becomes `key: "id"` with no annotation. |
| 4 | Can Hive Router cache API responses? | **No.** Open RFC #312, nothing shipped. Hive **Gateway** can. |
| 5 | Redis/Valkey as backend? | **Yes**, natively, in Hive Gateway. Valkey is a drop-in. |
| 6 | Can I define my own Redis keys? | **Yes** — `buildResponseCacheKey`. Constraint: **no colons** (§3.3). |
| 7 | Can I see/predict the keys? | **Yes.** All three key shapes are documented in §3.1 and written verbatim to Redis. |
| 8 | Explicitly delete one entry? | **Yes** — a plain `DEL`, from redis-cli or any service. |
| 9 | Invalidate everything for an entity? | **Yes** — built in, and reproducible externally in 4 Redis commands. |
| 10 | Cache tags? | **Yes**, as key-per-pair rather than SETs. Functionally equivalent; see §3.5 for the scaling caveat. |
| 11 | Custom invalidation outside Hive? | **Yes** — the keys are plain strings. The POC's invalidator imports nothing from Hive. |
| 12 | Where should the Redis logic live? | **Reads** in the gateway (config). **Writes/invalidation** in a separate service, so REST-side updates can trigger it. |
| 13 | Possible without modifying the REST APIs? | **Yes** for the GraphQL response cache. The optional HTTP-layer cache needs a `Cache-Control` header added. |
| 14 | Simplest architecture meeting custom keys + explicit invalidation? | Mesh Compose → Hive Gateway (`responseCaching` + `cache: redis`) → Valkey, plus a small invalidator service. |
| 15 | Recommendation for this POC? | **Option E.** Everything required is configuration; the only custom code is the ~150-line invalidator, which is the piece you genuinely want to own. |

---

## 6. Risks and limitations

1. **Hive Router is a dead end for this use case today.** If the evaluation is
   specifically "can we adopt Hive *Router*", the honest answer is not with
   caching, and not with REST. Watch RFC #312.
2. **`hive-router` is 0.2.15 and `@omnigraph/openapi` is 0.112.4** — both
   pre-1.0. `@graphql-hive/gateway` at 2.14.2 is the mature piece.
3. **The colon constraint (§3.3) is undocumented** and fails silently. Anyone
   customising keys later will hit it. Keep the comment in `gateway.config.ts`.
4. **`SCAN`-based invalidation is O(keyspace).** Fine for a POC, needs the SET
   wrapper before production scale.
5. **Response caching is coarse.** The unit is a whole GraphQL response, so a
   query touching 40 funds is invalidated by any one of them changing. Cache
   narrow, frequently-repeated operations; leave wide ad-hoc queries uncached
   via `ttlPerSchemaCoordinate: { …: 0 }`.
6. **Auth and cache scope.** `session: () => null` is a single shared bucket,
   correct only because these REST APIs return non-user-specific data. Anything
   per-user needs a validated `session` key and `scopePerSchemaCoordinate:
   'PRIVATE'`, or the cache leaks data across users.
7. **Node, not Rust.** Hive Gateway will not match Hive Router's raw throughput.
   Cache hits short-circuit before planning, so the cached path is fast anyway.
8. **Build-time composition.** `supergraph.graphql` must be regenerated when an
   OpenAPI spec changes. Wire `mesh-compose` into CI.
9. **Unrelated to Hive, found while building this:** `GET /accounts/{accountId}/funds`
   is broken in the funds mock service.
   [`mock-rest-apis/funds/server.js:135`](../mock-rest-apis/funds/server.js#L135)
   dereferences an `accounts` array that does not exist in that process, so the
   route throws `ReferenceError` and kills the whole service. It is declared in
   `funds/openapi.yaml`, so any generated client will call it. The POC routes
   the account → funds join through `fundHoldings` and `GET /funds/{id}`
   instead. Worth fixing regardless of which gateway you pick.
10. **The gateway needs `@graphql-mesh/transport-rest`** as an explicit
    dependency. Without it every REST-backed field fails at runtime with
    `Cannot find package '@graphql-mesh/transport-rest'`, and the error does not
    appear until the first query.

---

## 7. Hive vs Grafbase, for this exact use case

You have already built the Grafbase half, so this is a comparison of measured
outcomes rather than feature lists.

| | **Grafbase** (this repo today) | **Hive Gateway** (the POC) |
|---|---|---|
| REST integration | `@rest`/`@restEndpoint` WASM extension, declarative in SDL, **runtime** | Mesh `@omnigraph/openapi` from OpenAPI, **build time** |
| Schema authoring | hand-written + `schema-gen` generator you maintain | generated from `openapi.yaml`, plus ~40 lines of `@resolveTo` |
| Topology | one virtual subgraph | three real federation subgraphs |
| Response cache | ❌ none | ✅ `responseCaching` |
| Query-plan cache | ✅ `operation_caching` → Redis | ✅ in-memory |
| Entity cache | ⚠️ exists, **no-op here** (no subgraph fetch to intercept) | n/a — response cache supersedes it |
| Cuts REST calls? | ❌ **no** — plans cached, data is not | ✅ **yes** |
| Cache key control | ❌ opaque `op.blake3.<hash>` | ✅ `buildResponseCacheKey` |
| Cache tags | ❌ | ✅ entity tags |
| Explicit invalidation | ❌ no supported path | ✅ built in + externally scriptable |
| Config friction hit here | `{{ env.* }}` not interpolated in `redis.url`; needed an entrypoint `sed` | env vars read normally in `gateway.config.ts` |
| Dev/prod parity | ⚠️ `grafbase dev` silently ignores all caching | one binary, one behaviour |
| Licence | source-available, paid platform | MIT, self-hostable |

**The deciding fact:** Grafbase's two caches are a plan cache (never reduces REST
load) and an entity cache that is structurally inert in a REST-extension topology
— both already documented in this repo. Hive Gateway caches the response itself,
which is the only layer that actually removes REST calls, and it exposes the key
format so you can delete individual entries. On the brief's stated priority —
*custom cache keys plus explicit invalidation* — Grafbase offers no path and Hive
Gateway offers a configured one.

Where Grafbase still wins: the REST extension is genuinely more elegant than
build-time composition (no regeneration step), and `@derive`/`@is` express
fan-out more compactly than `@resolveTo`. If caching were not a requirement, it
would be a close call. It is the requirement.

---

## 8. Recommendation

Build on **Hive Gateway**, not Hive Router.

```
┌──────────────┐
│ GraphQL      │
│ client       │
└──────┬───────┘
       │ one query
       ▼
┌──────────────────────────┐        ┌──────────────┐
│      Hive Gateway        │◄──────►│ Valkey/Redis │
│  responseCaching         │  keys: │              │
│  cache: { type: redis }  │  response-cache:*     │
└──────┬───────────────────┘        └──────▲───────┘
       │ on MISS only                      │ DEL
       ▼                                   │
┌──────────────┬──────────────┬────────────┴─┐
│ Accounts     │ Policies     │ Funds        │   ┌──────────────┐
│ REST :3001   │ REST :3003   │ REST :3002   │   │ invalidator  │
└──────────────┴──────────────┴──────────────┘   │ :8090        │
       ▲                                          └──────────────┘
       │ openapi.yaml ×3
       │
┌──────┴───────────────────┐
│ mesh-compose (build time)│──► supergraph.graphql
└──────────────────────────┘
```

Native: REST→GraphQL composition, federation, response caching, Redis/Valkey,
custom keys, TTL, entity tags, mutation-driven invalidation.
Custom: the invalidator service (~150 lines), and optionally the SET-based tag
wrapper if you outgrow `SCAN`.

Runnable POC, Docker Compose and demo script: [`../hive-poc`](../hive-poc/README.md).
