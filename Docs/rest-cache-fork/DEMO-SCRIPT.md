# Demo script — cache invalidation for REST-backed fields

Presenter runbook for the story written up in
[`CONFLUENCE-REST-Cache-Fork.md`](./CONFLUENCE-REST-Cache-Fork.md).
Two versions: **Short (~5 min)** and **Medium (~15 min)**.

Legend: **[SAY]** = talking point · **[RUN]** = command to run live ·
**[POINT]** = what to highlight on screen · **[NOTE]** = presenter's heads-up.

The one-sentence pitch, if you only get one sentence:

> *"A fund changes in another system, and we can drop exactly that fund from the
> cache with a single `DEL` — something the gateway's own cache makes impossible."*

---

## Pre-flight checklist (BEFORE the meeting)

```bash
cd rest-demo
```

```bash
npm run cached:up
```

```bash
docker compose -f docker-compose.cached.yml ps
```

All five services should read `Up`, with `valkey` **healthy**. Then warm it once
so the first live query isn't also the first container start:

```bash
curl -s localhost:5065/graphql -H 'content-type: application/json' -d '{"query":"{ account(id:\"acct-1001\"){ holderName } }"}'
```

Free the ports if an older stack is still around (they clash on 3001-3003 / 6379):

```bash
docker compose -f docker-compose.gateway.yml down
```

If you plan to show the test report in the medium demo, generate it now — it takes
about two minutes and leaves the stack running and warm:

```bash
npm run cached:test
```

**Terminal layout.** Three panes:

| Pane | Command |
|---|---|
| A — driving | your prompt, at the repo root |
| B — cache log | `docker compose -f docker-compose.cached.yml logs -f cached-gateway \| grep rest-cache` |
| C — keyspace | your prompt, for `valkey-cli` |

Have open in tabs: [`CONFLUENCE-REST-Cache-Fork.md`](./CONFLUENCE-REST-Cache-Fork.md)
(for the architecture diagram) and, if the audience is technical,
[`Docs/spikes/1_entityCacheTagInvalidation_verdictAug.md`](../spikes/1_entityCacheTagInvalidation_verdictAug.md).

Copy this to your clipboard — it is the query used throughout:

```bash
Q='{"query":"{ account(id:\"acct-1001\"){ holderName policies { policyNumber } fundHoldings { fund { id name } } } }"}'
```

---

# SHORT DEMO (~5 min)

**Goal:** show a readable cache key, invalidate one fund by name, show only that
fund refetched.

### 1. The problem, in one screen (45s)

> **[SAY]** "We cache REST responses so the gateway isn't hammering the backends.
> The question this story answers is what happens when a fund changes in a system
> that never talks to Grafbase. With the gateway's built-in cache, this is what a
> cached fund looks like."

> **[POINT]** on the Confluence page, or read it out:
>
> ```
> insurance-entitycache-2c295b92553f5d5d54d4f2e3aa165eb83609fb2249b7a85a6bbfc314d5c0d0fb
>   value: {"name":"Green Bond Income","currency":"GBP"}
> ```

> **[SAY]** "That key is a hash of the request, including every header. The fund
> id isn't in the key, and it isn't in the value either. There is no delete in the
> API. So there is no way to say 'drop fund-green-bond' — you can only wait for the
> TTL. That is the problem."

### 2. What it looks like now (60s)

> **[RUN]** pane A — clear the cache, then one query:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli FLUSHALL
```

```bash
curl -s localhost:5065/graphql -H 'content-type: application/json' -d '{"query":"{ account(id:\"acct-1001\"){ holderName policies { policyNumber } fundHoldings { fund { id name } } } }"}'
```

> **[RUN]** pane C:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli --scan
```

> **[POINT]** the keys:
>
> ```
> rest:accounts:/accounts/acct-1001
> rest:policies:/accounts/acct-1001/policies
> rest:funds:/funds/fund-green-bond
> tag:Fund:fund-green-bond
> ```

> **[SAY]** "Same data, same Valkey — but the key is just the REST URL. Anyone who
> knows a fund id can compute it. And there is a tag index next to it."

### 3. It is a real cache (45s)

Run the same query again.

