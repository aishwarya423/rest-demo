I'll give you a quick inline command plus a reusable script, and smoke-test the script so I know it actually works.

Now smoke-test the script against a throwaway Redis with a couple of sample keys (mimicking the cache) to confirm it works:

The script works but I caught two bugs in the smoke test: only the **first** key got dumped (the `docker exec -i` inside the loop consumed the key-list stdin — a classic pipe bug), and the "source" line printed garbled. Let me fix both:

Fixed and verified — all 3 keys dumped, the prefix summary groups correctly (2 entity + 1 op), TTLs shown, and `-1s` correctly means "no expiry" (operation cache).

## Quick inline command (one-off peek)

Adjust the container name to yours (`docker ps` to find it — e.g. `redis-cache`, or `rest-demo-redis-1` for docker-compose):

```bash
docker exec redis-cache redis-cli --scan --pattern '*'
```

See a specific key's TTL + value:

```bash
docker exec redis-cache redis-cli TTL 'insurance-entitycache-<hash>'
docker exec redis-cache redis-cli --no-raw GET 'insurance-entitycache-<hash>'
```

If you have `redis-cli` on your host (port 6379 is published), drop the `docker exec redis-cache` prefix and use `redis-cli ...` directly.

## The script → writes to a file

[scripts/dump-redis-cache.sh](scripts/dump-redis-cache.sh) dumps every matching key with **KEY · TYPE · TTL · VALUE** plus a count-by-prefix summary.

```bash
# host has redis-cli (port 6379 published):
scripts/dump-redis-cache.sh

# no host redis-cli — run inside the container instead:
REDIS_CONTAINER=redis-cache scripts/dump-redis-cache.sh

# only entity-cache keys, custom output file:
scripts/dump-redis-cache.sh 'insurance-entitycache*' entity-keys.txt
```

Defaults: pattern `*`, output `redis-cache-dump-<timestamp>.txt` in the current dir. Connection is `127.0.0.1:6379` unless you set `REDIS_HOST`/`REDIS_PORT` or `REDIS_CONTAINER`.

A couple of honest notes:
- Cache **values are serialized/compressed blobs**, so the readable signal is the **key names, TYPE, and TTL** — not the value bytes. The script still dumps the raw value (escaped) so you can see it's there.
- It reads real cache keys only when the stack is actually running (funds subgraph + production gateway per [funds-subgraph/README.md](funds-subgraph/README.md)) and you've fired a query — otherwise it correctly reports 0 keys.

This is a new untracked file (`scripts/`); I haven't staged or committed anything.


-----2nd

I'll add the Redis cache-inspection commands to [funds-subgraph/README.md](funds-subgraph/README.md) so all test commands live in one place. Let me read the current "Prove entity caching" section to slot it in right after:

Now I'll insert an "Inspect the Redis cache" section between "Prove entity caching" and "Caveats":

Done. Added an **"Inspect the Redis cache"** section to [funds-subgraph/README.md](funds-subgraph/README.md), placed right after "Prove entity caching" so the whole test flow reads top-to-bottom in one place:

- **Quick peek (inline)** — `--scan` for all keys / entity-only / op-only, plus `TTL` + `--no-raw GET` for a single key, with the note that you can drop the `docker exec` prefix if you have host `redis-cli`.
- **Dump the whole cache to a file** — the three ways to run [scripts/dump-redis-cache.sh](scripts/dump-redis-cache.sh) (host redis-cli, `REDIS_CONTAINER`, filtered pattern), defaults, and the reminder that values are serialized blobs so key names/TYPE/TTL are the readable signal.

The README now covers the full runbook end-to-end: install → run stack → query → prove caching → inspect Redis → caveats. Still nothing staged or committed.