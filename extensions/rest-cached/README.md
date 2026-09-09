# `rest-cached` — the Grafbase `rest` extension, with an invalidatable cache

A fork of the official [`rest` resolver extension](https://github.com/grafbase/extensions/tree/main/extensions/rest)
(Apache-2.0) that caches REST responses in Redis/Valkey under **keys you can read
and delete**:

```
rest:funds:/funds/fund-green-bond
```

## Why fork at all

The gateway's own entity cache is TTL-only. Its keys are
`<prefix>-<blake3 of the subgraph fetch>`, the entity id does not appear in the
key *or* reliably in the value, and one entity produces a different key for every
GraphQL field selection. Nothing outside the gateway can name the entry to drop.
No hook or config changes that: hooks (`on_request` / `on_response`) only see
headers and an audit event queue, and the SDK's own `host_io::cache` has
`get_or_insert*` but **no delete**.

The extension, on the other hand, is the code that makes the REST call. Cache
there and the key can be the URL — which is stable across query shapes and
trivially targetable by any system that changes the data.

## What actually changed

Three edits to upstream, all marked `--- cache ---` in `src/lib.rs`:

| | |
|---|---|
| `struct RestExtension` | one field: `cache: Option<RestCache>` |
| `new()` | `RestCache::from_config(&config)?` — reads `[…config.cache]` |
| `resolve()` | the single `http::execute` call is wrapped in read-through cache logic |

Plus `src/cache.rs` (new): config types, the URL→key/tag mapping, and a minimal
RESP2 client. `src/types.rs` and `definitions.graphql` are upstream, untouched.

With no `cache` config the extension behaves **exactly** like upstream, so the
fork is a drop-in: the manifest deliberately keeps the upstream identity
(`rest` 0.5.2) and `schema.graphql` keeps its existing
`@link(url: "https://grafbase.com/extensions/rest/0.5.2")`.

## One non-obvious detail

`@rest`'s `body` argument has a **default value** (`{ selection: ".args.input" }`),
so `body.is_some()` is true even for a plain `GET`. The body must be *rendered*
before you can tell whether the request carries one — get this wrong and nothing
is ever cached. That is why `resolve()` renders the body earlier than upstream does.

## Redis from inside wasm

There is no Redis client in the SDK (`host_io` has http, postgres, grpc, kafka,
nats, logger, event_queue and the delete-less cache). This fork therefore speaks
RESP2 over `std::net::TcpStream`, which works because extensions are WASI
Preview 2 components and the gateway grants sockets when the extension is
configured with `networking = true`. Verified end-to-end, including DNS
(`redis://valkey:6379` resolves inside the sandbox).

Not implemented: TLS (`rediss://`), AUTH, and cluster. All three want a real
client library; `redis-rs` on `wasm32-wasip2` is the thing to try first.

## Build

```bash
cd extensions/rest-cached
cargo test --target aarch64-apple-darwin      # unit tests for keys, tags, RESP
grafbase extension build --output-dir ../../grafbase_extensions/rest-cached/build
```

`cargo build` for the host target fails to link (it is a `cdylib` expecting the
wasm host imports) — that is expected; `cargo test` and the wasm build are the
two that matter.

## Rebasing on upstream

Upstream `rest` is ~310 lines. When it moves:

```bash
curl -sO https://raw.githubusercontent.com/grafbase/extensions/main/extensions/rest/src/lib.rs
```

…diff it against `src/lib.rs`, and re-apply the three `--- cache ---` blocks.
`src/cache.rs` is independent of upstream and should carry over untouched.

Full usage, config reference and invalidation recipes:
[`Docs/EXTENSION-CACHE.md`](../../Docs/EXTENSION-CACHE.md).
Design record and decisions:
[`Docs/rest-cache-fork/CONFLUENCE-REST-Cache-Fork.md`](../../Docs/rest-cache-fork/CONFLUENCE-REST-Cache-Fork.md).
Presenter runbook:
[`Docs/rest-cache-fork/DEMO-SCRIPT.md`](../../Docs/rest-cache-fork/DEMO-SCRIPT.md).
