# Why caching needs `grafbase-gateway` and is a no-op under `grafbase dev`

> Companion to [`CACHING.md`](./CACHING.md) and
> [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md).
>
> The `[operation_caching]` and `[entity_caching]` blocks in
> [`grafbase.toml`](../grafbase.toml) are correct, but they only do anything when
> the graph is served by the **production gateway binary** (`grafbase-gateway`).
> The `grafbase` service in [`docker-compose.yml`](../docker-compose.yml) runs
> `grafbase dev`, so in the default setup **no caching happens** — not because
> the config is wrong, but because `dev` is a different program with a different
> job.

---

## TL;DR

| | `grafbase dev` (CLI) | `grafbase-gateway` (production binary) |
|---|---|---|
| Purpose | local development environment | production request serving |
| Config surface (per docs) | `[subgraphs]`, `[hooks]`, `[mcp]`, introspection | full gateway config incl. **caching** |
| `[operation_caching]` | not part of its job → **no-op** | ✅ honored (verified Redis-backed) |
| `[entity_caching]` | not part of its job → **no-op** | honored (but a no-op *here* for a separate, topology reason — see [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md)) |

So there are **two independent reasons** caching can be a no-op in this project.
Keep them separate:

1. **Wrong binary** (this doc): `grafbase dev` doesn't run caching at all.
2. **Wrong topology** ([`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md)):
   even under the correct binary, entity caching has no subgraph fetch to cache.

Operation caching only ever hits reason #1 — run it under `grafbase-gateway` and
it works (proven in [`CACHING.md`](./CACHING.md)).

---

## What the official docs actually say

The docs never phrase it as "dev disables caching" in one sentence. The reason
is structural: **caching is documented as a feature of the Gateway, and `dev` is
documented as a local development server** — two different tools with two
different config surfaces. Put the two doc pages side by side:

### `grafbase dev` — a local development environment

> "Start the Grafbase local development environment."
> — [grafbase dev, CLI reference](https://grafbase.com/docs/reference/grafbase-cli/dev)

The `dev` reference documents its configuration surface as local-development
concerns — `[subgraphs]` (local overrides, `schema_path`, introspection
headers), `[hooks]`, and `[mcp]`. **The caching blocks are not part of the `dev`
command's documented configuration.** `dev` exists to compose your subgraphs and
serve them locally for iteration, not to reproduce production caching behavior.

### Operation & entity caching — Gateway features

> "The Grafbase **Gateway** maintains cached operation plans for unique
> operations to speed up consecutive requests with the same operation."
> — [Operation Caching](https://grafbase.com/docs/gateway/configuration/operation-caching)

> "Grafbase **Gateway** uses Entity Caching to cache requests to subgraphs."
> — [Entity Caching](https://grafbase.com/docs/gateway/performance/entity-caching)

Both caching features are defined as behavior of the **Gateway** — the
self-hosted production binary you download and run (`grafbase-gateway`), the same
binary the self-hosting docs describe installing. Caching (including the Redis
backends and cache warming) is part of *that* program's runtime, not the `dev`
server's.

Official references:
- `grafbase dev` — https://grafbase.com/docs/reference/grafbase-cli/dev
- Operation Caching — https://grafbase.com/docs/gateway/configuration/operation-caching
- Entity Caching — https://grafbase.com/docs/gateway/performance/entity-caching
- Self-hosting the Gateway — https://grafbase.com/docs/platform/self-hosting/installation

## Why this is the *expected* design, not a bug

`grafbase dev` optimizes for a fast edit→reload loop: recompose the schema,
restart, serve. Caching does the opposite — it *remembers* work across requests
(cached query plans, cached subgraph responses). During development that would
actively mislead you: a schema or resolver change wouldn't show up because a
stale plan/response is being served. So a dev server that ignores the caching
config is the sane default, and the production gateway — where you *want* the
speedup and the data is stable — is where caching belongs.

## What this project observed (empirical, gateway 0.53.5)

The docs establish the *scoping* (caching = Gateway feature; dev = local server).
This project then verified the concrete behavior end-to-end — see
[`CACHING.md`](./CACHING.md) for the full runnable steps:

- **Under `grafbase dev`** (the docker-compose default): firing queries produced
  **no** `insurance-opcache*` or `insurance-entitycache*` keys in Redis. Caching
  config present, nothing written.
- **Under `grafbase-gateway`** (production binary, same config): two distinct
  queries run twice each produced `insurance-opcache*` keys in Redis —
  **operation caching verified Redis-backed**. (`insurance-entitycache*` stayed
  empty for the *separate* topology reason in
  [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md), not because of the
  binary.)

That contrast is the proof: swapping only the binary — same `grafbase.toml`, same
Redis — turns operation caching from silent no-op into working cache.

## How to actually get caching (run the production gateway)

The current `grafbase` service in [`docker-compose.yml`](../docker-compose.yml)
runs `grafbase dev`. To get caching you run `grafbase-gateway` instead, which
needs a **pre-composed federated schema** (dev composes on the fly; the
production gateway does not):

```bash
# 1. compose the federated schema the production gateway consumes
npx grafbase compose -c grafbase.toml > federated.graphql

# 2. run the PRODUCTION gateway against the same config + composed schema
grafbase-gateway --config grafbase.toml --schema federated.graphql
```

[`CACHING.md`](./CACHING.md) has the full, verified host-testing walkthrough
(localhost URL rewrites, downloading the gateway binary, watching Redis fill).
To move docker-compose onto the production gateway, swap that one service's
command to `grafbase-gateway ...`, add a `grafbase compose` step to produce the
federated schema, and keep the existing `redis` service — it's already wired in.

---

## One-paragraph summary

Caching is a feature of the **Grafbase Gateway** (the production
`grafbase-gateway` binary), per the
[operation](https://grafbase.com/docs/gateway/configuration/operation-caching)
and [entity](https://grafbase.com/docs/gateway/performance/entity-caching)
caching docs, whereas
[`grafbase dev`](https://grafbase.com/docs/reference/grafbase-cli/dev) is
documented as a **local development environment** whose config surface is
subgraphs/hooks/mcp — the caching blocks aren't part of it. This project's
docker-compose runs `grafbase dev`, so the `[operation_caching]` and
`[entity_caching]` blocks are correct-but-inert there; running the same config
under `grafbase-gateway` turns operation caching into a verified Redis-backed
cache. (Entity caching stays a no-op even then, for the separate topology reason
documented in [`ENTITY-CACHING-WHY-NOOP.md`](./ENTITY-CACHING-WHY-NOOP.md).)
