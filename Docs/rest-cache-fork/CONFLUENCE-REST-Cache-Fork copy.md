# Cache-Tag Based Invalidation for REST-Backed Fields (Forked `rest` Extension)

> **Repository:** `rest-demo` · branch `feature/cache-tagging-rest-cached-fork-extension`
> **Status:** Implemented and verified end-to-end locally (17/17 automated assertions)
> **Command reference:** [`manualTestingCmds.md`](./manualTestingCmds.md) · **Demo runbook:** [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) · **Usage guide:** [`Docs/EXTENSION-CACHE.md`](../EXTENSION-CACHE.md) · **Extension README:** [`extensions/rest-cached/README.md`](../../extensions/rest-cached/README.md)

---

## Overview

Our REST services (accounts, policies, funds) are updated by systems that never
go through Grafbase. When that data changes, the cached copy served by the
gateway needs to be removed **immediately and by name** — not whenever a TTL
happens to lapse.

Grafbase does not provide a cache-tag or selective-invalidation mechanism out of
the box. To achieve this, we **forked the official Grafbase `rest` resolver
extension** and added our own Rust code to cache each REST response in
Valkey/Redis under a deterministic, human-readable key, together with a **tag
index** that lets us (or any external system) delete exactly the cache entries
tied to one entity:

```
rest:funds:/funds/fund-green-bond
tag:Fund:fund-green-bond
```

```bash
valkey-cli DEL "rest:funds:/funds/fund-green-bond"
```

The cache lives inside the gateway process, in the extension's WebAssembly
sandbox. Onboarding another REST API is a config change in `grafbase.cached.toml`,
not new code.

## Problem Statement

As a platform engineer, we need REST-backed GraphQL fields to be cached, and we
need a way to invalidate **one specific entity's** cached data on demand — a
"cache tag" capability.

Grafbase's built-in `[entity_caching]` does not support this:

| # | Blocker | Consequence |
|---|---|---|
| 1 | Its key is `blake3("v1" ‖ subgraph ‖ every request header ‖ scopes ‖ entity representation)` | Not reconstructible outside the gateway. Two clients differing only in a header produce two cache entries for the same entity. |
| 2 | The stored value holds only the **fields that were selected** — the entity id lives in the hashed key, not the body | Nothing to scan-and-match on for invalidation. |
| 3 | One logical entity maps to **one cache entry per field-selection shape** | `fund { id name }` and `fund { isin riskRating }` are separate entries. |
| 4 | The cache interface is `get` + `put` only. **No delete, no tag, no purge API** | Its entire config surface is `enabled`, `ttl`, `storage`, `redis.url`, `redis.key_prefix`, `redis.tls`. |

We also checked the other extension points and confirmed none of them help:

- **Hooks extensions** (`on_request` / `on_response`) only read/modify headers
  and drain an audit event queue — they never see a REST or subgraph fetch and
  cannot return a cached response.
- **`host_io::cache`** in the extension SDK is a per-gateway, in-process
  key-value store with `get_or_insert*` and **no delete**.
- **There is no Redis client in the SDK.** `host_io` exposes `http`, `postgres`,
  `grpc`, `kafka`, `nats`, `logger`, `event_queue` — no Redis.

**Conclusion:** the only place we control that sees the raw REST response, per
resource, is the `rest` extension itself — so that is where we built caching
with tag-based invalidation.

## Solution Implemented

