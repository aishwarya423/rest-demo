# Speaker notes: Hive POC

Developer-focused notes for presenting this POC. Each section follows the same
shape: **what it does, why we need it, how it works, what to say.**

Companion docs:
- [README.md](README.md) has the run steps.
- [../Docs/HIVE-EVALUATION.md](../Docs/HIVE-EVALUATION.md) has the full evaluation.

---

## 1. The one-minute summary

We have three REST APIs: Accounts, Policies and Funds. Clients currently call
each one and join the data themselves.

This POC puts **one GraphQL endpoint** in front of all three. A client sends one
query. The gateway calls the REST APIs it needs, merges the results, and returns
one response.

The gateway caches that response in **Valkey**, a Redis-compatible store. The
cache keys are readable. We can delete everything related to one account, fund
or policy when that data changes.

We did not change the REST APIs. We only read their existing OpenAPI files.

**Say:** "One query replaces three REST calls. The answer is cached in Redis
under keys we designed. When one entity changes, we delete exactly the
responses that contained it."

---

## 2. Terms you will hear

| Term | Plain meaning |
|---|---|
| **GraphQL** | A query language. The client asks for exactly the fields it wants, in one request. |
| **Schema** | The contract listing every type, field and query clients can use. |
| **Query / Mutation** | A Query reads data. A Mutation changes data. This POC only has Queries. |
| **Resolver** | The code or rule that fetches the value for one field. Here most resolvers are REST calls. |
| **Subgraph** | One service's slice of the schema. We have three: Accounts, Policies and Funds. |
| **Supergraph** | All subgraphs combined into one schema, plus notes on which subgraph owns which field. |
| **Composition** | The build step that combines subgraphs into the supergraph. |
| **Federation** | The standard for splitting one GraphQL API across several services and joining them. |
| **Entity** | A type with a stable identity that several services can refer to, such as Account with an `id`. |
| **`@key`** | The federation marker that says which field identifies an entity. Here it is always `id`. |
| **Router / gateway** | The single front door. It receives the client query, plans the calls, and merges results. |
| **Query plan** | The gateway's step-by-step list of which services to call, and in what order. |
| **OpenAPI** | The YAML/JSON file that describes a REST API's routes and response shapes. |
| **TTL** | Time to live. How long a cached item stays before Redis deletes it automatically. |
| **Cache hit / miss** | A hit means the answer was already cached. A miss means we had to call the REST APIs. |
| **Cache tag** | A label saying "this cached response contains Account acct-1001". Used for invalidation. |
| **Invalidation** | Deleting cached data because the source data changed. |
| **Valkey** | An open-source fork of Redis. Same commands, same client libraries. |

---

## 3. Packages and tools

| Package / tool | Used in | Why we need it |
|---|---|---|
| `@graphql-mesh/compose-cli` | `mesh/` | Runs the build step that creates `supergraph.graphql`. Also provides rename transforms. |
| `@omnigraph/openapi` | `mesh/` | Reads an OpenAPI file and turns each REST route into a GraphQL field. |
| `@graphql-hive/gateway` | `gateway/` | The runtime server. It serves GraphQL, plans queries, calls REST, and caches responses. |
| `@graphql-mesh/transport-rest` | `gateway/` | Lets the gateway execute REST-backed fields. Without it, every REST field fails at query time. |
| `@graphql-mesh/plugin-http-cache` | `gateway/` | Optional cache for raw REST responses. It is off by default. |
| `ioredis` | `invalidator/` | Node Redis client. The invalidator uses it to find and delete keys. |
| Valkey 8 | Docker | Stores cached responses and their tags. |
| Docker Compose | root of POC | Starts everything with one command. |

### Hive Router vs Hive Gateway

This is the most important product distinction.

| | Hive Router | Hive Gateway |
|---|---|---|
| Language | Rust | Node.js |
| Used here? | No | Yes |
| Response caching | None today | Built in |
| Redis support | No | Yes |
| Custom cache keys | No | Yes |

"Router" is also a general term for a federation front door. In this POC,
**Hive Gateway plays the router role**. We did not use the Hive Router product.