> **[POINT]** pane B — every line now says `HIT`, and no REST call was made:
>
> ```
> [rest-cache] HIT  rest:funds:/funds/fund-green-bond
> ```

### 4. The money shot — invalidate one fund (90s)

> **[SAY]** "Now pretend the fund was just updated somewhere else. This is the
> entire integration — one command, no Grafbase knowledge, no purge service."

> **[RUN]** pane C:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli DEL "rest:funds:/funds/fund-green-bond"
```

Re-run the query in pane A.

> **[POINT]** pane B — one MISS, everything else still served from cache:
>
> ```
> [rest-cache] HIT  rest:accounts:/accounts/acct-1001
> [rest-cache] HIT  rest:funds:/funds/fund-global-equity
> [rest-cache] MISS rest:funds:/funds/fund-green-bond      ← only this one
> [rest-cache] HIT  rest:funds:/funds/fund-cash-plus
> [rest-cache] SET  rest:funds:/funds/fund-green-bond ttl=300s tags=[Fund, Fund:fund-green-bond]
> ```

> **[SAY]** "Surgical. One fund refetched, everything else untouched."

### 5. Close (30s)

> **[SAY]** "That's a fork of the official Grafbase REST extension — about 460
> lines of Rust, added once. The cache runs inside the gateway's WebAssembly
> sandbox and talks to Valkey directly. Adding another REST API later is a config
> change, not code. Full write-up and a 17-assertion test script are in the repo."

---

# MEDIUM DEMO (~15 min)

Everything above, plus the parts that make a technical audience believe it.

### 1. Context and the spike verdict (3 min) — Confluence

> **[SAY]** "In August we investigated whether cache tags could drive the
> gateway's entity cache. The verdict was no — not hard, structurally impossible."

Walk the four blockers from the Confluence table:

1. The key is a BLAKE3 hash over **every request header** — not reconstructible.
2. The value holds only the **selected fields** — the id isn't there to match on.
3. **One entry per field selection**, so a fund has many keys, not one.
4. The cache interface is **`get` and `put`. There is no delete.**

> **[SAY]** "Hooks don't help either — they only see headers and an audit event
> queue, never the fetch. And the SDK's own cache has no delete method. The spike's
> conclusion was: move the cache one layer down, to the boundary we own. That's what
> this implements."

> **[POINT]** the architecture diagram on the Confluence page.

### 2. Where the cache actually sits (2 min)

> **[SAY]** "The REST extension is the code that makes the REST call. It's open
> source and small — 227 lines. We forked it and wrapped the single HTTP call site."

> **[POINT]** `extensions/rest-cached/src/lib.rs`, search for `--- cache ---`:
> three marked edits, one struct field, one constructor line, one wrapped call.

> **[SAY]** "With no cache block in the config it behaves exactly like upstream.
> The manifest even keeps the upstream name and version, so the schema didn't change
> at all."

### 3. Bring it up and populate (2 min)

Run short-demo steps 2 and 3.

> **[RUN]** show TTLs differing per endpoint — configured, not hard-coded:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli TTL "rest:funds:/funds/fund-green-bond"
```

> **[SAY]** "300 seconds for funds, 120 for accounts, 30 for policies — reference
> data versus things that churn."

### 4. One key per resource, not per query shape (2 min)

> **[SAY]** "This is the part the entity cache gets wrong. Watch what happens when
> I ask for completely different fields on the same fund."

> **[RUN]**:

```bash
curl -s localhost:5065/graphql -H 'content-type: application/json' -d '{"query":"{ account(id:\"acct-1001\"){ riskProfile fundHoldings { fund { isin riskRating } } } }"}'
```

> **[POINT]** pane B — still all `HIT`; pane C — no new keys.

> **[SAY]** "We cache the raw REST response, before the field selection is applied.
> The entity cache would have created a whole second set of entries here."

### 5. Prove reads really come from the cache (2 min)

> **[SAY]** "How do you know it's serving the cache and not just being fast? Let's
> put a value in Valkey that the REST API could never return."

