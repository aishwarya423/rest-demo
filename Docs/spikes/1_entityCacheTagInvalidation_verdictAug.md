Technical Investigation · Grafbase Gateway 0.53.5 · 25 Aug 2026

Can @cacheTag drive Entity Cache invalidation in Grafbase?
Source-backed investigation into tag-based invalidation for the AEM → REST → Grafbase → Valkey stack. Short answer: no — and the reason matters more than the answer.

Gateway 0.53.5
Backends verified redis:7-alpine · valkey/valkey:8-alpine
Evidence binary symbols · upstream source · official docs · local keyspace dumps
Verdict

The @cacheTag approach is not viable on Grafbase Entity Cache. Not "hard" — structurally impossible.

Grafbase has no @cacheTag directive, no cache-tag concept, and no tag index in Redis. Its entity cache interface is literally two methods — get and put. There is no delete. Cache keys are unsalted BLAKE3 hashes over every request header, so a single logical entity maps to an unbounded, unenumerable set of keys that no external process can reconstruct or reverse.

Separately and independently decisive: Grafbase was acquired by The Guild and the Gateway is end-of-life. Building bespoke tooling against its internals now is investment into a dead runtime.

Source
Read from Grafbase upstream Rust source or the shipped binary's symbols.
Docs
Confirmed in official Grafbase / Apollo / Hive documentation.
Observed
Reproduced experimentally in your own Redis + Valkey dumps.
Inference
Architectural reasoning from confirmed facts — not directly verified.
Validate
Unknown; needs checking before you rely on it.
01
Executive summary
Grafbase has no @cacheTag directive. Zero occurrences in the 78 MB gateway binary, absent from the official directive list, absent from both entity-caching doc pages. Source Docs
@cacheTag is an Apollo construct. It was introduced in Apollo Federation v2.12 for the Apollo Router Response Cache — a different product, in a different router, replacing Apollo's own older entity caching. None of it transfers to Grafbase. Docs
The cache interface has no delete. Grafbase's EntityCache trait defines exactly two methods, get and put. No delete, invalidate, purge, or tag exists anywhere in the abstraction. Source
Redis storage is flat strings — no index of any kind. One SET per entity with EX/PX expiry, key = {key_prefix}-{blake3_hex}. No SET, ZSET, or HASH is ever created. Confirmed in source and in your own dump: DBSIZE 4, all four keys TYPE string. Source Observed
Cache keys hash all request headers, unfiltered. The key is blake3("v1" ‖ subgraph_name ‖ every header name+value ‖ scopes ‖ entity representation). Two clients differing only in user-agent produce two different cache entries for the same entity. Source
Keys are therefore not reconstructible externally. An invalidator would need the exact, complete header set of every request that ever populated an entry. That set is unbounded and unknowable out-of-band. Inference
Nor can you identify entries by reading their values. Your own dump proves it: the cached payload for a Fund is {"name":"Green Bond Income","currency":"GBP"} — the id is absent, because the identifier lives in the hashed key, not the stored body. Scan-and-match invalidation has nothing to match on. Observed
Grafbase Gateway is end-of-life. The Guild acquired Grafbase on 10 Feb 2026; the README states the Gateway, CLI and repository "will be archived by end of May 2026," with only high-severity security fixes until then. That date has passed. Docs
The successor doesn't solve this either — yet. Hive Router's response caching is still an open RFC, and its proposed invalidation is mutation/entity-based, not tag-based. Docs
Your REST extension is invisible to entity caching anyway. Entity caching only observes real GraphQL subgraph fetches over HTTP. REST-extension-resolved fields are never cached — you already documented and worked around this by splitting out a real funds subgraph. Docs Observed
The useful conclusion
Your hypothesised design — tag:account-1001 → {key1, key2, key3} → delete — is sound. It simply cannot attach to a cache whose keys you don't own. Move the cache one layer down, to the REST-fetch boundary you control, and the exact design you drew works as specified. See §7.

02
What Grafbase Entity Cache actually does
The cache sits on the gateway↔subgraph wire
Entity caching caches subgraph fetch responses — not client responses, not resolver calls. The official definition is one sentence: "Grafbase Gateway uses Entity Caching to cache requests to subgraphs." Docs

