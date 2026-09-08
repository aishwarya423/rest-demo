// =============================================================================
// Shared REST-cache layer for the federation subgraphs (accounts / policies /
// funds).
//
// Every subgraph in subgraphs/ is a thin GraphQL facade over one REST service.
// Instead of letting the gateway cache whole GraphQL responses, EACH SUBGRAPH
// caches the individual REST calls it makes, in Valkey/Redis, under a key
// derived from the route:
//
//     subgraph:<service>:<route>
//     e.g. subgraph:accounts:/accounts/acct-1001
//
// and registers that key in one Valkey SET per entity TAG:
//
//     tag:Account            -> { subgraph:accounts:/accounts/acct-1001, ... }
//     tag:Account:acct-1001  -> { subgraph:accounts:/accounts/acct-1001,
//                                 subgraph:policies:/accounts/acct-1001/policies }
//
// A purge then needs no knowledge of individual cache keys — POST /purge
// {"tags":["Account:acct-1001"]} on any subgraph's management port drops every
// entry registered under that tag, ACROSS services.
//
// Watch it happen:  docker exec -it <valkey-container> valkey-cli MONITOR
// =============================================================================
const http = require("http");
const Redis = require("ioredis");

// ---------------------------------------------------------------------------
// Entity tagging
//
// Each cached entry carries a list of tags (e.g. ["Account", "Account:acct-1001"])
// derived from the REST route. Tags are stored as Valkey SETs:
//
//     tag:Account:acct-1001  →  { subgraph:accounts:/accounts/acct-1001, ... }
//
// Invalidating a tag (e.g. POST /purge {"tags":["Account:acct-1001"]}) deletes
// every cache entry that registered that tag in one operation — no need to
// know individual cache keys.
// ---------------------------------------------------------------------------
function tagsForRoute(route) {
  // Patterns we understand. Order matters — more specific patterns first.
  const patterns = [
    // /accounts/{id}/policies → tied to that account + the Policy collection
    { re: /^\/accounts\/([^/]+)\/policies$/, tags: (m) => [`Account:${m[1]}`, "Policy"] },
    // /accounts/{id}/funds → tied to that account + the Fund collection
    { re: /^\/accounts\/([^/]+)\/funds$/, tags: (m) => [`Account:${m[1]}`, "Fund"] },
    // /accounts/{id}
    { re: /^\/accounts\/([^/]+)$/, tags: (m) => ["Account", `Account:${m[1]}`] },
    // /accounts (list)
    { re: /^\/accounts$/, tags: () => ["Account"] },
    // /customers/{id}/accounts → tied to that customer + Account collection
    { re: /^\/customers\/([^/]+)\/accounts$/, tags: (m) => [`Customer:${m[1]}`, "Account"] },
    // /policies/{id}
    { re: /^\/policies\/([^/]+)$/, tags: (m) => ["Policy", `Policy:${m[1]}`] },
    // /policies (list)
    { re: /^\/policies$/, tags: () => ["Policy"] },
    // /funds/{id}/policies → tied to that fund + Policy collection
    { re: /^\/funds\/([^/]+)\/policies$/, tags: (m) => [`Fund:${m[1]}`, "Policy"] },
    // /funds/{id}
    { re: /^\/funds\/([^/]+)$/, tags: (m) => ["Fund", `Fund:${m[1]}`] },
    // /funds (list)
    { re: /^\/funds$/, tags: () => ["Fund"] }
  ];

  for (const { re, tags } of patterns) {
    const m = route.match(re);
    if (m) return tags(m);
  }
  return []; // unknown shape — no tags, cached but not purgable by tag
}

const tagIndexKey = (tag) => `tag:${tag}`;

