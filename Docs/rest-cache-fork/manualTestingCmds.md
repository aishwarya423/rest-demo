Stack is up and I validated every command below by running it.

## 1. Start / stop

```bash
npm run cached:up
```

```bash
npm run cached:down
```

## 2. Watch the cache (leave running in a second terminal)

```bash
docker compose -f docker-compose.cached.yml exec valkey valkey-cli MONITOR
```

```bash
docker compose -f docker-compose.cached.yml logs -f cached-gateway | grep rest-cache
```

## 3. Cold query, then inspect what landed in Valkey

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli FLUSHALL
```

```bash
curl -s localhost:5065/graphql -H 'content-type: application/json' -d '{"query":"{ account(id:\"acct-1001\"){ holderName policies { policyNumber } fundHoldings { fund { id name } } } }"}'
```

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli --scan
```

You get five readable entries plus their tag indexes:

| key | TTL |
|---|---|
| `rest:accounts:/accounts/acct-1001` | 120 |
| `rest:policies:/accounts/acct-1001/policies` | 30 |
| `rest:funds:/funds/fund-green-bond` (one per fund) | 300 |

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli TTL "rest:funds:/funds/fund-green-bond"
```

Run the same curl again and every line in the log tab says `HIT`. Run it with completely different fields (`fundHoldings { fund { isin riskRating } }`) and it still hits the same keys, because the entry is the raw REST response.

## 4. Invalidate one fund — the actual goal

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli DEL "rest:funds:/funds/fund-green-bond"
```

Query again and the log shows only that fund refetched:

```
[rest-cache] HIT  rest:funds:/funds/fund-global-equity
[rest-cache] MISS rest:funds:/funds/fund-green-bond
[rest-cache] HIT  rest:funds:/funds/fund-cash-plus
[rest-cache] SET  rest:funds:/funds/fund-green-bond ttl=300s tags=[Fund, Fund:fund-green-bond]
```

## 5. Prove the read really came from the cache

Overwrite the cached copy with a name the REST API never returns, then query:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli SET "rest:funds:/funds/fund-green-bond" '{"id":"fund-green-bond","isin":"GB00GRNBD002","name":"PROOF: SERVED FROM CACHE","assetClass":"FIXED_INCOME","currency":"GBP","riskRating":3,"ongoingChargePercent":0.22,"oneYearReturnPercent":5.8,"threeYearReturnPercent":13.2,"sustainabilityLabel":"SUSTAINABLE"}' EX 300
```

```bash
curl -s localhost:5065/graphql -H 'content-type: application/json' -d '{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name } } } }"}'
```

GraphQL returns `PROOF: SERVED FROM CACHE`. `DEL` the key and it returns `Green Bond Income` again.

## 6. Bulk purge by tag

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli SMEMBERS tag:Fund
```

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli EVAL 'local ks=redis.call("SMEMBERS",KEYS[1]) if #ks>0 then redis.call("DEL",unpack(ks)) end redis.call("DEL",KEYS[1]) return #ks' 1 tag:Fund
```

Returns `3`. Swap `tag:Fund` for `tag:Account:acct-1001` to drop the account entry and its policies entry together, across two REST services.

## 7. After editing the Rust

```bash
cd extensions/rest-cached && cargo test --target aarch64-apple-darwin
```

```bash
npm run cached:build
```

```bash
docker compose -f docker-compose.cached.yml up --build -d cached-gateway
```

## 8. Everything at once

```bash
npm run cached:test
```

Clean slate, rebuild, 17 assertions, writes `extension-cache-test-report.txt` and `extension-cache-monitor.txt`.

One gotcha while poking around: there is no top-level `fund(id:)` query in this schema — it's `@inaccessible`, so funds are reachable only through `account.fundHoldings.fund`. A direct `{ fund(id:"...") }` returns a validation error, not a cache problem.