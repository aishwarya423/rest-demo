# Federation and Hive Router

## Contents

- [The shape of the system](#the-shape-of-the-system)
- [Anatomy of a subgraph module](#anatomy-of-a-subgraph-module)
- [Entities and the join](#entities-and-the-join)
- [Adding a field](#adding-a-field)
- [Adding a subgraph](#adding-a-subgraph)
- [Composition](#composition)
- [Router configuration](#router-configuration)
- [Router vs Gateway](#router-vs-gateway)
- [Known traps](#known-traps)

## The shape of the system

Hive Router consumes **federation subgraphs over HTTP only**. It cannot call
REST, and cannot be made to — that is why this POC runs three Yoga servers in
front of the three REST services rather than pointing the router at REST
directly. (Hive Gateway *can* do REST through GraphQL Mesh. See
`Docs/Hive-docs/CONFLUENCE-REST-Integration-Options.md` for the full comparison
and the options if the subgraph layer ever feels too heavy.)

One image, three containers. `subgraphs/src/server.mjs` reads `SUBGRAPH` from
the environment and picks the matching schema module:

```
SUBGRAPH=accounts PORT=4001 REST_URL=http://accounts-rest:3001 node src/server.mjs
```

## Anatomy of a subgraph module

Each of `accounts.mjs`, `policies.mjs`, `funds.mjs` exports exactly three
things, and `compose.mjs` and `server.mjs` both rely on that shape:

```js
export const name = 'funds';              // used as the service name and key namespace
export const typeDefs = gql`...`;         // a DocumentNode, from graphql-tag
export function createResolvers(rest) {}  // takes the REST client, returns resolvers
```

The federation link goes at the top of every `typeDefs`:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
```

Resolvers receive the shared REST client (`rest.mjs`), which logs every upstream
call. Every GraphQL field in this POC bottoms out in a REST call through it —
keep it that way, because the logging is what proves cache behaviour.

Document fields with the REST route they map to. The existing modules use
`"GET /funds/{id}"` as the field description, which makes the mapping visible in
introspection and in the Console's schema explorer.

## Entities and the join

A type becomes an entity with `@key`, and gains a `__resolveReference` resolver:

```graphql
type Fund @key(fields: "id") {
  id: String!
  name: String!
  ...
}
```

```js
Fund: {
  __resolveReference: (reference) => rest.get(`/funds/${encodeURIComponent(reference.id)}`),
}
```

The accounts and policies subgraphs emit Fund *references* — `{ id }` only —
and never call the funds service. The router collects those references and
resolves them against the funds subgraph in one batched `_entities` call per
level. That is the whole federation mechanism: `@key` plus `_entities`.

The funds subgraph's `__resolveReference` is the busiest code path in the POC,
which is also why caching it pays so well.

To extend a type owned by another subgraph, declare it with its `@key` and only
the fields you own — see how `policies.mjs` extends `Account`.

## Adding a field

1. Add it to `typeDefs` in the owning subgraph module, with a description naming
   the REST route it maps to.
2. Add the resolver in `createResolvers`, going through the `rest` client.
3. Restart that subgraph and re-run `supergraph-compose`:
   ```bash
   docker compose -f hive-router-poc/docker-compose.yml up -d --build \
     <name>-subgraph supergraph-compose
   docker compose -f hive-router-poc/docker-compose.yml restart hive-router
   ```
4. If the registry is in use, republish — see `references/console.md`.

The file-sourced router on `:4000` reads a mounted volume, so it needs the
compose step to rerun and a restart. The registry-sourced router on `:4100`
picks up a republish on its own within the poll interval.

## Adding a subgraph

1. Create `subgraphs/src/<name>.mjs` exporting `name`, `typeDefs`,
   `createResolvers`.
2. Register it in `subgraphs/src/server.mjs`'s `MODULES` map and give it a
   default TTL in `DEFAULT_TTL`.
3. Import it in `compose/compose.mjs` and add it to the `URLS` map — the URL is
   baked into the supergraph, so it must be the in-network form
   (`http://<name>-subgraph:<port>/graphql`), not localhost.
4. Add the service to `docker-compose.yml` using the `x-subgraph-base` anchor.
5. If publishing to the registry, add it to the loops in `hive/publish.sh` and
   `hive/check.sh`.

## Composition

`compose/compose.mjs` composes the three subgraph SDLs into one supergraph using
`@theguild/federation-composition` — the same library the Hive registry uses, so
local composition and registry composition agree.

It runs as a one-shot container that writes to a shared volume and exits.
`Exited (0)` is success, not a failure.

Outputs:

```
/out/supergraph.graphql         what the router serves
/out/supergraph.public.graphql  the public SDL, federation plumbing stripped
/out/sdl/<name>.graphql         per-subgraph SDL, for `hive schema:publish`
```

The per-subgraph SDL files are written from the same modules the servers run, so
the published schema and the running schema cannot drift. That is deliberate —
do not hand-maintain SDL files alongside the modules.

The composer imports the subgraph modules directly, which is why
`compose/Dockerfile` installs dependencies at `/app` rather than `/app/compose`:
Node resolves `graphql-tag` from `/app/subgraphs/src` by walking up, and
installing inside `compose/` puts `node_modules` outside that search path.

Composition failure exits non-zero and lists the errors. It is the same check
the registry runs, so a local failure will fail in CI too.

## Router configuration

Two configs, same image, same subgraphs:

| File | Port | Supergraph source |
|---|---|---|
| `router/router.config.yaml` | 4000 | `source: file`, mounted volume |
| `router/router.registry.config.yaml` | 4100 | `source: hive`, self-hosted artifact endpoint |

Settings that matter:

```yaml
introspection: true           # so the POC is explorable

cache:                        # IN-MEMORY ONLY — parse, validation,
  router: {...}               # normalization, query plans.
  supergraph: {...}           # NOT a response cache. See references/caching.md.

headers:
  all:
    request:
      - propagate: { named: x-request-id }

traffic_shaping:
  all:
    request_timeout: 10s
    forward_operation_name: true   # without this every subgraph cache key
                                   # for a root fetch reads `anonymous`
```

For the registry config, `endpoint` and `key` read from the environment via
`expression: env("HIVE_CDN_ENDPOINT")`, and `poll_interval` is set explicitly —
see the warning in `references/console.md` about per-source defaults.

## Router vs Gateway

| Capability | Router (Rust) | Gateway (Node) |
|---|---|---|
| Federation planning and execution | yes | yes |
| REST without subgraphs | **no** | yes, via Mesh |
| Response cache | **no** | yes, in-memory or Redis |
| Persistent / shared query-plan cache | **no** — moka, per process | yes, `hive-gateway:query-plan:*` in Redis |
| Plugins | Rust plugins + coprocessors | large JS plugin ecosystem |
| Subscriptions | SSE, WebSocket, HTTP streaming | WS, SSE, HTTP callbacks |
| Image size | 32.5 MB | 141 MB |
| Licence | MIT | MIT |

Measured here on the `InsurancePortfolio` query: Router cold miss 6.1–8.5 ms,
warm hit 2.6–2.9 ms; Gateway with `--hive-router-runtime` 8.7–12.8 ms and
3.8–4.5 ms.

If what you need is a cache that survives a restart or is shared between
replicas, Gateway is the only option in this repo — see the edge cache on
`:4020` in `references/caching.md`. The router cannot be configured into it.

A `compare` profile runs Gateway with Router's planner on `:4010`:

```bash
docker compose -f hive-router-poc/docker-compose.yml --profile compare up -d
```

It returns identical data and **byte-identical cache keys**, which is good
evidence it really is the same planner — but it is slower on both paths and four
times the image size. The verdict recorded in the README: not a better fit here.
Its value is for someone who wants Router's planner while keeping Gateway's
plugin ecosystem, particularly Gateway's own response cache.

## Known traps

**`buildSubgraphSchema` needs an array.** Passing the module object bare makes
`typeDefs` the object itself and fails with `doc.definitions is not iterable`.
The array form is the supported shape:

```js
buildSubgraphSchema([{ typeDefs: module.typeDefs, resolvers: module.createResolvers(rest) }])
```

**Identifiers are `String!`, not `ID!`.** GraphQL treats them as distinct for
variable usage, so a document written against one is rejected against the other
with `Variable "$id" of type "String!" used in position expecting type "ID!"`.
All three subgraphs use `String!`. Changing it means changing all three plus
`demo/queries.graphql` and the Bruno collection together.

**Use `#` comments, not `"""` docstrings, for internal notes in SDL.** Triple-quoted
strings are descriptions and leak into the public schema.

**`GET /accounts/{id}/funds` crashes the funds mock.** It references an
`accounts` array that does not exist in that process. Route account→funds
through `Account.fundHoldings.fund`. Do not fix the REST service.

**The host-side `supergraph.graphql` goes stale.** The router reads the Docker
volume, not the file in your working copy. After recomposing, check the volume:
```bash
docker run --rm -v hive-router-poc_supergraph:/v alpine cat /v/supergraph.graphql
```
