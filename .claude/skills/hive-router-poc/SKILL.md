---
name: hive-router-poc
description: >-
  Working knowledge of the rest-demo repo: three insurance REST APIs federated
  into one GraphQL API via Hive Router, with response caching in the subgraphs
  and a self-hosted Hive Console registry. Use this skill for ANY work in this
  repo — changing or reasoning about caching, cache keys, TTLs or invalidation;
  adding or editing subgraphs, entities, @key directives or federation
  composition; configuring Hive Router or Hive Gateway; running, demoing or
  debugging the Docker Compose stack; publishing schemas or running schema
  checks against the self-hosted Hive Console; and writing the Confluence spike
  pages, speaker notes, lead briefs or demo walkthroughs this repo produces.
  Trigger it whenever the user mentions Hive, Hive Router, Hive Gateway, Hive
  Console, federation, subgraphs, supergraph, GraphQL caching, Valkey/Redis
  cache invalidation, the accounts/policies/funds services, or asks for a spike
  document or demo script — even if they do not name this repo, and even if the
  request looks like a quick one-liner. Several facts here contradict what the
  official docs say, so check this skill before answering from memory.
---

# rest-demo — Hive Router federation POC

Three existing insurance REST APIs are presented as one federated GraphQL API.
Hive Router (Rust) plans and executes queries across three Yoga subgraphs, each
of which caches its own responses in Valkey. A self-hosted Hive Console acts as
the schema registry.

```
                        GraphQL client
                              |
         :4000 file-sourced   |   :4100 registry-sourced
                  Hive Router (Rust, NO response cache)
        :4020 Hive Gateway, optional: the one runtime here that CAN
              keep a response + query-plan cache in Redis (profile edge-cache)
                              |
          +-------------------+-------------------+
          v                   v                   v
   accounts-subgraph   policies-subgraph    funds-subgraph
      :4001                :4002               :4003
     (Yoga + @apollo/subgraph, response cache lives HERE)
          |                   |                   |
          +---------+---------+---------+---------+---> Valkey :6379
          |                   |                   |          ^
          v                   v                   v          | purge
   accounts-rest       policies-rest        funds-rest    invalidator
      :3001                :3003               :3002        :8090

   build step: supergraph-compose -> supergraph.graphql (shared volume)
   registry  : Hive Console :8080 UI, :8082 API + /artifacts/v1/...
```

## Start here: facts that are easy to get wrong

These are verified against running code and shipped sources in this repo, and
several of them contradict either intuition or the published documentation.
Getting one wrong produces something that looks correct and silently is not, so
check this list before asserting anything in these areas.

