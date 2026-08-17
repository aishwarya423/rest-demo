Great idea — a presenter's runbook. I'll write two demo scripts (short ~5 min, medium ~12–15 min) with narration, the exact commands to run live, and what to point at — plus a pre-flight checklist so nothing stalls during the demo.

One claim in the demo needs verifying before I hand it over — that a **cache hit doesn't reset the TTL** (my "proof of cache hit" step). Let me confirm that's actually true, so it doesn't backfire live:

Verified — the proof point holds: TTL went **120 → 115 → 115** (the repeat query did **not** reset it to 120), confirming the second query was served from cache. That step is safe to show live.

The demo script is written to [Docs/jira/DEMO-SCRIPT.md](Docs/jira/DEMO-SCRIPT.md) — untracked, nothing staged/committed, stack torn down.

## What you got — two demo scripts in one runbook

**Pre-flight checklist** (run before the meeting): pre-build images, pre-pull Redis + Valkey, free the ports, and (for the short version) pre-start the stack — so nothing downloads or stalls live.

**Short (~5 min)** — the elevator demo:
1. The pitch (30s)
2. A query resolves across two subgraphs
3. Caching engaged → show the `insurance-entitycache*` + `insurance-opcache*` keys
4. **Cache-hit proof via TTL countdown** (verified above)
5. Redis → Valkey with one env var, same keys
6. Close

**Medium (~12–15 min)** — adds the story:
1. Context + the architecture diagram (from Confluence)
2. **The key insight** (virtual REST subgraph → no entity cache; real GraphQL subgraph → cached)
3. Bring the stack up, point at the services
4. Operation + entity cache + the TTL cache-hit proof
5. **Persistence across restart** (DBSIZE unchanged, no query re-fired)
6. Redis → Valkey drop-in + the licensing talking point
7. The tooling (`run-valkey-cache-test.sh`, `dump-redis-cache.sh`)
8. Wrap: caveats + future scope

Every step is marked **[SAY]** / **[RUN]** / **[POINT]**, with copy-pasteable commands. It also includes:
- A **reusable `Q=...` query** to put on your clipboard.
- A **troubleshooting table** (port clash, gateway warm-up, `valkey-cli` vs `redis-cli`, etc.).
- A **one-liner fallback** — `scripts/test-entity-caching.sh both` — if live commands wobble, just run it and narrate the PASS output.

One tip baked into the checklist: pre-pull `valkey/valkey:8-alpine` and pre-build the gateway image, since the gateway image download (~90s) is the only slow part and you don't want it happening mid-demo.


$ cd /Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo
for p in 3001 3002 3003 3009 6379 5060; do pid=$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
docker compose -f docker-compose.gateway.yml up -d >/dev/null 2>&1
# wait for gateway
for _ in $(seq 1 30); do curl -sf localhost:5060/graphql -H 'content-type: application/json' -d '{"query":"{ __typename }"}' >/dev/null 2>&1 && break; sleep 2; done
Q='{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name currency } } } }"}'
docker compose -f docker-compose.gateway.yml exec -T redis redis-cli FLUSHALL >/dev/null
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null
K=$(docker compose -f docker-compose.gateway.yml exec -T redis redis-cli --scan --pattern 'insurance-entitycache*' | head -1 | tr -d '\r')
echo "TTL right after 1st query: $(docker compose -f docker-compose.gateway.yml exec -T redis redis-cli TTL "$K" | tr -d '\r')"
sleep 5
echo "TTL after 5s (no query):   $(docker compose -f docker-compose.gateway.yml exec -T redis redis-cli TTL "$K" | tr -d '\r')"
curl -s localhost:5060/graphql -H 'content-type: application/json' -d "$Q" >/dev/null
echo "TTL after repeat query:    $(docker compose -f docker-compose.gateway.yml exec -T redis redis-cli TTL "$K" | tr -d '\r')  (if still counting down => cache HIT, not reset)"
docker compose -f docker-compose.gateway.yml down -v >/dev/null 2>&1

TTL right after 1st query: 120
TTL after 5s (no query):   115
TTL after repeat query:    115  (if still counting down => cache HIT, not reset)