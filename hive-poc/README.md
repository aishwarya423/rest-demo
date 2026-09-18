# Hive POC — 3 REST APIs → one GraphQL API, cached in Valkey/Redis

Runnable proof of concept for the evaluation in
[`../Docs/HIVE-EVALUATION.md`](../Docs/HIVE-EVALUATION.md).

It demonstrates the two things the brief cares about most:

1. **One GraphQL query** fanning out to three untouched REST services.
2. **Predictable Redis cache keys** you can read, and **explicit invalidation**
   you can trigger from outside the gateway.

> **Which Hive product?** Hive **Gateway** (Node.js), not Hive **Router** (Rust).
> Hive Router has no caching of any kind and cannot consume REST. See
> [§0 of the evaluation](../Docs/HIVE-EVALUATION.md#0-the-one-thing-to-know-first).

## Verified behaviour

Both run paths below were executed end to end against Hive Gateway 2.14.2 and
Valkey 8, with all three REST services live. These are observed numbers.

| Step | Docker (Path A) | Host (Path B) |
|---|---|---|
| `AccountOverview` first call (MISS) | **105 ms** | 4–7 ms |
| Same call again (HIT) | **2.4 ms — 43× faster** | ~1 ms |
| Keys written by one query | 13 | 13 |
| `DELETE /cache/entity/Account/acct-1001` | 16 keys, across 2 operations | same |
| Unrelated `FundDetail` response | survived | survived |
| Re-query after invalidation | MISS, refetched, repopulated | same |

The 13 keys are 1 response body, 6 entity tags and 6 reverse tags. The entities
tagged automatically were `Account.acct-1001`, `Policy.pol-life-3001`,
`Policy.pol-annuity-3002` and three `Fund.*` — **one query tagging entities from
all three REST services**, which is what makes per-entity invalidation possible.

Use the Docker numbers when demoing. The host figures are compressed because the
mock services answer in microseconds over loopback; real network hops look like
the Docker column or worse.

---

## Architecture

```
                       ┌──────────────┐
                       │ GraphQL      │
                       │ client       │
                       └──────┬───────┘
                              │ ONE query
                              ▼
                  ┌───────────────────────────┐        ┌──────────────┐
                  │      Hive Gateway :4000   │◄──────►│   Valkey     │
                  │   responseCaching         │  keys  │   :6379      │
                  │   cache: { type: redis }  │        │              │
                  └───────────┬───────────────┘        └──────▲───────┘
                              │ on cache MISS only            │ DEL
              ┌───────────────┼───────────────┐               │
              ▼               ▼               ▼               │
     ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌─────┴────────┐
     │ Accounts   │   │ Policies   │   │ Funds      │   │ invalidator  │
     │ REST :3001 │   │ REST :3003 │   │ REST :3002 │   │ :8090        │
     └─────┬──────┘   └─────┬──────┘   └─────┬──────┘   └──────────────┘
           │ openapi.yaml   │ openapi.yaml   │ openapi.yaml
           └────────────────┼────────────────┘
                            ▼
                ┌───────────────────────┐
                │ mesh-compose          │──► supergraph.graphql
                │ (build time, one-shot)│
                └───────────────────────┘
```

The REST services are **not modified**. Their existing `openapi.yaml` files are
read-only inputs to a build step.

## Folder structure

```
hive-poc/
├── docker-compose.yml         # the whole stack
├── mesh/
│   ├── mesh.config.ts         # OpenAPI -> subgraphs + cross-service joins
│   ├── Dockerfile             # one-shot compose job
│   └── package.json
├── gateway/
│   ├── gateway.config.ts      # cache keys, TTL, Redis  <-- the important file
│   ├── tagged-cache.ts        # OPTIONAL: real Redis SET tags (scale upgrade)
│   ├── Dockerfile
│   └── package.json
├── invalidator/
│   ├── server.js              # explicit cache deletion over HTTP
│   ├── Dockerfile
│   └── package.json
├── demo/
│   ├── queries.graphql        # the example queries
│   └── demo.sh                # scripted MISS -> HIT -> invalidate -> MISS
└── supergraph.graphql         # generated artifact (gitignored)
```

---

# Manual steps

Two ways to run it, **both executed end to end and working**. **Path A (Docker)**
is what you would demo. **Path B (host)** is faster to iterate on.

## Path A — Docker Compose (recommended for the demo)

### A1. Start everything

```bash
docker compose -f hive-poc/docker-compose.yml up --build -d
```

First build takes a few minutes (it installs the gateway and Mesh toolchains).
The `mesh-compose` service runs once, writes `supergraph.graphql` into a shared
volume, and exits — that is expected, not a failure.

### A2. Check everything is up

```bash
docker compose -f hive-poc/docker-compose.yml ps
```

You want `accounts-rest`, `policies-rest`, `funds-rest`, `valkey`,
`hive-gateway` and `invalidator` running, and `mesh-compose` **exited (0)**.

| Service | URL |
|---|---|
| GraphQL API + GraphiQL | http://localhost:4000/graphql |
| Invalidator | http://localhost:8090/health |
| Valkey | `localhost:6379` |
| Accounts / Funds / Policies REST | `:3001` / `:3002` / `:3003` |

### A3. Watch the gateway logs in a second terminal

```bash
docker compose -f hive-poc/docker-compose.yml logs -f hive-gateway
```

### A4. Run the scripted walkthrough

```bash
cd hive-poc/demo && ./demo.sh
```

It runs the whole MISS → HIT → invalidate → MISS cycle and prints the Redis keys
at each step. To drive it by hand instead, follow [Verify the cache](#verify-the-cache-by-hand) below.

### A5. Tear down

```bash
docker compose -f hive-poc/docker-compose.yml down -v
```

`-v` also drops the Valkey volume and the composed supergraph.

---

## Path B — Run on the host (fastest iteration)

### B1. Start Valkey

```bash
docker run -d --name hive-poc-valkey -p 6379:6379 valkey/valkey:8-alpine
```

Check it: `docker exec hive-poc-valkey valkey-cli ping` → `PONG`.

> Prefer Redis? `docker run -d --name hive-poc-valkey -p 6379:6379 redis:7-alpine`
> and use `redis-cli` in place of `valkey-cli` everywhere below. Nothing else changes.

### B2. Start the three REST APIs

From the repo root:

```bash
npm run mock-apis
```

Ports are hardcoded in each `server.js`: accounts `3001`, funds `3002`,
policies `3003`. Verify:

```bash
curl -s localhost:3001/health && curl -s localhost:3002/health && curl -s localhost:3003/health
```

### B3. Install the three toolchains (once)

```bash
cd hive-poc/mesh && npm install
cd ../gateway && npm install
cd ../invalidator && npm install
```

### B4. Compose the supergraph

```bash
cd hive-poc/mesh
ACCOUNTS_URL=http://localhost:3001 \
POLICIES_URL=http://localhost:3003 \
FUNDS_URL=http://localhost:3002 \
npx mesh-compose -o ../supergraph.graphql
```

Expect `Done!` and a `hive-poc/supergraph.graphql` of about 203 lines. Sanity
check that federation was inferred and the joins landed:

```bash
grep -c 'resolveTo' ../supergraph.graphql
```

Expect `3` — the `@resolveTo` joins for `Account.policies`, `FundHolding.fund`
and `Policy.account`. And `grep -o 'key: "id"' ../supergraph.graphql | wc -l`
should print `3`, one federation entity key each for `Account`, `Fund` and
`Policy`, none of which you wrote by hand.

> Re-run this whenever an `openapi.yaml` changes. The supergraph is a build
> artifact, and it bakes in the REST base URLs — so the host copy points at
> `localhost` and the Docker copy points at compose service names.

### B5. Start the gateway

```bash
cd hive-poc/gateway
REDIS_URL=redis://localhost:6379 \
ACCOUNTS_API_KEY=accounts-local-key \
POLICIES_API_KEY=policies-local-key \
FUNDS_API_KEY=funds-local-key \
npx hive-gateway supergraph ../supergraph.graphql -c ./gateway.config.ts --port 4000
```

Wait for `Listening on http://localhost:4000`.

> **Two flags that will bite you.** The config flag is `-c` / `--config-path`,
> not `--config`. And the config file must be passed explicitly because it is
> named `gateway.config.ts`; Hive only auto-discovers `gateway.ts`.

### B6. Start the invalidator

```bash
cd hive-poc/invalidator
REDIS_URL=redis://localhost:6379 PORT=8090 node server.js
```

### B7. Run the demo

```bash
cd hive-poc/demo
GATEWAY=http://localhost:4000/graphql \
INVALIDATOR=http://localhost:8090 \
VK="docker exec hive-poc-valkey valkey-cli" \
./demo.sh
```

---

# The unified query

Open http://localhost:4000/graphql and run:

```graphql
query AccountOverview($id: String!) {
  account(id: $id) {
    id
    holderName
    accountType
    totalValue
    policies {        # -> Policies REST  GET /accounts/{id}/policies
      id
      policyNumber
      productName
    }
    fundHoldings {
      allocationPercent
      fund {          # -> Funds REST     GET /funds/{fundId}
        id
        name
        isin
      }
    }
  }
}
```

Variables:

```json
{ "id": "acct-1001" }
```

One request in, three REST services queried, one response out. More examples in
[`demo/queries.graphql`](demo/queries.graphql).

> ### ⚠️ `account.funds` is deliberately missing
> `GET /accounts/{accountId}/funds` is declared in `funds/openapi.yaml` but is
> **broken in the mock service**: [`mock-rest-apis/funds/server.js:135`](../mock-rest-apis/funds/server.js#L135)
> dereferences an `accounts` array that does not exist in that process, so the
> request throws `ReferenceError` and **takes the whole funds service down**.
> The account → funds join therefore runs through `fundHoldings`, which uses the
> working `GET /funds/{id}` route and demonstrates the same cross-service
> fan-out. Fix that route and the field goes back into `mesh/mesh.config.ts` in
> four lines.

---

# Cache design

## Key strategy

Hive Gateway writes three key shapes, verbatim, with no prefix of its own:

| Redis key | Holds |
|---|---|
| `response-cache:<responseId>` | the cached JSON response |
| `response-cache:<Type>.<id>:<responseId>` | entity → response (**the tag**) |
| `response-cache:<responseId>:<Type>.<id>` | response → entity (reverse tag) |

`<responseId>` is ours to choose, via `buildResponseCacheKey` in
[`gateway/gateway.config.ts`](gateway/gateway.config.ts):

```
gql.<operationName>.<variables>.<documentHash8>
gql.AccountOverview.id-acct-1001.737e0759
```

So a full key set for one query looks like:

```
response-cache:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Policy.pol-life-3001:gql.AccountOverview.id-acct-1001.737e0759
response-cache:Fund.fund-global-equity:gql.AccountOverview.id-acct-1001.737e0759
```

> ## ⚠️ Never put a colon in the response key
> Hive parses the tag key positionally with `key.split(':')[2]` to recover the
> response id. A colon inside your key shifts that index and invalidation
> silently deletes nothing. Use dots and dashes. Entity ids must be colon-free
> too — `acct-1001` is fine.

## TTL strategy

| Scope | TTL | Why |
|---|---|---|
| `Fund` | 300s | reference data, rarely changes |
| `Policy` | 120s | changes on renewal |
| `Account` | 30s | balances move |
| everything else | 60s | global default |

Set in `responseCaching.ttlPerSchemaCoordinate`. Use `0` to make a type or field
uncacheable.

## Tag strategy

The `response-cache:<Type>.<id>:*` keys **are** the tag index — one Redis key per
(entity, response) pair. Invalidation scans that prefix.

For production scale, [`gateway/tagged-cache.ts`](gateway/tagged-cache.ts) is an
optional drop-in that mirrors those tags into real Redis SETs, turning
invalidation from a keyspace `SCAN` into an `SMEMBERS`. It is off by default.

---

# Verify the cache by hand

Set a shortcut first:

```bash
alias vk='docker exec hive-poc-valkey valkey-cli'
```

(Under Path A use `docker compose -f hive-poc/docker-compose.yml exec valkey valkey-cli`.)

### 1. Start empty

```bash
vk FLUSHALL
vk DBSIZE
```

### 2. Cache MISS — REST APIs are called

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"operationName":"AccountOverview","query":"query AccountOverview($id: String!) { account(id: $id) { id holderName policies { id policyNumber } fundHoldings { allocationPercent fund { id name } } } }","variables":{"id":"acct-1001"}}'
```

### 3. Look at what landed

```bash
vk --scan --pattern 'response-cache:*' | sort
```

You now see the response key plus one tag key per entity in the response.

Read the cached body back, and its remaining TTL:

```bash
vk GET  'response-cache:gql.AccountOverview.id-acct-1001.737e0759'
vk PTTL 'response-cache:gql.AccountOverview.id-acct-1001.737e0759'
```

### 4. Cache HIT — no REST traffic

Run the exact same curl again. Watch the REST logs: nothing arrives. Compare
timings with `curl -w '%{time_total}\n'`.

### 5. Which responses does one account affect?

```bash
vk --scan --pattern 'response-cache:Account.acct-1001:*'
```

Or ask the invalidator for a dry run:

```bash
curl -s localhost:8090/cache/entity/Account/acct-1001
```

### 6. Invalidate that entity

```bash
curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001
```

Or do it with raw Redis, to prove Hive is not required:

```bash
vk --scan --pattern 'response-cache:Account.acct-1001:*'   # note the responseIds
vk DEL 'response-cache:gql.AccountOverview.id-acct-1001.737e0759'
vk DEL 'response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759'
```

### 7. Confirm it is gone, then MISS again

```bash
vk --scan --pattern 'response-cache:*' | sort
```

Re-run the query from step 2. The REST services are hit again and the keys
reappear.

### Watch it live

```bash
vk MONITOR
```

Then fire queries in another terminal and watch the `GET` / `SET` / `DEL`
traffic in real time. This is the single most convincing thing to put on screen.

### Invalidator endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness |
| `GET` | `/cache/keys?pattern=response-cache:*` | list keys |
| `GET` | `/cache/entity/:type/:id` | dry run — what would be deleted |
| `DELETE` | `/cache/entity/:type/:id` | **invalidate an entity** |
| `DELETE` | `/cache/key?key=<redis key>` | delete one specific key |
| `DELETE` | `/cache/rest?url=<upstream url>` | drop one cached REST response |
| `POST` | `/cache/flush` | clear all gateway cache keys |

---

# Demoing this to a technical lead

A 10-minute script. Keep three panes open: GraphiQL, `valkey-cli MONITOR`, and
the REST service logs.

1. **The problem, in one line.** Three REST APIs, clients making three round
   trips and joining data themselves.
2. **One query replaces three calls.** Run `AccountOverview` in GraphiQL. Point
   out that `policies` and `funds` come from different services.
3. **Nothing was rewritten.** Show `mesh/mesh.config.ts`: the inputs are the
   `openapi.yaml` files that already existed. Show that `key: "id"` in the
   supergraph was inferred, not authored.
4. **The cache is not a black box.** `vk --scan --pattern 'response-cache:*'`.
   The keys are readable. Point at `buildResponseCacheKey` and say: we chose
   this format.
5. **Show the hit.** Re-run the query with the REST logs visible. Nothing
   arrives there. That is the whole value proposition.
6. **Show targeted invalidation.** `curl -s localhost:8090/cache/entity/Account/acct-1001`
   for the dry run, then the `DELETE`. Re-run the query and show the REST logs
   light up again.
7. **The part that matters for production.** The invalidator imports nothing
   from Hive. It is 150 lines against Redis. Any service, CDC stream or runbook
   can call it when data changes.
8. **Name the limits honestly.** The colon constraint, `SCAN`-based invalidation
   at scale, response-cache granularity, and that per-user data would need
   `session` scoping. All written up in
   [the evaluation](../Docs/HIVE-EVALUATION.md#6-risks-and-limitations).

---

# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `unknown option '--config'` | Use `-c` or `--config-path`. |
| `Cannot find package '@graphql-mesh/transport-rest'` | The REST runtime transport is a separate dependency. `npm install @graphql-mesh/transport-rest` in `gateway/`. |
| Query returns `null` with a connection error | The supergraph baked in the wrong base URLs. Recompose with the right `ACCOUNTS_URL`/`POLICIES_URL`/`FUNDS_URL` (B4). |
| `401 Missing or invalid X-Api-Key` | The gateway needs `ACCOUNTS_API_KEY`, `POLICIES_API_KEY`, `FUNDS_API_KEY` in its environment. |
| No `response-cache:*` keys appear | `REDIS_URL` is not reaching Valkey, or the operation resolved to an error — errored responses are not cached. |
| Invalidation deletes nothing | A colon crept into the response key or an entity id. See the warning above. |
| `mesh-compose` container keeps restarting | It is a one-shot job. `exited (0)` is success. |
| `ttlForType is deprecated` warning | Harmless. Emitted by the underlying plugin; the config here already uses `ttlPerSchemaCoordinate`. |

---

# What is Hive and what is ours

| Capability | Provider |
|---|---|
| REST → GraphQL subgraphs | **Hive/Mesh** — `@omnigraph/openapi` |
| Federation entities (`key: "id"`) | **Hive/Mesh** — inferred from the specs |
| Cross-service joins | **Hive/Mesh** — `@resolveTo`, ~40 lines of config |
| Query planning and execution | **Hive Gateway** |
| Response caching | **Hive Gateway** — `responseCaching` |
| Redis/Valkey backend | **Hive Gateway** — `cache: { type: 'redis' }` |
| Custom cache keys | **Hive Gateway** — `buildResponseCacheKey` |
| TTL (global / per-type / per-field) | **Hive Gateway** |
| Entity tags + mutation invalidation | **Hive Gateway** |
| HTTP-level REST caching | **Hive Gateway** — `plugin-http-cache` (opt-in) |
| **Invalidation API over HTTP** | **ours** — `invalidator/server.js` |
| **SET-based tags for scale** | **ours** — `gateway/tagged-cache.ts` (opt-in) |
