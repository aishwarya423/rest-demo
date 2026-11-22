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
| "Put the cache in the router" | The cache lives **inside each subgraph** (`subgraphs/src/cache.mjs`). That is forced by the line above, but it is also better: the router's own `_entities` calls go through it, so a federated query is served from cache piece by piece. |
| "Hive Router can call REST directly" | **No.** It consumes federation subgraphs over HTTP only. Hive Gateway can do REST via GraphQL Mesh; Router cannot, and cannot be made to. |
| "`poll_interval` has a sane default" | Depends on the source. Under `supergraph.source: hive` it defaults to 10s. Under `source: storage` polling defaults to **disabled** — the router loads once, never reloads, and logs no warning. Always set it explicitly. |
| "Identifiers are `ID!`" | They are **`String!`** in all three subgraphs, deliberately. Changing one means changing all three plus `demo/queries.graphql` and the Bruno collection. |
| "`GET /accounts/{id}/funds` works" | It crashes the funds mock — `mock-rest-apis/funds/server.js` references an `accounts` array that does not exist in that process. Route account→funds through `Account.fundHoldings.fund` instead. **Do not fix the REST services**; they stand in for systems we do not own. |
| "hive@15 uses `MINIO_ROOT_USER`" | The published get-started guide says so and is **stale**. hive@15 switched MinIO→VersityGW and renamed them to `S3_ROOT_USER` / `S3_ROOT_PASSWORD`. The old names are silently ignored and artifact writes fail later, not at startup. |
| "Hive access tokens are target-scoped" | **Organization-scoped** in Hive 15, so every CLI call also needs `--target "<org>/<project>/<target>"`. |
| "`HIVE_CDN_ENDPOINT` can name the target" | **No — it must end with the target's UUID.** With the same valid key, `…/artifacts/v1/development` is **403** and `…/artifacts/v1/<uuid>` is 200. Because it is 403 and not 404 the key gets blamed instead of the path. Symptom: `failed to load supergraph` every `poll_interval`, `NO_SUPERGRAPH_AVAILABLE` on every query. |
| "The router can use the localhost artifact URL" | It cannot — it runs in a container. Use `http://server:3001/artifacts/v1/<TARGET_ID>` from the router, and the `localhost:8082` form only from your shell. |
| "Regenerating `.env` is safe once the stack has run" | **Not for `POSTGRES_PASSWORD`.** The postgres image applies it only at first `initdb`; with `.hive/postgres` present it keeps the old one. The result is `28P01`, `migrations` exit 1, and `server` never starting — which shows up only as **"Failed to fetch"** on the login page, because `app` stays healthy. Worse, `docker exec db psql -U postgres` succeeds anyway (`pg_hba.conf` trusts the socket and loopback), so the password looks correct. Probe from another container over the `hive` network. `bootstrap-secrets.sh` now carries the value forward; `hive-console/sync-db-password.sh` repairs a drifted database without data loss. Never answer this with `down -v`. |
| "Self-hosting gives you the CDN" | The High-Availability CDN is **Cloud-only**. Self-hosted serves the same artifact *routes* from the `server` container (`CDN_API=1`), which is what the router consumes. The routes work; the CDN does not exist. |
| "Re-running `supergraph-compose` picks up a subgraph edit" | **Only with `--build`.** `compose/Dockerfile` COPYs `subgraphs/src` into the composer image — that is what stops the published SDL and the running schema drifting. Without a rebuild the composer composes the OLD modules, **exits 0**, and writes a supergraph with your change missing, so every later gate passes on a schema that does not match the code. Always `run --rm --build supergraph-compose`. |
| "A runtime can tell you which supergraph it loaded" | **No endpoint does.** On Router 0.3.16 `/health` and `/readiness` return an empty `200`; `/version`, `/metrics` and every other path return the router's landing page, so a 200 proves only that the process is up. Gateway 2.15.10 is the same. Answer the question by comparing schemas: `scripts/supergraph-version.sh` canonicalises the CDN `sdl` artifact and the runtime's introspection through graphql-js and compares hashes. Do not go looking for a version route again. |
| "`etag` and `x-hive-schema-version-id` are the same thing" | **No.** The artifact routes return both. The **version id changes on every publish**, even when the bytes are identical; the **etag changes only when the bytes change**. Verified: republishing the previous schema gave a new version id with the old etag. Version id = audit trail, etag = "did anything actually change". |
| "Hive Gateway needs a supergraph file" | **It consumes the self-hosted CDN natively.** Gateway 2.15.10 takes `--hive-cdn-endpoint` / `--hive-cdn-key`, or the same two as `HIVE_CDN_ENDPOINT` / `HIVE_CDN_KEY` env vars, in which case `hive-gateway supergraph` needs no path argument at all. Running on `:4110` under the `gateway-cdn` profile. **It reloads silently** — unlike the router it logs nothing on a swap, so never verify it by grepping its log. |
| "`HIVE_TOKEN` works against the Hive API" | **Not the public GraphQL API.** The registry token (the `tokens` row) is accepted by `hive schema:check` / `schema:publish` but rejected outright by `:8082/graphql` — even a bare `{ __typename }` returns `Invalid token provided`, while the same query with **no** auth header succeeds. The public API wants an *organization* access token, of which this stack has none. Read schema versions from the CDN response headers instead. |
| "The Laboratory can run queries as soon as a schema is published" | **It needs an endpoint set first.** The Laboratory's target endpoint is the per-target `targets.graphql_endpoint_url` column, NULL on all three targets here, so until it is set in Target → Settings the Laboratory can autocomplete and validate but has nowhere to send a request. Point it at **`:4110` (Gateway), not `:4100` (Router)**: the router answers `OPTIONS /graphql` with 405 and sends no `Access-Control-*` headers, so a browser request from the Console origin fails CORS; the gateway answers the preflight 204 with the right headers. And it is a `localhost` URL, because the request leaves the browser — the opposite of `HIVE_CDN_ENDPOINT`. |

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
| The registry -> CDN -> runtime lifecycle, the Console Laboratory, verifying what a runtime serves, CI/CD for schemas | `Docs/SUPERGRAPH-CDN-LIFECYCLE.md` and `Docs/SUPERGRAPH-CICD.md` — both verified end to end, with the commands |

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
│   ├── invalidator/server.js        purge API; talks only to Redis
│   ├── hive/                        Hive CLI image + publish.sh + check.sh
│   ├── hive-console/                vendored official Compose file (hive@15.0.1)
│   │                                + bootstrap-secrets.sh, sync-db-password.sh
│   └── demo/demo.sh                 MISS -> HIT -> purge -> MISS, with REST call counts
├── scripts/                     repo-root, spans the stack and the docs
│   ├── test-supergraph-lifecycle.sh  change -> check -> publish -> CDN ->
│   │                                 runtime -> query -> revert, as a test
│   ├── supergraph-version.sh         CDN version/etag/checksum + per-runtime
│   │                                 canonical fingerprint with a verdict
│   └── lib/schema-fingerprint.mjs    graphql-js canonicalisation; mount it
│                                     INSIDE /app or `graphql` will not resolve
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