This is the single most consequential fact for your architecture, and your own Docs/ENTITY-CACHING-WHY-NOOP.md already establishes it: fields resolved by the REST WASM extension are resolved in-process, never cross a subgraph HTTP boundary, and are therefore never entity-cached. That is why entity caching wrote nothing to Redis until you split funds into a real GraphQL subgraph on :3009. Observed

Two distinct cache paths
The source implements two separate key derivations Source:

Whole-response caching (fetch_response) — hashes subgraph name + headers + the full subgraph request body.
Per-entity caching (fetch_entities) — hashes subgraph name + headers + each individual entity representation, producing one key per entity.
The per-entity path supports partial hits: results are partitioned into hits and misses, and only the misses go downstream in an _entities fetch. This is confirmed by your dump — one query touching three funds produced exactly three keys. Source Observed

Key derivation, exactly
blake3::Hasher::new()
  .update(b"v1")                        // version marker
  .update(subgraph_name.as_bytes())     // e.g. "funds"
  // every header, length-prefixed, UNFILTERED:
  .update(name.len().to_le_bytes()).update(name.as_bytes())
  .update(value.len().to_le_bytes()).update(value.as_bytes())
  .update(additional_scopes)            // currently always empty
  .update(representation.as_bytes())    // the entity @key repr, or request body
  .finalize().to_string()               // → 64 lowercase hex chars
Note on additional_scopes
The source contains commented-out logic to fold auth/cache scopes into the key, marked FIXME: handle cache scopes. It is presently an empty vector — an unfinished feature in an archived codebase. Source

The write to Redis
The Redis backend does exactly one thing per entry Source:

// crates/runtime-local/src/entity_cache/redis.rs
fn key(&self, name) -> String { format!("{}-{name}", self.key_prefix) }

// read:   connection.get(self.key(name))
// write:  connection.set_options(self.key(name), bytes, options)
//         where options carry SetExpiry::PX(ms)  if ttl >  60s
//                             SetExpiry::EX(secs) if ttl <= 60s
That is the entire storage model. A GET, and a SET … EX|PX. Nothing else is written, and nothing is ever deleted by the gateway — entries leave only by TTL expiry or eviction. Source

03
@cacheTag investigation
It does not exist in Grafbase, in any form. Four independent checks, all negative:

Check	Method	Result	Evidence
Directive in binary	strings over the 78 MB grafbase-gateway 0.53.5 for cacheTag/cache_tag/cache-tag/surrogate-key	0 hits	Source
Supported directive list	Official Grafbase federation directives page	Absent — 11 directives, all federation/auth, none caching	Docs
Entity Cache config schema	Config docs + config struct symbols in binary	No tag key — only enabled, ttl, storage, redis{url,key_prefix,tls{cert,key,ca}}	Source Docs
Invalidation / purge surface	Binary scan for purge/invalidate HTTP routes; EntityCache trait definition	None — trait is get + put only	Source
Do not let search results mislead you here
Web searches for "Grafbase cacheTag" return confident-sounding text about @cacheTag, surrogate keys and mutationInvalidation. Every one of those statements is describing Apollo Router and is being silently attributed to Grafbase. This was the specific trap you flagged, and it is a real one — verify any claim in this space against the binary or the source.

Keeping the four mechanisms straight
Mechanism	Product	Tag invalidation?	Applies to you?
Grafbase Entity Cache	Grafbase Gateway (EOL)	No — TTL expiry only	This is what you are running
Grafbase Operation Cache	Grafbase Gateway (EOL)	No — caches query plans, not data	Running, but irrelevant to content freshness
Apollo Response Cache + @cacheTag	Apollo Router / GraphOS, Federation v2.12+	Yes — native, plus CDN surrogate-key header	Only if you migrate to Apollo Router
Federation directives (@key, @shareable…)	Spec-level, all routers	N/A — composition semantics, not caching	Already in use; unrelated
Hive Router response cache	Hive Router (successor)	RFC only — proposal is mutation/entity-based, not tags	Future option, not shippable today
What happens if you add @cacheTag to your SDL anyway
Composition will either reject it as an unknown directive or strip it as non-executable — and in neither case will the gateway act on it, because no code path reads it. Adding it produces a schema that looks like it has tag invalidation and silently has none. That failure mode is worse than not having the feature. Inference

04
Redis / Valkey key investigation
Your existing dumps already answer this definitively. Reproduced from redis-cache-dump-20260824-140414.txt and valkey-cache-test-report.txt, one query (account(id:"acct-1001") → 3 funds), against both backends: Observed

