import { createHash } from 'node:crypto';
import { defineConfig } from '@graphql-hive/gateway';
import useHTTPCache from '@graphql-mesh/plugin-http-cache';

/**
 * ---------------------------------------------------------------------------
 * CACHE KEY STRATEGY
 * ---------------------------------------------------------------------------
 * Hive Gateway's response cache stores three kinds of Redis keys. All of them
 * are written to Redis VERBATIM (@graphql-mesh/cache-redis adds no prefix of
 * its own), so every key below is greppable with `redis-cli --scan`:
 *
 *   1. response-cache:<responseId>                      -> the cached JSON body
 *   2. response-cache:<Type>.<id>:<responseId>          -> entity  -> response
 *   3. response-cache:<responseId>:<Type>.<id>          -> response -> entity
 *
 * (2) and (3) are the built-in "cache tag" index. Invalidating an entity means
 * scanning prefix (2) and deleting every responseId it points at.
 *
 * <responseId> is whatever `buildResponseCacheKey` returns. By default it is an
 * opaque SHA-256. We override it below to produce a readable, predictable id.
 *
 * !! HARD CONSTRAINT !!
 * The responseId MUST NOT contain a colon. Hive's invalidation routine parses
 * the entity index key with `key.split(':')` and reads index [2] as the
 * responseId. A colon inside the responseId shifts that index and silently
 * breaks invalidation. So we use dots and dashes as separators, never colons.
 * That is why keys read `gql.account.acct-1001...` and not `gql:account:1001`.
 */
function sanitize(value: unknown): string {
  return String(value).replace(/[:\s]/g, '_');
}

function fingerprintVariables(variableValues: Record<string, unknown> | null | undefined): string {
  const entries = Object.entries(variableValues ?? {});
  if (entries.length === 0) return 'novars';
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${sanitize(key)}-${sanitize(value)}`)
    .join('_');
}

export const gatewayConfig = defineConfig({
  // The composed supergraph produced by Mesh Compose (build-time artifact).
  supergraph: process.env.SUPERGRAPH_PATH ?? '../supergraph.graphql',

  // ---------------------------------------------------------------------
  // Shared cache storage. Everything below (response cache, HTTP cache)
  // writes through this one Redis/Valkey connection.
  // ---------------------------------------------------------------------
  cache: {
    type: 'redis',
    url: process.env.REDIS_URL ?? 'redis://redis:6379',
    lazyConnect: false,
  },

  // ---------------------------------------------------------------------
  // GraphQL response caching. This is the layer that stops REST calls.
  // ---------------------------------------------------------------------
  responseCaching: {
    // One shared cache bucket. Return a validated user/tenant id here to
    // partition the cache per caller instead.
    session: () => null,

    // Default TTL for anything not listed below (milliseconds).
    ttl: 60_000,

    // Per-type / per-field TTL. Longest-lived data first.
    ttlPerSchemaCoordinate: {
      Fund: 300_000,    // reference data, changes rarely
      Policy: 120_000,
      Account: 30_000,  // most volatile
    },

    // Which field identifies an entity. Drives the `<Type>.<id>` tag keys.
    idFields: ['id'],

    // Auto-invalidate cached responses when a mutation returns a mutated
    // entity. Harmless here (the REST APIs are read-only) but left on so the
    // behaviour is visible once mutations are added.
    invalidateViaMutation: true,

    // Readable, predictable response ids. See the header comment for why
    // colons are forbidden.
    buildResponseCacheKey: async ({ documentString, variableValues, operationName, sessionId }) => {
      const op = sanitize(operationName ?? 'anonymous');
      const vars = fingerprintVariables(variableValues as Record<string, unknown>);
      // Hash of the document so two different selection sets on the same
      // operation name never collide.
      const shape = createHash('sha256').update(documentString).digest('hex').slice(0, 8);
      const scope = sessionId ? `.s-${sanitize(sessionId)}` : '';
      return `gql.${op}.${vars}.${shape}${scope}`;
    },
  },

  // ---------------------------------------------------------------------
  // OPTIONAL second layer: cache the raw REST/HTTP responses.
  //
  // Keys are `http-cache-<url>-<method>-<body>`, e.g.
  //   http-cache-http://accounts-rest:3001/accounts/acct-1001-GET-undefined
  //
  // PREREQUISITE: this plugin obeys RFC 9111 via `http-cache-semantics`. A REST
  // response with no `Cache-Control` header is treated as immediately stale and
  // nothing is stored. Enable this only after the REST services emit
  // `Cache-Control: max-age=N`. Off by default so the POC needs zero changes to
  // the existing REST APIs.
  // ---------------------------------------------------------------------
  plugins: (ctx) =>
    process.env.ENABLE_HTTP_CACHE === '1'
      ? [
          useHTTPCache({
            cache: ctx.cache,
            matches: ['http://accounts-rest:*', 'http://policies-rest:*', 'http://funds-rest:*'],
            logger: ctx.logger,
          }),
        ]
      : [],

  // Serve GraphiQL at / for the demo.
  graphiql: true,
  landingPage: false,
  maskedErrors: false,
});
