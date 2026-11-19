# Running, demoing and debugging the stack

## Contents

- [Ports](#ports)
- [Starting and stopping](#starting-and-stopping)
- [The demo script](#the-demo-script)
- [Running a demo live](#running-a-demo-live)
- [Inspecting the cache](#inspecting-the-cache)
- [Debugging](#debugging)
- [The second POC](#the-second-poc)

## Ports

| Port | Service |
|---|---|
| 4000 | Hive Router, supergraph from a file — the base POC |
| 4100 | Hive Router, supergraph from the registry (`registry` profile) |
| 4010 | Hive Gateway with Router's planner (`compare` profile) |
| 4001 / 4002 / 4003 | accounts / policies / funds subgraphs |
| 3001 / 3003 / 3002 | accounts / policies / funds REST services |
| 6379 | Valkey — the POC's response cache |
| 8090 | invalidator |
| 8080 / 8081 / 8082 / 8083 | Hive Console app / usage API / GraphQL API + artifacts / Caddy→S3 |
| 9000 / 9001 | S3 API / S3 admin UI |
| 9092 / 9644 | Redpanda broker / admin |

Note the two Redis-family stores do not collide: the POC's Valkey publishes
6379, and Hive Console's own Redis is internal to the `hive` network with no
published port.

## Starting and stopping

```bash
cd hive-router-poc

# base POC only — no registry, nothing to configure
docker compose -f docker-compose.yml up --build -d

# with the self-hosted Hive Console
docker compose -f docker-compose.yml -f docker-compose.console.yml up -d --build

# add the registry-sourced router (needs .env configured first)
docker compose -f docker-compose.yml -f docker-compose.console.yml \
  --profile registry up -d hive-router-registry

# add the Gateway comparison runtime on :4010
docker compose -f docker-compose.yml --profile compare up -d
```

Tear down:

```bash
docker compose -f docker-compose.yml -f docker-compose.console.yml down      # keep data
docker compose -f docker-compose.yml -f docker-compose.console.yml down -v   # drop volumes
rm -rf hive-console/.hive                                                    # drop Hive's databases
```

`supergraph-compose` and `migrations` exit 0 by design. A container listed as
`Exited (0)` is a completed one-shot job, not a failure.

## The demo script

```bash
cd hive-router-poc/demo && ./demo.sh
```

It walks MISS → HIT → targeted purge → MISS, and counts REST calls at each step
by grepping the subgraph logs for `REST GET`. Three queries are used:
`AccountOverview` (the deep one), `AccountName` and `FundDetail` — the last one
exists to show that an unrelated cached response *survives* a targeted purge.

Overridable by environment: `ROUTER`, `INVALIDATOR`, `COMPOSE`, `VK`,
`ACCOUNT_ID`, `FUND_ID`. To demo against the registry-sourced router instead:

```bash
ROUTER=http://localhost:4100/graphql ./demo.sh
```

The header comment states the principle worth repeating out loud during a demo:
**the proof of a cache hit is the REST log, not the latency.** On a hit the
subgraph containers print no `REST GET` line at all.

## Running a demo live

A sequence that reliably lands, in rough order:

1. **Set the scene.** Three REST services that cannot be changed; one GraphQL
   endpoint in front of them. Show `demo/queries.graphql` — one query, three
   services behind it.

2. **Open a log pane and leave it visible.** This is the whole demo.
   ```bash
   docker compose -f hive-router-poc/docker-compose.yml logs -f \
     accounts-subgraph policies-subgraph funds-subgraph
   ```

3. **First query — the miss.** Five `REST GET` lines appear. Count them aloud.

4. **Same query again — the hit.** Nothing appears in the log pane. That
   silence is the point; let it sit for a second before explaining it.

5. **Show what is cached, and how it is filed.**
   ```bash
   curl -s localhost:8090/cache/keys | jq
   curl -s localhost:8090/cache/tags | jq
   ```
   The keys are readable on purpose — `sg:accounts:AccountById:id=acct-1001:3f21ab09`.

6. **Preview a purge before doing it.**
   ```bash
   curl -s localhost:8090/cache/entity/Account/acct-1001 | jq
   ```

7. **Purge, then re-query.** Two `REST GET` lines, not five — the fund data was
   never invalidated. This is the payoff of caching inside the subgraphs rather
   than at the gateway, and it is the most persuasive moment in the demo.

8. **Show an unrelated entry survived.** `FundDetail` is still a hit.

If Hive Console is part of the demo, add: publish a schema, show it appear in
the Console, run a check against a deliberately breaking change, and show the
registry-sourced router on `:4100` pick up a republish within ~2 seconds
without a restart.

## Inspecting the cache

```bash
# everything cached, and the tag index
curl -s localhost:8090/cache/keys | jq
curl -s localhost:8090/cache/tags | jq

# raw, proving Hive is not in the loop
docker compose -f hive-router-poc/docker-compose.yml exec valkey valkey-cli --scan
docker compose -f hive-router-poc/docker-compose.yml exec valkey valkey-cli smembers 'Account:acct-1001'

# preview / purge
curl -s          localhost:8090/cache/entity/Account/acct-1001 | jq
curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001 | jq
curl -s -X DELETE localhost:8090/cache/type/Fund | jq
curl -s -X DELETE localhost:8090/cache/subgraph/accounts | jq
curl -s -X POST   localhost:8090/cache/flush | jq
```

Useful switches: `CACHE_ENABLED=0` disables caching for a clean baseline;
`CACHE_EXTENSION_METADATA=1` adds `extensions.responseCache.hit` to direct
subgraph responses (not router responses).

## Debugging

| Symptom | Likely cause |
|---|---|
| Cache keys all read `anonymous` | `forward_operation_name: true` missing from `traffic_shaping.all` |
| Type-level purge reports success but purges nothing | `buildRedisEntityId` was changed from its default — `KEYS <Typename>:*` no longer matches |
| Tags point at responses that no longer exist | A purge path skipped the inner `SMEMBERS ops:<responseId>` unfiling step |
| `doc.definitions is not iterable` | `buildSubgraphSchema` was passed a bare object instead of an array |
| `Variable "$id" of type "String!" used in position expecting type "ID!"` | A subgraph drifted to `ID!`; all three must agree |
| Router serves an old schema | The host-side `supergraph.graphql` is stale — the router reads the Docker volume. Re-run `supergraph-compose` and restart the router |
| `GET /accounts/{id}/funds` 500s | Known mock bug, not ours. Use `Account.fundHoldings.fund` |
| Cache never hits | Check Valkey is reachable; cache errors are logged, not thrown, so a dead Redis looks like a permanent miss |

Reading the volume the router actually serves:

```bash
docker run --rm -v hive-router-poc_supergraph:/v alpine cat /v/supergraph.graphql
docker run --rm -v hive-router-poc_supergraph:/v alpine ls -la /v/sdl
```

Console-specific failures are in `references/console.md`.

## The second POC

`hive-registry-poc` answers one narrow question: with Hive's HA CDN unavailable
self-hosted, can Hive Router boot from — and hot-reload — a supergraph held in
S3-compatible object storage? Answer: yes, **provided `poll_interval` is set**,
because under `source: storage` polling defaults to disabled.

It deliberately does not run Hive Console, and it reuses `hive-router-poc`'s
subgraphs and composed supergraph through an external network and volume, so
`hive-router-poc` must be up first. Keep the two separate.