We forked the upstream [`extensions/rest`](https://github.com/grafbase/extensions/tree/main/extensions/rest)
(Apache-2.0) and added a caching layer:

| File | Status | Lines |
|---|---|---|
| `src/lib.rs` | upstream + 3 marked `--- cache ---` edits | 313 |
| `src/cache.rs` | **new** — everything the cache-tag feature needed | 458 |
| `src/types.rs` | upstream, untouched | 85 |
| `definitions.graphql` | upstream, untouched (must be vendored with the fork or the built manifest carries no directive SDL) | 107 |

`cache.rs` has four parts, no third-party crates beyond `serde`:

1. **Config types** — `CacheSettings`, per-endpoint TTL overrides, tag rules.
2. **Key building** — `rest:<endpoint-name>:<url-path>`, built from the REST
   endpoint's own request, before the `@rest` `selection` jq filter runs — so
   every GraphQL field-selection shape over one resource shares the same entry.
3. **Path-template matcher** — `"/funds/{id}"` matches `/funds/fund-green-bond`
   and captures `{id}` for interpolation into tag names. A deliberate ~30-line
   hand-rolled matcher instead of pulling in `regex`, to keep the wasm binary
   small.
4. **A minimal RESP2 client over `std::net::TcpStream`** — `GET`, `SET … EX`,
   `SADD`, `EXPIRE`, pipelined, with its own buffered reader. There is no Redis
   client in the SDK, so we wrote our own. This was the one unproven part of
   the plan going in, and it works: extensions are WASI Preview 2 components
   and the gateway grants real TCP sockets when `networking = true`, including
   DNS resolution inside the sandbox (`redis://valkey:6379` resolves in Docker).

The three integration seams in `lib.rs`:

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
extension behaves **exactly like upstream** — a safe drop-in. The manifest
keeps the upstream identity (`rest` 0.5.2), so `schema.graphql`'s existing
`@link(url: "https://grafbase.com/extensions/rest/0.5.2")` resolves unchanged;
only the `path` in `grafbase.cached.toml` points at our build.

**Failure policy:** cache-aside and strictly best-effort. Any Redis error drops
the connection and the request falls through to the real REST call — a cache
outage costs latency, never correctness.

### Cache configuration used

From [`grafbase.cached.toml`](../../grafbase.cached.toml):

```toml
[extensions.rest]
path = "grafbase_extensions/rest-cached/build"
networking = true      # REQUIRED — WASI HTTP for REST, TCP sockets for Redis
stderr = true           # lets [rest-cache] HIT/MISS/SET reach the gateway logs

[extensions.rest.config.cache]
url = "redis://redis:6379"
key_prefix = "rest"     # keys look like rest:funds:/funds/fund-green-bond
ttl = 120                # default TTL in seconds; 0 disables the cache
debug = true
# tag_ttl defaults to 2x the longest endpoint ttl below, so a shared tag index
# can never expire while an entry it points at is still cached.

[extensions.rest.config.cache.endpoints.funds]
ttl = 300                # reference data, slow-moving
[extensions.rest.config.cache.endpoints.policies]
ttl = 30                 # churns fastest
[extensions.rest.config.cache.endpoints.accounts]
ttl = 120

# Reverse index: tag -> the cache keys carrying that entity, so one purge can
# drop several routes at once. First matching rule wins — list specific routes
# before general ones.
[[extensions.rest.config.cache.tags]]
path = "/accounts/{id}/policies"
tags = ["Account:{id}", "Policy"]

[[extensions.rest.config.cache.tags]]
path = "/funds/{id}"
tags = ["Fund", "Fund:{id}"]

[[extensions.rest.config.cache.tags]]
path = "/accounts/{id}"
tags = ["Account", "Account:{id}"]
```

Full file (all endpoints and tag rules): [`grafbase.cached.toml`](../../grafbase.cached.toml).
Current TTLs: accounts 120s, policies 30s, funds 300s, tag index 600s (default).

**Gateway entity caching is deliberately OFF** in this config. Left enabled it
sits *in front of* our extension cache and keeps serving its own opaque,
un-purgeable copy for up to its TTL after we invalidate — defeating the whole
mechanism.

## Project Architecture / Flow

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

Reads flow through a cache whose keys we generate and can reconstruct from an
entity id. Invalidation is a **separate path** that never has to involve the
gateway — a `DEL` or a tag purge against Valkey is enough.

This configuration uses **one** virtual subgraph in which accounts, policies
and funds are all resolved by the extension
([`schema-gen/schema.generated.graphql`](../../schema-gen/schema.generated.graphql)),
where `@lookup`/`@derive` fan `fundHoldings` out into one `GET /funds/{id}` per
fund — which is exactly what yields one cache key per fund rather than one per
query.

## How the Project Works

1. A client sends a GraphQL query touching one or more `@rest` fields.
2. The extension resolves the REST endpoint and path for that field and builds
   a cache key: `rest:<endpoint>:<path>[?query]`.
3. **On a HIT**, the cached raw REST response bytes are returned straight away
   — the REST API is never called.
4. **On a MISS**, the extension calls the REST API (`http::execute`), then
   pipelines a `SET … EX <ttl>` for the response plus `SADD`/`EXPIRE` for every
   tag configured for that path, in a single round trip to Valkey.
5. The cached/fetched raw response is passed through the `@rest` field's `jq`
   `selection` **after** the cache lookup — so different GraphQL selections
   over the same resource share one cache entry instead of creating a new one
   each time.
6. **Invalidation** happens entirely outside the gateway: `DEL` one key, or
   resolve a tag (e.g. `tag:Fund:fund-green-bond`) to its member keys with
   `SMEMBERS` and remove them with `UNLINK`/`DEL`.

## What is Grafbase Caching? (Operation vs Entity)

Grafbase Gateway ships two built-in caches, both usable with a memory or Redis
backend:

- **Operation caching** — stores the **query plan** for a given operation
  document. Speeds up parse/validate/plan on repeat queries; does not cache
  response data.
- **Entity caching** (`[entity_caching]`) — stores **subgraph fetch responses**
  when the gateway resolves `@key` entities across subgraph boundaries. This is
  Grafbase's closest built-in feature to what we needed — but as covered in
  [Problem Statement](#problem-statement), its keys are opaque hashes with no
  delete/tag/purge API, so it cannot do selective, external invalidation.

Neither built-in cache gave us a tag mechanism, which is why **`rest-cached`
adds a third, custom cache layer inside the extension itself** — one Grafbase
does not offer natively. It is unrelated to, and safe to run alongside,
whichever built-in caches a given topology uses; in this config we turn entity
caching off so it cannot shadow the extension cache with stale, un-purgeable
data (see [Limitations](#limitations--known-considerations)).

Both built-in caches are features of the production `grafbase-gateway` binary;
`grafbase dev` ignores all caching, including ours — the extension only runs
inside the built gateway.

## Key Benefits

- **Cache-tag invalidation, which Grafbase does not provide natively** — delete
  one entity's cache entries by tag (`tag:Fund:fund-green-bond`) instead of
  waiting out a TTL.
- **Readable, deterministic keys** — `rest:<endpoint>:<path>` can be
  reconstructed by anyone holding the entity id; no need to know GraphQL.
- **One cache entry per resource, not per query shape** — fixes the built-in
  entity cache's biggest limitation, since the raw REST response is cached
  before the `jq selection` runs.
- **Tags span multiple REST endpoints** — e.g. `tag:Account:acct-1001` covers
  both the account entry and its policies entry, so one purge invalidates
  related data across services.
- **Config-driven onboarding** — a new REST API needs entries in
  `grafbase.cached.toml`, not new Rust code.
- **Fail-open safety** — any Redis error falls through to the real REST call;
  a cache outage costs latency, not correctness.
- **Minimal footprint, portable core** — `cache.rs` depends only on `std` and
  `serde`, no `grafbase-sdk` — it ports to a different host with just the three
  call sites in `lib.rs` re-pointed (see [Limitations](#limitations--known-considerations)).

## Official References

- REST extension (upstream we forked) — https://grafbase.com/extensions/rest
- Entity Caching — https://grafbase.com/docs/gateway/performance/entity-caching
- Operation Caching — https://grafbase.com/docs/gateway/configuration/operation-caching
- Extension SDK / `host_io` — https://grafbase.com/docs/extensions
- Gateway Docker deployment — https://grafbase.com/docs/gateway/deployment/docker
- Valkey ↔ Redis migration — https://valkey.io/topics/migration/
- Redis command reference (`SET`, `SADD`, `EXPIRE`, `SMEMBERS`, `UNLINK`) — https://redis.io/commands/

## Future Scope

1. **Wire a real invalidator.** Today invalidation is a manual `DEL`/tag purge
   run by hand. The production shape is a small consumer of the upstream
   change stream (CDC / queue / webhook) that maps a changed entity id to its
   tag (`tag:Fund:{id}`) and issues `SMEMBERS` + `UNLINK` automatically.
2. **Header scoping**, if this cache ever fronts per-user data (see
   [Limitations](#limitations--known-considerations)).
3. **Single-flight on miss**, to collapse concurrent identical fetches for the
   same key into one REST call.
4. **TLS/AUTH support**, by trying `redis-rs` on `wasm32-wasip2` — a smaller
   bet now that raw sockets from inside the wasm sandbox are proven to work.
5. **Migration spike** — port `cache.rs` to whatever makes the REST call in a
   future router, and measure what carries over unchanged (see
   [Limitations](#limitations--known-considerations)).

## Limitations / Known Considerations

**Security — read before production.** Cache keys are **not header-scoped**.
The built-in entity cache hashes every request header into its key precisely so
two users can't share an entry; this cache does not. That's fine for a static,
per-service API key, and **wrong for per-user tokens**, where all users would
share one cache entry. Scoping would mean folding selected headers into the key
and giving up the one-key-per-URL property that makes invalidation simple.

| Limit | Detail |
|---|---|
| `GET` only, empty body only | Anything else bypasses the cache entirely. |
| No request coalescing | N concurrent misses for one key make N REST calls. |
| No TLS / AUTH / cluster | Plain `redis://` only. Under Redis Cluster, a key and its tag set can land in different slots, breaking `SMEMBERS`+`DEL` atomicity — a hash tag in `key_prefix` would fix this if it becomes real. |
| Stale tag members | Deleting a key does not remove it from other `tag:*` sets. Harmless: a later purge just deletes keys that are already gone, and the set itself expires via `tag_ttl`. |
| Cache-aside, not write-through | Nothing invalidates automatically today — TTL is the backstop until Future Scope item 1 is built. |
| Gateway dependency | The extension, and therefore this cache, only runs inside the production `grafbase-gateway` binary — not `grafbase dev`. |

We also intentionally keep `src/cache.rs` free of any `grafbase-sdk` dependency
(only `std` + `serde`), so the key scheme, tag index, path-template matcher and
RESP client are not locked to this specific gateway and can be ported to
whatever makes the REST call next.

## Summary

Grafbase has no native cache-tag or selective-invalidation capability — the
built-in Entity Cache is TTL-only, keyed by an opaque hash with no delete API.
To meet the requirement of invalidating one entity's cached REST data on
demand, we **forked the official `rest` extension and added our own Rust
caching layer** (`src/cache.rs`, ~458 lines) that stores raw REST responses in
Valkey/Redis under readable, deterministic keys and maintains a **tag index**
(`tag:<Type>`, `tag:<Type>:<id>`) built from config rules in
`grafbase.cached.toml`. This gives any external system a plain `DEL` or tag
purge as its invalidation mechanism — no purge service, no GraphQL knowledge
required. The approach is verified end-to-end with 17 automated assertions
(`npm run cached:test`) plus manual Valkey CLI walkthroughs (see
[`manualTestingCmds.md`](./manualTestingCmds.md)), and is documented with clear
limitations — notably that keys are not header-scoped and are therefore only
safe for shared/service-level REST data today, not per-user data.
