// =============================================================================
// rest-cache — a tag-invalidated cache at the REST boundary.
//
// WHY THIS EXISTS
//   Grafbase Entity Cache cannot do selective invalidation: its keys are BLAKE3
//   hashes over every request header, its Redis values carry no entity id, and
//   its cache interface has no delete. See Docs/ for the full investigation.
//   So the cache moves to a layer where WE generate the keys — and then a
//   tag -> keys index is trivial, because we write it ourselves.
//
// WHAT IT DOES
//   Transparent HTTP proxy in front of the mock REST services. Caches GET
//   responses in Redis db 1 as plain strings, and records each response against
//   the logical entities it depends on as Redis SETs:
//
//       rc:accounts:GET:/accounts/acct-1001   STRING  <body>          EX 600
//       tag:account:acct-1001                 SET     { rc:... }      EX 660
//
//   Invalidation is then: SMEMBERS tag:<t>  ->  UNLINK those keys.
//
// ENDPOINTS (on every listener)
//   GET  /_health                      liveness + which upstream this port maps to
//   GET  /_tags?tag=account:acct-1001  inspect one tag's members
//   POST /_invalidate {"tags":[...]}   delete everything carrying those tags
//   *                                  proxied to the upstream
//
// NOT PRODUCTION READY — /_invalidate is unauthenticated, there is no stampede
// protection, and Redis failure returns 502 rather than failing open. See
// README.md "Before production".
// =============================================================================
const http = require("http");
const Redis = require("ioredis");
const { tagsFor } = require("./tags");

const redis = new Redis({
  host: process.env.REDIS_HOST || "redis",
  port: Number(process.env.REDIS_PORT || 6379),
  // db 1 keeps our keys physically separate from Grafbase's own cache in db 0,
  // so neither side's FLUSHDB can harm the other and the demo is unambiguous.
  db: Number(process.env.REDIS_DB || 1),
});
redis.on("error", (e) => console.error("[rest-cache] redis:", e.message));

const TTL = Number(process.env.CACHE_TTL_SECONDS || 600);
const TAG_TTL = TTL + 60; // tag sets MUST outlive their members, or entries leak

// port -> upstream. One listener per REST service keeps the callers' baseURLs
// clean: no path prefixing and no routing header needed.
const UPSTREAMS = JSON.parse(
  process.env.UPSTREAMS ||
    JSON.stringify({
      3101: { name: "accounts", upstream: "http://accounts-rest:3001" },
      3102: { name: "funds", upstream: "http://funds-rest:3002" },
      3103: { name: "policies", upstream: "http://policies-rest:3003" },
    })
);

const cacheKey = (svc, target) => `rc:${svc}:GET:${target}`;
const tagKey = (t) => `tag:${t}`;

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

function send(res, code, body, extra = {}) {
  res.writeHead(code, { "content-type": "application/json", ...extra });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj, null, 2));

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

// Pass auth (X-Api-Key) straight through; drop hop-by-hop headers.
function forwarded(headers) {
  const out = { ...headers };
  delete out.host;
  delete out.connection;
  delete out["content-length"];
  delete out["accept-encoding"]; // keep upstream bodies unencoded so we cache text
  return out;
}

// ---------------------------------------------------------------------------

async function handle(svc, req, res) {
  const url = new URL(req.url, "http://localhost");
  const target = url.pathname + url.search;

  // ---- control plane ------------------------------------------------------
  if (url.pathname === "/_health") {
    return json(res, 200, { ok: true, service: svc.name, upstream: svc.upstream, ttl: TTL });
  }
  if (url.pathname === "/_tags") {
    const tag = url.searchParams.get("tag");
    if (!tag) return json(res, 400, { error: "usage: /_tags?tag=account:acct-1001" });
    return json(res, 200, { tag, keys: await redis.smembers(tagKey(tag)) });
  }
  if (url.pathname === "/_invalidate") {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    return invalidate(req, res);
  }

  // ---- only GET is cacheable ----------------------------------------------
  if (req.method !== "GET") return passthrough(svc, req, res, target);

  const key = cacheKey(svc.name, target);
  const hit = await redis.get(key);
  if (hit !== null) {
    return send(res, 200, hit, { "x-rest-cache": "HIT", "x-rest-cache-key": key });
  }

  const upstream = await fetch(svc.upstream + target, { headers: forwarded(req.headers) });
  const body = await upstream.text();

  let tags = [];
  if (upstream.ok) {
    tags = tagsFor(svc.name, url.pathname, safeParse(body));
    // Never cache what we cannot invalidate — an untagged route falls through
    // to the upstream every time, and says so in the response header.
    if (tags.length) {
      const p = redis.pipeline();
      p.set(key, body, "EX", TTL);
      for (const t of tags) {
        p.sadd(tagKey(t), key);
        p.expire(tagKey(t), TAG_TTL);
      }
      await p.exec();
    }
  }

  send(res, upstream.status, body, {
    "x-rest-cache": tags.length ? "MISS" : "BYPASS",
    "x-rest-cache-key": key,
    "x-rest-cache-tags": tags.join(","),
  });
}

async function invalidate(req, res) {
  const parsed = safeParse((await readBody(req)).toString()) || {};
  const tags = parsed.tags;
  if (!Array.isArray(tags) || tags.length === 0) {
    return json(res, 400, { error: 'body must be { "tags": ["account:acct-1001"] }' });
  }

  const doomed = new Set();
  for (const t of tags) {
    (await redis.smembers(tagKey(t))).forEach((k) => doomed.add(k));
  }

  const keys = [...doomed];
  // UNLINK reclaims memory on a background thread — non-blocking, unlike DEL.
  await redis.unlink(...keys, ...tags.map(tagKey));

  console.log(`[rest-cache] invalidated ${tags.join(",")} -> ${keys.length} key(s)`);
  return json(res, 200, { tags, deletedKeys: keys, count: keys.length });
}

async function passthrough(svc, req, res, target) {
  const body = await readBody(req);
  const upstream = await fetch(svc.upstream + target, {
    method: req.method,
    headers: forwarded(req.headers),
    body: body.length ? body : undefined,
  });
  send(res, upstream.status, await upstream.text(), { "x-rest-cache": "BYPASS" });
}

// ---------------------------------------------------------------------------

for (const [port, svc] of Object.entries(UPSTREAMS)) {
  http
    .createServer((req, res) =>
      handle(svc, req, res).catch((e) => {
        console.error(`[rest-cache] ${svc.name} ${req.url}:`, e.message);
        json(res, 502, { error: String(e && e.message ? e.message : e) });
      })
    )
    .listen(Number(port), () =>
      console.log(`[rest-cache] ${svc.name.padEnd(8)} :${port} -> ${svc.upstream}`)
    );
}
