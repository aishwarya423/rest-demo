/**
 * ===========================================================================
 * CACHE INVALIDATION SERVICE
 * ===========================================================================
 * Standalone HTTP service that purges the subgraph response caches by talking
 * to Redis/Valkey directly. It imports nothing from Hive Router and nothing
 * from the subgraphs. That is the requirement: invalidation must be drivable
 * from OUTSIDE the router, by whatever system knows the data changed.
 *
 * ---------------------------------------------------------------------------
 * REDIS LAYOUT (written by @envelop/response-cache-redis)
 * ---------------------------------------------------------------------------
 *   <responseId>       STRING  the cached JSON response body
 *   ops:<responseId>   SET     every tag that response carries
 *   <Typename>         SET     responseIds containing that type
 *   <Typename>:<id>    SET     responseIds containing that entity
 *
 * Tags are real Redis SETs. Purging one entity is SMEMBERS on its tag, not a
 * keyspace scan, so cost scales with the size of the tag rather than the size
 * of the cache.
 *
 * Purge algorithm for Account:acct-1001:
 *   1. SMEMBERS Account:acct-1001            -> affected responseIds
 *   2. for each responseId:
 *        SMEMBERS ops:<responseId>           -> every tag it is filed under
 *        SREM <each tag> <responseId>        -> unfile it, leaving no dangling
 *        DEL ops:<responseId>                -> drop its tag index
 *        DEL <responseId>                    -> drop the cached body
 *   3. DEL Account:acct-1001                 -> drop the now-empty tag
 *
 * Step 2's inner SMEMBERS is what keeps the other tags clean. Without it, the
 * Policy and Fund tags would keep pointing at a response that no longer exists.
 */
import http from 'node:http';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://valkey:6379';
const PORT = Number(process.env.PORT ?? 8090);

// Key namespaces, mirroring hive-router-poc/subgraphs/src/cache.mjs.
const RESPONSE_PREFIX = 'sg:';
const OPS_PREFIX = 'ops:';

const redis = new Redis(REDIS_URL);
redis.on('error', (error) => console.error(`redis error: ${error.message}`));

