/**
 * ===========================================================================
 * OPTIONAL: real Redis SET-based cache tags
 * ===========================================================================
 * Hive Gateway's response cache records "which responses contain entity X" as
 * one Redis STRING per (entity, response) pair:
 *
 *     response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759
 *
 * To invalidate an entity it then calls `getKeysByPrefix('response-cache:Account.acct-1001:')`,
 * which the Redis adapter implements as a SCAN across the WHOLE keyspace.
 * That is O(total keys) per invalidation — fine for a POC, wasteful once the
 * cache holds millions of keys.
 *
 * This wrapper keeps the exact same behaviour but maintains a parallel Redis
 * SET per tag, so lookups become SMEMBERS — O(size of that tag) instead:
 *
 *     SADD     tag:Account.acct-1001  gql.AccountOverview.id-acct-1001.737e0759
 *     SMEMBERS tag:Account.acct-1001
 *
 * Nothing in Hive is forked or patched. `KeyValueCache` is the documented
 * extension point; we simply implement it.
 *
 * ---------------------------------------------------------------------------
 * ENABLE IT
 * ---------------------------------------------------------------------------
 * In gateway.config.ts, replace the declarative `cache: { type: 'redis', ... }`
 * block with:
 *
 *     import { createTaggedRedisCache } from './tagged-cache';
 *     ...
 *     cache: createTaggedRedisCache({ url: process.env.REDIS_URL! }),
 *
 * The invalidator service keeps working unchanged, and additionally gains the
 * option of reading `tag:<Type>.<id>` directly:
 *
 *     SMEMBERS tag:Account.acct-1001
 * ---------------------------------------------------------------------------
 */
import Redis from 'ioredis';

/**
 * Must match the prefix produced by `buildResponseCacheKey` in gateway.config.ts.
 * It is how we tell a forward index key (entity -> response) apart from a
 * reverse index key (response -> entity); both have the same three-segment
 * shape, and only the forward one is ever queried by prefix.
 */
const RESPONSE_ID_PREFIX = 'gql.';
const CACHE_PREFIX = 'response-cache:';
const TAG_PREFIX = 'tag:';

export interface TaggedRedisCacheOptions {
  url: string;
  /** Safety net so tag sets cannot outlive their entries. Seconds. */
  tagTtlSeconds?: number;
}

/**
 * Split `response-cache:<a>:<b>` and report whether it is a forward index key
 * (i.e. <a> is an entity tag and <b> is a response id).
 */
function parseForwardIndexKey(key: string): { tag: string; responseId: string } | null {
  if (!key.startsWith(CACHE_PREFIX)) return null;
  const rest = key.slice(CACHE_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator === -1) return null; // plain body key, not an index key

  const tag = rest.slice(0, separator);
  const responseId = rest.slice(separator + 1);

  // Reverse index keys have the response id first — skip those.
  if (tag.startsWith(RESPONSE_ID_PREFIX)) return null;
  if (!responseId.startsWith(RESPONSE_ID_PREFIX)) return null;

  return { tag, responseId };
}

export function createTaggedRedisCache({ url, tagTtlSeconds = 86_400 }: TaggedRedisCacheOptions) {
  const redis = new Redis(url);

  return {
    async get(key: string) {
      const value = await redis.get(key);
      return value == null ? undefined : JSON.parse(value);
    },

    async set(key: string, value: unknown, options?: { ttl?: number }) {
      const payload = JSON.stringify(value);
      const pipeline = redis.pipeline();

      if (options?.ttl && options.ttl > 0) {
        pipeline.set(key, payload, 'PX', options.ttl * 1000);
      } else {
        pipeline.set(key, payload);
      }

      // Mirror forward index keys into a real Redis SET.
      const parsed = parseForwardIndexKey(key);
      if (parsed) {
        const tagKey = `${TAG_PREFIX}${parsed.tag}`;
        pipeline.sadd(tagKey, parsed.responseId);
        pipeline.expire(tagKey, tagTtlSeconds);
      }

      await pipeline.exec();
    },

    async delete(key: string) {
      const parsed = parseForwardIndexKey(key);
      const pipeline = redis.pipeline();
      pipeline.del(key);
      if (parsed) {
        pipeline.srem(`${TAG_PREFIX}${parsed.tag}`, parsed.responseId);
      }
      await pipeline.exec();
    },

    /**
     * The hot path. Hive calls this with `response-cache:<Type>.<id>:` when
     * invalidating an entity. Answer from the SET instead of scanning.
     */
    async getKeysByPrefix(prefix: string): Promise<string[]> {
      const withoutPrefix = prefix.startsWith(CACHE_PREFIX) ? prefix.slice(CACHE_PREFIX.length) : null;

      if (withoutPrefix?.endsWith(':')) {
        const tag = withoutPrefix.slice(0, -1);
        if (!tag.startsWith(RESPONSE_ID_PREFIX)) {
          const responseIds = await redis.smembers(`${TAG_PREFIX}${tag}`);
          return responseIds.map((responseId) => `${CACHE_PREFIX}${tag}:${responseId}`);
        }
      }

      // Anything else (including reverse-index lookups): fall back to SCAN.
      const found: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
        cursor = next;
        found.push(...batch);
      } while (cursor !== '0');
      return found;
    },

    async [Symbol.asyncDispose]() {
      await redis.quit();
    },
  };
}
