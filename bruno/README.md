# Bruno Collection — Hive POC

API requests for the Hive POC in [`../hive-poc`](../hive-poc/README.md).
Open this folder as a collection in [Bruno](https://www.usebruno.com/) and
select the **local** environment.

## Prerequisites

Start the stack first:

```bash
docker compose -f hive-poc/docker-compose.yml up --build -d
```

## Environment variables

| Variable | Value | What it is |
|---|---|---|
| `gatewayUrl` | `http://localhost:4000` | Hive Gateway. GraphiQL is at the root, the API at `/graphql`. |
| `invalidatorUrl` | `http://localhost:8090` | Cache inspection and deletion service. |
| `accountsRest` | `http://localhost:3001` | Accounts REST API. |
| `fundsRest` | `http://localhost:3002` | Funds REST API. |
| `policiesRest` | `http://localhost:3003` | Policies REST API. |

## Folders

**`01-graphql-queries`** — queries against the unified GraphQL API. The headline
one is *Account full portfolio*, which pulls from all three REST services in a
single request.

**`02-cache-management`** — the invalidator API: inspect keys, preview a purge,
delete by entity, delete one key, flush everything.

## Suggested demo order

1. `02-cache-management` → **Flush all cache keys**, for a clean start.
2. `01-graphql-queries` → **Account full portfolio**. Cache miss, REST called.
3. Run it again. Cache hit, no REST traffic.
4. `01-graphql-queries` → **Fund by ID**. Caches an unrelated response.
5. `02-cache-management` → **List all cache keys**. Readable, predictable keys.
6. `02-cache-management` → **Preview purge — Account acct-1001**. Shows the
   blast radius without deleting anything.
7. `02-cache-management` → **Purge — Account acct-1001**. Both account responses
   go; the fund response survives.
8. Re-run **Account full portfolio**. Miss again, fresh data, re-cached.

## Notes

ID arguments are typed `String!`, not `ID!`. Mesh derives argument types from
the OpenAPI path parameters, which are plain strings.

Cache keys follow the format set by `buildResponseCacheKey` in
[`../hive-poc/gateway/gateway.config.ts`](../hive-poc/gateway/gateway.config.ts):

```text
response-cache:gql.<operationName>.<variables>.<documentHash>
```

The operation name appears even if the client does not send an `operationName`
field, because the gateway parses it out of the query text. That is why every
request in this collection uses a named operation such as `AccountById`: the
cache key is then readable and easy to find with `--scan`.

Colons are deliberately avoided inside the key. Hive recovers the response id by
splitting the tag key on colons, so an extra colon silently breaks invalidation.

There is no `account.funds` field. Its REST route crashes the funds mock service
at [`../mock-rest-apis/funds/server.js:135`](../mock-rest-apis/funds/server.js#L135),
so the account-to-funds join runs through `fundHoldings` instead.

## Equivalent CLI

```bash
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ account(id:\"acct-1001\") { holderName totalValue } }"}'
```

```bash
docker compose -f hive-poc/docker-compose.yml exec valkey \
  valkey-cli --scan --pattern 'response-cache:*'
```
