# REST response caching with tag-based invalidation (forked `rest` extension)

> **Jira Story:** `<PROJECT-KEY>` — Cache invalidation for REST-backed fields on the Grafbase Gateway
> **Status:** Implemented · verified end-to-end locally (17/17 automated assertions)
> **Owner:** `<team / author>`
> **Repository:** `<repo URL>` · branch `feature/entity-caching-testing`
> **Last updated:** 9 Sep 2026
> **Implements:** the recommendation in [`Docs/spikes/1_entityCacheTagInvalidation_verdictAug.md`](../spikes/1_entityCacheTagInvalidation_verdictAug.md) §7 — *"move the cache one layer down, to the REST-fetch boundary you control."*
> **Demo runbook:** [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) · **Command reference:** [`manualTestingCmds.md`](./manualTestingCmds.md) · **Usage guide:** [`Docs/EXTENSION-CACHE.md`](../EXTENSION-CACHE.md)

---

## Overview

Data in our REST services is changed by systems that never touch Grafbase. When a
fund is updated, the cached copy in Valkey has to go — immediately, by name, not
when a TTL happens to lapse.

The August spike established that this is **structurally impossible** against the
Grafbase Gateway's built-in Entity Cache. This story implements the alternative
the spike recommended: a **fork of the official Grafbase `rest` resolver
extension** that caches each REST response in Valkey/Redis under a key derived
from the REST URL:

```
rest:funds:/funds/fund-green-bond
```

Invalidation is then a one-line operation that any external system can perform,
with no knowledge of GraphQL, no purge service, and no bespoke sidecar:

```bash
valkey-cli DEL "rest:funds:/funds/fund-green-bond"
```

The cache lives **inside the gateway process**, in the extension's WebAssembly
sandbox. Adding another REST API later is a configuration change, not code.

---

## Problem statement

### What the built-in Entity Cache does

`[entity_caching]` stores subgraph fetch responses in Redis. Its keys look like
this, from our own keyspace dump:

```
insurance-entitycache-2c295b92553f5d5d54d4f2e3aa165eb83609fb2249b7a85a6bbfc314d5c0d0fb
  value: {"name":"Green Bond Income","currency":"GBP"}
```

### Why that cannot be invalidated

Four independent blockers, each sufficient on its own:

| # | Blocker | Consequence |
|---|---|---|
| 1 | The key is `blake3("v1" ‖ subgraph ‖ **every request header** ‖ scopes ‖ entity representation)` | Not reconstructible out-of-band. Two clients differing only in `user-agent` produce two entries for the same fund. |
| 2 | The stored value contains **only the fields that were selected** — the id is in the hashed key, not the body | Scan-and-match invalidation has nothing to match on. |
| 3 | One logical entity maps to **one entry per field selection** | `fund { id name }` and `fund { isin riskRating }` are separate entries. |
| 4 | The cache interface is `get` + `put`. **There is no delete**, no tag, no purge API | Configuration surface is `enabled`, `ttl`, `storage`, `redis.url`, `redis.key_prefix`, `redis.tls`. That is all of it. |

### Why the extension points don't help either

- **Hooks extensions** expose `on_request` and `on_response` only. They read and
  modify headers and drain an audit event queue. They never see a subgraph or
  REST fetch, cannot short-circuit one, and cannot return a cached response.
- **`host_io::cache`** in the SDK is a per-gateway, in-process key-value store
  with `get_or_insert*` and **no delete**. Useless for external invalidation.
- **There is no Redis client in the SDK.** `host_io` provides `http`, `postgres`,
  `grpc`, `kafka`, `nats`, `logger`, `event_queue` — no Redis.

The conclusion is forced: **the cache must live where the REST call is made**, and
in this stack that is the `rest` extension.

---

## Options evaluated

| Option | Readable keys | Extra hop | New code | Verdict |
|---|---|---|---|---|
| Short TTL only | n/a | no | none | No invalidation. Rejected — doesn't meet the requirement. |
| Blunt prefix flush of `insurance-entitycache-*` | no | no | none | Nukes every entity for every subgraph. Rejected as a primary mechanism. |
| Value-scan and match on entity id | no | no | small | **Impossible** — the id is not in the value (blocker 2). |
| Caching HTTP proxy in front of the REST APIs | yes | **yes** | ~70 lines JS | Viable fallback. Rejected: extra network hop and a second process to run and monitor. |
| **Fork the `rest` extension** | **yes** | **no** | ~460 lines Rust, once | **Chosen.** Covers every `@rest` field, current and future, and is config-driven per API. |

