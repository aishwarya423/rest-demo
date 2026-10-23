# Hive Router MVP — 3 REST APIs via federation subgraphs

The [`../hive-router-poc`](../hive-router-poc/README.md) application with all
caching removed: no Valkey/Redis, no response cache, no invalidator. Everything
else — the subgraphs, composition, router and federated queries — is unchanged.

Built on: `hive-router` **0.3.x**, `@apollo/subgraph` **2.15.1**,
`graphql-yoga` **5.24.1**, `@theguild/federation-composition` **0.27.0**.

## Architecture

```
                        GraphQL client
                              |
                              v
                   Hive Router :4000   (Rust)
                              |
          +-------------------+-------------------+
          v                   v                   v
   accounts-subgraph   policies-subgraph    funds-subgraph
      :4001                :4002               :4003
     (Yoga)               (Yoga)              (Yoga)
          |                   |                   |
          v                   v                   v
   accounts-rest       policies-rest        funds-rest
      :3001                :3003               :3002

   build step: supergraph-compose -> supergraph.graphql (shared volume)
```

Hive Router federates GraphQL subgraphs only, so each REST API has a thin
GraphQL subgraph in front of it.

## Folder structure

```
hive-router-mvp/
├── docker-compose.yml           the whole stack
├── subgraphs/                   ONE image, three containers (SUBGRAPH env)
│   ├── src/
│   │   ├── server.mjs           Yoga bootstrap, picks a schema
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
│   └── router.config.yaml       Hive Router config
└── demo/
    ├── demo.sh                  runs the federated queries, with REST call counts
    └── queries.graphql          sample queries
```

---

## Quick start

```bash
docker compose -f hive-router-mvp/docker-compose.yml up --build -d
```

| Service | URL |
|---|---|
| GraphQL (Hive Router) | http://localhost:4000/graphql |
| accounts / policies / funds subgraph | `:4001` / `:4002` / `:4003` |
| REST services | `:3001` / `:3003` / `:3002` |

`supergraph-compose` runs once and exits 0. That is success, not a failure.

> **Do not run this at the same time as `hive-router-poc` or `hive-poc`.** They
> share port 4000. Stop the other first, for example:
> `docker compose -f hive-router-poc/docker-compose.yml down`

Then:

```bash
cd hive-router-mvp/demo && ./demo.sh
```

Or query the router directly:

```bash
curl -s http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id: \"acct-1001\") { holderName policies { policyNumber } fundHoldings { fund { name } } } }"}'
```

## Target queries

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

More in [`demo/queries.graphql`](demo/queries.graphql). Identifier arguments are
`String!` rather than `ID!` so the same query documents also work against
`hive-poc`.

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

Composition uses `@theguild/federation-composition`, the same library the Hive
registry uses. It imports the subgraph modules directly, so the composed SDL and
the running schema cannot drift apart.

---

## Comparison profile

Hive Gateway can run the same supergraph with Router's query planner
(`--hive-router-runtime`):

```bash
docker compose -f hive-router-mvp/docker-compose.yml --profile compare up -d
# -> http://localhost:4010/graphql
```

---

## What is native vs what we built

| Capability | Provider |
|---|---|
| Federation query planning and execution | **Hive Router** |
| Entity resolution across subgraphs | **Hive Router** |
| Operation name forwarding to subgraphs | **Hive Router** (`forward_operation_name`) |
| Timeouts, header propagation | **Hive Router** |
| Supergraph composition | **Hive** (`@theguild/federation-composition`) |
| Subgraph server + federation directives | **Yoga + @apollo/subgraph** |
| REST → GraphQL mapping | **ours**, 3 schema modules + resolvers |
| Cross-service joins | **ours**, reference resolvers |

---

## Limitations

1. **No caching.** Every query calls the REST services. See `hive-router-poc`
   for the cached version.
2. **Three subgraph schemas are hand-written.** The OpenAPI specs are no longer
   the source of truth, so a REST change can diverge silently. Generate the SDL
   from OpenAPI or add a contract test.
3. **`hive-router` is pre-1.0**; pin the image version before production.
4. **`account.funds` is absent.** `GET /accounts/{accountId}/funds` crashes the
   funds mock service at
   [`../mock-rest-apis/funds/server.js:135`](../mock-rest-apis/funds/server.js#L135).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `unknown field 'timeout' ... for key 'traffic_shaping.all'` | It is `request_timeout`, not `timeout`. |
| `data did not match any variant of untagged enum IntrospectionPermissionConfig` | `introspection` takes a bool: `introspection: true`. |
| `doc.definitions is not iterable` from `buildSubgraphSchema` | Pass an **array**: `buildSubgraphSchema([{ typeDefs, resolvers }])`. |
| `Cannot find package 'graphql-tag' imported from /app/subgraphs/src/...` | The composer image must `npm install` at `/app`, not `/app/compose`. |
| Schema change not picked up | The router reads the supergraph from a Docker **volume**. Rebuild `supergraph-compose`, then recreate the subgraphs and router. |
| Port already in use on 4000 | Another Hive stack is running. Stop it with `docker compose ... down`. |
| `supergraph-compose` keeps restarting | It is a one-shot job. `Exited (0)` is success. |
