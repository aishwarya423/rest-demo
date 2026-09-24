# POC: Cache Key Visibility & Valkey Entity Tagging

> **Branch:** `feature/cache-tagging-rest-cached-fork-extension`
> **Status:** Implemented and verified locally (17/17 automated checks in `scripts/test-cached-extension.sh`)
> **Related docs:** `Docs/EXTENSION-CACHE.md` · `Docs/rest-cache-fork/DEMO-SCRIPT.md` · `Docs/rest-cache-fork/manualTestingCmds.md` · `extensions/rest-cached/README.md`

---

## Overview

This POC answers one question: **can we see our cache keys in Valkey, and delete the cached data for a single entity (for example one fund) on demand?**

Grafbase's built-in cache can't do this. We added our own caching to the Grafbase REST extension, so that:

- every cached REST response has a **readable key**, e.g. `rest:funds:/funds/fund-green-bond`
- every entry is also added to **entity tags**, e.g. `tag:Fund:fund-green-bond`
- one entity, or a whole entity type, can be cleared with a single Valkey command

---

## Problem Statement

Our REST services (accounts, policies, funds) are updated by systems that don't go through Grafbase. When that data changes, the cached copy needs to be removed **straight away**, without waiting for a TTL to expire.

The earlier spike (`Docs/spikes/1_entityCacheTagInvalidation_verdictAug.md`) found that Grafbase's built-in entity cache can't support this:

| Issue | What it means |
|---|---|
| Keys are hashes, e.g. `insurance-entitycache-2c295b92…` | We can't tell which entity a key belongs to, and we can't rebuild the key outside the gateway |
| The hash includes every request header | The same fund can end up with many different keys |
| The cached value has no entity id in it | We can't find the right entry by searching values |
| Only `get` and `put`, with no delete, tag or purge | There's no built-in way to invalidate |

The spike recommended moving the cache to the point where the REST call is made, which we control. This POC does that.

---

## Solution Implemented

We forked the official Grafbase `rest` extension (Apache-2.0) into `extensions/rest-cached/` and added a Valkey/Redis cache to it.

**1. How cache keys are generated**

The key is built from the REST endpoint name and the URL path:

```
<key_prefix>:<@restEndpoint name>:<URL path>[?query]
rest:funds:/funds/fund-green-bond
rest:accounts:/accounts/acct-1001
rest:policies:/accounts/acct-1001/policies
```

- **Readable and predictable:** if you know the fund id, you know its key.
- **One key per resource:** we store the raw REST response *before* the GraphQL field selection is applied. So `fund { id name }` and `fund { isin riskRating }` use the **same** key.

**2. How payloads and tags are stored in Valkey**

| Valkey key | Type | Holds | TTL |
|---|---|---|---|
| `rest:<endpoint>:<path>` | String | Raw REST JSON response | Per endpoint (30–300 s) |
| `tag:<Entity>` (e.g. `tag:Fund`) | Set | All cache keys for that entity type | 600 s |
| `tag:<Entity>:<id>` (e.g. `tag:Fund:fund-green-bond`) | Set | All cache keys for that one entity | 600 s |

When the cache misses, the payload and its tags are written together in one round trip:

```
SET    rest:funds:/funds/fund-green-bond <json> EX 300
SADD   tag:Fund                 rest:funds:/funds/fund-green-bond
EXPIRE tag:Fund                 600
SADD   tag:Fund:fund-green-bond rest:funds:/funds/fund-green-bond
EXPIRE tag:Fund:fund-green-bond 600
```

**3. How routes map to tags**

Tag rules in `grafbase.cached.toml` match the URL path and use `{id}` from it. The first matching rule wins. One tag can point to keys from **different services**. For example, `tag:Account:acct-1001` holds both the accounts entry and the policies entry for that account.

**4. How invalidation uses the tags**

Invalidation is done directly in Valkey. It doesn't go through the gateway.

```bash
# One entry
valkey-cli DEL "rest:funds:/funds/fund-green-bond"

# Everything tagged Fund, in one call
valkey-cli EVAL 'local ks=redis.call("SMEMBERS",KEYS[1]); if #ks>0 then redis.call("DEL",unpack(ks)) end; redis.call("DEL",KEYS[1]); return #ks' 1 tag:Fund
```

> **Note on `server.js`:** all caching logic is in the extension. The mock REST APIs (`mock-rest-apis/*/server.js`) are unchanged and just serve data.

### Cache configuration used

From `grafbase.cached.toml`:

```toml
[extensions.rest]
path = "grafbase_extensions/rest-cached/build"
networking = true        # needed for REST calls and the Valkey connection
stderr = true            # shows [rest-cache] HIT/MISS/SET in gateway logs

[extensions.rest.config.cache]
url = "redis://redis:6379"   # replaced with REDIS_URL (redis://valkey:6379) at startup
key_prefix = "rest"
ttl = 120                    # default TTL (seconds)
debug = true
# tag_ttl defaults to 2x the longest endpoint TTL = 600s

[extensions.rest.config.cache.endpoints.funds]
ttl = 300
[extensions.rest.config.cache.endpoints.policies]
ttl = 30
[extensions.rest.config.cache.endpoints.accounts]
ttl = 120

[[extensions.rest.config.cache.tags]]
path = "/funds/{id}"
tags = ["Fund", "Fund:{id}"]
# ...plus rules for /accounts/{id}, /policies/{id}, /accounts/{id}/policies,
#    /customers/{id}/accounts, /funds/{id}/policies and the list routes
```

