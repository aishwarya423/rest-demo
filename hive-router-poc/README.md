# Hive Router POC — 3 REST APIs via federation subgraphs, cached in Valkey

Second POC, alongside [`../hive-poc`](../hive-poc/README.md). Same requirement,
different engine: **Hive Router** (Rust) instead of Hive Gateway (Node).

Verified against: `hive-router` **0.3.1**, `@apollo/subgraph` **2.15.1**,
`graphql-yoga` **5.24.1**, `@graphql-yoga/plugin-response-cache` **3.26.1**,
`@envelop/response-cache-redis` **4.5.1**,
`@theguild/federation-composition` **0.27.0**, Hive Gateway **2.15.1**,
Valkey **8**. Everything below was executed, not assumed.

---

## The headline

**Hive Router cannot cache, so the cache does not live in the router.** It lives
in the subgraphs, and that turns out to be better than where Hive Gateway puts
it. More on that in [the comparison](#hive-router-vs-hive-gateway).

## Constraint check

All three stated constraints hold, with one correction.

| # | Constraint | Status |
|---|---|---|
| 1 | Router consumes federated GraphQL subgraphs over HTTP only; a Mesh supergraph with `@httpOperation`/`@resolveTo` will not run on it | ✅ **Confirmed.** Docs state plainly that for non-GraphQL APIs you use Mesh or Gateway instead. |
| 2 | Router has no caching; config has no cache key | ⚠️ **Changed, but the conclusion holds.** A top-level `cache` key now exists. It is **in-memory only, no external store**, and caches parsing, validation, normalization and query plans. It never stores response data and never removes an upstream call. Response caching is still open RFC [#312](https://github.com/graphql-hive/router/issues/312). |
| 3 | Extension points are Rust plugins (only `on_http_request` and `on_graphql_params` can short-circuit) plus a coprocessor | ✅ **Confirmed.** Neither was needed here. |

On constraint 2, note the shape of the trap: Router's `cache` key looks like the
answer and is not. It is the same category as Grafbase's `operation_caching`,
which [this repo already proved](../Docs/HIVE-EVALUATION.md#2-what-hive-gateway-caches-precisely)
does not reduce REST load. Caching plans is not caching data.

## Architecture

```
                        GraphQL client
                              |
                              v
                   Hive Router :4000   (Rust, no cache)
                              |
          +-------------------+-------------------+
          v                   v                   v
   accounts-subgraph   policies-subgraph    funds-subgraph
      :4001                :4002               :4003
     (Yoga)               (Yoga)              (Yoga)
          |                   |                   |
          |  response cache   |  response cache   |     +--------------+
          +---------+---------+---------+---------+---->|   Valkey     |
          |                   |                   |     |   :6379      |
          v                   v                   v     +------^-------+
   accounts-rest       policies-rest        funds-rest          | purge
      :3001                :3003               :3002           |
                                                        +--------------+
                                                        | invalidator  |
                                                        |   :8090      |
                                                        +--------------+

   build step: supergraph-compose -> supergraph.graphql (shared volume)
```

Three containers more than the Gateway POC: the router needs real subgraphs in
front of the REST APIs, because it cannot call REST itself.

## Folder structure

```
hive-router-poc/
├── docker-compose.yml           the whole stack
├── subgraphs/                   ONE image, three containers (SUBGRAPH env)
│   ├── src/
│   │   ├── server.mjs           Yoga bootstrap, picks a schema
│   │   ├── cache.mjs            the response cache  <-- the important file
│   │   ├── rest.mjs             REST client, logs every upstream call
│   │   ├── accounts.mjs         Account entity + Fund references
│   │   ├── policies.mjs         Policy entity + extends Account
│   │   └── funds.mjs            Fund entity + reference resolver
│   ├── Dockerfile
│   └── package.json
├── compose/
│   ├── compose.mjs              subgraph SDLs -> supergraph.graphql
│   ├── Dockerfile               one-shot build job
│   └── package.json
├── router/
│   └── router.config.yaml       Hive Router config (note what is absent)
├── invalidator/
│   ├── server.js                purge API, talks only to Redis
│   ├── Dockerfile
│   └── package.json
├── demo/
│   ├── demo.sh                  MISS -> HIT -> purge -> MISS, with REST counts
│   └── queries.graphql          both target queries
└── supergraph.graphql           generated (gitignored)
```

---

## Quick start

```bash
docker compose -f hive-router-poc/docker-compose.yml up --build -d
```

| Service | URL |
|---|---|
| GraphQL (Hive Router) | http://localhost:4000/graphql |
| Invalidator | http://localhost:8090/health |
| accounts / policies / funds subgraph | `:4001` / `:4002` / `:4003` |
| Valkey | `localhost:6379` |
| REST services | `:3001` / `:3003` / `:3002` |

`supergraph-compose` runs once and exits 0. That is success, not a failure.

> **Do not run this at the same time as `hive-poc`.** Both use 4000, 6379 and
> 8090. Stop the other first:
> `docker compose -f hive-poc/docker-compose.yml down`

Then:

```bash
cd hive-router-poc/demo && ./demo.sh
```

## Both target queries

```graphql
query AccountOverview($id: String!) {
  account(id: $id) {
    holderName
    policies { policyNumber }
    fundHoldings { fund { name } }
  }
}
```

```graphql
query InsurancePortfolio {
  account(id: "acct-1001") {
    id holderName accountType totalValue
    policies {
      policyNumber productName status
      linkedFunds { name assetClass oneYearReturnPercent }
    }
    fundHoldings {
      allocationPercent currentValue
      fund { name riskRating sustainabilityLabel }
    }
  }
}
```

Both return full data. Verified.

### Identifier arguments are `String!`, not `ID!`

`ID!` is the more idiomatic GraphQL choice and was the original here. It is
deliberately `String!` so **one query document works against both POCs**.

The Gateway POC cannot change: Mesh derives its argument types from the OpenAPI
path parameters, which are plain strings. GraphQL treats `ID` and `String` as
distinct types for variable usage, so a query written against that POC was
rejected here with:

```text
Variable "$id" of type "String!" used in position expecting type "ID!".
```

Validating the saved queries against both schemas now gives:

| Operation | Gateway POC | Router POC |
|---|---|---|
| `AccountOverview` | ✅ | ✅ |
| `AccountName` | ✅ | ✅ |
| `FundDetail` | ✅ | ✅ |
| `PolicyWithAccount` | ✅ | ✅ |
| `PoliciesByAccount` | ✅ | ✅ |
| `ListAccounts` | ✅ | ✅ |
| `ListFunds` | ✅ | ✅ |
| `InsurancePortfolio` | ❌ no `linkedFunds` on `Policy` | ✅ |

Seven of eight are portable. The last one fails on the Gateway POC for a real
architectural reason, not a type mismatch: `linkedFunds` does not exist there.

To switch back to `ID!`, change it in all three subgraph modules at once and
update `demo/queries.graphql`, `demo/demo.sh` and the bruno collection to match.

**`policies { linkedFunds }` was impossible in the Hive Gateway POC.** Mesh had
no batch-by-ids route to fan out to, so the field was left out. With real
federation subgraphs it is one line: the policies subgraph returns Fund
references and the router resolves them against the funds subgraph, batched.

```js
linkedFunds: (policy) => (policy.fundIds ?? []).map((id) => ({ __typename: 'Fund', id })),
```

That is the clearest single win for this architecture.

---

## How federation is wired

No REST calls cross a subgraph boundary. Subgraphs hand each other *references*
and the router resolves them.

| Field | Owner | Mechanism |
|---|---|---|
| `Query.account` | accounts | `GET /accounts/{id}` |
| `Account.policies` | **policies** | policies declares `type Account @key(fields:"id")` and attaches one field |
| `FundHolding.fund` | accounts → funds | accounts returns `{__typename:"Fund", id}`; funds resolves it |
| `Policy.linkedFunds` | policies → funds | same, one reference per `fundIds` entry |
| `Policy.account` | policies → accounts | reference back to the Account entity |

`type Fund @key(fields: "id", resolvable: false)` in the accounts and policies
subgraphs means "I can mention Fund but cannot answer lookups for it, ask the
subgraph that owns it".

Composition is `@theguild/federation-composition`, the same library the Hive
registry uses. It imports the subgraph modules directly, so the composed SDL and
the running schema cannot drift apart. Output: 174-line supergraph, 121-line
public schema, 7 entity keys.

---

## Cache design

### Where it lives and why

In the subgraphs. The router has nowhere to put it. That placement gives three
things a gateway-level response cache cannot:

1. **The router's own entity fetches are cached.** `_entities` calls go through
   the same cache as root fields.
2. **Partial cache reuse.** A federated query can be served half from cache and
   half from REST. Measured: after purging one account, the next deep query made
   **2 REST calls instead of 5**, because the funds entity response was still
   cached.
3. **Per-subgraph TTL and per-subgraph purge**, owned by the team that owns the
   data.

### Redis layout

Written by `@envelop/response-cache-redis`:

| Key | Type | Holds |
|---|---|---|
| `sg:<subgraph>:<op>:<vars>:<hash>` | STRING | the cached JSON response |
| `ops:<responseId>` | SET | every tag this response carries |
| `<Typename>` | SET | responseIds containing that type |
| `<Typename>:<id>` | SET | responseIds containing that entity |

**Tags are real Redis SETs**, written with `SADD` and read with `SMEMBERS`.
Purging one entity costs O(size of that tag), not a keyspace scan. Colons in
keys are completely safe, because nothing parses keys positionally.

That is the opposite of Hive Gateway's Mesh cache on both counts: flat
key-per-pair plus `SCAN`, and a colon in the key silently breaks invalidation.
This POC is strictly better on cache mechanics.

### Cache key format

```text
sg:<subgraph>:<operation>:<variables>:<documentHash8>
```

Real keys from a verified run of `InsurancePortfolio`:

```text
sg:accounts:InsurancePortfolio__2:novars:0b3153f4
sg:policies:InsurancePortfolio__3:Account~acct-1001:a3ba474e
sg:funds:InsurancePortfolio__4:Fund~fund-global-equity,Fund~fund-green-bond:230f587a
sg:funds:InsurancePortfolio__5:Fund~fund-cash-plus,Fund~fund-global-equity,Fund~fund-green-bond:54f96347
```

You can read the whole query plan out of the keyspace: which subgraph, which
operation, which plan step (`__2`, `__3`, ...), and which entities were being
resolved. Four cached pieces for one client query.

Two details that made this readable, both discovered by running it:

**`forward_operation_name: true`** in the router's `traffic_shaping`. Without it
the router sends anonymous operations to subgraphs and every root-fetch key
reads `anonymous`. Costs nothing, so it is on.

**Entity-fetch variables are rendered, not hashed.** The router's `_entities`
calls carry a `representations` array. `fingerprintVariables` turns that into
`Fund~fund-global-equity,Fund~fund-green-bond`, capped at four refs before
falling back to a hash so a large batch cannot blow up the key.

### TTL

| Subgraph | TTL | Why |
|---|---|---|
| funds | 300s | reference data, changes daily at most |
| policies | 120s | changes on renewal |
| accounts | 30s | balances move |

Set per container via `CACHE_TTL_MS` in `docker-compose.yml`. Override with
`ACCOUNTS_TTL_MS`, `POLICIES_TTL_MS`, `FUNDS_TTL_MS`.

### One deliberate non-customization

`buildRedisEntityId` is left at its default `Typename:id`. Type-level
invalidation runs `KEYS <Typename>:*` internally, so prefixing entity ids here
would make purging a whole type silently match nothing. The comment in
[`subgraphs/src/cache.mjs`](subgraphs/src/cache.mjs) says so, because it is the
kind of thing someone will otherwise "tidy up" later and break.

---

## Invalidation

[`invalidator/server.js`](invalidator/server.js) imports nothing from Hive and
nothing from the subgraphs. It only speaks Redis, which is the requirement:
purging must be drivable from outside the router.

### Purge algorithm

For `Account:acct-1001`:

```text
1. SMEMBERS Account:acct-1001          -> affected responseIds
2. for each responseId:
     SMEMBERS ops:<responseId>         -> every tag it is filed under
     SREM <each tag> <responseId>      -> unfile it, leaving nothing dangling
     DEL ops:<responseId>
     DEL <responseId>
3. DEL Account:acct-1001
```

Step 2's inner `SMEMBERS` is what keeps the other tags clean. Without it the
Policy and Fund tags would keep pointing at deleted responses. Verified: after a
purge, a sweep of every tag SET found **no dangling members**.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness |
| `GET` | `/cache/keys?pattern=sg:*` | every cached response |
| `GET` | `/cache/tags?pattern=*` | the tag index, with members |
| `GET` | `/cache/entity/:type/:id` | **dry run** |
| `DELETE` | `/cache/entity/:type/:id` | purge one entity |
| `GET` | `/cache/type/:type` | dry run, whole type |
| `DELETE` | `/cache/type/:type` | purge every entity of a type |
| `DELETE` | `/cache/key?key=<responseId>` | purge one exact entry |
| `DELETE` | `/cache/subgraph/:name` | purge one subgraph, e.g. after redeploy |
| `POST` | `/cache/flush` | clear everything (demo only) |

All ten verified against the live stack.

---

## Verified results

Measured on the `InsurancePortfolio` query, Docker Compose on one machine.

| | Hive Router `:4000` | Gateway + `--hive-router-runtime` `:4010` |
|---|---|---|
| Cold miss | 6.1 – 8.5 ms | 8.7 – 12.8 ms |
| Warm hit | **2.6 – 2.9 ms** | 3.8 – 4.5 ms |
| Image size | **32.5 MB** | 141 MB |

| Observation | Result |
|---|---|
| REST calls on a miss | 5 |
| REST calls on a hit | **0** |
| REST calls after purging one account | **2, not 5** (funds still cached) |
| Cached pieces per deep query | 4, one per query-plan step |
| Purging `Account:acct-1001` | 7 keys deleted, 9 tag SETs updated, 3 responses gone |
| Unrelated `FundDetail` response | survived |
| Dangling tag members after purge | **none** |

The hit path is ~2.5x faster than the miss path. The latency gap is modest only
because the mock REST services answer in microseconds over loopback. The number
that matters is REST calls per hit: zero.

### On `--hive-router-runtime`

It works, returns identical data, and produces **byte-identical cache keys**,
which is good evidence it really is the same planner. But it is slower on both
paths and 4x the image size.

**Verdict: not a better fit here.** Its value is for someone who wants Router's
planner while keeping Gateway's plugin ecosystem, particularly Gateway's own
response cache. If you are running real subgraphs and caching inside them, as
this POC does, the plain Rust router is the faster and smaller choice.

---

## Verify the cache by hand

```bash
alias vk='docker compose -f hive-router-poc/docker-compose.yml exec -T valkey valkey-cli'
```

```bash
vk FLUSHALL

# MISS. Watch the REST logs in another pane:
#   docker compose -f hive-router-poc/docker-compose.yml logs -f \
#     accounts-subgraph policies-subgraph funds-subgraph
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"operationName":"AccountOverview","query":"query AccountOverview($id: String!) { account(id: $id) { holderName policies { policyNumber } fundHoldings { fund { name } } } }","variables":{"id":"acct-1001"}}'

# What landed, and the tag index
vk --scan --pattern 'sg:*'
vk SMEMBERS Account:acct-1001
vk SMEMBERS ops:sg:accounts:AccountOverview__2:id=acct-1001:386b194a

# HIT. Same curl again. No new "REST GET" lines appear.

# Preview, then purge
curl -s localhost:8090/cache/entity/Account/acct-1001
curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001

# Or purge with raw Redis, proving Hive is not in the loop
vk SMEMBERS Account:acct-1001
vk DEL <responseId> ops:<responseId>
```

Live view, the most convincing thing to put on screen:

```bash
vk MONITOR
```

---

## Hive Router vs Hive Gateway

Both POCs now exist in this repo and do the same job, so this is measured, not
argued.

| | **Hive Gateway** ([`../hive-poc`](../hive-poc/README.md)) | **Hive Router** (this) |
|---|---|---|
| REST integration | Mesh reads OpenAPI at build time | 3 hand-written Yoga subgraphs |
| Services to run | **1** gateway | **4** (router + 3 subgraphs) |
| Lines of code we wrote | **483** (config + invalidator + compose) | **730** (subgraphs + cache + composer + invalidator) |
| Schema source | generated from `openapi.yaml` | hand-written SDL |
| Schema drift risk | spec changes flow in on recompose | **manual**, specs and SDL can diverge |
| Response caching | **native**, one config block | **none in router**; built in subgraphs |
| Cache tags | key-per-pair, `SCAN` | **real Redis SETs**, `SMEMBERS` |
| Colons in keys | **break invalidation silently** | safe |
| Invalidation cost | O(total keys) | **O(tag size)** |
| Partial cache reuse | ❌ whole response or nothing | ✅ **per plan step** |
| `Policy.linkedFunds` | ❌ not possible | ✅ one line |
| Warm hit latency | 2.4 ms | **2.6 ms** (comparable) |
| Router image | 141 MB | **32.5 MB** |
| Operational overhead | **low** | 4 services, 3 to keep in sync |

### Which to pick

**Gateway**, if the REST contracts are the source of truth and you want the
smallest thing to operate. One container, caching is a config block, and the
schema regenerates when a spec changes. The cost is coarse caching and a cache
key format with a silent footgun.

**Router**, if you want the better cache and the better federation. Real
entities make joins like `linkedFunds` trivial, SET-based tags make invalidation
cheap, and subgraph-level caching gives partial reuse the gateway cannot. The
cost is three services you now own, hand-written SDL that can drift from the
OpenAPI specs, and all the cache code being yours.

**For this POC's stated priority, custom cache keys plus explicit
invalidation, Router's architecture is the stronger one** despite Router itself
contributing nothing to it. The caching quality comes from putting the cache in
the subgraphs, not from the router.

---

## What is native vs what we built

| Capability | Provider |
|---|---|
| Federation query planning and execution | **Hive Router** |
| Entity resolution across subgraphs | **Hive Router** |
| Parse / validation / plan caching (in memory) | **Hive Router** |
| Operation name forwarding to subgraphs | **Hive Router** (`forward_operation_name`) |
| Timeouts, header propagation, CORS, JWT | **Hive Router** |
| Supergraph composition | **Hive** (`@theguild/federation-composition`) |
| Subgraph server + federation directives | **Yoga + @apollo/subgraph** |
| Response caching with Redis tags | **plugin** (`@envelop/response-cache-redis`) |
| REST → GraphQL mapping | **ours**, 3 schema modules + resolvers |
| Cross-service joins | **ours**, reference resolvers |
| Cache key format | **ours**, `buildResponseCacheKey` |
| TTL per subgraph | **ours**, env-driven |
| **Invalidation API** | **ours**, `invalidator/server.js` |
| **Response caching in the router** | **nobody** — does not exist |

---

## Risks and limitations

1. **Hive Router contributes zero caching.** Everything in the cache section is
   ours or a plugin's. If Router's RFC [#312](https://github.com/graphql-hive/router/issues/312)
   lands, revisit: a router-level cache would skip the subgraph hop entirely.
2. **Router's `cache` key is a trap.** It reads like a response cache and is
   not. Anyone skimming the config will assume caching is handled.
3. **Three subgraph schemas are hand-written.** The OpenAPI specs are no longer
   the source of truth, so a REST change can silently diverge. Mitigate by
   generating the SDL from OpenAPI, or add a contract test.
4. **Shared cache, no auth.** `session: () => null` means one bucket for all
   callers, correct only because this data is not user-specific. The invalidator
   has no authentication and must not be exposed.
5. **`hive-router` is 0.3.1**, pre-1.0.
6. **Type-level purge uses `KEYS`** inside the plugin, which blocks Redis. Fine
   at POC scale; prefer entity-level purges in production.
7. **`account.funds` is still absent.** `GET /accounts/{accountId}/funds` crashes
   the funds mock service at
   [`../mock-rest-apis/funds/server.js:135`](../mock-rest-apis/funds/server.js#L135).
   Unrelated to Hive, still unfixed.
8. **Four services instead of one.** The main operational cost of this choice.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `unknown field 'timeout' ... for key 'traffic_shaping.all'` | It is `request_timeout`, not `timeout`. |
| `data did not match any variant of untagged enum IntrospectionPermissionConfig` | `introspection` takes a bool: `introspection: true`, not a nested `enabled:`. |
| `doc.definitions is not iterable` from `buildSubgraphSchema` | Pass an **array**: `buildSubgraphSchema([{ typeDefs, resolvers }])`. A bare object is mis-normalized into `[{ typeDefs: <the object> }]`. |
| `Cannot find package 'graphql-tag' imported from /app/subgraphs/src/...` | The composer image must `npm install` at `/app`, not `/app/compose`, so Node finds `node_modules` when resolving imports from `/app/subgraphs/src`. |
| `Variable "$id" of type "String!" used in position expecting type "ID!"` | Stale copy of this POC using `ID!`. Both POCs now use `String!`; recompose with `npm run supergraph:build` and restart the subgraphs. |
| Cache keys all say `anonymous` | Set `traffic_shaping.all.forward_operation_name: true`. |
| Schema change not picked up | The router reads the supergraph from a Docker **volume**, not your working tree. Rebuild `supergraph-compose`, then recreate the subgraphs and router. The host-side `supergraph.graphql` is only for local inspection and can go stale independently. |
| Port already in use on 4000 / 6379 / 8090 | The `hive-poc` stack is running. `docker compose -f hive-poc/docker-compose.yml down` |
| `supergraph-compose` keeps restarting | It is a one-shot job. `Exited (0)` is success. |
| Nothing caches | Check `CACHE_ENABLED` is not `0`, and that the subgraphs can reach `REDIS_URL`. |
