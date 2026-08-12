Short answer: **no — I wouldn't split the graph just to make entity caching fire.** That's restructuring the architecture to satisfy a cache mechanism, which is backwards. Let me check what the REST extension actually supports so my recommendation is concrete rather than hand-wavy.

The REST extension (0.5.2) confirms the picture: it only declares the `network` permission and has **no cache config and doesn't honor `Cache-Control`** — so it caches nothing on its own. That shapes the recommendation.

## Do I recommend splitting the graph? No.

Splitting `funds` into its own subgraph *only to make entity caching fire* is optimizing the architecture to satisfy a cache, which is backwards. You'd pay real costs — an extra network hop, a second schema/deploy to own, composition complexity, header-propagation rules — for a cache that still **wouldn't reduce your REST round-trips** (entity caching sits gateway→subgraph, not extension→REST API). Split subgraphs only when there's an independent reason: separate team ownership, independent deploy cadence, or different scaling needs. If that day comes, entity caching becomes a free bonus — but it's never the reason to split.

## Where the actual cost is

Your latency/load bottleneck is the **REST calls the extension makes** (accounts/funds/policies), amplified by the `@derive` fan-out — one query can spray many `Fund @key` lookups. None of Grafbase's built-in caches touch those calls:

| Cache | Caches | Cuts REST round-trips? |
|---|---|---|
| `operation_caching` (working) | query plan | ❌ |
| `entity_caching` | subgraph fetches (none here) | ❌ (no-op) |
| **REST-layer cache** | the REST HTTP responses | ✅ **this is the lever** |

## What I'd actually do, in order

1. **Keep operation caching on** (already verified). It's a cheap parse/validate/plan win — leave it.

2. **Put a caching HTTP proxy in front of the mock REST services** — this is the real performance move. Since the extension only does `network` and ignores `Cache-Control`, the cache has to live *between the extension and the REST APIs*. A small Redis-backed reverse proxy (nginx `proxy_cache`, Varnish, or a tiny Redis-caching sidecar) keyed on method+path+`X-Api-Key`, with a short TTL matching how fresh the insurance data must be. This collapses the `@derive` fan-out — repeated `Fund` lookups for the same `id` become one upstream call.

3. **Reduce the fan-out itself if the mock APIs allow it** — a batch endpoint (`GET /funds?ids=1,2,3`) resolved by one `@rest` call beats N per-id calls. Cheaper than any cache because the round-trips never happen. Worth checking whether the REST services expose batch/list routes.

4. **Leave the `[entity_caching]` block as-is** — documented template, correct config, zero cost. Revisit only if you split subgraphs for real reasons.

Net: **operation caching (keep) + a REST-layer proxy cache (add) + batch the fan-out (if possible)** gives you the performance win. Entity caching and subgraph-splitting don't belong on that list for this topology.

Want me to sketch the proxy-cache setup (a `redis`-backed nginx `proxy_cache` service in your existing [docker-compose.yml](docker-compose.yml), sitting in front of the three mock APIs)? I can add it as a documented option without changing the current default.