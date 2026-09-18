/**
 * Cache Invalidation Service
 * ---------------------------------------------------------------------------
 * A standalone HTTP service that invalidates Hive Gateway's Redis cache by
 * talking to Redis DIRECTLY. It imports nothing from Hive. That is the point:
 * it proves cache invalidation does not have to live inside the gateway, so
 * your existing REST services (or a CDC stream, or an ops runbook) can drive it.
 *
 * Redis layout written by Hive Gateway's response cache:
 *
 *   response-cache:<responseId>                 STRING  the cached JSON body
 *   response-cache:<Type>.<id>:<responseId>     STRING  entity   -> response  (tag)
 *   response-cache:<responseId>:<Type>.<id>     STRING  response -> entity    (reverse tag)
 *   http-cache-<url>-<method>-<body>            STRING  raw REST response (optional layer)
 *
 * Invalidating `Account acct-1001` means: find every response tagged with
 * `Account.acct-1001`, delete those response bodies, and delete both index
 * directions so no dangling tags remain.
 */
import http from 'node:http';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const PORT = Number(process.env.PORT ?? 8090);
const PREFIX = 'response-cache:';

const redis = new Redis(REDIS_URL);

/** Non-blocking key lookup. Never use KEYS in production; SCAN is cursor-based. */
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
 * Resolve every Redis key that must die when <Type>.<id> changes.
 * Mirrors the algorithm Hive Gateway uses internally.
 */
async function resolveKeysForEntity(typename, id) {
  const tag = `${typename}.${id}`;
  const forwardIndexKeys = await scan(`${PREFIX}${tag}:*`);

  const responseIds = new Set();
  for (const key of forwardIndexKeys) {
    // response-cache:Account.acct-1001:gql.AccountOverview.id-acct-1001.737e0759
    //      [0]              [1]                       [2]
    // This positional split is exactly what Hive Gateway does internally, and
    // it is why neither the response id nor an entity id may contain a colon.
    const responseId = key.split(':')[2];
    if (responseId) responseIds.add(responseId);
  }

  const doomed = new Set(forwardIndexKeys);
  for (const responseId of responseIds) {
    doomed.add(`${PREFIX}${responseId}`); // the cached body itself

    // Walk the reverse index to find EVERY entity this response was tagged
    // with, not just the one being invalidated. Without this, the other
    // entities keep a forward tag pointing at a response that no longer
    // exists, and those dangling keys accumulate forever.
    for (const reverseKey of await scan(`${PREFIX}${responseId}:*`)) {
      doomed.add(reverseKey);
      // response-cache:<responseId>:<Type>.<id>  ->  the matching forward key
      const otherTag = reverseKey.split(':')[2];
      if (otherTag) doomed.add(`${PREFIX}${otherTag}:${responseId}`);
    }
  }

  return { tag, responseIds: [...responseIds], keys: [...doomed] };
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);

  try {
    // GET /health
    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, { ok: true, redis: redis.status });
    }

    // GET /cache/keys?pattern=response-cache:*
    if (req.method === 'GET' && path === '/cache/keys') {
      const pattern = url.searchParams.get('pattern') ?? `${PREFIX}*`;
      const keys = await scan(pattern);
      return json(res, 200, { pattern, count: keys.length, keys: keys.sort() });
    }

    // GET /cache/entity/:type/:id  -> preview what WOULD be deleted
    if (req.method === 'GET' && segments[0] === 'cache' && segments[1] === 'entity' && segments.length === 4) {
      const [, , typename, id] = segments;
      const plan = await resolveKeysForEntity(typename, decodeURIComponent(id));
      return json(res, 200, { action: 'preview', ...plan });
    }

    // DELETE /cache/entity/:type/:id  -> THE invalidation endpoint
    if (req.method === 'DELETE' && segments[0] === 'cache' && segments[1] === 'entity' && segments.length === 4) {
      const [, , typename, id] = segments;
      const plan = await resolveKeysForEntity(typename, decodeURIComponent(id));
      const deleted = plan.keys.length ? await redis.del(...plan.keys) : 0;
      console.log(`[invalidate] ${plan.tag} -> ${deleted} keys deleted`);
      return json(res, 200, { action: 'invalidate', ...plan, deleted });
    }

    // DELETE /cache/key?key=response-cache:gql....  -> explicit single-key delete
    if (req.method === 'DELETE' && path === '/cache/key') {
      const key = url.searchParams.get('key');
      if (!key) return json(res, 400, { error: 'missing ?key=' });
      const deleted = await redis.del(key);
      return json(res, 200, { action: 'delete', key, deleted });
    }

    // DELETE /cache/rest?url=http://accounts-rest:3001/accounts/acct-1001
    // Removes the optional HTTP-layer cache entry for one upstream REST call.
    if (req.method === 'DELETE' && path === '/cache/rest') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, 400, { error: 'missing ?url=' });
      const method = (url.searchParams.get('method') ?? 'GET').toUpperCase();
      const keys = await scan(`http-cache-${target}-${method}-*`);
      const deleted = keys.length ? await redis.del(...keys) : 0;
      return json(res, 200, { action: 'invalidate-rest', target, method, keys, deleted });
    }

    // POST /cache/flush  -> wipe every gateway cache key (demo convenience)
    if (req.method === 'POST' && path === '/cache/flush') {
      const keys = [...(await scan(`${PREFIX}*`)), ...(await scan('http-cache-*'))];
      const deleted = keys.length ? await redis.del(...keys) : 0;
      return json(res, 200, { action: 'flush', deleted });
    }

    return json(res, 404, {
      error: 'not found',
      routes: [
        'GET    /health',
        'GET    /cache/keys?pattern=response-cache:*',
        'GET    /cache/entity/:type/:id',
        'DELETE /cache/entity/:type/:id',
        'DELETE /cache/key?key=<redis key>',
        'DELETE /cache/rest?url=<upstream url>&method=GET',
        'POST   /cache/flush',
      ],
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: String(error?.message ?? error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`invalidator listening on :${PORT} (redis=${REDIS_URL})`);
});
