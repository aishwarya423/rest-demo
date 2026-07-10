# Bruno Collection — Grafbase POC

A Bruno workspace to exercise the federated GraphQL gateway and the per-subgraph cache management API.

## Open

1. Install Bruno → https://www.usebruno.com/
2. Open this `bruno/` directory as a collection.
3. Top-right → select the **local** environment.

## Layout

```
bruno/
├── bruno.json                          # collection manifest
├── environments/
│   └── local.bru                       # gatewayUrl + per-subgraph mgmt URLs
├── 01-graphql-queries/                 # POST {{gatewayUrl}}/graphql — body type: graphql
│   ├── 01-account-by-id.bru
│   ├── 02-account-full-portfolio.bru   # cross-subgraph federation join
│   ├── 03-policy-by-id.bru
│   ├── 04-fund-by-id.bru
│   ├── 05-list-accounts.bru
│   ├── 06-list-policies.bru
│   └── 07-list-funds.bru
└── 02-cache-management/                # subgraph mgmt API (ports 5001/5002/5003)
    ├── 01-health-accounts.bru
    ├── 02-list-tag-members.bru
    ├── 03-purge-single-account.bru
    ├── 04-purge-all-accounts.bru
    ├── 05-purge-policy.bru
    └── 06-purge-fund.bru
```

## Environment variables (`environments/local.bru`)

| Var | Value |
|---|---|
| `gatewayUrl` | `http://localhost:5050` |
| `accountsMgmt` | `http://localhost:5001` |
| `policiesMgmt` | `http://localhost:5002` |
| `fundsMgmt` | `http://localhost:5003` |

## GraphQL request shape (Bruno native)

Every query file uses Bruno's first-class GraphQL body — the **Query** and **Variables** tabs in the UI map directly to:

```
body:graphql { ...query string... }
body:graphql:vars { ...JSON variables... }
```

This is the same as the canonical demo curl:

```bash
curl -X POST http://localhost:5050/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ account(id:\"acct-1001\") { holderName totalValue } }"}'
```

…but with the query and variables editable in separate panels.

## Cache demo flow inside Bruno

1. Run **01 → Account by ID** twice — second call is faster (cache HIT).
2. Run **02 → List cache keys for a tag** — confirms `Account:acct-1001` index exists.
3. Run **03 → Purge single account** — instant tag invalidation.
4. Run **01 → Account by ID** again — back to MISS, slower.
