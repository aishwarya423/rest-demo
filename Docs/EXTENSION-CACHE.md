# REST caching with readable keys, inside the gateway

> How a fund that changed in some other system gets invalidated here — with one
> `DEL`, no purge service, and no JavaScript.
>
> Code: [`extensions/rest-cached/`](../extensions/rest-cached/) ·
> Config: [`grafbase.cached.toml`](../grafbase.cached.toml) ·
> Run: `npm run cached:up` · Verify: `npm run cached:test`

---

## 1. Why the gateway's own cache cannot do this

`[entity_caching]` writes keys like:

```
insurance-entitycache-2c295b92553f5d5d54d4f2e3aa165eb83609fb2249b7a85a6bbfc314d5c0d0fb
  value: {"name":"Green Bond Income","currency":"GBP"}
```

Three separate problems, any one of which is fatal for targeted invalidation:

1. **The key is a hash** of the subgraph fetch, computed inside the gateway. Its
   only configurable part is `key_prefix`, and that is global.
2. **The fund id is not in the value either.** The gateway already knows the key
   from the parent, so the subgraph returns only the fields that were selected —
   value-matching is not a fallback.
3. **One fund, many entries.** The key covers the field selection and the header
   scope, so `fund { id name }` and `fund { isin riskRating }` are different
   entries for the same fund.

And there is no purge API: entity caching config is `enabled`, `ttl`, `storage`,
`redis.url`, `redis.key_prefix`, `redis.tls` — that is the whole surface. Hooks
cannot help (`on_request` / `on_response` see headers and an audit event queue,
never the subgraph fetch), and the SDK's `host_io::cache` is `get_or_insert*`
with no delete.

Conclusion: the cache has to live where the REST call is made. That is the
extension.

## 2. What this does instead

One key per REST URL, written by the extension itself:

```
rest:funds:/funds/fund-green-bond          ttl 300s
rest:accounts:/accounts/acct-1001          ttl 120s
rest:policies:/accounts/acct-1001/policies ttl  30s
```

Because the entry is the **raw REST response**, cached before the `@rest`
`selection` jq filter runs, every GraphQL query shape for that fund shares the
one entry — the opposite of the entity cache's behaviour.

Optional tag SETs give you bulk invalidation:

```
tag:Fund                    -> all three rest:funds:… keys
tag:Fund:fund-green-bond    -> rest:funds:/funds/fund-green-bond
tag:Account:acct-1001       -> rest:accounts:/accounts/acct-1001
                               rest:policies:/accounts/acct-1001/policies
```

## 3. Invalidating

Whatever changes the data — a write API, a CDC consumer, an ETL job, a DBA —
runs one command. No Grafbase knowledge, no purge endpoint, no HTTP call.

**One fund:**

```bash
valkey-cli DEL "rest:funds:/funds/fund-green-bond"
```

**Everything tagged `Fund`, in a single round trip:**

```bash
valkey-cli EVAL 'local ks=redis.call("SMEMBERS",KEYS[1])
                 if #ks>0 then redis.call("DEL",unpack(ks)) end
                 redis.call("DEL",KEYS[1]); return #ks' 1 tag:Fund
```

**Everything for one account (spans two REST services):**

```bash
valkey-cli EVAL '…same script…' 1 tag:Account:acct-1001
```

**Inspect before purging:**

```bash
valkey-cli --scan --pattern 'rest:funds:*'
valkey-cli SMEMBERS tag:Fund:fund-green-bond
valkey-cli TTL "rest:funds:/funds/fund-green-bond"
```

## 4. Configuration

Everything lives in [`grafbase.cached.toml`](../grafbase.cached.toml). **A new
REST API is a config change, not a code change.**

