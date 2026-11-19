// ===========================================================================
// HIVE GATEWAY — PERSISTENT, REDIS-BACKED CACHE AT THE EDGE
// ===========================================================================
// WHY THIS FILE EXISTS
//
// The `cache:` block in router/router.config.yaml cannot be made persistent.
// Verified two ways against ghcr.io/graphql-hive/router:latest (2026-11-19):
//
//   1. The binary carries no Redis client. Its cache crates are `moka
//      0.12.16` and `lru 0.16.4`, both in-process. The only "redis" byte
//      sequences in the 65 MB binary are Monaco's editor language list (for
//      the bundled GraphiQL) and an OpenTelemetry db.system enum value
//      ("redis valkey sql cassandra mssql mysql postgresql oracle").
//   2. The config reference documents `cache` as "the router's in-memory
//      caches for parsing, validation, normalization, and query plans". The
//      complete set of sub-keys is plugin_supergraph_runtimes, parsing,
//      validation, normalization and query_plans, each taking only
//      max_entries / time_to_live / time_to_idle. There is no backend key.
//
// Hive GATEWAY does support Redis, natively, and it runs this same supergraph
// with the same Rust planner (--hive-router-runtime). So this is where a
// persistent cache can actually live today. Giving it `cache: {type:'redis'}`
// persists THREE things, all verified present in Valkey:
//
//   response-cache:<sha256>              the cached response body  (ttl: ours)
//   hive-gateway:query-plan:<hash>:<h>   the serialized query plan (ttl: ~24h)
//   hive-gateway:supergraph              the supergraph SDL        (ttl: ~10s)
//
// The middle one is the exact thing the router's `cache.supergraph.query_plans`
// holds in moka — so a persistent, shared query-plan cache IS available in the
// Hive ecosystem. Just not in Hive Router.
//
// VERIFIED (2026-11-19, Hive Gateway 2.15.10, hive-router runtime):
//   - cold query -> didCache: true; 5 REST GET lines upstream
//   - repeat     -> hit: true;      0 REST GET lines
//   - with all six subgraph and REST containers STOPPED, and this container
//     RESTARTED, the same query still returned the full correct response from
//     Redis: hit: true, holderName "Anika Rao", zero errors. A fresh process
//     with no upstreams is as strong a persistence proof as this stack can
//     give. The router's moka caches cannot do that by construction.
//
// Run it:
//   docker compose -f docker-compose.yml --profile edge-cache up -d
//   -> http://localhost:4020/graphql     (router stays on :4000, untouched)
// ===========================================================================

import { defineConfig } from '@graphql-hive/gateway';

// Shortest subgraph TTL wins. A single gateway response can splice together
// accounts (30s), policies (120s) and funds (300s) data; holding the whole
// response longer than its freshest component would serve data staler than any
// subgraph ever would. 30s is therefore a ceiling, not a preference.
const TTL_MS = Number(process.env.GATEWAY_CACHE_TTL_MS ?? 30_000);
const FUNDS_TTL_MS = Number(process.env.FUNDS_TTL_MS ?? 300_000);

export const gatewayConfig = defineConfig({
  // ---------------------------------------------------------------- storage
  cache: {
    type: 'redis',
    url: process.env.REDIS_URL ?? 'redis://valkey:6379',
    // Do not block startup on Valkey. A dead cache must degrade to "always
    // miss", never to a gateway that refuses to boot — the same property
    // subgraphs/src/cache.mjs preserves by logging Redis errors, not throwing.
    lazyConnect: true,
  },

  responseCaching: {
    // One shared bucket. Correct here because these REST payloads are not
    // user-specific. If per-user data is ever introduced, return a VALIDATED
    // user id from this function and mark the private fields with
    // scopePerSchemaCoordinate — do not leave it returning null and hope.
    session: () => null,

    ttl: TTL_MS,

    // Reference data is safe to hold far longer, and it is the busiest path in
    // the POC. Verified this option actually bites: a FundDetail query came
    // back with the per-coordinate ttl, not the global one. Note the spelling —
    // `ttlForSchemaCoordinate` is silently ignored, which was confirmed by
    // setting it and watching the global ttl come back instead.
    ttlPerSchemaCoordinate: {
      'Query.fund': FUNDS_TTL_MS,
      'Query.funds': FUNDS_TTL_MS,
    },

    // -------------------------------------------------------------------
    // idFields: [] IS LOAD-BEARING. DO NOT REMOVE IT.
    //
    // By default this plugin rewrites every selection set to also fetch the
    // entity key under an alias, `__responseCacheId: id`, so it can build
    // `Typename:id` invalidation tags. On this federated graph that alias
    // comes back null and nulls its whole parent:
    //
    //   {"errors":[{"message":"Cannot return null for non-nullable field
    //     Policy.id.","path":["account","policies",0,"__responseCacheId"]}]}
    //
    // It is NOT a bug in this plugin. An aliased key field on a federated
    // entity is broken in every runtime available here — verified by hand,
    // with no cache plugin involved at all:
    //
    //   `policies { id }`                        -> works everywhere
    //   `policies { __responseCacheId: id }`     -> nulls the parent on
    //        :4000 Hive Router (Rust),
    //        :4010 Hive Gateway + --hive-router-runtime,
    //        :4022 Hive Gateway + its own planner.
    //
    // So the response cache cannot tag entities here, and emptying idFields is
    // what makes the cache usable at all. Cost: expiry at this layer is
    // TTL-only, and the invalidator cannot purge it (see below). Worth
    // reporting upstream; until it is fixed, leave this empty.
    idFields: [],

    // Off because it depends on the entity tags that idFields: [] disables,
    // and because this POC is read-only anyway. Leaving it true would imply an
    // invalidation path that does not exist.
    invalidateViaMutation: false,

    // Adds extensions.responseCache.{hit,didCache,ttl} to the reply, so a demo
    // can show a hit without reading logs. Same switch the subgraph cache uses
    // (CACHE_EXTENSION_METADATA in subgraphs/src/cache.mjs).
    includeExtensionMetadata: process.env.CACHE_EXTENSION_METADATA !== '0',
  },
});

// ===========================================================================
// INVALIDATION — READ THIS BEFORE DEMOING :4020
//
// The invalidator (:8090) CANNOT purge this layer. It purges by entity tag,
// and this layer writes no entity tags (see idFields above). Its keys are
// opaque `response-cache:<sha256>` strings keyed on the whole operation.
//
// So for up to GATEWAY_CACHE_TTL_MS after a purge, :4020 keeps serving the
// stale response while :4000 is already correct. That is not a wiring mistake,
// it is the trade-off this layer makes, and it is why the POC's headline
// caching story stays on the subgraph layer:
//
//   :4000  router + subgraph cache   -> targeted purge, 2 REST calls not 5
//   :4020  gateway + edge cache      -> persistent, 0 REST calls, TTL-only
//
// To clear this layer by hand:
//   docker compose exec valkey valkey-cli --scan --pattern 'response-cache:*' \
//     | xargs -r docker compose exec -T valkey valkey-cli del
// ===========================================================================