| Claim | Reality |
|---|---|
| "Hive Router can cache responses" | **No.** Its `cache` key tunes *in-memory* parsing, validation, normalization and query-plan caches. It never stores response data and never removes a single upstream call. Response caching is an open RFC. This is the single most important fact in the repo. |
| "The router's `cache:` can be pointed at Redis" | **No, and there is no option to add.** The binary links `moka 0.12.16` + `lru 0.16.4` and contains **no Redis client at all** (the only `redis` strings in 65 MB are Monaco's language list and an OpenTelemetry `db.system` enum). The documented sub-keys are only `plugin_supergraph_runtimes`/`parsing`/`validation`/`normalization`/`query_plans`, each taking `max_entries`/`time_to_live`/`time_to_idle`. Persistent caching **is** available in Hive — on Hive **Gateway** (`--profile edge-cache`, :4020), which persists the response body *and* the serialized query plan in Redis. See `references/caching.md`. |
| "An aliased field works anywhere a plain one does" | **Not on a federated entity key.** `policies { id }` works; `policies { someAlias: id }` returns null and nulls its parent — on Hive Router, on Gateway with the router runtime, and on Gateway with its own planner. This is why the Gateway response cache needs `idFields: []` here: it injects `__responseCacheId: id` by default and breaks every query. |
| "Put the cache in the router" | The cache lives **inside each subgraph** (`subgraphs/src/cache.mjs`). That is forced by the line above, but it is also better: the router's own `_entities` calls go through it, so a federated query is served from cache piece by piece. |
| "Hive Router can call REST directly" | **No.** It consumes federation subgraphs over HTTP only. Hive Gateway can do REST via GraphQL Mesh; Router cannot, and cannot be made to. |
| "`poll_interval` has a sane default" | Depends on the source. Under `supergraph.source: hive` it defaults to 10s. Under `source: storage` polling defaults to **disabled** — the router loads once, never reloads, and logs no warning. Always set it explicitly. |
| "Identifiers are `ID!`" | They are **`String!`** in all three subgraphs, deliberately. Changing one means changing all three plus `demo/queries.graphql` and the Bruno collection. |
| "`GET /accounts/{id}/funds` works" | It crashes the funds mock — `mock-rest-apis/funds/server.js` references an `accounts` array that does not exist in that process. Route account→funds through `Account.fundHoldings.fund` instead. **Do not fix the REST services**; they stand in for systems we do not own. |
| "hive@15 uses `MINIO_ROOT_USER`" | The published get-started guide says so and is **stale**. hive@15 switched MinIO→VersityGW and renamed them to `S3_ROOT_USER` / `S3_ROOT_PASSWORD`. The old names are silently ignored and artifact writes fail later, not at startup. |
| "Hive access tokens are target-scoped" | **Organization-scoped** in Hive 15, so every CLI call also needs `--target "<org>/<project>/<target>"`. |
| "The router can use the localhost artifact URL" | It cannot — it runs in a container. Use `http://server:3001/artifacts/v1/<TARGET_ID>` from the router, and the `localhost:8082` form only from your shell. |
| "Self-hosting gives you the CDN" | The High-Availability CDN is **Cloud-only**. Self-hosted serves the same artifact *routes* from the `server` container (`CDN_API=1`), which is what the router consumes. The routes work; the CDN does not exist. |

## Repo-wide conventions

**Never modify the REST services.** `mock-rest-apis/` stands in for systems the
team does not own. Their `openapi.yaml` files may be read; their behaviour,
bugs included, is a fixed constraint. Work around problems in the subgraph
layer and document the workaround.

**Comment the why, not the what.** Every non-obvious file here carries a header
block explaining the reasoning and the traps — see `subgraphs/src/cache.mjs` for
the standard. When you change behaviour, update the reasoning next to it. A
future reader needs to know *why `buildRedisEntityId` is left alone*, not that
it is left alone.

**Claim only what you ran.** The documents in `Docs/` label every finding
`[Verified]`, `[Documented]` or `[Unverified]` and pin versions. Hold code and
prose to the same bar: if you did not execute it, say so. "Nothing is asserted
from memory" is the house rule, and it is why the facts table above is
trustworthy.

**Both routers stay working.** `:4000` loads its supergraph from a mounted file
and must keep working whether or not Hive Console is running; `:4100` loads from
the registry. Changes should not couple the base POC to the registry.

## Which reference to read

Read the one that matches the task. They are detailed and self-contained, so
there is no need to read more than the task calls for.

| Task | Read |
|---|---|
| Cache keys, TTLs, Redis layout, tags, invalidation, the purge algorithm, adding a purge route | `references/caching.md` |
| Adding or changing a subgraph, entities, `@key`, reference resolvers, composition, router config, Router vs Gateway | `references/federation.md` |
| Publishing schemas, schema checks, CDN tokens, artifact endpoints, the self-hosted Console stack | `references/console.md` |
| Starting the stack, ports, the demo, proving a cache hit, debugging a failure | `references/operations.md` |
| Confluence spike pages, speaker notes, lead briefs, demo walkthroughs, slide decks | `references/writing-docs.md` |

## Where things live

```
rest-demo/
├── mock-rest-apis/              the three REST services — READ ONLY
│   ├── accounts/  policies/  funds/
├── hive-router-poc/             the main stack
│   ├── docker-compose.yml           base: REST, subgraphs, Valkey, router, invalidator
│   ├── docker-compose.console.yml   overlay: self-hosted Hive Console + registry router
│   ├── subgraphs/src/
│   │   ├── server.mjs               one image, three containers (SUBGRAPH env picks schema)
│   │   ├── cache.mjs                the response cache  <-- the important file
│   │   ├── rest.mjs                 REST client; logs every upstream call
│   │   └── accounts.mjs policies.mjs funds.mjs
│   ├── compose/compose.mjs          subgraph SDLs -> supergraph.graphql + per-subgraph SDL
│   ├── router/
│   │   ├── router.config.yaml           supergraph from a file (:4000)
│   │   └── router.registry.config.yaml  supergraph from the registry (:4100)
│   ├── gateway/gateway.config.ts    Hive Gateway + PERSISTENT Redis cache (:4020)
│   ├── invalidator/server.js        purge API; talks only to Redis
│   ├── hive/                        Hive CLI image + publish.sh + check.sh
│   ├── hive-console/                vendored official Compose file (hive@15.0.1)
│   └── demo/demo.sh                 MISS -> HIT -> purge -> MISS, with REST call counts
├── hive-registry-poc/           separate: supergraph delivery over S3
└── Docs/Hive-docs/              Confluence pages, briefs, deck source
```

## How to approach work here

**Verify before asserting.** The facts table exists because this stack has
several traps where the obvious answer is wrong. When a question touches
caching, router capability, or Hive Console configuration, check the running
system or the shipped source rather than recalling. `docker compose ... logs`,
`redis-cli --scan`, and the invalidator's preview endpoints are all cheap.

**Prove cache behaviour through REST logs, not timings.** `rest.mjs` logs every
upstream call. A cache hit prints *nothing*. That is a far stronger signal than
latency, which is noisy on loopback where the mocks answer in microseconds. The
number that matters is REST calls per hit: zero.

**Reach for the invalidator's preview mode.** Every destructive purge route has
a `GET` twin that returns the plan without executing it. Use it to show what
would be removed before removing it.

**Keep the two POCs distinct.** `hive-router-poc` is the main stack.
`hive-registry-poc` answers one narrow question — can the router boot from and
hot-reload an S3 artifact — and deliberately does not run Hive Console. Do not
merge them.