| Setting | Value |
|---|---|
| Cache backend | Valkey `valkey/valkey:8-alpine` (Redis 7 also works via `CACHE_IMAGE`) |
| Stack | `docker-compose.cached.yml`: 3 mock REST APIs + Valkey + gateway on `:5065` |
| TTLs | accounts 120 s · policies 30 s · funds 300 s · tag sets 600 s |
| Gateway entity caching | **Off** in this config (see below) |
| Gateway operation caching | **Off** in this config |

---

## Project Architecture / Flow

```
GraphQL query
   │
   ▼
Grafbase Gateway (:5065)
   │
   ▼
rest-cached extension ── builds key: rest:funds:/funds/fund-green-bond
   │
   ├─ GET key in Valkey ── HIT ──► return cached response (REST not called)
   │
   └─ MISS ──► call REST API ──► SET payload + SADD tag sets ──► return response

Valkey
   ├─ rest:funds:/funds/fund-green-bond      (payload)
   └─ tag:Fund:fund-green-bond → { keys }    (tag index)
        ▲
        └── DEL / tag purge from any external system
```

---

## How the Project Works

| File | Role |
|---|---|
| `extensions/rest-cached/src/cache.rs` | **New.** Cache config, key building, path-to-tag matching, and a small Valkey/Redis client (`GET`, `SET EX`, `SADD`, `EXPIRE`) |
| `extensions/rest-cached/src/lib.rs` | Upstream code plus 3 small edits, each marked `--- cache ---`: load config, check cache before the REST call, store after it |
| `grafbase.cached.toml` | All cache settings: URL, TTLs, tag rules |
| `docker-compose.cached.yml` | Runs the mock REST APIs, Valkey (with volume) and the gateway |
| `docker/cached-gateway-entrypoint.sh` | Adds the Valkey URL to the config, composes the schema, starts the gateway |
| `schema-gen/schema.generated.graphql` | Schema that resolves accounts, policies and funds through the extension (one REST call per fund) |
| `scripts/test-cached-extension.sh` | End-to-end test (`npm run cached:test`) |

**Behaviour to know:**

- Only `GET` requests with no body are cached. Everything else goes straight to REST.
- If Valkey is down or errors, the request just goes to the REST API. You lose speed, but responses stay correct.
- With no `cache` block in the config, the extension behaves exactly like the upstream `rest` extension.

**Useful commands:** `npm run cached:up`, `cached:keys`, `cached:logs`, `cached:monitor`, `cached:test`, `cached:down`

---

## What is Grafbase Caching? (Operation vs Entity)

| | Operation caching | Entity caching |
|---|---|---|
| What it stores | The **query plan** for a GraphQL operation | **Subgraph fetch responses** (data) |
| Stores data? | No | Yes |
| Key format | Internal | `<prefix>-<blake3 hash>` (not readable) |
| Can we delete one entity? | Not applicable | No: no delete or tag support |
| Covers REST-extension fields? | n/a | No: only real GraphQL subgraph calls |

**What this POC uses:** neither. It uses **extension-level caching**: the forked `rest` extension caches REST responses in Valkey using keys and tags we control.

Gateway entity caching is **turned off** in `grafbase.cached.toml`. If it were on, it would sit in front of our cache and keep serving its own copy after we invalidate. Operation caching is also off here, so that Valkey only shows our own keys. The original setup with both gateway caches (`grafbase.toml`) is still in the repo and still works.

---

## Key Benefits

- **Cache key visibility:** keys are readable (`rest:funds:/funds/fund-green-bond`) and easy to list with `valkey-cli --scan`.
- **Entity-based tagging:** each entry is tagged by entity type and id (`tag:Fund`, `tag:Fund:fund-green-bond`), set up in config.
- **Targeted invalidation:** you can delete one entity, or all entries of a type, without touching anything else.
- **Reproducibility:** one command (`npm run cached:test`) starts from a clean slate and checks everything.
- **Debugging / observability:** `[rest-cache] HIT/MISS/SET` log lines and `valkey-cli MONITOR` show exactly what happens.
- **Separate payload keys and tag indexes:** data lives in `rest:*` strings, and relationships live in `tag:*` sets.
- **Config-driven:** a new REST API only needs TTL and tag entries in the TOML. No code changes.

---

## Official References

