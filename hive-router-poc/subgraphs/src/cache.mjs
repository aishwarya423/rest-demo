/**
 * ===========================================================================
 * SUBGRAPH-LEVEL RESPONSE CACHE  (Redis / Valkey)
 * ===========================================================================
 * Hive Router has no response cache of any kind, so the cache cannot live in
 * the router. It lives here instead, inside each subgraph, which turns out to
 * be a better place anyway:
 *
 *   - The router's own entity-resolution calls (`_entities`) go through it too,
 *     so a federated query can be served from cache piece by piece.
 *   - Each subgraph owns the TTL for its own data.
 *   - One subgraph's cache can be purged without touching the others.
 *
 * ---------------------------------------------------------------------------
 * REDIS LAYOUT (written by @envelop/response-cache-redis)
 * ---------------------------------------------------------------------------
 *   <responseId>              STRING  the cached JSON response body
 *   ops:<responseId>          SET     every tag this response carries
 *   <Typename>                SET     responseIds containing that type
 *   <Typename>:<id>           SET     responseIds containing that entity
 *
 * The tag indexes are real Redis SETs, maintained with SADD and read with
 * SMEMBERS. Invalidation is therefore O(size of the tag), not a keyspace scan.
 * Colons inside keys are completely safe here, because nothing parses keys
 * positionally. (Hive Gateway's Mesh cache does the opposite on both counts —
 * flat keys plus SCAN, and a colon in the key silently breaks invalidation.)
 *
 * ---------------------------------------------------------------------------
 * CACHE KEY FORMAT  (ours, chosen for readability)
 * ---------------------------------------------------------------------------
 *   sg:<subgraph>:<operation>:<variables>:<documentHash8>
 *
 *   sg:accounts:AccountById:id=acct-1001:3f21ab09
 *   sg:policies:entities:Account~acct-1001:9c0d1e77
 *
 * Entity-resolution calls from the router are unnamed operations whose only
 * variable is a `representations` array. We render those as `entities` plus the
 * typename and id being resolved, so even router-internal fetches are legible
 * in `redis-cli --scan`.
 */
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { createRedisCache } from '@envelop/response-cache-redis';
import { useResponseCache } from '@graphql-yoga/plugin-response-cache';

const shortHash = (input) => createHash('sha256').update(input).digest('hex').slice(0, 8);

/** Keep keys printable. Colons are legal, but whitespace and braces are not helpful. */
const clean = (value) => String(value).replace(/[\s{}"'`]/g, '');

/**
 * Render variables into something a human can read in a Redis key listing.
 *
 * Scalars become `name=value`. The router's `representations` array becomes
 * `Typename~id` pairs. Anything else collapses to a short hash so the key can
 * never grow unbounded.
 */
function fingerprintVariables(variables) {
  const entries = Object.entries(variables ?? {});
  if (entries.length === 0) return 'novars';

  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => {
      if (value == null || typeof value !== 'object') {
        return `${clean(name)}=${clean(value)}`;
      }

      // The federation entity-fetch shape: [{ __typename, id }, ...]
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => item && typeof item === 'object' && item.__typename)
      ) {
        const refs = value
          .map((item) => `${clean(item.__typename)}~${clean(item.id ?? '')}`)
          .sort();
        // Cap the readable form so a 500-entity batch cannot blow up the key.
        return refs.length <= 4 ? refs.join(',') : `${refs[0]}+${refs.length - 1}more#${shortHash(refs.join(','))}`;
      }

      return `${clean(name)}#${shortHash(JSON.stringify(value))}`;
    })
    .join(':');
}

/**
 * Recover a readable operation label.
 *
 * `operationName` is only set when the caller sends it. The router does not
 * name its entity fetches, so without this fallback every router-driven key
 * would read `anonymous` and the whole point of readable keys would be lost.
 */
function resolveOperationLabel(operationName, documentString) {
  if (operationName) return clean(operationName);
  if (/\b_entities\s*\(/.test(documentString)) return 'entities';

  const named = documentString.match(/\b(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/);
  return named ? clean(named[1]) : 'anonymous';
}

/**
 * Build the Yoga response-cache plugin for one subgraph.
 *
 * @param subgraph  short name used as the key namespace, e.g. 'accounts'
 * @param redisUrl  redis:// or rediss:// URL
 * @param ttl       default TTL in milliseconds
 * @param ttlPerType per-type overrides in milliseconds
 */
export function createResponseCachePlugin({ subgraph, redisUrl, ttl, ttlPerType = {} }) {
  const redis = new Redis(redisUrl, { lazyConnect: false });

  redis.on('error', (error) => {
    // Never let a cache outage take the subgraph down. A dead Redis should
    // degrade to "always miss", not to 500s.
    console.error(`[${subgraph}] redis error: ${error.message}`);
  });

  const cache = createRedisCache({
    redis,
    // Namespace the response -> tags index. Used symmetrically on write and on
    // invalidate, so changing it is safe.
    buildRedisOperationResultCacheKey: (responseId) => `ops:${responseId}`,
    // LEAVE buildRedisEntityId AT ITS DEFAULT (`Typename:id`).
    // Invalidating a whole type runs `KEYS <Typename>:*`, so prefixing entity
    // ids here would make type-level invalidation silently match nothing.
  });

  const plugin = useResponseCache({
    cache,
    // One shared cache bucket. These REST payloads are not user-specific.
    // For per-user data, return a validated user id here and mark private
    // coordinates with `scopePerSchemaCoordinate`.
    session: () => null,
    ttl,
    ttlPerType,
    // Which field identifies an entity. Drives the `<Typename>:<id>` tag SETs.
    idFields: ['id'],
    // Adds `extensions.responseCache.hit` so a direct subgraph query shows
    // hit/miss without reading Redis. Handy in the demo, noisy in production.
    includeExtensionMetadata: process.env.CACHE_EXTENSION_METADATA === '1',
    buildResponseCacheKey: async ({ documentString, variableValues, operationName }) => {
      const operation = resolveOperationLabel(operationName, documentString);
      const variables = fingerprintVariables(variableValues);
      return `sg:${subgraph}:${operation}:${variables}:${shortHash(documentString)}`;
    },
  });

  return { plugin, redis };
}