```toml
[extensions.rest]
path = "grafbase_extensions/rest-cached/build"
networking = true      # REQUIRED — WASI HTTP for REST, TCP sockets for Redis
stderr = true          # lets [rest-cache] HIT/MISS/SET reach the gateway logs

[extensions.rest.config.cache]
url = "redis://valkey:6379"   # plain redis:// only — no TLS, no AUTH
key_prefix = "rest"           # first segment of every key
ttl = 120                     # default TTL, seconds; 0 disables the cache
debug = true                  # log every HIT/MISS/SET
# tag_ttl = 600               # defaults to 2x the longest endpoint ttl below

[extensions.rest.config.cache.endpoints.funds]      # keyed by @restEndpoint name
ttl = 300
[extensions.rest.config.cache.endpoints.policies]
ttl = 30
[extensions.rest.config.cache.endpoints.accounts]
ttl = 120
# enabled = false   # opt one endpoint out entirely

[[extensions.rest.config.cache.tags]]
path = "/funds/{id}"                 # {name} captures one path segment
tags = ["Fund", "Fund:{id}"]         # and interpolates into the tags
```

Rules are tried in order and **the first match wins**, so list specific routes
(`/accounts/{id}/policies`) before general ones (`/accounts/{id}`).

`tag_ttl` is shared deliberately. A tag SET is written by several endpoints with
different TTLs, and each write resets its expiry — if the 30s endpoint set it to
60s, the index could die while a 300s entry it points at is still cached, and a
later tag purge would silently miss that entry. Defaulting to twice the longest
endpoint TTL removes the trap. (`EXPIRE … GT` looks like the fix but is not: `GT`
treats a key with no expiry as infinite and refuses to set one.)

## 5. Run it

```bash
npm run cached:up        # docker compose -f docker-compose.cached.yml up --build -d
npm run cached:keys      # what is cached right now
npm run cached:logs      # [rest-cache] HIT / MISS / SET
npm run cached:monitor   # live valkey MONITOR
npm run cached:test      # clean slate, 17 assertions, writes a report
```

GraphQL on <http://localhost:5065/graphql>. A cold query looks like this in
`MONITOR` — all of it written by the wasm extension:

```
"GET"    "rest:accounts:/accounts/acct-1001"
"SET"    "rest:accounts:/accounts/acct-1001" "{…}" "EX" "120"
"SADD"   "tag:Account" "rest:accounts:/accounts/acct-1001"
"EXPIRE" "tag:Account" "600"
"SADD"   "tag:Account:acct-1001" "rest:accounts:/accounts/acct-1001"
"GET"    "rest:funds:/funds/fund-green-bond"
"SET"    "rest:funds:/funds/fund-green-bond" "{…}" "EX" "300"
"SADD"   "tag:Fund:fund-green-bond" "rest:funds:/funds/fund-green-bond"
…
```

### Topology, and why it differs from the entity-caching demo

This setup uses **one** virtual subgraph in which accounts, policies *and* funds
are all resolved by the extension ([`schema-gen/schema.generated.graphql`](../schema-gen/schema.generated.graphql),
where `@lookup`/`@derive` fan `fundHoldings` out into one `GET /funds/{id}` per
fund — which is what produces one cache key per fund).

[`grafbase.toml`](../grafbase.toml) + [`docker-compose.gateway.yml`](../docker-compose.gateway.yml)
keep the other arrangement — Fund in its own GraphQL subgraph so the gateway's
entity cache engages. Both remain in the repo; run one stack at a time (they
share ports 3001-3003 and 6379).

**Gateway caching is off here on purpose.** Entity caching would sit in front of
this cache and keep serving its own opaque, un-purgeable copy for up to its TTL
after you invalidate — which would defeat the entire exercise.

## 6. Caveats

- **Keys are not header-scoped.** The gateway's entity cache mixes all subgraph
  headers into its key; this one does not. Fine for a static service API key,
  **wrong for per-user tokens** — everyone would share one entry. Scoping would
  mean adding configured headers to the key, and giving up one-key-per-URL.
- **`GET` only, and only with an empty body.** Anything else goes straight to REST.
- **No request coalescing.** N concurrent misses for one key make N REST calls.
- **Stale tag members.** Deleting a key does not remove it from `tag:*` SETs; a
  later purge just deletes keys that are already gone, and the SET expires by
  `tag_ttl` anyway.
- **Plain `redis://` only** — no TLS, AUTH or cluster (see the extension README).
- **Cache outages degrade, never fail.** Any Redis error drops the connection and
  the request falls through to the REST API.