- Grafbase REST extension: https://grafbase.com/extensions/rest
- Grafbase entity caching: https://grafbase.com/docs/gateway/configuration/entity-cache
- Grafbase operation caching: https://grafbase.com/docs/gateway/configuration/operation-caching
- Grafbase extensions configuration: https://grafbase.com/docs/gateway/configuration/extensions
- Building a resolver extension: https://grafbase.com/guides/implementing-a-gateway-resolver-extension
- Upstream extension source: https://github.com/grafbase/extensions/tree/main/extensions/rest
- Valkey: https://valkey.io/
- Redis/Valkey commands (`SET`, `SADD`, `SMEMBERS`, `EXPIRE`, `DEL`): https://redis.io/commands/

---

## Future Scope

1. **Invalidation API / service:** today invalidation is a manual `valkey-cli` command. The next step is a small service that listens for data changes (CDC, queue or webhook) and clears `tag:<Entity>:<id>`.
2. **Invalidate by entity/tag in production:** use `SMEMBERS` + `UNLINK` (non-blocking) instead of `DEL` when volumes are high.
3. **More entities:** add tag rules as new REST APIs are onboarded.
4. **Automation / testing:** run `cached:test` in CI.
5. **Production hardening:** TLS/AUTH for Valkey, header-scoped keys if per-user data is ever cached, and request coalescing on cache misses.
6. **Router migration:** `cache.rs` has no Grafbase SDK dependency, so it can be ported to the next router (e.g. Hive Router).

---

## Limitations / Known Considerations

| Limitation | Detail |
|---|---|
| Keys aren't per user | Safe for static service API keys. **Not** safe for per-user tokens, because all users would share one entry. |
| `GET` only | `GET` requests with a body, and non-`GET` requests, aren't cached. |
| No TLS / AUTH / cluster | Only plain `redis://` is supported. |
| No request coalescing | Several misses at once for the same key each call REST. |
| Stale tag members | Deleting a key doesn't remove it from other tag sets. This is harmless, and the sets expire after 600 s. |
| No automatic invalidation | Invalidation is manual. TTL is the fallback. |
| Grafbase Gateway is end-of-life | Grafbase was acquired by The Guild, and the Gateway is being archived. The cache logic is kept portable to reduce this risk. |
| Local POC only | The mock REST APIs must be running. On a cold cache, queries fail if they're down. |

---

## Summary

The POC shows that we can have **readable cache keys** and **entity-based invalidation** in Valkey. It does this by adding caching to a fork of the Grafbase `rest` extension instead of using the gateway's built-in cache. Each REST response is stored under a readable key and indexed in tag sets per entity. That means a single fund, or every fund, can be cleared with one Valkey command. The automated test passed all 17 checks. These cover readable keys, one key per resource, warm queries served fully from cache, and single-key and tag-based invalidation.

---

## Jira Acceptance Criteria Mapping

| Acceptance Criteria | Implementation / Evidence | Status |
|---|---|---|
| 1. Check whether Grafbase has native cache tag functionality | It doesn't: no `@cacheTag`, and the cache only has `get`/`put`. See the spike doc. | ✅ Done |
| 2. Find out how entity cache entries are stored in Valkey | Plain strings, key = `<prefix>-<blake3>`, no index. Confirmed from keyspace dumps. See the spike doc. | ✅ Done |
| 3. Confirm whether entity cache keys can be accessed or configured | Only the prefix can be configured. Keys include request headers, so they can't be rebuilt outside the gateway. | ✅ Done |
| 4. Evaluate a custom way to map entities to tags | Tag rules in `grafbase.cached.toml`, stored as `tag:<Entity>` / `tag:<Entity>:<id>` Sets (`cache.rs`) | ✅ Done |
| 5. Check that a custom invalidator can safely clear targeted entries | Test: `DEL` on one fund key → only that fund misses and the others stay cached. A tag purge clears all `Fund` entries. | ✅ Done |
| 6. Document findings, limitations and recommended approach | This page, `Docs/EXTENSION-CACHE.md`, `Docs/rest-cache-fork/*`, `extensions/rest-cached/README.md` | ✅ Done |
| 7. Check Grafbase's Valkey data structures (SET / ZSET) | Grafbase uses only Strings (no SET/ZSET). The POC uses **Strings** for payloads and **SETs** for tag indexes. ZSET isn't needed. | ✅ Done |

---

## Deliverables Completed

| Deliverable | Where |
|---|---|
| Review Grafbase docs and source for tag-like features | `Docs/spikes/1_entityCacheTagInvalidation_verdictAug.md` |
| Inspect how Valkey stores the entity cache | Spike doc (keyspace dumps), `Docs/ENTITY-CACHING-WHY-NOOP.md` |
| Find out how entity cache keys are generated | Spike doc (key derivation section) |
| Investigate invalidation options | Spike doc and "Problem Statement" above |
| Try cache-tag behaviour outside Grafbase's native features | `extensions/rest-cached/` (fork), `grafbase.cached.toml`, `docker-compose.cached.yml` |
| Recommend an approach, with evidence | This page + `scripts/test-cached-extension.sh` (17/17 pass) + `Docs/rest-cache-fork/DEMO-SCRIPT.md` |
