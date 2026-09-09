# Why entity caching does nothing in this graph

> Companion to [`CACHING.md`](./CACHING.md). This file exists to justify — with
> the official Grafbase definition — the one table row that keeps surprising
> people:
>
> | Cache | What it stores | Reduces REST calls? | Redis-backed here? |
> |---|---|---|---|
> | `entity_caching` | downstream **subgraph fetch** responses | would, but… | ❌ **no cacheable fetch in this topology** |
>
> The config in [`grafbase.toml`](../grafbase.toml) is *correct*. Entity caching
> is enabled, `storage = "redis"`, TTL set. It still writes nothing to Redis.
> The reason is topology, not configuration.

> **Follow-up.** Entity caching now *does* write keys (Fund lives in its own
> subgraph), but those keys are opaque hashes that nothing outside the gateway
> can target for invalidation. If what you need is *invalidation* rather than
> just caching, see [`EXTENSION-CACHE.md`](EXTENSION-CACHE.md).

---

## 1. What entity caching actually caches (per the docs)

The Grafbase docs define entity caching in one sentence:

> "Grafbase Gateway uses Entity Caching to cache **requests to subgraphs**."
> — [Entity Caching, grafbase.com/docs](https://grafbase.com/docs/gateway/performance/entity-caching)

Two words carry all the weight: **requests to subgraphs**. Entity caching sits
on the wire *between the gateway and a subgraph*. When the gateway resolves a
federated query, it issues **subgraph fetches** (HTTP requests to a downstream
GraphQL service), and it is *those fetch responses* — keyed by the entity's
`@key` and scoped by request headers — that get written to the cache.

> "The system protects user data by scoping cached data, and uses all headers to
> compute the scope." — same page.

So the unit being cached is **a subgraph fetch response**. No subgraph fetch ⇒
no cache entry. That is the entire argument; the rest of this doc just shows
that this graph never makes such a fetch.

Official references:
- Entity Caching — https://grafbase.com/docs/gateway/performance/entity-caching
- Entity Cache config — https://grafbase.com/docs/gateway/configuration/entity-cache
- Subgraph config — https://grafbase.com/docs/gateway/configuration/subgraph-configuration

## 2. This graph has exactly one subgraph, and it isn't fetched over HTTP

Look at [`grafbase.toml`](../grafbase.toml): there is a single subgraph,
`insurance`:

```toml
[subgraphs.insurance]
schema_path = "schema.graphql"
```

`accounts`, `funds`, and `policies` are **not** subgraphs. They are REST
endpoints declared *inside* the one `insurance` subgraph via the REST WASM
extension ([`schema.graphql`](../schema.graphql)):

```graphql
@link(url: "https://grafbase.com/extensions/rest/0.5.2",
      import: ["@restEndpoint", "@rest"])

# ... @restEndpoint(...) blocks for accounts / policies / funds
```

Every field in this schema is resolved by the **REST extension running in-process
inside the gateway** — the extension makes a plain HTTP call to a mock REST API
and maps the JSON back onto the GraphQL field. That is an *extension resolver
call*, **not** a GraphQL subgraph fetch. Entity caching does not observe it and
does not cache it.

In federation terms: entity caching needs **≥ 2 subgraphs** (or at least one
subgraph reached by a fetch) so that resolving an `@key` entity crosses a
subgraph boundary over HTTP. A single virtual subgraph has no such boundary to
cross.

## 3. "But there's a `Fund @key` and `@derive` — isn't that an entity lookup?"

Yes, and this is the part that *looks* like it should trigger entity caching.
It doesn't. Here's the mechanism:

```graphql
type Fund @key(fields: "id") { ... }            # schema.graphql:105

# Internal entity lookup used by @derive to fan out funds  # schema.graphql:230
#   (a @lookup query field, resolved by the SAME rest extension)

fund: Fund        @derive @is(field: "{ id: fundId }")           # :283
linkedFunds: [Fund!]! @derive @is(field: "fundIds[{ id: . }]")   # :288
```

`@derive` + `@is` tell the gateway to synthesize a `Fund` from a key it already
has (`fundId` / `fundIds`) and resolve it through the `Fund @key` `@lookup`.
Critically, **that lookup is served by the same REST extension in the same
subgraph** — the "fan-out" is a batch of REST calls made *by the extension*, not
a set of subgraph fetches made *by the gateway across a subgraph boundary*.

So the `@key` here is real federation machinery, but it resolves **intra-subgraph
via the extension**. Entity caching still has no gateway→subgraph fetch to
intercept. The `@key` being present is necessary-but-not-sufficient: entity
caching caches the *fetch that resolves the key across subgraphs*, and there is
no such fetch.

## 4. Empirical proof (already captured in CACHING.md)

This isn't a guess — it was tested under the **production** gateway (the only
mode where caching runs at all; `grafbase dev` ignores caching):

- Ran two distinct queries twice each. Redis filled with `insurance-opcache*`
  keys (operation caching) while `insurance-entitycache*` stayed **empty**.
- Started `grafbase-gateway` pointed at a **dead** Redis port. It served
  normally — it never even opened a Redis connection for entity caching, because
  in this topology there is nothing for that cache to write.

Both results are exactly what "no cacheable subgraph fetch exists" predicts.

## 5. What *would* make entity caching fire here

Entity caching becomes a real Redis-backed cache the moment a query resolves an
entity via an actual **subgraph fetch**. Concretely, any of:

1. **Split the graph into ≥ 2 real subgraphs** — e.g. promote `funds` to its own
   GraphQL subgraph and let `Fund` be resolved across the `accounts`↔`funds`
   boundary. The gateway then issues a subgraph fetch for `Fund @key`, and *that*
   response is what entity caching stores.
2. **Add a second GraphQL (non-REST-extension) subgraph** that contributes an
   `@key` entity, so cross-subgraph entity resolution happens over HTTP.

In today's single-`insurance`-REST-extension shape, neither exists, so entity
caching is a correctly-configured **no-op** — kept as a ready template, not a
bug.

### If your goal is "fewer REST round-trips"

Entity caching is the wrong lever here regardless. It caches subgraph fetches,
not REST-extension calls, so even if it fired it wouldn't be the thing cutting
load on the mock REST services. To reduce REST round-trips, cache at the REST
layer (a Redis/HTTP proxy cache in front of the mock services) — independent of
Grafbase. See the note in [`CACHING.md`](./CACHING.md).

---

## One-paragraph summary

Entity caching caches **gateway→subgraph fetch responses**
([official docs](https://grafbase.com/docs/gateway/performance/entity-caching)).
This project is a **single** virtual subgraph (`insurance`) whose every field —
including the `Fund @key` lookup fanned out by `@derive`/`@is` — is resolved by
the **in-process REST WASM extension**, not by an HTTP subgraph fetch across a
subgraph boundary. With no subgraph fetch to intercept, entity caching has
nothing to store, so it writes nothing to Redis even under the production
gateway. The config is correct; the topology simply gives it no work to do.