Key	Type	TTL	Purpose
insurance-entitycache-2c295b92…d0d0fb	string	94 s	Fund entity — Green Bond Income
insurance-entitycache-4be3c818…be0c1c9	string	94 s	Fund entity — Cash Plus Reserve
insurance-entitycache-a950197f…ad3d73	string	94 s	Fund entity — Global Equity Index
insurance-opcacheop.blake3.EydUS4Mj…	string	−1 (none)	Operation cache — serialised query plan
Answers to your specific questions
Question	Answer	Evidence
What keys are created?	One per cached entity: {key_prefix}-{64 hex}. Operation cache uses a different shape: {prefix}op.blake3.{base64}.	Source Observed
What Redis data types?	String only. Never SET, ZSET, HASH, or Stream.	Source Observed
How are keys generated?	BLAKE3 over version marker + subgraph name + all headers + scopes + entity representation, hex-encoded.	Source
Are keys deterministic?	Yes — but only given identical inputs, including the complete header set. Deterministic ≠ predictable from outside.	Source
Is there a tag → cache-key index?	No. No such structure is written. DBSIZE equals exactly the number of cached items — there is no room for an index.	Source Observed
Is metadata stored?	No. The value is the raw serialised subgraph response. No entity id, no type name, no tags, no timestamp.	Observed
Can keys be queried externally?	Listed, yes. Interpreted, no. SCAN enumerates them; nothing lets you map one back to a business entity.	Inference
The detail that closes the door
The stored value for a Fund is {"name":"Green Bond Income","currency":"GBP"}. There is no id field in the payload. The identifier was consumed into the hashed key, and the subgraph only returned the fields the plan requested. So even the fallback strategy — scan every key, read every value, delete the ones mentioning fund-green-bond — has nothing to match against. Selective invalidation from outside is not merely fragile here; it lacks the necessary information. Observed

Verify it yourself
C="docker compose -f docker-compose.gateway.yml exec -T redis redis-cli"

$C DBSIZE
$C --scan --pattern 'insurance-*'

# every key is a plain string — no index structures exist
for k in $($C --scan --pattern 'insurance-entitycache*' | tr -d '\r'); do
  printf '%s | %s | %s\n' "$k" "$($C TYPE "$k" | tr -d '\r')" "$($C TTL "$k" | tr -d '\r')"
done

# these all return WRONGTYPE or empty — proving no SET/ZSET/HASH tag index
K=$($C --scan --pattern 'insurance-entitycache*' | head -1 | tr -d '\r')
$C SMEMBERS "$K"
$C ZRANGE  "$K" 0 -1
$C HGETALL "$K"

# and no tag namespace is ever created
$C --scan --pattern 'tag:*'
$C --scan --pattern '*tag*'
Expected: TYPE is string for every key; SMEMBERS/ZRANGE/HGETALL error with WRONGTYPE; both tag scans return nothing.

05
Custom invalidator feasibility
Can we safely depend on Grafbase's internal Entity Cache Redis keys for production invalidation?

NO.

Not "risky but workable." The information required to do it selectively does not exist in the keyspace.

To be precise about what is and isn't possible:

Selective invalidation of one entity — impossible. Requires reversing a BLAKE3 hash or knowing every historical header permutation. Inference
Prefix-wide flush (DEL insurance-entitycache-*) — possible, blunt. Works, but discards the entire entity cache for every entity and every tenant. That's a cold-start stampede against AEM, not invalidation. Inference
Value-matching invalidation — impossible. Payloads carry no identifier. Observed
Risk register, if you attempted it anyway
Dimension	Assessment
Feasibility	Fails at step 1. There is no tag lookup to perform — step 2 of your proposed flow has no data to read.
Reliability	Any heuristic key-matching silently under-invalidates (stale content ships) or over-invalidates (cache is useless). Both fail quietly.
Upgrade compatibility	The b"v1" marker exists precisely so Grafbase can change the hash inputs at will. It is an internal detail with no compatibility contract. Moot regardless — the project is archived.
Race conditions	Classic delete-vs-refill: an in-flight request that missed before your DEL writes stale data back after it. The gateway has no coordination hook to prevent this. Inference
TTL interaction	External DEL and gateway SET…EX are unordered. Nothing preserves your intent across a concurrent refill.
Multiple gateway instances	Shared Redis makes deletion globally visible — the one genuinely favourable property. But every instance can immediately refill with different headers, producing new keys you again cannot track.
Redis / Valkey clustering	Hash-derived keys distribute across all slots with no hash tags, so any multi-key operation is CROSSSLOT. Cluster-wide SCAN must be fanned out per node. Your prefix-flush gets slow and non-atomic exactly when the cache is large enough to matter. Inference
Key-format changes	Unversioned, undocumented, explicitly internal.
Cache consistency	No read-your-writes guarantee after invalidation. Cannot support a "publish in AEM, verify immediately" workflow.
Operational risk	A component whose correctness depends on undocumented internals of an archived runtime, whose failure mode is serving stale content silently. This will not survive an architecture review, and it shouldn't.
One more structural problem
Even if all of the above were solved, entity caching would only cover your funds subgraph. Accounts and policies resolve through the REST extension and are never entity-cached at all. An invalidator built on this layer would cover a fraction of the surface you actually need to keep fresh. Observed

