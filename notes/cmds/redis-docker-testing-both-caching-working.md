I'll make the Docker path fully self-contained so you can test Redis entity caching with just `docker compose`. Let me re-read the current Docker files to update them precisely.

Now I have the full picture. I'll wire the `funds-subgraph` into the Docker gateway stack. Changes: a Dockerfile for the funds subgraph, gateway image copies the funds SDL, the entrypoint rewrites the funds URL + schema_path to Docker service names, and the compose file adds the funds service. Let me write them all:

Now update the gateway image to copy the funds SDL, and the entrypoint to rewrite the funds URL + schema_path for the Docker network:

Now rewrite `docker-compose.gateway.yml` to add the `funds-subgraph` service and a clear run/test sequence in the header:

Now the critical part — build and run the full Docker stack, then verify entity caching works end-to-end in Docker:

All images built. Now bring it up and verify entity caching in Docker:

Port 3001 is occupied — leftover host processes from earlier testing. Let me free the ports and retry:

6379 is held by a leftover Redis container's port mapping. Let me find and remove it (not kill Docker itself):

All services healthy and the gateway is serving. Now the decisive test — entity caching in Docker:

Query resolved correctly (fund data returned). The shell-variable-as-command failed in zsh again — let me run the Redis checks directly:

**Entity caching works fully in Docker.** 3 `insurance-entitycache-*` keys (one per Fund), 1 op-cache key, TTL 120s — all from a single `docker compose up`, no host tools. Let me also confirm the dump script works against the compose Redis, then tear down:

Everything works in Docker — the dump script too. Let me finalize the docs: add a warning to the default compose, and update the canonical caching doc. Let me check the current top of `docker-compose.yml` and the CACHING.md docker section:

The CACHING.md docker section and its "entity caching does nothing" recap are now outdated (entity caching works after the split). Let me read the recap to update it, then fix everything:

Now update the CACHING.md Docker section and the outdated recap, and add a warning to the default compose. First the Docker section:

Now a warning at the top of the default `docker-compose.yml` (it can't cache and now needs the funds subgraph):

Now add a Docker section to [funds-subgraph/README.md](funds-subgraph/README.md) so the all-Docker path sits alongside the other commands. Let me view where to insert it:

Let me verify the final git state (everything unstaged, no stray files) and that the stack is torn down:

The earlier changes aren't in this status — it looks like you committed them between turns (funds-subgraph/README.md shows as tracked now). Let me confirm that and clean up stray dump files from my testing:

Confirmed — you committed the earlier work (`a8ddce7 entity caching working without docker`), so schema.graphql, grafbase.toml, funds-subgraph/, and scripts/ are all in HEAD. My Docker changes are the new unstaged work. Since the dump script writes `redis-cache-dump-*.txt` to the cwd, let me add that to `.gitignore` so those outputs never get committed by accident:

Done — and I caught something worth flagging: three of my earlier **test dump files got accidentally committed** in your commit (`entity-keys.txt`, `redis-cache-dump-*.txt`). I removed them (they show as `D` deletions) and added a `.gitignore` rule so the dump script's output can't be committed again. Include those deletions when you commit.

Everything runs and was **verified end-to-end in Docker** — no host tools needed.

## What changed
- **`funds-subgraph/Dockerfile`** + **`.dockerignore`** (new) — containerizes the Yoga subgraph.
- **`Dockerfile.gateway`** — now also bundles the funds SDL for `grafbase compose`.
- **`docker/gateway-entrypoint.sh`** — rewrites the funds subgraph URL (`localhost:3009` → `funds-subgraph:3009`) and its schema path for the Docker network, alongside the existing REST/Redis rewrites.
- **`docker-compose.gateway.yml`** — adds the `funds-subgraph` service, makes the gateway depend on it, and carries the full run/test sequence in its header.
- **`docker-compose.yml`** — warning banner pointing to the gateway compose for caching.
- **`Docs/CACHING.md`** + **`funds-subgraph/README.md`** — updated to the working entity-caching Docker flow.

## Verified in Docker
One `docker compose up` → query → **3 `insurance-entitycache-*` keys** (one per Fund) + op-cache key, **TTL 120s**, and the dump script works against the compose Redis. All services healthy.

## Simple sequence (all Docker)

```bash
# 1. run the whole stack (mocks + funds subgraph + redis + production gateway)
docker compose -f docker-compose.gateway.yml up --build -d
docker compose -f docker-compose.gateway.yml ps          # wait until healthy
```

```bash
# 2. clear the cache
docker compose -f docker-compose.gateway.yml exec redis redis-cli FLUSHALL
```

```bash
# 3. query across the subgraph boundary (account -> fund lives in `funds`)
curl -s localhost:5060/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name currency } } } }"}'
```

```bash
# 4. see the ENTITY cache keys (one per Fund) + operation cache
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-entitycache*'
docker compose -f docker-compose.gateway.yml exec redis redis-cli --scan --pattern 'insurance-opcache*'
```

```bash
# 5. dump the whole cache to a file
REDIS_CONTAINER=$(docker compose -f docker-compose.gateway.yml ps -q redis) scripts/dump-redis-cache.sh
```

```bash
# 6. tear down
docker compose -f docker-compose.gateway.yml down
```

This same sequence is in the `docker-compose.gateway.yml` header, `Docs/CACHING.md`, and `funds-subgraph/README.md` so it's easy to find.

## Notes
- Use `docker-compose.gateway.yml` (not the default `docker-compose.yml`, which runs `grafbase dev` and ignores caching).
- One corporate-network caveat: the gateway image build downloads the `grafbase-gateway` binary from `grafbase.com` and installs the `grafbase` CLI via npm — the **build** step needs outbound access to those. Once built, **running** is fully local. If your build environment blocks that, tell me and I'll adjust the image to use a pre-provided binary/registry.
- Nothing staged or committed — all yours to review.