---

## Solution implemented

### Architecture

```
                    reads                             writes
 client ─► Grafbase Gateway ─► rest-cached extension ─► REST services
                                        │  ▲                (accounts,
                                 GET/SET│  │hit              policies,
                                        ▼  │                  funds)
                                   Valkey / Redis
                                   rest:funds:/funds/fund-green-bond
                                   tag:Fund:fund-green-bond ──► { keys }
                                        ▲
                                        │ DEL / SMEMBERS+UNLINK
                              any external writer (CDC, ETL, write API, DBA)
```

Reads flow through a cache whose keys we generate. Invalidation is a **separate
path** that never involves the gateway.

### Cache key design

```
<key_prefix> : <@restEndpoint name> : <URL path>[?query]
rest         : funds                : /funds/fund-green-bond
```

Three properties make this work:

1. **Deterministic and reversible.** Anyone holding a fund id can compute the key.
2. **One key per resource, not per query shape.** The cached entry is the **raw
   REST response**, stored *before* the `@rest` `selection` jq filter runs, so
   every GraphQL selection over that fund shares one entry.
3. **Covers the whole surface.** Accounts, policies and funds all flow through the
   extension — unlike entity caching, which only ever saw funds.

### Tag index

On every cache fill the extension pipelines the entry and its tag memberships in
a single round trip:

```
SET    rest:funds:/funds/fund-green-bond <json> EX 300
SADD   tag:Fund                  rest:funds:/funds/fund-green-bond
EXPIRE tag:Fund                  600
SADD   tag:Fund:fund-green-bond  rest:funds:/funds/fund-green-bond
EXPIRE tag:Fund:fund-green-bond  600
```

Tags come from route rules in `grafbase.toml`, so one purge can span services —
`tag:Account:acct-1001` holds both the accounts entry and the policies entry.

### Topology

This configuration uses **one** virtual subgraph in which accounts, policies *and*
funds are resolved by the extension, using
[`schema-gen/schema.generated.graphql`](../../schema-gen/schema.generated.graphql)
where `@lookup`/`@derive` fan `fundHoldings` out into one `GET /funds/{id}` per
fund — which is precisely what yields one cache key per fund.

The previous arrangement (Fund in its own GraphQL subgraph so the gateway's entity
cache engages) is untouched and still runs from `grafbase.toml` +
`docker-compose.gateway.yml`. The two stacks share ports 3001-3003 and 6379, so
run one at a time.

**Gateway entity caching is disabled here.** Left enabled it sits *in front* of
this cache and keeps serving its own un-purgeable copy for up to its TTL after an
invalidation, which would defeat the entire mechanism. The spike's alternative —
keep it as a short-TTL shock absorber at your maximum tolerable staleness
(30–60 s) — is equally valid; it is off in this config so that demos and the
`MONITOR` trace show exactly one cache.

---

## How it was built

### The fork

