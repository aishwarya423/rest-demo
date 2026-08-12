I'll read your Jira story first, then go through the code to check coverage.

Now let me go through the code to check coverage. Let me look at the key files: docker-compose, grafbase.toml, README, and the docs.

I've gone through the story and the code. Here's the coverage assessment mapping each **in-scope** item and **acceptance criterion** to what's actually in the repo.

## The one gap that undercuts everything else

**The `grafbase` service in [docker-compose.yml:63](docker-compose.yml:63) runs `grafbase dev`, and `grafbase dev` ignores all caching** (documented in [Docs/DEV-VS-GATEWAY-CACHING.md](Docs/DEV-VS-GATEWAY-CACHING.md)). Caching only runs under the production `grafbase-gateway` binary — which compose does **not** run.

So in the default `docker compose up` experience, **no caching happens at all**. Every acceptance criterion about the cache actually working (AC2, AC3, AC4, AC5) is only demonstrable by manually running `grafbase-gateway` on the host outside compose. That's the headline gap.

## In-scope coverage

| In-scope item | Status | Evidence / gap |
|---|---|---|
| Redis/Valkey container via Docker Compose **with persistence** | ✅ Covered | `redis:7-alpine`, `restart: unless-stopped`, `redis-data` volume ([docker-compose.yml:46](docker-compose.yml:46)) |
| Runtime uses Valkey endpoint **through environment config** | ⚠️ Partial | Redis URL is **hardcoded** `redis://redis:6379` in [grafbase.toml:44](grafbase.toml:44), not read from an env var (`{{ env.* }}`). Endpoint is a compose service name, not env-driven. |
| Grafbase cache configuration | ✅ Covered | `[operation_caching]` + `[entity_caching]` with Redis backends ([grafbase.toml:39-59](grafbase.toml)) |
| Cache behavior validation — **entity query** | ❌ Not achievable here | Entity caching is a verified **no-op** in this single-subgraph REST-extension topology ([Docs/ENTITY-CACHING-WHY-NOOP.md](Docs/ENTITY-CACHING-WHY-NOOP.md)). Only *operation* caching was validated. The story literally asks for entity-query validation. |
| TTL or cache tagging at POC level | ⚠️ Partial | TTL is **configured** (`ttl="60s"`, subgraph `120s`) but never **demonstrated** (no expiry test). Operation caching doesn't exercise TTL the way the story implies. |
| Documentation updated with cache setup + verification flow | ✅ Covered (in Docs) | [Docs/CACHING.md](Docs/CACHING.md) is thorough — but see AC6, it's **not in the README**. |
| Cache persistence across gateway restart, verified via retained keyspace | ⚠️ Partial | Volume persists keys, and [CACHING.md §6](Docs/CACHING.md) shows restart reuse — **but only under `grafbase-gateway`**, not the compose default. |

## Acceptance criteria coverage

| Acceptance criterion | Status | Note |
|---|---|---|
| Valkey/redis runs alongside grafbase via docker compose | ✅ Covered | Both services present |
| **Runtime uses Valkey-backed cache** | ❌ **Not covered** | Compose runs `grafbase dev` → caching ignored. The shipped runtime does not use the cache. |
| **Repeat queries return cached response** | ❌ Not as written | Operation caching caches the **query plan, not response data**. Entity caching (which *would* cache responses) is a no-op here. So repeat queries do **not** return a cached response. |
| Cache TTL or tagging behavior is **demonstrated** | ❌ Not demonstrated | Configured only; no test showing expiry/tagging |
| Cache survives runtime restart (where applicable) | ⚠️ Partial | Works under `grafbase-gateway` + volume; "where applicable" caveat saves it, but not shown in compose default |
| **README updated** with cache configuration details | ❌ Not covered | [README.md](README.md) is still the REST-extension example + scratch commands. Caching docs live in `Docs/`, not the README. |

## What's missing, prioritized

1. **AC2 — biggest gap.** Compose runs `grafbase dev`, so nothing is cached in the delivered setup. Either switch the compose `grafbase` service to `grafbase-gateway` (+ a `grafbase compose` step for the federated schema), or the story must explicitly scope "runtime" to the host-run production gateway.
2. **AC6 — README not updated.** Concrete, easy fix: the story says *Readme*, and the README has zero cache content. Either update README.md or get agreement that `Docs/CACHING.md` satisfies it.
3. **Entity-query validation (in-scope) + "repeat queries return cached response" (AC3).** Both assume response-data caching. This topology can't do it via Grafbase — only operation-plan caching works. Needs either a scope caveat in the story or a REST-layer cache to actually cut round-trips.
4. **TTL/tagging demonstration (AC4).** Configured but not demonstrated — add a POC step showing a key expiring after TTL.
5. **Env-driven endpoint (in-scope).** Redis URL is hardcoded; make it `{{ env.REDIS_URL }}` if "through environment config" is meant literally.

Want me to write this up as a coverage/gap report md file in `Docs/`, or start closing the gaps (switch compose to the production gateway, update the README)?