> **[RUN]**:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli SET "rest:funds:/funds/fund-green-bond" '{"id":"fund-green-bond","isin":"GB00GRNBD002","name":"PROOF: SERVED FROM CACHE","assetClass":"FIXED_INCOME","currency":"GBP","riskRating":3,"ongoingChargePercent":0.22,"oneYearReturnPercent":5.8,"threeYearReturnPercent":13.2,"sustainabilityLabel":"SUSTAINABLE"}' EX 300
```

```bash
curl -s localhost:5065/graphql -H 'content-type: application/json' -d '{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name } } } }"}'
```

> **[POINT]** GraphQL returns `PROOF: SERVED FROM CACHE`.

> **[SAY]** "That string exists nowhere in the REST service. Now I invalidate it,
> and the real value comes back."

Run the `DEL` from short-demo step 4, then the query again → `Green Bond Income`.

### 6. Tags — invalidating more than one key (2 min)

> **[RUN]**:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli SMEMBERS tag:Account:acct-1001
```

> **[POINT]** the tag holds **two** keys, from **two different REST services** —
> the account itself and its policies.

> **[RUN]** purge them in one round trip:

```bash
docker compose -f docker-compose.cached.yml exec -T valkey valkey-cli EVAL 'local ks=redis.call("SMEMBERS",KEYS[1]) if #ks>0 then redis.call("DEL",unpack(ks)) end redis.call("DEL",KEYS[1]) return #ks' 1 tag:Account:acct-1001
```

> **[SAY]** "In production this is a small consumer of the change stream: entity id
> in, `SMEMBERS` plus `UNLINK` out."

> **[NOTE]** this purge drops the account and policies entries, so the next query
> legitimately shows two MISSes. Say so before someone asks.

### 7. Why the next REST API costs nothing (2 min)

> **[POINT]** `grafbase.cached.toml`, the `[extensions.rest.config.cache]` section:

```toml
[extensions.rest.config.cache.endpoints.funds]
ttl = 300

[[extensions.rest.config.cache.tags]]
path = "/funds/{id}"
tags = ["Fund", "Fund:{id}"]
```

> **[SAY]** "TTLs and tag rules are configuration. A new REST service means a few
> lines here — no Rust, no rebuild, no new container."

### 8. The evidence, and the caveats (2 min)

> **[RUN]** if you have the time budget (it rebuilds from scratch, ~2 min):

```bash
npm run cached:test
```

Otherwise show the report from your last run (written into the repo root, and
gitignored — run the script once before the meeting so the file exists):

```bash
head -30 extension-cache-test-report.txt
```

> **[SAY]** "17 assertions, clean slate every run. And three caveats I'd want you
> to hear from me rather than find later."

1. **Keys are not header-scoped.** Fine for a service API key, wrong for per-user
   tokens — users would share entries. Documented, and fixable if we ever front
   per-user data.
2. **The gateway's entity cache is switched off here** on purpose. Left on, it
   would sit in front and keep serving its own un-purgeable copy after we
   invalidate.
3. **The Grafbase Gateway is end-of-life.** The cache module itself has no
   Grafbase dependency — only `std` and `serde` — so the key scheme, tag index and
   Redis client port to whatever replaces it. The gateway-specific part is three
   marked lines.

---

## If something goes wrong (quick recovery)

Gateway not answering on 5065:

```bash
docker compose -f docker-compose.cached.yml logs cached-gateway | tail -20
```

Nothing appearing in Valkey — check the extension loaded and the cache connected:

```bash
docker compose -f docker-compose.cached.yml logs cached-gateway | grep -E "Loading extension|rest-cache"
```

Ports held by the other stack:

```bash
docker compose -f docker-compose.gateway.yml down
```

Full reset (rebuilds, ~2 min — use only if you have the time):

```bash
npm run cached:down && npm run cached:up
```

## Known gotchas while poking around

- There is **no top-level `fund(id:)` query** — it is `@inaccessible`, so funds are
  reachable only through `account.fundHoldings.fund`. A direct `{ fund(id:"…") }`
  returns a validation error; that is the schema, not the cache.
- `policies` entries expire after **30 s**. If a demo run stalls, they may show a
  legitimate `MISS` — mention the TTL rather than debugging it live.
- The `MONITOR` pane shows several client connections. That is the gateway's pool
  of extension instances, each holding its own Redis connection.

## One-liner fallback (if live commands wobble)

```bash
npm run cached:test
```

It prints all 17 assertions with PASS/FAIL and writes the report — enough to carry
the demo on its own.