06
Solution options, compared
Rank	Option	Feasibility	Complexity	Reliability	Upgrade safety	Selective invalidation	Recommendation
1	B — App-level cache at the REST boundary
Your own Redis/Valkey cache in front of the AEM REST calls, keys you define, tag index you maintain	High	Medium	High	Total
router-independent	Yes — exactly your design	Adopt. Only option that delivers the requirement and survives the migration.
2	C — Separate Redis cache for AEM content
A caching layer/sidecar owned by the AEM integration, shared by all consumers	High	Medium	High	Total	Yes	Strong alternative. Same mechanics as B; pick it if the cache should serve non-GraphQL consumers too.
3	D — Apollo Router response cache + @cacheTag	Yes, via migration	High
router swap + GraphOS	High	Supported API	Yes — native, plus CDN purge	The right answer to a different question. Consider only if a router migration is on the table for other reasons.
4	E — Hive Router caching
The named successor to Grafbase	Not yet	Medium	Unproven	Evolving	No — RFC proposes mutation-based	Track, don't depend. You will likely migrate the router here regardless; just don't put invalidation on it.
5	A — Grafbase Entity Cache + custom Redis invalidation
The proposed hypothesis	No	High	Very low	None — archived project	No	Reject. Structurally impossible and built on a dead runtime.
Why B beats C only narrowly
They're the same pattern at different ownership boundaries. Choose B if GraphQL is the only consumer of this AEM content and you want the cache close to where the fetch happens. Choose C if other services also read AEM content and would benefit from the same tag-invalidated cache. Do not build both. Inference

Implementation constraint worth checking early
If you implement B inside the REST WASM extension, note that it runs in wasmtime. The binary does expose wasi:sockets/tcp-create-socket, so raw TCP is theoretically reachable, but a Redis client compiled to WASM under WASI is awkward and poorly-trodden. The pragmatic form of B is a caching HTTP layer between the gateway and the AEM REST APIs — a sidecar or small service — which keeps the cache in ordinary application code. Confirm this before committing to an in-extension design. Validate

07
Recommended architecture
Move the cache to the layer where you control key generation. Everything your hypothesis described then works literally as drawn — because the keys become yours.

READ PATH
INVALIDATION PATH
Client
Grafbase GW
REST ext.
App cache
KEYS YOU OWN
AEM REST
hit → serve · miss → fetch + tag
Entity cache
TTL only
DO NOT INVALIDATE
AEM publish
Invalidator
account-1001
webhook / queue
TAG INDEX · REDIS SET
tag:account-1001
→ {key1, key2, key3}
DEL
purges
Reads flow left to right through a cache whose keys you generate. Invalidation is a separate path: AEM publishes a change, the invalidator resolves tag:account-1001 against a real Redis SET, and deletes exactly those keys. Grafbase's entity cache stays in place with a short TTL and is never touched.
Why this works where the original didn't
Deterministic, reversible keys. You choose aem:account:1001 — no hashing of unfiltered headers, no reconstruction problem.
A real tag index, because you write it. On every cache fill: SET key value EX ttl plus SADD tag:account-1001 key. The SET you hypothesised now exists because you created it.
Covers the whole surface. Accounts, policies and funds all flow through REST — unlike entity caching, which only ever saw funds.
Router-independent. Survives the Grafbase → Hive Router migration untouched. This is the decisive property given the EOL.
Sketch of the tag index
# on cache fill
MULTI
  SET  aem:account:1001 <json> EX 600
  SADD tag:account-1001 aem:account:1001
  EXPIRE tag:account-1001 660      # outlive the entries it tracks