**Say:** "We evaluated Hive Router first, but it has no response cache today.
Hive Gateway is part of the same Hive platform and supports Redis, custom keys
and invalidation."

---

## 4. Architecture and request flow

```
                 GraphQL client
                       |
                       | one query
                       v
              Hive Gateway :4000  <-------->  Valkey :6379
                       |                         ^
                       | cache miss only         | DEL keys
          +------------+------------+            |
          v            v            v            |
     Accounts      Policies       Funds      Invalidator :8090
      :3001          :3003         :3002
```

There are two phases.

**Build time.** Mesh reads the three OpenAPI files and writes
`supergraph.graphql`. In Docker, the `mesh-compose` container does this once
and then exits with code 0. That exit is expected.

**Runtime.** Hive Gateway loads the supergraph and serves requests.

### Cache miss

1. The client sends `AccountOverview` with `id: acct-1001`.
2. The gateway builds our custom cache key and looks it up in Valkey.
3. The key is missing.
4. The gateway plans the query.
5. It calls `GET /accounts/acct-1001`.
6. It calls `GET /accounts/acct-1001/policies`.
7. It calls `GET /funds/{fundId}` once for each fund holding.
8. It merges the results into one GraphQL response.
9. It stores the response and its entity tags in Valkey.
10. It returns the response.

### Cache hit

1. The client sends the same query and variables again.
2. The gateway builds the same cache key.
3. Valkey has it.
4. The gateway returns the cached JSON. It makes no REST calls.

### Invalidation

1. Account `acct-1001` changes in the REST tier.
2. Something calls `DELETE /cache/entity/Account/acct-1001` on the invalidator.
3. The invalidator finds every cached response tagged with that account.
4. It deletes those responses and their tag keys.
5. The next query misses and fetches fresh data.

**Say:** "The gateway only calls REST on a miss. On a hit, the three services
see no traffic at all."

---

## 5. REST to GraphQL: the Mesh config

**File:** [`mesh/mesh.config.ts`](mesh/mesh.config.ts)

### What it does

It turns three OpenAPI files into three GraphQL subgraphs. It also adds the
fields that join data across services.

### Why we need it

Hive Gateway does not read OpenAPI directly. It needs a supergraph file that
describes every field and how to fetch it.

### How it works

Each REST API gets one `loadOpenAPISubgraph` block:

```ts
loadOpenAPISubgraph('Accounts', {
  source: '../../mock-rest-apis/accounts/openapi.yaml',
  endpoint: ACCOUNTS_URL,
  operationHeaders: { 'X-Api-Key': '{env.ACCOUNTS_API_KEY}' },
})
```

| Option | Meaning |
|---|---|
| `source` | The OpenAPI file to read. |
| `endpoint` | The REST base URL written into the supergraph. |
| `operationHeaders` | Headers sent to REST. `{env.X}` is filled from the gateway's environment at runtime, so the key is not stored in the file. |

Mesh names fields after routes, such as `accounts_by_id`. The rename transform
changes those to cleaner GraphQL names:

| Generated name | Our name |
|---|---|
| `accounts_by_id` | `account` |
| `policies_by_id` | `policy` |
| `funds_by_id` | `fund` |
| `accounts_by_accountId_policies` | `policiesByAccount` |

Mesh also sees routes like `GET /accounts/{id}` and treats that type as an
entity with `key: "id"`. **We did not write that federation metadata by hand.**

### The joins

The OpenAPI files do not say that an account has policies. We add that link in
`additionalTypeDefs`:

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

Read that as: "To resolve `Account.policies`, first make sure we have the
account's `id`. Then call `policiesByAccount(accountId: <that id>)` on the
Policies subgraph."

| Argument | Meaning |
|---|---|
| `sourceName` | Which subgraph to call. |
| `sourceFieldName` | Which query field on that subgraph. |
| `requiredSelectionSet` | Parent fields the gateway must fetch first. |
| `sourceArgs` | How to map parent data into the target field's arguments. `root` means the parent object. |

We define three joins:

| Field | REST call |
|---|---|
| `Account.policies` | `GET /accounts/{id}/policies` |
| `FundHolding.fund` | `GET /funds/{fundId}` |
| `Policy.account` | `GET /accounts/{accountId}` |

