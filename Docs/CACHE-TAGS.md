# Tag-based REST caching (`subgraphs/` + Valkey)

Caching of REST responses **inside each subgraph**, with **entity-tag
invalidation**: a single `POST /purge {"tags":["Account:acct-1001"]}` drops every
cached entry that touches that account — across services — without the caller
knowing a single cache key.

This is a **separate stack** from the gateway caching demo:

| | `docker-compose.gateway.yml` | `docker-compose.tagcache.yml` |
|---|---|---|
| what caches | the Grafbase gateway | each subgraph, in its own code |
| what is cached | query plans + `_entities` responses | individual REST responses |
| keys | `insurance-opcache*`, `insurance-entitycache*` | `subgraph:<service>:<route>` |
| invalidation | TTL only | TTL **or** purge by tag |
| accounts/policies | REST extension (`@rest` in `schema.graphql`) | real GraphQL subgraphs (`subgraphs/`) |
| gateway port | 5060 | 5070 |

They share ports 3001–3003 and 6379, so **run one at a time**.

---

## How it works

Each subgraph is a thin GraphQL facade over one REST service, and every REST call
goes through `cachedRequestJson()` in [`subgraphs/lib/cache.js`](../subgraphs/lib/cache.js):

```
key   subgraph:<service>:<route>       e.g. subgraph:accounts:/accounts/acct-1001
tags  tag:<Entity>  +  tag:<Entity>:<id>
```

On a **miss** the entry is written with `SET … EX <ttl>` and its key is added to
one Valkey SET per tag; on a **hit** the REST API is never called. The tag SETs
are the whole trick — they are a reverse index from entity to cache keys:

```
tag:Account:acct-1001 -> { subgraph:accounts:/accounts/acct-1001,
                           subgraph:policies:/accounts/acct-1001/policies }
```

`purgeTags()` reads those SETs, `DEL`s every member, then `DEL`s the SETs.

### Route → tags

`tagsForRoute()` maps REST routes to tags (most specific pattern first):

| route | tags |
|---|---|
| `/accounts` | `Account` |
| `/accounts/{id}` | `Account`, `Account:{id}` |
| `/accounts/{id}/policies` | `Account:{id}`, `Policy` |
| `/accounts/{id}/funds` | `Account:{id}`, `Fund` |
| `/customers/{id}/accounts` | `Customer:{id}`, `Account` |
| `/policies`, `/policies/{id}` | `Policy` (+ `Policy:{id}`) |
| `/funds`, `/funds/{id}` | `Fund` (+ `Fund:{id}`) |
| `/funds/{id}/policies` | `Fund:{id}`, `Policy` |

An unknown route is still cached, just not purgable by tag. Add a pattern to
`tagsForRoute()` when you add a REST route.

### TTLs

| service | data TTL (`CACHE_TTL`) | why |
|---|---|---|
| accounts | 120s | balances move, but not per-request |
| policies | 30s | fastest-churning |
| funds | 300s | reference data |

Tag SETs use **one shared TTL** (`TAG_INDEX_TTL`, 600s) in all three services.
They must: `tag:Account:{id}` is written by *both* accounts and policies, and each
write resets the SET's expiry — if policies (30s) set it to 60s, the index would
die while the accounts entry is still cached for 120s, and a purge after that
would silently miss it. `EXPIRE … GT` is not a fix: `GT` treats a key with no
expiry as infinite and refuses to set one.

---

## Run it

```bash
npm run tagcache:up          # docker compose -f docker-compose.tagcache.yml up --build -d
```

| endpoint | what |
|---|---|
| http://localhost:5070/graphql | federated graph |
| :3011 / :3013 / :3012 | accounts / policies / funds subgraphs |
| :4011 / :4013 / :4012 | their management APIs |
| :6379 | Valkey |

Watch the cache live:

```bash
npm run tagcache:monitor     # valkey-cli MONITOR
```

…and in another terminal fire a query that crosses all three subgraphs:

```bash
curl -s localhost:5070/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName policies { policyNumber } fundHoldings { fund { id name } } } }"}'
```

```
"get"    "subgraph:accounts:/accounts/acct-1001"
"set"    "subgraph:accounts:/accounts/acct-1001" "{…}" "EX" "120"
"sadd"   "tag:Account" "subgraph:accounts:/accounts/acct-1001"
"expire" "tag:Account" "600"
"sadd"   "tag:Account:acct-1001" "subgraph:accounts:/accounts/acct-1001"
"expire" "tag:Account:acct-1001" "600"
"get"    "subgraph:policies:/accounts/acct-1001/policies"
"set"    "subgraph:policies:/accounts/acct-1001/policies" "[…]" "EX" "30"
"sadd"   "tag:Account:acct-1001" "subgraph:policies:/accounts/acct-1001/policies"
…
```

Run the same query again — no `get`/`set` churn, and the subgraph logs show
`[cache HIT]` on every line (`npm run tagcache:logs`).

## Management API

Every subgraph exposes the same four routes on its management port. They all talk
to the same Valkey, so **any** of them can purge **any** tag.

```bash
curl -s localhost:4011/health                     # {"service":"accounts","cache":"ready"}
curl -s localhost:4011/keys                       # this service's cache keys
curl -s localhost:4011/tags/Account:acct-1001     # keys registered under a tag
curl -s -XPOST localhost:4011/purge -H 'content-type: application/json' \
     -d '{"tags":["Account:acct-1001"]}'
# {"purgedKeys":2,"purgedTags":1,"keys":["subgraph:accounts:/accounts/acct-1001",
#                                        "subgraph:policies:/accounts/acct-1001/policies"]}
```

Purging `Account:acct-1001` drops the accounts **and** policies entries but leaves
the funds entries alone — the next query re-fetches only what was invalidated.

In a real deployment you would call `/purge` from whatever writes the data (an
event consumer, a CDC stream, the REST service's own write path). The management
port is deliberately separate from the GraphQL port so it can stay internal.

## Verify everything at once

```bash
npm run tagcache:test        # scripts/run-tag-cache-test.sh
```

Clean slate → build → cold query (with a `MONITOR` capture) → warm query → purge
by tag → re-query, with 13 assertions and a written report
(`tag-cache-test-report.txt`, full trace in `tag-cache-monitor.txt`).

## Caveats

- **Stale tag members.** Purging `Account:acct-1001` deletes that SET, but the
  same key may still be listed in `tag:Account`. Harmless — a later purge of
  `Account` just `DEL`s keys that no longer exist — and the SET expires on its
  own after `TAG_INDEX_TTL`.
- **Cache-aside, not write-through.** Nothing invalidates automatically; the mock
  REST APIs are read-only. TTL is the backstop.
- **Per-route, not per-field.** Two GraphQL queries selecting different fields of
  the same account share one cache entry (the whole REST payload). That is the
  point — the cache sits at the REST boundary, not the GraphQL one.
- **No request coalescing.** N concurrent misses for the same key make N REST
  calls. Fine for a demo; add a single-flight map if you take this further.
- **Cache outages degrade, not fail.** If Valkey is down, `redis.status !== "ready"`
  and every call falls through to REST.
