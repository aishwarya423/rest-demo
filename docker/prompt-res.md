Good idea — a Docker-native way to prove caching. Let me first understand the current Dockerfile, the mock-service ports, and the schema's baseURLs so the gateway container can actually reach the REST services inside the compose network.

Let me check what port the mock services actually listen on (there's a `PORT: 3000` env but `3001:3001` port mapping — I need the real internal port for the gateway to reach them by service name).

Clear now. Key facts confirmed:
- Mock services **hardcode** their ports (`accounts=3001`, `funds=3002`, `policies=3003`); the `PORT` env is ignored. So inside the compose network the gateway reaches them at `http://accounts-rest:3001`, `http://funds-rest:3002`, `http://policies-rest:3003` — which match the commented-out service-name baseURLs in [schema.graphql](schema.graphql).
- The current [Dockerfile](Dockerfile) only has the `grafbase` CLI (for `dev`), not the production gateway.

My approach: a separate **`Dockerfile.gateway`** (installs `grafbase-gateway` + CLI), an **entrypoint** that rewrites baseURLs → service names, composes the federated schema, and runs the production gateway, plus a standalone **`docker-compose.gateway.yml`**. This leaves your existing dev setup untouched. Writing them now:

Let me make the entrypoint executable and verify Docker is available, then test the build actually works:

Docker's available and the compose file parses. Let me build the gateway image to catch any install/binary issues (this is the risky part — the `grafbase-gateway` download and CLI install):

Build succeeded — gateway 0.53.5 installed and `--version` ran. Now the real test: bring up the full stack and verify caching actually writes to Redis.

The gateway container isn't in the `ps` list — it may have exited. Let me check its logs:

The gateway starts but resolves the extension path **relative to the config file's directory** (`/tmp`), not `/app`. Since I put the rewritten config in `/tmp`, it looks for `/tmp/grafbase_extensions`. Fix: make the extension path absolute in the rewritten config. Let me update the entrypoint:

The gateway is up and serving. Now the real proof — fire a query and confirm caching keys land in Redis:

The query works end-to-end (`"holderName":"Anika Rao"` — gateway reached the REST services via service names). The shell alias trick failed in zsh; let me run the Redis checks directly:

DBSIZE is 0 — no keys written, even though the query succeeded. That's unexpected. Let me investigate: check all keys, the resolved config inside the container, and whether `{{ env.REDIS_URL }}` actually interpolated:

No keys at all, and the config still shows the literal `{{ env.REDIS_URL }}`. I need to determine the real cause: does the gateway **not** interpolate `{{ env.* }}` on the caching URL (meaning my Task-2 change silently broke caching), or is operation caching just not writing? Let me test with a hardcoded URL inside the running container:

**Critical finding.** With a **hardcoded** `redis://redis:6379`, the key appears (`insurance-opcacheop.blake3.…`). With `{{ env.REDIS_URL }}`, **no keys are written**. So gateway 0.53.5 does **not** interpolate `{{ env.* }}` on the caching `redis.url` field — my Task-2 change silently broke caching (the web docs were wrong for this version). The `{{ env.* }}` templating only works for the REST *extension* config, not the gateway's core caching config.

I'll fix this properly: keep the endpoint env-driven, but do the substitution in tooling (entrypoint / host sed) instead of relying on gateway templating that this version ignores. Let me correct all the affected files.

Now the entrypoint — substitute `$REDIS_URL` into the config so the endpoint stays env-driven at the docker layer:

Now rebuild and retest the real entrypoint end-to-end:

Now it caches correctly (`DBSIZE=1`, `insurance-opcache*` key present). Let me verify the **persistence AC** — restart the gateway and Redis, confirm the key survives via the volume:

Persistence confirmed — the `insurance-opcache` key survived restarting **both** Redis and the gateway (via the `redis-data` volume). The Docker path fully works. Now let me fix the two docs that still describe the broken gateway-interpolation approach. Reading the current state of CACHING.md's affected sections:

Now restore the host `sed` step (revert the env-export changes I made earlier):

Now fix the README's env-driven section and add the Docker-way instructions. Let me read the current README caching section:

Now update CACHING.md's "Running caching in docker-compose" section — that follow-up now exists as `docker-compose.gateway.yml`:

Now sync the technical-details doc (§4 env note + §6 AC2 status) and the Confluence page. Reading the relevant sections:

Now update the Confluence page (Solution table env note + Future Scope AC2):

Let me correct an inaccurate comment in the Dockerfile (the build log showed the installer actually pulls a **musl** static binary, not glibc), then tear down the test stack:

Done — and importantly, **testing it surfaced a real bug I introduced earlier**, which is now fixed and verified.

## New files (the Docker way to run caching)
- **[Dockerfile.gateway](Dockerfile.gateway)** — installs the production `grafbase-gateway` binary + the `grafbase` CLI.
- **[docker/gateway-entrypoint.sh](docker/gateway-entrypoint.sh)** — at startup: rewrites REST baseURLs → compose service names, substitutes `$REDIS_URL`, runs `grafbase compose`, execs the gateway.
- **[docker-compose.gateway.yml](docker-compose.gateway.yml)** — standalone stack (mocks + Redis + production gateway on port **5060**). Run it *instead of* the default compose.

```bash
docker compose -f docker-compose.gateway.yml up --build -d
```

## Verified end-to-end (not just written)
I built and ran the whole stack:
- ✅ Query works: `{"data":{"account":{"holderName":"Anika Rao"}}}` — gateway reaches the REST services by service name.
- ✅ Caching engages: `insurance-opcache*` key appears in Redis after a query.
- ✅ Entity cache stays empty (topology no-op, as documented).
- ✅ **Persistence**: the key survives restarting **both** `redis` and `grafbase-gateway` (via the `redis-data` volume) — this validates AC5 in Docker.

## The bug it caught — Task 2 was silently broken
Testing revealed that gateway **0.53.5 does NOT interpolate `{{ env.REDIS_URL }}`** in the caching `redis.url` field (that templating only works for the REST-*extension* config). Proof: `{{ env.REDIS_URL }}` wrote **zero keys**; a concrete `redis://redis:6379` wrote the key. The web docs I relied on were wrong for this version.

Fix applied everywhere: `grafbase.toml` now holds a concrete default, and `REDIS_URL` is substituted by our tooling (entrypoint for Docker; the restored `sed` for host testing) — so it's still env-driven, just not via gateway templating. I corrected [grafbase.toml](grafbase.toml), [Docs/CACHING.md](Docs/CACHING.md), [README.md](README.md), and both analysis docs, with a ⚠️ gotcha note so no one reintroduces it.

## Docs updated
AC2 and AC5 are now marked **Done (verified in Docker)** in [Caching-Technical-Details.md](Docs/Caching-Technical-Details.md) and the Confluence page; the "run caching in Docker" sections now point to the real, working compose file.

Two caveats unchanged (both by design, both documented): the *default* `docker-compose.yml` still runs `grafbase dev` (no caching) — use the gateway compose file for caching; and entity caching remains a topology no-op.

Want me to fold the production gateway into the default `docker-compose.yml` behind a compose profile so a single `up` can run either mode?

util cmds
docker build -f Dockerfile.gateway -t rest-demo-gateway:test . 2>&1 | tail -40
