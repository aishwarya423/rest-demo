# Caching and invalidation

Everything here is implemented in two files:

- `hive-router-poc/subgraphs/src/cache.mjs` — the response cache
- `hive-router-poc/invalidator/server.js` — the purge API

Read both before changing either. They share a Redis layout, and a change to
one that is not mirrored in the other leaves dangling tags.

## Contents

- [Why the cache is in the subgraphs](#why-the-cache-is-in-the-subgraphs)
- [The Redis layout](#the-redis-layout)
- [Cache key format](#cache-key-format)
- [Settings that must not be changed casually](#settings-that-must-not-be-changed-casually)
- [TTL](#ttl)
- [Invalidation](#invalidation)
- [Adding a purge route](#adding-a-purge-route)
- [Proving cache behaviour](#proving-cache-behaviour)
- [Measured results](#measured-results)

## Why the cache is in the subgraphs

Hive Router has no response cache. Its `cache` config key tunes in-memory
parsing, validation, normalization and query-plan caches — these make repeat
*planning* cheap, and remove zero upstream calls. Treating that key as a
response cache is the most common mistake made against this stack.

So the cache had to go somewhere else, and the subgraph turned out to be a
better home than the gateway would have been:

- The router's own entity-resolution calls (`_entities`) pass through it, so a
  federated query is served from cache **piece by piece**. After purging one
  account, a deep query costs 2 REST calls rather than 5 — the fund data is
  still cached.
- Each subgraph owns the TTL for the data it owns, which is where that decision
  belongs.
- One subgraph's cache can be purged without touching the others.

The stack is `@graphql-yoga/plugin-response-cache` for the caching behaviour,
with `@envelop/response-cache-redis` as the Redis-backed store.

## The Redis layout

Written by `@envelop/response-cache-redis`:

```
<responseId>              STRING  the cached JSON response body
ops:<responseId>          SET     every tag this response carries
<Typename>                SET     responseIds containing that type
<Typename>:<id>           SET     responseIds containing that entity
```

Two properties matter and are worth preserving in any redesign:

**Tags are real Redis SETs**, maintained with `SADD` and read with `SMEMBERS`.
Invalidating one entity costs O(size of that tag), not O(keyspace). A design
that stores flat keys and finds them with `SCAN` degrades as the cache grows.

**Nothing parses keys positionally**, so colons inside keys are safe. This is
worth stating because the Hive Gateway / Mesh response cache does the opposite
on both counts — flat keys plus `SCAN`, and a colon in a cache key silently
breaks its invalidation, because it splits the key on `:` and reads a fixed
index. If you ever port this design to Gateway, that constraint is undocumented
and will bite.

## Cache key format

```
sg:<subgraph>:<operation>:<variables>:<documentHash8>

sg:accounts:AccountById:id=acct-1001:3f21ab09
sg:policies:entities:Account~acct-1001:9c0d1e77
```

Built in `buildResponseCacheKey`. The format is ours, chosen so that
`redis-cli --scan` is readable by a human debugging a miss.

Three pieces of machinery keep it readable:

**`fingerprintVariables`** renders scalars as `name=value`, and the federation
`representations` array as sorted `Typename~id` pairs. A batch of more than four
collapses to `first+Nmore#hash` so a 500-entity fetch cannot produce an
unbounded key.

**`resolveOperationLabel`** recovers a name when `operationName` is absent. The
router does not name its entity fetches, so without this every router-driven key
would read `anonymous`. It detects `_entities(` and labels those `entities`,
otherwise it parses the operation name out of the document.

**`forward_operation_name: true`** in both router configs. Without it the router
sends anonymous operations and every root-fetch key reads `anonymous`. It costs
nothing and makes the keyspace legible — if keys suddenly go anonymous, check
this setting first.

## Settings that must not be changed casually

**`buildRedisEntityId` is left at its default (`Typename:id`).** Type-level
invalidation matches the pattern `<Typename>:*` — with `SCAN ... MATCH`, not
`KEYS`; see the note further down. Prefixing entity ids would make that pattern
match nothing, and the failure is silent: purges would report success and purge
nothing. The comment in `cache.mjs` says this; keep it there.

**`buildRedisOperationResultCacheKey` is `ops:<responseId>`.** Used symmetrically
on write and on invalidate, so changing it is safe *provided* the invalidator's
`OPS_PREFIX` changes with it. These two constants are a pair.

**`session: () => null`** puts everything in one shared bucket, which is correct
because these REST payloads are not user-specific. If per-user data is ever
introduced, return a validated user id here and mark the private coordinates
with `scopePerSchemaCoordinate` — do not leave this returning null and hope.

**Redis errors are logged, not thrown.** A dead cache degrades to "always miss",
never to 500s. Preserve that property.

## TTL

Defaults live in `subgraphs/src/server.mjs`, overridable per subgraph by env:

| Subgraph | Default | Reasoning |
|---|---|---|
| `accounts` | 30 s | balances move |
| `policies` | 120 s | changes on renewal |
| `funds` | 300 s | reference data, changes daily at most |

Override with `ACCOUNTS_TTL_MS`, `POLICIES_TTL_MS`, `FUNDS_TTL_MS`. Per-type
overrides within a subgraph go through `ttlPerType`, which is wired up but
currently empty — it is the hook to reach for when one type in a subgraph needs
different freshness from the rest.

## Invalidation

The invalidator is a standalone HTTP service that talks **only to Redis**. It
imports nothing from Hive Router and nothing from the subgraphs. That
independence is a requirement, not an accident: invalidation has to be drivable
from outside, by whatever system knows the data changed.

Purge algorithm for `Account:acct-1001`:

```
1. SMEMBERS Account:acct-1001         -> affected responseIds
2. for each responseId:
     SMEMBERS ops:<responseId>        -> every tag it is filed under
     SREM <each tag> <responseId>     -> unfile it, leaving no dangling member
     DEL ops:<responseId>             -> drop its tag index
     DEL <responseId>                 -> drop the cached body
3. DEL Account:acct-1001              -> drop the now-empty tag
```

Step 2's inner `SMEMBERS` is the part that is easy to omit and important to
keep. Without it the Policy and Fund tags keep pointing at a response that no
longer exists, and those dangling members accumulate silently until a later
purge walks a tag full of ids that resolve to nothing.

`planPurge` computes the whole plan without executing it; `executePurge` runs
`planPurge` and then applies it in a single pipeline. Every destructive route
has a `GET` twin that returns the plan — use it to show what *would* happen.

### Routes

```
GET    /health
GET    /cache/keys?pattern=sg:*
GET    /cache/tags?pattern=*
GET    /cache/entity/:type/:id        preview
DELETE /cache/entity/:type/:id        purge one entity
GET    /cache/type/:type              preview
DELETE /cache/type/:type              purge a whole type
DELETE /cache/key?key=<responseId>    purge one exact entry
DELETE /cache/subgraph/:name          purge everything one subgraph cached
POST   /cache/flush
```

`/cache/type/:type` purges both the bare typename tag (responses with no id) and
every `Typename:*` entity tag, which is why it is a loop rather than one call.

`SCAN` is used for key lookup, never `KEYS` — `KEYS` blocks Redis and this runs
in a request path.

## Adding a purge route

Follow the existing shape so the new route behaves like the others:

1. Add it to the `ROUTES` array, so a 404 advertises it.
2. Implement `GET` (preview) and `DELETE` (execute) together. Preview should be
   `planPurge`-based and must not mutate.
3. Reuse `planPurge` / `executePurge` rather than writing new Redis logic — they
   already handle the unfiling step correctly.
4. Pipeline the writes.
5. If the route introduces a new key namespace, mirror the constant in
   `cache.mjs` and say so in both files' header comments.

## Proving cache behaviour

`rest.mjs` logs every upstream call. On a cache hit it prints nothing at all —
that is the proof, and it is far stronger than a latency measurement, because
the mock REST services answer in microseconds over loopback and timing is noisy.

```bash
# watch the upstream calls in one pane
docker compose -f hive-router-poc/docker-compose.yml logs -f \
  accounts-subgraph policies-subgraph funds-subgraph

# first call: MISS, REST GET lines appear
# same call again: HIT, no new lines

# what landed, and the tag index
curl -s localhost:8090/cache/keys | jq
curl -s localhost:8090/cache/tags | jq

# preview, then purge
curl -s localhost:8090/cache/entity/Account/acct-1001 | jq
curl -s -X DELETE localhost:8090/cache/entity/Account/acct-1001 | jq
```

`CACHE_EXTENSION_METADATA=1` adds `extensions.responseCache.hit` to responses
from a *direct* subgraph query, which is convenient in a demo and noisy in
production. It does not appear on router responses.

`CACHE_ENABLED=0` turns the cache off entirely, which is the cleanest way to
get a baseline.

## Measured results

From `hive-router-poc/README.md`, measured on the `InsurancePortfolio` query:

| Observation | Result |
|---|---|
| REST calls on a miss | 5 |
| REST calls on a hit | **0** |
| REST calls after purging one account | **2, not 5** — funds still cached |
| Cached pieces per deep query | 4, one per query-plan step |
| Purging `Account:acct-1001` | 7 keys deleted, 9 tag SETs updated, 3 responses gone |
| Unrelated `FundDetail` response | survived |
| Dangling tag members after purge | **none** |

Latency on this stack: cold miss 6.1–8.5 ms, warm hit 2.6–2.9 ms. Quote the
REST-call numbers in preference to the timings — the timings are dominated by
loopback mocks and do not generalise.