EXEC

# on AEM invalidation event for account-1001
keys=$(SMEMBERS tag:account-1001)
UNLINK $keys tag:account-1001      # UNLINK: non-blocking
Two implementation notes
Give the tag set a slightly longer TTL than its members so it can't outlive its own usefulness or leak unboundedly. Under Redis Cluster, use a hash tag — aem:{account-1001}:profile — so an entity's keys and its tag set land in one slot and SMEMBERS+UNLINK stay atomic. Inference

What to do with Grafbase Entity Cache
Keep it, but demote it. It's still useful as a short-TTL shock absorber for the funds subgraph. Set the TTL to your maximum tolerable staleness — 30–60 s — and accept that it expires rather than invalidates. Your real freshness guarantee lives one layer down. Inference

08
Proof-of-concept: validate this locally
Every claim below is falsifiable against your existing stack. Run these before the design discussion so you can present evidence rather than analysis.

Confirm no cache-tag support in your binary
strings -a grafbase-gateway | grep -icE 'cachetag|cache_tag|surrogate-key'
strings -a grafbase-gateway | grep -oE 'crates/[a-z-]+/src/entity_cache/[a-z]+\.rs' | sort -u
Expect 0, then the two implementation paths: entity_cache/memory.rs and entity_cache/redis.rs.

Start clean and populate the cache
docker compose -f docker-compose.gateway.yml up --build -d
sleep 10
docker compose -f docker-compose.gateway.yml exec -T redis redis-cli FLUSHALL

curl -s localhost:5060/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { id name currency } } } }"}' \
  | jq '.data.account.fundHoldings[].fund'
Prove there is no tag index
C="docker compose -f docker-compose.gateway.yml exec -T redis redis-cli"
$C DBSIZE
$C --scan --pattern '*'          # every key accounted for
$C --scan --pattern 'tag:*'      # empty
$C --scan --pattern '*tag*'      # empty
Expect DBSIZE = entity count + 1 op-cache key, and nothing tag-shaped.

Prove every key is a plain string
K=$($C --scan --pattern 'insurance-entitycache*' | head -1 | tr -d '\r')
$C TYPE "$K"; $C TTL "$K"
$C SMEMBERS "$K"; $C ZRANGE "$K" 0 -1; $C HGETALL "$K"
Expect string, a positive TTL, and three WRONGTYPE errors.

Prove the payload carries no identifier
$C GET "$K"
Expect something like {"name":"Green Bond Income","currency":"GBP"} — no id. This is the step that kills scan-and-match invalidation; demo it explicitly.

Prove headers are part of the key
$C FLUSHALL
Q='{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name currency } } } }"}'
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" > /dev/null
$C DBSIZE
curl -s localhost:5060/graphql -H 'content-type: application/json' \
     -H 'x-poc-header: anything' -d "$Q" > /dev/null
$C DBSIZE
Expect DBSIZE to increase — a meaningless extra header produced a whole new set of entity keys. This is the single most persuasive demo: it shows one entity fanning out into unbounded, unpredictable keys.

Confirm @cacheTag is rejected or inert
Add @cacheTag(format: "account-{id}") to a type in funds-subgraph/funds.graphql and recompose. Either composition fails on the unknown directive, or it succeeds and no tag keys appear in Redis. Both outcomes confirm the finding. Validate

Prototype the recommendation
Put a thin caching proxy in front of one AEM REST endpoint, writing SET + SADD tag:<id> on fill. Fire an invalidation for account-1001 and confirm exactly its keys disappear while the rest of the keyspace is untouched. That is your architecture-review demo.

09
Risks and limitations
Anything depending on Grafbase internals
The key format {prefix}-{blake3_hex}, the b"v1" marker, the hash inputs and the string-only storage are undocumented internal implementation details with no stability contract. They appear in no public API and no configuration surface. The only public knobs are enabled, ttl, storage, redis.url, redis.key_prefix and TLS. key_prefix is the only part of the key you can influence — and it is a namespace, not a handle on any individual entry.