/** Cursor-based key lookup. Never KEYS in a hot path; it blocks Redis. */
async function scan(pattern) {
  const found = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

/**
 * Work out everything that must be removed for one tag, without removing it.
 * Returns the plan so it can be previewed as well as executed.
 */
async function planPurge(tag) {
  const responseIds = await redis.smembers(tag);

  const bodyKeys = [];
  const opsKeys = [];
  const srems = new Map(); // tag -> Set<responseId>

  for (const responseId of responseIds) {
    bodyKeys.push(responseId);
    opsKeys.push(`${OPS_PREFIX}${responseId}`);

    // Every tag this response is filed under, so none is left dangling.
    for (const otherTag of await redis.smembers(`${OPS_PREFIX}${responseId}`)) {
      if (!srems.has(otherTag)) srems.set(otherTag, new Set());
      srems.get(otherTag).add(responseId);
    }
  }

  return {
    tag,
    responseIds,
    bodyKeys,
    opsKeys,
    untagFrom: [...srems.keys()].sort(),
  };
}

async function executePurge(tag) {
  const plan = await planPurge(tag);
  if (plan.responseIds.length === 0) {
    return { ...plan, deleted: 0, untagged: 0 };
  }

  const pipeline = redis.pipeline();

  for (const responseId of plan.responseIds) {
    pipeline.del(responseId);
    pipeline.del(`${OPS_PREFIX}${responseId}`);
  }

  let untagged = 0;
  for (const otherTag of plan.untagFrom) {
    pipeline.srem(otherTag, ...plan.responseIds);
    untagged += 1;
  }

  // The purged tag itself is now empty.
  pipeline.del(tag);

  await pipeline.exec();

  console.log(`[purge] ${tag} -> ${plan.responseIds.length} responses, ${untagged} tags updated`);
  return { ...plan, deleted: plan.bodyKeys.length + plan.opsKeys.length + 1, untagged };
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const ROUTES = [
  'GET    /health',
  'GET    /cache/keys?pattern=sg:*',
  'GET    /cache/tags?pattern=*',
  'GET    /cache/entity/:type/:id        (preview)',
  'DELETE /cache/entity/:type/:id        (purge one entity)',
  'GET    /cache/type/:type              (preview)',
  'DELETE /cache/type/:type              (purge a whole type)',
  'DELETE /cache/key?key=<responseId>    (purge one exact entry)',
  'DELETE /cache/subgraph/:name          (purge one subgraph)',
  'POST   /cache/flush',
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, { ok: true, redis: redis.status });
    }

    // Every cached response body.
    if (req.method === 'GET' && path === '/cache/keys') {
      const pattern = url.searchParams.get('pattern') ?? `${RESPONSE_PREFIX}*`;
      const keys = (await scan(pattern)).sort();
      return json(res, 200, { pattern, count: keys.length, keys });
    }

    // Every tag SET, with its member count. The tag index, human readable.
    if (req.method === 'GET' && path === '/cache/tags') {
      const pattern = url.searchParams.get('pattern') ?? '*';
      const tags = {};
      for (const key of await scan(pattern)) {
        if (key.startsWith(RESPONSE_PREFIX) || key.startsWith(OPS_PREFIX)) continue;
        if ((await redis.type(key)) !== 'set') continue;
        tags[key] = await redis.smembers(key);
      }
      return json(res, 200, { count: Object.keys(tags).length, tags });
    }

    // Entity-level: /cache/entity/Account/acct-1001
    if (seg[0] === 'cache' && seg[1] === 'entity' && seg.length === 4) {
      const tag = `${seg[2]}:${decodeURIComponent(seg[3])}`;
      if (req.method === 'GET') return json(res, 200, { action: 'preview', ...(await planPurge(tag)) });
      if (req.method === 'DELETE') return json(res, 200, { action: 'purge', ...(await executePurge(tag)) });
    }

    // Type-level: /cache/type/Fund  (every Fund, any id)
    if (seg[0] === 'cache' && seg[1] === 'type' && seg.length === 3) {
      const typename = seg[2];
      if (req.method === 'GET') return json(res, 200, { action: 'preview', ...(await planPurge(typename)) });
      if (req.method === 'DELETE') {
        // The bare typename tag covers responses with no id, and each
        // Typename:id tag covers the rest.
        const results = [await executePurge(typename)];
        for (const entityTag of await scan(`${typename}:*`)) {
          results.push(await executePurge(entityTag));
        }
        const deleted = results.reduce((sum, r) => sum + r.deleted, 0);
        return json(res, 200, {
          action: 'purge-type',
          typename,
          tagsPurged: results.length,
          deleted,
        });
      }
    }

    // One exact cached response.
    if (req.method === 'DELETE' && path === '/cache/key') {
      const key = url.searchParams.get('key');
      if (!key) return json(res, 400, { error: 'missing ?key=' });

      // Unfile it from every tag first, so no tag is left pointing at it.
      const tags = await redis.smembers(`${OPS_PREFIX}${key}`);
      const pipeline = redis.pipeline();
      for (const tag of tags) pipeline.srem(tag, key);
      pipeline.del(`${OPS_PREFIX}${key}`);
      pipeline.del(key);
      await pipeline.exec();

      return json(res, 200, { action: 'delete', key, untaggedFrom: tags, deleted: 1 });
    }

    // Everything one subgraph cached. Useful after redeploying it.
    if (req.method === 'DELETE' && seg[0] === 'cache' && seg[1] === 'subgraph' && seg.length === 3) {
      const subgraph = seg[2];
      const bodies = await scan(`${RESPONSE_PREFIX}${subgraph}:*`);
      let deleted = 0;
      for (const key of bodies) {
        const tags = await redis.smembers(`${OPS_PREFIX}${key}`);
        const pipeline = redis.pipeline();
        for (const tag of tags) pipeline.srem(tag, key);
        pipeline.del(`${OPS_PREFIX}${key}`);
        pipeline.del(key);
        await pipeline.exec();
        deleted += 1;
      }
      return json(res, 200, { action: 'purge-subgraph', subgraph, deleted });
    }

    if (req.method === 'POST' && path === '/cache/flush') {
      const before = await redis.dbsize();
      await redis.flushdb();
      return json(res, 200, { action: 'flush', keysBefore: before });
    }

    return json(res, 404, { error: 'not found', routes: ROUTES });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: String(error?.message ?? error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`invalidator listening on :${PORT} (redis=${REDIS_URL})`);
});
