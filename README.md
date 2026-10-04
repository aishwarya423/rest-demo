# rest-demo — three REST APIs as one GraphQL API

Three existing REST services exposed through a single unified GraphQL API, with
Redis/Valkey response caching and explicit per-entity cache invalidation.

**Two working POCs, same requirement, different engines.** Both run locally and
both are verified end to end.

| POC | Engine | Shape | Services |
|---|---|---|---|
| [`hive-poc/`](hive-poc/README.md) | **Hive Gateway** (Node) | Mesh reads the OpenAPI specs at build time; the gateway calls REST directly and caches whole responses | 1 |
| [`hive-router-poc/`](hive-router-poc/README.md) | **Hive Router** (Rust) | Three real federation subgraphs wrap the REST APIs and cache their own responses | 4 |

Hive Router cannot call REST and has no response cache, so that POC puts the
cache in the subgraphs. That turns out to give better cache mechanics at the
cost of three more services. Full comparison:
[Hive Router vs Hive Gateway](hive-router-poc/README.md#hive-router-vs-hive-gateway).
Why Hive over Grafbase at all: [`Docs/HIVE-EVALUATION.md`](Docs/HIVE-EVALUATION.md).

> The two stacks share ports 4000, 6379 and 8090. Run one at a time.

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

## Quick start

```bash
docker compose -f hive-poc/docker-compose.yml up --build -d
```

Or the Router POC instead (not both at once):

```bash
docker compose -f hive-router-poc/docker-compose.yml up --build -d
```

| Service | URL |
|---|---|
| GraphQL API + GraphiQL | http://localhost:4000/graphql |
| Cache invalidator | http://localhost:8090/health |
| Valkey | `localhost:6379` |
| Accounts / Funds / Policies REST | `:3001` / `:3002` / `:3003` |

Then run the scripted walkthrough of cache miss, hit, invalidation and refetch:

```bash
cd hive-poc/demo && ./demo.sh
```

The first build takes a few minutes. The `mesh-compose` container runs once,
writes the supergraph and exits with code 0. That exit is expected.

## Try it

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\") { holderName policies { policyNumber } fundHoldings { fund { name } } } }"}'
```

One request, three REST services. Run it twice and the second call is served
from Valkey with no REST traffic at all.

## Layout

| Path | What it is |
|---|---|
| [`hive-poc/`](hive-poc/README.md) | Gateway POC: Mesh composition, gateway config, invalidator, Compose, demo |
| [`hive-poc/SPEAKER-NOTES.md`](hive-poc/SPEAKER-NOTES.md) | Developer-focused walkthrough and demo script |
| [`hive-router-poc/`](hive-router-poc/README.md) | Router POC: 3 Yoga federation subgraphs, subgraph-level cache, invalidator |
| [`Docs/HIVE-EVALUATION.md`](Docs/HIVE-EVALUATION.md) | Why Hive Gateway, what is native vs custom, risks, Hive vs Grafbase |
| [`mock-rest-apis/`](mock-rest-apis/) | The three REST services and their OpenAPI contracts |
| [`bruno/`](bruno/README.md) | Bruno collection, pointed at the Gateway POC on :4000 |

## How it fits together

**Build time.** Mesh reads the three `openapi.yaml` files and composes one
federated `supergraph.graphql`. Federation entity keys are derived
automatically from the `GET /<resource>/{id}` routes.

**Runtime.** Hive Gateway serves that supergraph, calls the REST services on a
cache miss, and caches each response in Valkey under a readable key such as
`response-cache:gql.AccountOverview.id-acct-1001.737e0759`.

**Invalidation.** Every cached response is tagged with the entities it contains.
Deleting one entity removes exactly the responses that embedded it:

```bash
curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001
```

The REST services were not modified. Only their OpenAPI files are read.

## Known issue

`GET /accounts/{accountId}/funds` crashes the funds service. It dereferences an
`accounts` array that does not exist in that process, at
[`mock-rest-apis/funds/server.js:135`](mock-rest-apis/funds/server.js#L135). The
route is declared in `funds/openapi.yaml`, so generated clients will call it.
The account-to-funds join uses `fundHoldings` instead until it is fixed.

## Running without Docker

```bash
npm install
npm run mock-apis          # accounts :3001, funds :3002, policies :3003
npm run supergraph:build   # compose the supergraph against localhost
```

Then start the gateway and invalidator as described in
[`hive-poc/README.md`](hive-poc/README.md#path-b--run-on-the-host-fastest-iteration).