Upstream [`extensions/rest`](https://github.com/grafbase/extensions/tree/main/extensions/rest)
(Apache-2.0) is small: 227 lines in `lib.rs`, 85 in `types.rs`. That is what makes
this approach cheap.

| File | Status | Lines |
|---|---|---|
| `src/lib.rs` | upstream + 3 marked edits | 313 |
| `src/cache.rs` | **new** | 458 |
| `src/types.rs` | upstream, untouched | 85 |
| `definitions.graphql` | upstream, untouched | 107 |

Every change in `lib.rs` is marked `--- cache ---` so a future rebase onto
upstream is a mechanical re-apply.

### The three seams

```rust
// 1. state
struct RestExtension { …, cache: Option<RestCache> }

// 2. construction — reads [extensions.rest.config.cache]
cache: RestCache::from_config(&config)?,

// 3. the single HTTP call site in resolve()
let bytes = match cached {
    Some(bytes) => bytes,                       // HIT — REST is never called
    None => {
        let resp = http::execute(request)?;     // upstream path
        let bytes = resp.into_bytes();
        cache.store(&key, &bytes, ttl, &tags);  // SET + SADD/EXPIRE, pipelined
        bytes
    }
};
```

With no `cache` block in the config, `from_config` returns `None` and the
extension behaves **exactly** like upstream. The manifest keeps the upstream
identity (`rest` 0.5.2) so `schema.graphql` needs no change at all — its existing
`@link(url: "https://grafbase.com/extensions/rest/0.5.2")` resolves unchanged and
only the `path` in the TOML points at the fork.

### `cache.rs`

Four parts, no third-party crates beyond `serde`:

1. **Config types** — `CacheSettings`, per-endpoint overrides, tag rules.
2. **Key building** — `rest:<endpoint>:<path>`.
3. **Path-template matcher** — `"/funds/{id}"` matches `/funds/fund-green-bond`
   and captures `{id}` for interpolation into tags. A deliberate ~30-line
   alternative to pulling in `regex`, which keeps the wasm small and the TOML
   readable.
4. **A minimal RESP2 client** — `GET`, `SET … EX`, `SADD`, `EXPIRE`, pipelined,
   with its own buffered reader.

### Redis from inside WebAssembly — the unknown, now resolved

There is no Redis client in the SDK, so the fork speaks RESP2 over
`std::net::TcpStream`. This was the one genuinely unproven part of the plan, and
it **works**: extensions are WASI Preview 2 components, and the gateway grants
real sockets when the extension is configured with `networking = true`.

Verified in both environments, including DNS name resolution from inside the
sandbox (`redis://valkey:6379` resolves in Docker).

Failure policy is cache-aside and strictly best-effort: any Redis error drops the
connection and the request falls through to the REST API. A cache outage costs
latency, never correctness.

---

## Findings worth keeping

1. **`@rest`'s `body` argument has a default value** (`{ selection: ".args.input" }`),
   so `body.is_some()` is **true even for a plain GET**. Gating the cache on it
   silently disabled caching entirely — the first build cached nothing. The body
   must be *rendered* before you can tell whether a request carries one, which is
   why `resolve()` renders it earlier than upstream does.
2. **`EXPIRE … GT` is not the fix for shared tag TTLs.** `GT` treats a key with no
   expiry as infinite and refuses to set one, so the tag index would never expire
   at all. Tag sets instead use one shared `tag_ttl`, defaulting to twice the
   longest endpoint TTL. Without that, the 30 s policies endpoint would reset a
   shared `tag:Account:{id}` to 60 s while the 120 s accounts entry it points at
   is still live — and a purge after that would silently miss it.
3. **Cache before the jq `selection`, not after.** Caching the selected output
   would reintroduce the entity cache's one-entry-per-query-shape problem.
4. **`cargo build` for the host target fails to link** — it is a `cdylib`
   expecting wasm host imports. `cargo test` and `grafbase extension build` are
   the two commands that matter.
5. **`definitions.graphql` must be vendored with the fork.** Without it the built
   manifest carries no directive SDL and composition fails.

---

## Configuration reference

All of it in [`grafbase.cached.toml`](../../grafbase.cached.toml).

```toml
[extensions.rest]
path = "grafbase_extensions/rest-cached/build"
networking = true      # REQUIRED — WASI HTTP for REST, TCP sockets for Redis
stderr = true          # lets [rest-cache] HIT/MISS/SET reach the gateway logs

[extensions.rest.config.cache]
url = "redis://valkey:6379"   # plain redis:// only — no TLS, no AUTH
key_prefix = "rest"
ttl = 120                     # default TTL in seconds; 0 disables the cache
debug = true
# tag_ttl = 600               # defaults to 2x the longest endpoint ttl

[extensions.rest.config.cache.endpoints.funds]     # keyed by @restEndpoint name
ttl = 300
[extensions.rest.config.cache.endpoints.policies]
ttl = 30
# enabled = false             # opt one endpoint out entirely

[[extensions.rest.config.cache.tags]]
path = "/funds/{id}"                 # {name} captures one path segment
tags = ["Fund", "Fund:{id}"]         # …and interpolates into the tags
```

Rules are tried in order and **first match wins**, so list specific routes
(`/accounts/{id}/policies`) before general ones (`/accounts/{id}`).

Current TTLs: accounts 120 s, policies 30 s, funds 300 s, tag index 600 s.

---

## Verification

`npm run cached:test` ([`scripts/test-cached-extension.sh`](../../scripts/test-cached-extension.sh))
runs from a clean slate — down `-v`, rebuild, wait for health — and asserts 17
properties. The interesting ones:

- Keys are readable and **one per fund**, not one per query shape.
- A different field selection reuses the same entries and **creates no new keys**.
- A warm query is served **entirely** from cache — REST is not called.
- The read path really is the cache: the test rewrites a cached fund's name to a
  value the REST API never returns and confirms GraphQL serves it.
- `DEL` on one key causes **exactly one** MISS on the next query; the other funds
  stay cached.
- A tag purge drops every `Fund` entry in one round trip.

Output: `extension-cache-test-report.txt` and a raw `MONITOR` capture in
`extension-cache-monitor.txt` (both gitignored).

Toolchain used: Grafbase Gateway 0.53.5 · CLI 0.105.1 · grafbase-sdk 0.22.3 ·
Rust 1.96.1 (`wasm32-wasip2`) · Valkey 8.1.10 / Redis 7 · wasm artifact 1.8 MB.

---

## Trade-offs, limits and risks

**Security — read this before production.** Cache keys are **not header-scoped**.
The gateway's entity cache hashes every request header into its key precisely so
that two users cannot share an entry; this cache does not. That is safe for a
static per-service API key and **wrong for per-user tokens**, where all users
would share one entry. Scoping would mean folding selected headers into the key
and giving up the one-key-per-URL property that makes invalidation simple.

| Limit | Detail |
|---|---|
| `GET` only, empty body only | Anything else bypasses the cache entirely. |
| No request coalescing | N concurrent misses for one key make N REST calls. |
| No TLS / AUTH / cluster | Plain `redis://` only. Under Redis Cluster a key and its tag set can land in different slots, breaking `SMEMBERS`+`DEL` atomicity — use a hash tag in `key_prefix` if that becomes real. |
| Stale tag members | Deleting a key does not remove it from other `tag:*` sets. Harmless: a later purge deletes keys that are already gone, and the set expires by `tag_ttl`. |
| Cache-aside, not write-through | Nothing invalidates automatically. TTL is the backstop. |

**Runtime risk — Grafbase Gateway is end-of-life.** The Guild acquired Grafbase in
February 2026 and the Gateway, CLI and repository were slated for archival by end
of May 2026. The spike correctly weighted router-independence as a decisive
property, and an in-gateway extension is by definition not router-independent.

The mitigation is deliberate: **`src/cache.rs` has no dependency on
`grafbase-sdk`** — only `std` and `serde`. The key scheme, tag index, path-template
matcher and RESP client port to whatever makes the REST call next (Hive Router
plugin, a sidecar proxy, a service-layer client) by re-pointing three call sites.
The Grafbase-specific surface is confined to the three marked seams in `lib.rs`.

---

## Files

| Path | What |
|---|---|
| `extensions/rest-cached/` | the fork — `src/cache.rs`, patched `src/lib.rs`, [README](../../extensions/rest-cached/README.md) |
| `grafbase_extensions/rest-cached/build/` | built wasm + manifest (committed) |
| `grafbase.cached.toml` | gateway config incl. the whole cache configuration |
| `docker-compose.cached.yml` | stack: 3 REST mocks + Valkey + gateway on `:5065` |
| `docker/cached-gateway-entrypoint.sh` | path/Redis-URL rewrite, compose, launch |
| `scripts/test-cached-extension.sh` | 17-assertion end-to-end verification |
| `Docs/EXTENSION-CACHE.md` | usage guide, config reference, invalidation recipes |
| `Docs/rest-cache-fork/DEMO-SCRIPT.md` | presenter runbook |

npm scripts: `cached:build`, `cached:up`, `cached:down`, `cached:logs`,
`cached:keys`, `cached:monitor`, `cached:test`.

---

## Future work

1. **Wire a real invalidator.** Today invalidation is a manual `DEL`. The
   production shape is a small consumer of the change stream (CDC / queue /
   webhook) that maps an entity id to `tag:Fund:{id}` and issues
   `SMEMBERS` + `UNLINK` (non-blocking, preferred over `DEL` at volume).
2. **Header scoping**, if this ever fronts per-user data.
3. **Single-flight** on miss, to collapse concurrent identical fetches.
4. **TLS/AUTH**, by trying `redis-rs` on `wasm32-wasip2` — a much smaller bet now
   that raw sockets are proven to work.
5. **Migration spike** — port `cache.rs` to the Hive Router equivalent and measure
   what actually carries over.