// ---------------------------------------------------------------------------
// createRestCache — builds the cached REST client + management API for ONE
// subgraph. Everything below closes over this config.
//
//   serviceName  cache-key namespace + reported in /health  (e.g. "accounts")
//   restUrl      base URL of the REST service               (e.g. http://accounts-rest:3001)
//   apiKey       optional X-Api-Key for the REST service
//   redisUrl     redis://…  — empty/"disabled" turns caching off entirely
//   cacheTtl     seconds for cached REST responses
//   tagIndexTtl  seconds for the tag SETs (default 2x cacheTtl)
//   mgmtPort     management HTTP port (/health, /tags/:tag, /purge)
//
// NOTE on tagIndexTtl: tag SETs are SHARED between services (`tag:Account:{id}`
// is written by BOTH accounts and policies), and each write resets the SET's
// TTL. If one service used a shorter value, the index could expire while an
// entry it points at is still cached — a later purge would then miss that entry
// and serve stale data until its own TTL ran out. So give every service the
// SAME tagIndexTtl, >= the LONGEST cacheTtl in the fleet (compose passes
// TAG_INDEX_TTL=600 to all three). Redis' EXPIRE ... GT would look like the
// natural fix, but GT treats a key with no expiry as infinite and refuses to
// set one, so the index would never expire at all.
// ---------------------------------------------------------------------------
function createRestCache({
  serviceName,
  restUrl,
  apiKey = "",
  redisUrl,
  cacheTtl,
  tagIndexTtl = cacheTtl * 2,
  mgmtPort
}) {
  // ioredis reconnects on its own; `redis.status` tells us whether it is usable
  // right now, so a cache outage degrades to plain REST calls instead of 500s.
  const redis = redisUrl && redisUrl !== "disabled"
    ? new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 })
    : null;

  if (redis) {
    redis.on("ready", () =>
      console.log(`[cache] connected to ${redisUrl} (ttl=${cacheTtl}s, tag index ttl=${tagIndexTtl}s)`));
    redis.on("error", (e) => console.warn(`[cache] ${e.message}`));
  } else {
    console.log("[cache] disabled (no REDIS_URL) — every request hits REST");
  }

  // -------------------------------------------------------------------------
  // Plain REST call. Returns parsed JSON, or null on 404 / non-2xx.
  // -------------------------------------------------------------------------
  async function requestJson(route) {
    const headers = apiKey ? { "X-Api-Key": apiKey } : {};
    const res = await fetch(`${restUrl}${route}`, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  // -------------------------------------------------------------------------
  // Cache-aware wrapper around requestJson.
  // Key pattern: subgraph:<service>:<route>  e.g. subgraph:accounts:/accounts/acct-1001
  // On HIT  → returns parsed JSON from Valkey, REST API is NOT called.
  // On MISS → calls REST API, stores result in Valkey with EX TTL, registers tags.
  // -------------------------------------------------------------------------
  async function cachedRequestJson(route) {
    const key = `subgraph:${serviceName}:${route}`;

    if (redis && redis.status === "ready") {
      const cached = await redis.get(key);
      if (cached !== null) {
        console.log(`[cache HIT]  ${key}`);
        return JSON.parse(cached);
      }
      console.log(`[cache MISS] ${key}`);
    }

    const data = await requestJson(route);

    if (redis && redis.status === "ready" && data !== null) {
      const tags = tagsForRoute(route);
      // Pipeline: set the entry + register the key under each tag SET.
      // Tag SETs are not TTL'd per member — stale members get cleaned up when
      // purgeTags runs (it deletes the SET entirely after invalidation).
      const pipeline = redis.pipeline();
      pipeline.set(key, JSON.stringify(data), "EX", cacheTtl);
      for (const tag of tags) {
        pipeline.sadd(tagIndexKey(tag), key);
        // Give the tag index a TTL longer than the data TTL so it expires on
        // its own if nobody purges — prevents unbounded growth.
        pipeline.expire(tagIndexKey(tag), tagIndexTtl);
      }
      await pipeline.exec();
      if (tags.length > 0) {
        console.log(`[cache SET]  ${key} tags=[${tags.join(", ")}]`);
      }
    }
    return data;
  }

  // -------------------------------------------------------------------------
  // Tag-based invalidation: deletes every cache entry registered under any of
  // the supplied tags, then deletes the tag indexes themselves.
  // Returns { purgedKeys, purgedTags } for the response.
  // -------------------------------------------------------------------------
  async function purgeTags(tags) {
    if (!redis || redis.status !== "ready") {
      return { purgedKeys: 0, purgedTags: 0, error: "cache unavailable" };
    }
    if (!Array.isArray(tags) || tags.length === 0) {
      return { purgedKeys: 0, purgedTags: 0 };
    }

    const indexKeys = tags.map(tagIndexKey);
    // Gather all cache keys registered under any of the tags
    const memberLists = await Promise.all(indexKeys.map((k) => redis.smembers(k)));
    const cacheKeys = [...new Set(memberLists.flat())];

    const pipeline = redis.pipeline();
    if (cacheKeys.length > 0) pipeline.del(...cacheKeys);
    if (indexKeys.length > 0) pipeline.del(...indexKeys);
    await pipeline.exec();

    console.log(`[cache PURGE] tags=[${tags.join(", ")}] removed ${cacheKeys.length} key(s)`);
    return { purgedKeys: cacheKeys.length, purgedTags: tags.length, keys: cacheKeys };
  }

  // -------------------------------------------------------------------------
  // Management HTTP endpoint for cache-tag invalidation.
  //
  //   POST /purge   { "tags": ["Account:acct-1001", "Policy"] }
  //     → deletes every cached entry tagged with any of the given tags
  //
  //   GET /tags/:tag
  //     → lists cache keys currently registered under a tag
  //
  //   GET /health
  //     → simple liveness check
  //
  // Exposed on MGMT_PORT (default = PORT + 1000). Kept separate from the
  // GraphQL endpoint so the federation contract stays clean.
  // -------------------------------------------------------------------------
  function startMgmtServer() {
    const mgmt = http.createServer(async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };

      try {
        if (req.method === "GET" && req.url === "/health") {
          return send(200, { service: serviceName, cache: redis?.status || "disabled" });
        }

        if (req.method === "GET" && req.url.startsWith("/tags/")) {
          const tag = decodeURIComponent(req.url.slice("/tags/".length));
          if (!redis || redis.status !== "ready") return send(503, { error: "cache unavailable" });
          const members = await redis.smembers(tagIndexKey(tag));
          return send(200, { tag, keys: members });
        }

        if (req.method === "GET" && req.url === "/keys") {
          if (!redis || redis.status !== "ready") return send(503, { error: "cache unavailable" });
          const keys = await redis.keys(`subgraph:${serviceName}:*`);
          return send(200, { service: serviceName, keys });
        }

        if (req.method === "POST" && req.url === "/purge") {
          let raw = "";
          req.on("data", (chunk) => (raw += chunk));
          req.on("end", async () => {
            try {
              const { tags } = JSON.parse(raw || "{}");
              if (!Array.isArray(tags)) {
                return send(400, { error: "body must be { tags: string[] }" });
              }
              const result = await purgeTags(tags);
              return send(200, result);
            } catch (e) {
              return send(400, { error: e.message });
            }
          });
          return;
        }

        send(404, {
          error: "not found",
          routes: ["GET /health", "GET /keys", "GET /tags/:tag", "POST /purge"]
        });
      } catch (e) {
        send(500, { error: e.message });
      }
    });

    mgmt.listen(mgmtPort, "0.0.0.0", () => {
      console.log(`${serviceName} cache management API ready at http://0.0.0.0:${mgmtPort}`);
    });
    return mgmt;
  }

  return { redis, requestJson, cachedRequestJson, purgeTags, startMgmtServer };
}

module.exports = { createRestCache, tagsForRoute, tagIndexKey };