### Known gap

There is no `Account.funds` field. Its REST route, `GET /accounts/{id}/funds`,
crashes the funds mock service at
[`server.js:135`](../mock-rest-apis/funds/server.js#L135). It refers to an
`accounts` array that the funds service does not have. We use
`fundHoldings.fund` instead.

**Say:** "Mesh generated most of the schema from the existing OpenAPI files. We
wrote about 40 lines to connect the services."

---

## 6. How federation, subgraphs, resolvers and the gateway fit together

Use this analogy:

- Each **subgraph** is one department that knows its own data.
- The **supergraph** is the company directory that says who owns what.
- **Resolvers** are the instructions for fetching each piece of data.
- The **gateway** is the receptionist who receives one request, asks the right
  departments, and returns one combined answer.
- **Entities and `@key`** give every department a shared ID, so they know they
  are talking about the same account.

In this POC, the resolvers are not handwritten JavaScript functions. They are
directives in the supergraph:

- `@httpOperation` means "call this REST route".
- `@resolveTo` means "resolve this field by calling another subgraph".

Hive Gateway reads those directives and makes the HTTP calls.

**Say:** "There are no custom resolver services here. The gateway executes the
REST calls described in the generated supergraph."

---

## 7. Gateway and cache configuration

**File:** [`gateway/gateway.config.ts`](gateway/gateway.config.ts)

This is the most important file in the POC.

### 7.1 Redis connection

```ts
cache: {
  type: 'redis',
  url: process.env.REDIS_URL ?? 'redis://redis:6379',
  lazyConnect: false,
}
```

This is the gateway's shared cache storage. `lazyConnect: false` connects at
startup, so a bad Redis address shows up early.

### 7.2 Response caching

```ts
responseCaching: {
  session: () => null,
  ttl: 60_000,
  ttlPerSchemaCoordinate: {
    Fund: 300_000,
    Policy: 120_000,
    Account: 30_000,
  },
  idFields: ['id'],
  invalidateViaMutation: true,
  buildResponseCacheKey: async (...) => ...,
}
```

| Setting | What it does |
|---|---|
| `session: () => null` | Everyone shares one cache. This is safe only because the demo data is not user-specific. |
| `ttl` | Default lifetime: 60 seconds. |
| `ttlPerSchemaCoordinate` | Type-specific lifetimes. Funds last 5 minutes, policies 2 minutes, accounts 30 seconds. |
| `idFields` | The field that identifies an entity. It creates tags like `Account.acct-1001`. |
| `invalidateViaMutation` | Clears affected cache entries when a mutation returns an entity. It has no effect today because our REST APIs expose no mutations. |
| `buildResponseCacheKey` | Replaces Hive's opaque hash with our readable key. |

A **schema coordinate** is a path such as `Account` or `Query.account`.

If a response contains several types, the shortest matching TTL wins. The
`AccountOverview` response contains an account, so it lasts 30 seconds.

### 7.3 Custom cache key

Our key format is:

```text
gql.<operationName>.<variables>.<documentHash>
```

Example:

```text
gql.AccountOverview.id-acct-1001.737e0759
```

| Part | Why it exists |
|---|---|
| `gql.` | Marks our GraphQL response keys. |
| `AccountOverview` | The GraphQL operation name. |
| `id-acct-1001` | The variables, sorted so the same variables always produce the same key. |
| `737e0759` | The first 8 characters of a SHA-256 hash of the query text. Different field selections get different keys. |

### The colon rule

**Never put a colon in the response key or an entity ID.**

Hive stores tags like this:

```text
response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759
```

To find the response ID, Hive splits on colons and reads the third part. A
colon inside our key would change that position. Invalidation would then find
the wrong ID and delete nothing.

That is why we use dots and dashes instead of `account:123`.

### 7.4 Optional REST response cache

```ts
plugins: (ctx) =>
  process.env.ENABLE_HTTP_CACHE === '1'
    ? [useHTTPCache(...)]
    : []
```

This would cache raw REST responses. It follows standard HTTP caching rules, so
REST responses need a `Cache-Control` header. Our REST APIs do not send one, so
this layer stays off.

**Say:** "We chose the cache key format. It is readable in Redis, and it is safe
with Hive's invalidation logic."

---

## 8. What gets stored in Redis

One `AccountOverview` query writes 13 keys.

| Key shape | Count | Purpose |
|---|---|---|
| `response-cache:<responseId>` | 1 | The cached JSON response. |
| `response-cache:<Type>.<id>:<responseId>` | 6 | Forward tags: entity to response. |
| `response-cache:<responseId>:<Type>.<id>` | 6 | Reverse tags: response to entity. |

The six entities are:

- one account from Accounts;
- two policies from Policies;
- three funds from Funds.

So one cached response is tagged with entities from all three REST services.

### Why both tag directions?

**Forward tags** answer: "Which responses contain Account acct-1001?"

**Reverse tags** answer: "Which entities are in this response?"

We need both. When deleting one response, the reverse tags tell us which other
forward tags now point to nothing. Deleting those prevents stale tag keys from
building up.

### Tags are strings, not Redis Sets

Hive Gateway stores each entity-response pair as its own Redis key. It does not
use a Redis Set for each tag. To find tagged responses, it scans by prefix.

That is fine for a POC. At millions of keys, a full keyspace scan is slow.

**Say:** "Every cached response knows which accounts, policies and funds it
contains. That is what makes targeted invalidation possible."

---

## 9. The invalidator service

**File:** [`invalidator/server.js`](invalidator/server.js)

### What it does

It exposes simple HTTP endpoints for inspecting and deleting cache entries.

### Why we need it

Hive can invalidate after GraphQL mutations. But our data changes happen in the
REST services, outside the gateway. Another system needs a way to say "account
acct-1001 changed."

### How entity invalidation works

For `DELETE /cache/entity/Account/acct-1001`:

1. **Find the account's forward tags.**
   Scan `response-cache:Account.acct-1001:*`.
2. **Get the response IDs.**
   Take the third colon-separated part of each tag key.
3. **Delete each response body.**
   Delete `response-cache:<responseId>`.
4. **Find the response's other tags.**
   Scan `response-cache:<responseId>:*`.
5. **Delete tags in both directions.**
   This removes tags for the policies and funds in that response too.

It uses `SCAN`, not `KEYS`. `SCAN` walks Redis in batches. `KEYS` can block
Redis while it checks every key.

The invalidator imports nothing from Hive. It only needs Redis. Your REST
services, a message queue consumer or an ops script could use the same logic.

### Endpoints

| Method | Path | Use |
|---|---|---|
| `GET` | `/cache/entity/:type/:id` | Dry run. Shows what would be deleted. |
| `DELETE` | `/cache/entity/:type/:id` | Invalidates one entity. |
| `DELETE` | `/cache/key?key=...` | Deletes one exact Redis key. |
| `GET` | `/cache/keys?pattern=...` | Lists matching keys. |
| `POST` | `/cache/flush` | Clears all gateway cache keys. Demo use only. |

**Say:** "Invalidation does not have to go through the gateway. Any service that
can reach Redis can clear exactly the affected responses."

---

## 10. Optional Redis Set tags

**File:** [`gateway/tagged-cache.ts`](gateway/tagged-cache.ts)

This is a possible production upgrade. **It is not enabled or tested.**

It wraps the gateway's cache storage. When Hive writes a forward tag, the
wrapper also runs:

```text
SADD tag:Account.acct-1001 gql.AccountOverview.id-acct-1001.737e0759
```

When Hive asks for keys with that tag, the wrapper reads the Set:

```text
SMEMBERS tag:Account.acct-1001
```

That avoids scanning every Redis key.

Before using it:

- Add `ioredis` to `gateway/package.json`. It is only installed indirectly today.
- Update the invalidator to read and clean the `tag:*` Sets.
- Test mutation invalidation and TTL expiry.

**Say:** "The current design works for the POC. For very large caches, we have
a clear path to Redis Set tags without forking Hive."

---

## 11. Docker Compose setup

**File:** [`docker-compose.yml`](docker-compose.yml)

| Service | Role |
|---|---|
| `accounts-rest`, `policies-rest`, `funds-rest` | Existing mock REST APIs. |
| `valkey` | Redis-compatible cache. |
| `mesh-compose` | One-time build job that writes the supergraph. |
| `hive-gateway` | GraphQL API on port 4000. |
| `invalidator` | Cache deletion API on port 8090. |

The gateway waits until:

- `mesh-compose` has completed successfully;
- Valkey is healthy;
- the REST services have started.

The supergraph moves between containers through a shared Docker volume.

**Say:** "The whole stack starts with one Docker Compose command. The build job
finishes first, then the gateway serves the generated supergraph."

---

## 12. Demo script

Keep three views open:

1. GraphiQL at http://localhost:4000/graphql
2. REST service logs
3. `valkey-cli MONITOR`

### Step 1: show the problem

**Say:** "Today a client needs three REST calls and has to join the data."

### Step 2: run the unified query

Run `AccountOverview` with `id: acct-1001`.

**Say:** "This response includes account data, policies and fund details. They
come from three services, but the client made one request."

### Step 3: show the generated schema

Open `mesh/mesh.config.ts`.

**Say:** "The input is the OpenAPI files we already had. Mesh generated the
subgraphs. We only added names and joins."

### Step 4: show the cache keys

```bash
docker compose -f hive-poc/docker-compose.yml exec valkey \
  valkey-cli --scan --pattern 'response-cache:*'
```

**Say:** "The key includes the operation name and account ID. We can read it,
predict it and delete it."

### Step 5: show a cache hit

Run the same query again.

**Say:** "The response came from Valkey. The REST logs show no new calls."

In the verified Docker run, the miss took 105 ms and the hit took 2.4 ms.

### Step 6: invalidate one account

Dry run:

```bash
curl -s localhost:8090/cache/entity/Account/acct-1001
```

Delete:

```bash
curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001
```

**Say:** "Both cached account operations were removed. An unrelated fund query
stayed cached."

### Step 7: show the refresh

Run `AccountOverview` again.

**Say:** "This is a miss. The gateway calls REST, gets fresh data and caches it
again."

### Step 8: state the limits

- Keys and IDs must not contain colons.
- Tag lookup uses `SCAN`, which will need optimising at large scale.
- A response is invalidated as a whole, not one field at a time.
- User-specific data needs a validated session key.
- `Account.funds` is blocked by the funds service bug.

---

## 13. Likely questions

**Did you change the REST APIs?**
No. The POC only reads their OpenAPI files. The optional raw REST cache would
need `Cache-Control` headers, which is why it is off.

**Why not use Hive Router?**
Hive Router has no response cache, Redis support or cache invalidation today.
Hive Gateway has all three.

**Where are the resolvers?**
They are generated directives in `supergraph.graphql`. `@httpOperation` calls
REST, and `@resolveTo` joins subgraphs.

**Is this real federation?**
Yes. Mesh creates federation entities with `key: "id"` and a federation
supergraph.

**What happens if Valkey goes down?**
We have not tested that yet. Treat it as a production readiness item.

**What happens when a REST API changes?**
Update its OpenAPI file and rerun `mesh-compose`. In CI, this should happen
automatically.

**Could one user see another user's cached data?**
Yes, if the data were user-specific. This POC uses one shared cache. For private
data, set `session` from a validated user or tenant ID and mark private types
with `scopePerSchemaCoordinate`.

**Why does one account deletion remove fund tags too?**
Those fund tags belonged to the deleted account response. Leaving them would
create tags that point to nothing.

**Why not just set a short TTL?**
TTL is a safety net. Invalidation removes stale data as soon as we know it
changed.

**Can a mutation clear the cache automatically?**
Hive supports that. It is inactive here because the REST APIs expose only GET
routes, so the GraphQL schema has no mutations.

**What would you do before production?**
- Fix the funds route bug.
- Add authentication to the invalidator.
- Define session scoping for private data.
- Test Valkey failure behaviour.
- Load-test invalidation with realistic key counts.
- Decide whether to adopt the Redis Set tag wrapper.