Public API vs. internal detail
Capability	Status	Notes
Enable/disable caching, global + per-subgraph	Public	Documented config
TTL	Public	Global and per-subgraph override
Storage backend (memory / redis)	Public	Must be "redis" — defaults to memory
Redis URL, TLS	Public	Note: {{ env.* }} is not interpolated here, as your config comments record
key_prefix	Public	Namespace only
Custom key generation	Not offered	No hook, no config, no extension point
Cache tags	Does not exist	—
Programmatic delete / purge / invalidate	Does not exist	Trait has no delete method; no admin endpoint
Key format & hash inputs	Internal	Versioned for the maintainers' benefit, not yours
Other limitations to carry into the discussion
The EOL is the dominant risk. Stated archival was end of May 2026; today is 25 Aug 2026. Confirm the repository's current state and your support position before any further Grafbase investment. Validate
Header-sensitive keys hurt hit rates generally, not just invalidation. If your clients send varying headers, entity-cache effectiveness is already lower than you'd assume. Worth measuring. Inference
Operation cache entries have no TTL (TTL = -1 in your dump). They're query plans, so this is benign — but they will accumulate, bounded by limit = 1000. Not a freshness concern. Observed
Redis becomes a correctness dependency once invalidation lives there. Plan for its unavailability: fail open to origin, never fail open to stale. Inference
Valkey is a clean substitute at this layer. Your two runs — redis:7-alpine and valkey/valkey:8-alpine — produced byte-identical key sets. The commands the recommendation needs (SADD, SMEMBERS, UNLINK) are core RESP and equally supported. Observed
10
Final recommendation
Do not build
Option A. @cacheTag plus a custom invalidator over Grafbase's entity-cache keys cannot be made to work. The tag index doesn't exist, the keys can't be derived, the payloads can't be matched, the cache interface has no delete, and the runtime is archived. There is no version of this that becomes safe with more engineering.

Do build
Option B — a tag-invalidated application cache at the REST-fetch boundary, in Redis or Valkey, with keys you generate and a tag:<entity> → SET of keys index you maintain. Keep Grafbase Entity Cache in place with a short TTL as a shock absorber, and stop treating it as a freshness mechanism.

The three sentences for the architecture discussion
Grafbase Entity Cache is the wrong layer for selective invalidation — by design, not by omission. It is a TTL-based subgraph-fetch cache with no delete operation and opaque, header-derived keys. It also doesn't see the REST-extension traffic that carries most of our AEM content.
Our proposed tag-index design is correct; it just needs to live in a cache we own. Moving it to the REST boundary makes tag:account-1001 → {keys} real, and extends coverage from one subgraph to all AEM-backed content.
Grafbase Gateway is end-of-life following The Guild's acquisition. Any caching or invalidation logic we build must be router-independent so it survives the migration to Hive Router. That constraint alone rules out Option A and selects Option B.
Next steps
Run PoC steps 3–6 (§8) and bring the output — especially step 6, the header fan-out — to the discussion.
Confirm the current Grafbase repository/support status and set a target date for the Hive Router evaluation. Validate
Decide B vs. C on ownership grounds: is AEM content consumed by anything other than this graph?
Settle the tag granularity — per-entity (account-1001), per-type, or per-content-fragment — against what AEM actually emits on publish. This determines whether invalidation is genuinely selective in practice.
Confirm whether the cache belongs in the WASM extension or a sidecar before committing to a design. Validate
Primary sources
Grafbase upstream source — crates/runtime/src/entity_cache.rs (trait), crates/runtime-local/src/entity_cache/redis.rs (Redis backend), crates/engine/src/resolver/graphql/cache.rs (key derivation), crates/gateway-config/src/entity_caching.rs (config) — github.com/grafbase/grafbase
Entity Cache configuration — Grafbase docs
Entity Caching — Grafbase docs
Supported directives — Grafbase docs
The Guild has acquired Grafbase — Hive blog, 10 Feb 2026
RFC: Response Caching — graphql-hive/router #312
Response Caching FAQ (@cacheTag) — Apollo GraphOS docs
Introducing Response Caching — Apollo blog
Local artefacts — grafbase-gateway 0.53.5 binary symbols; redis-cache-dump-20260824-140414.txt; valkey-cache-test-report.txt; Docs/ENTITY-CACHING-WHY-NOOP.md; grafbase.toml