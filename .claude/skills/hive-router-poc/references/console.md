# Self-hosted Hive Console

The registry. Adds schema versioning, composition, schema checks, policy
linting and usage analytics, with no dependency on Hive Cloud. Everything runs
locally.

Verified end to end on 2026-11-04 against `hive@15.0.1` and Hive CLI 0.68.2,
and again on 2026-11-19 against `hive-router` **0.3.16** and Hive Gateway
**2.15.10**. Earlier notes in this repository saying router 0.3.12 or 0.3.14
are stale; the image tracked by `:latest` reports 0.3.16.

## Contents

- [What is and is not available self-hosted](#what-is-and-is-not-available-self-hosted)
- [The stack](#the-stack)
- [Setup](#setup)
- [Publishing and checking](#publishing-and-checking)
- [Connecting the router](#connecting-the-router)
- [Gotchas](#gotchas)
- [Credential drift: the one that cannot be rotated in place](#credential-drift-the-one-that-cannot-be-rotated-in-place)
- [Artifact versioning: the two identifiers](#artifact-versioning-the-two-identifiers)
- [Three kinds of credential, not interchangeable](#three-kinds-of-credential-not-interchangeable)
- [The Laboratory](#the-laboratory)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

## What is and is not available self-hosted

| Capability | Self-hosted |
|---|---|
| Console UI, registry, schema history | yes |
| Federation composition | yes (`schema` service) |
| Schema checks, breaking-change detection | yes |
| Schema policy linting | yes (`policy` service) |
| Usage analytics | yes (ClickHouse) |
| Supergraph artifact delivery | yes — `server` container, `CDN_API=1` |
| **High-Availability CDN** | **no — Cloud only** |
| Billing integration | no — Cloud only |

The precise statement, which matters because it is easy to get wrong in both
directions: **the CDN is unavailable, the artifact endpoints are not.** A real
CDN needs Cloudflare. The `server` container serves the same artifact *routes*,
and `supergraph.source: hive` works unchanged against them, because the loader
only needs a URL of that shape accepting an `X-Hive-CDN-Key` header.

**The registry is not in the request path.** It is a build-time dependency. If
Console is down, both routers keep serving the last supergraph they loaded.

## The stack

`hive-console/docker-compose.community.yml` is the **official** community file,
vendored byte-for-byte from the `hive@15.0.1` release and never edited, so it
can be re-fetched and diffed on upgrade.

| Group | Services |
|---|---|
| Hive | `app` `server` `schema` `policy` `workflows` `usage` `usage-ingestor` `migrations` |
| Data | `db` (PostgreSQL 16) `clickhouse` `redis` `broker` (Redpanda) |
| Storage | `s3` (VersityGW) `s3_reverse_proxy` (Caddy) |

`docker-compose.console.yml` pulls it in with Compose `include`, so the whole
thing is **one project**, not two. Two networks result:
`hive-router-poc_default` for the POC and `hive` for Console. Only `hive-cli`
and `hive-router-registry` join both.

Hive's own docs call this an evaluation environment, "not a production-ready
architecture" — single instance, local-disk state. That judgement is theirs and
it is correct.

Ports:

| URL | Purpose |
|---|---|
| http://localhost:8080 | Console web app |
| http://localhost:8082/graphql | Hive GraphQL API (CLI target) |
| http://localhost:8082/artifacts/v1/… | Artifact endpoints |
| http://localhost:8081 | Usage-reporting API |
| http://localhost:9001 | S3 admin UI |

First run pulls ~5.7 GB. `migrations` and `supergraph-compose` finish as
`Exited (0)` — success.

## Setup

```bash
cd hive-router-poc
./hive-console/bootstrap-secrets.sh                      # writes .env, chmod 600
docker compose -f docker-compose.yml -f docker-compose.console.yml up -d --build
```

The script exists because a Compose `.env` cannot run `$(openssl rand ...)` —
the resolved values have to be written out once. `.env.example` documents every
variable and marks each GENERATED, FIXED or MANUAL.

Then, **manually in the UI** (there is no documented CLI or bootstrap API for
these, so a one-command setup is not achievable):

1. Sign up at http://localhost:8080 — email verification is disabled, any
   address works.
2. Create an organization, then a project of type **Federation**. Hive creates
   `development`, `staging` and `production` targets automatically.
3. Organization → Settings → **Access Tokens**. Grant under Schema Registry:
   `Check schema`, `Publish schema`, `Push schema`; under Usage Reporting:
   `Report usage data`. Put it in `.env` as `HIVE_TOKEN`, with `HIVE_TARGET`.
4. Target → Settings → **CDN Tokens** → create. Take the target id from
   Settings → General. Put both in `.env` as `HIVE_CDN_KEY` and
   `HIVE_CDN_ENDPOINT`.

## Publishing and checking

```bash
docker compose -f docker-compose.yml -f docker-compose.console.yml \
  run --rm hive-cli hive/publish.sh

docker compose -f docker-compose.yml -f docker-compose.console.yml \
  run --rm hive-cli hive/check.sh
```

Both scripts loop over the three subgraphs, reading SDL from the shared volume
written by `supergraph-compose` — so the published schema and the running
schema cannot drift.

The subgraph URLs passed with `--url` are baked into the composed supergraph by
the registry, so they must be the in-network forms
(`http://accounts-subgraph:4001/graphql`).

A check composes the candidate against every *other* registered subgraph and
diffs it against the last published version. It exits non-zero on a breaking
change, so it works as a CI gate as-is. Verified: removing a field produced
`Field holderName was removed from object type Account` and exit 1.

There is no official `ghcr.io/graphql-hive/cli` image — `hive/Dockerfile`
installs the npm package `@graphql-hive/cli` (pinned) into a small Node image.

## Connecting the router

`router/router.registry.config.yaml`:

```yaml
supergraph:
  source: hive
  endpoint:
    expression: env("HIVE_CDN_ENDPOINT")
  key:
    expression: env("HIVE_CDN_KEY")
  poll_interval: 10s
```

```bash
docker compose -f docker-compose.yml -f docker-compose.console.yml \
  --profile registry up -d hive-router-registry
```

It sits behind a profile because it cannot start until a target exists and the
two CDN variables are filled in.

Verified: a republish propagated to the running router in **~2 seconds**, no
restart. Rollback likewise.

## Gotchas

**`S3_ROOT_USER`, not `MINIO_ROOT_USER`.** The published get-started guide says
the MinIO names and is stale. `hive@15` switched MinIO→VersityGW and renamed
them. The old names are silently ignored, the S3 credentials resolve empty, and
it fails at artifact-write time rather than at startup — so the stack looks
healthy first.

**Access tokens are organization-scoped**, so every CLI call needs
`--target "<org>/<project>/<target>"`. That is why `.env` carries `HIVE_TARGET`
alongside `HIVE_TOKEN`.

**`HIVE_CDN_ENDPOINT` ends with the target's UUID, not its name.** Verified
2026-11-19: with the same valid CDN key, `…/artifacts/v1/development` returns
**403 Forbidden** and `…/artifacts/v1/cc74f9a2-…` returns 200. A 403 rather than
a 404 is what makes this confusing — the path looks plausible, so the key gets
blamed. The router's symptom is a `failed to load supergraph` line every
`poll_interval` and `NO_SUPERGRAPH_AVAILABLE` on every query. Test the pair
before starting the router:

```bash
docker run --rm --network hive curlimages/curl:8.11.1 -s -o /dev/null -w '%{http_code}\n' \
  -H "X-Hive-CDN-Key: $(sed -n 's/^HIVE_CDN_KEY=//p' .env | tail -1)" \
  "$(sed -n 's/^HIVE_CDN_ENDPOINT=//p' .env | tail -1)/supergraph"
```

Target ids without the UI: `select id, name from targets` in the `registry`
database.

**Use the in-network artifact URL for the router.** The "Connect to CDN" dialog
shows `host.docker.internal:8082`, and Settings shows `localhost:8082`. Both are
host-side. The router is a container on the `hive` network, so it should use
`http://server:3001/artifacts/v1/<TARGET_ID>` — one hop fewer, and it works on
Linux where `host.docker.internal` does not exist by default. Use the
`localhost` form only from your own shell.

**`poll_interval` defaults differ by source.** Under `source: hive` it defaults
to 10s. Under `source: storage` — the S3 path tested in `hive-registry-poc` —
polling defaults to **disabled**, so the router loads once and never again, with
no error and no warning. Both configs in `router/` set it explicitly for this
reason.

**Do not use `:?` required-variable syntax in the Compose overlay.** Compose
interpolates every service even when its profile is inactive, so a `:?` on the
registry router's variables makes `config` and `up` fail for the whole project
until they are filled in. The overlay uses `:-` defaults with an obvious
placeholder instead.

**Regenerating secrets rotates sessions and tokens.** `bootstrap-secrets.sh
--force` rotates `SUPERTOKENS_*` (invalidating all sessions) and
`CDN_AUTH_PRIVATE_KEY` (invalidating every issued CDN token). It now *carries
forward* `POSTGRES_PASSWORD` and `HIVE_ENCRYPTION_SECRET` when
`hive-console/.hive/postgres` exists, because those two are pinned by that data
directory — see the next section. Deleting `hive-console/.hive/` is no longer
required, and is no longer the right first move.

## Credential drift: the one that cannot be rotated in place

Verified 2026-11-19. This is the most misleading failure in the stack, because
the symptom is a browser error on a healthy-looking install.

**The mechanism.** The `postgres` image applies `POSTGRES_PASSWORD` only at
first `initdb`. With `.hive/postgres` present it logs *"Database directory
appears to contain a database; Skipping initialization"* and keeps the original
password. Regenerate `.env` after that and `migrations`, `workflows` and `usage`
all fail with `28P01`; `server` waits on
`migrations: service_completed_successfully` and so never starts at all.

**Why it looks like a frontend bug.** `app` (:8080) has no `depends_on`, so it
stays healthy and serves the login page. The form posts to `server` (:8082),
which is in state `Created`. A POST to a port with nothing listening surfaces in
the browser as **"An error occurred / Failed to fetch"** — no database error
anywhere in sight. First check is `docker compose ps server`: `Created`, not
`Up`, means look at `migrations`.

**Why the obvious test says the password is fine.** The data directory's
`pg_hba.conf` is, in order:

```
local  all all              trust
host   all all 127.0.0.1/32 trust
host   all all all          scram-sha-256
```

So `docker exec db psql -U postgres` and `psql -h 127.0.0.1` **both succeed
without checking any password**. Only a connection from another container over
the `hive` network reaches the scram rule — the connection Hive's own services
make. Probe it that way or the fault appears not to exist. The same ordering is
what makes repair possible: `ALTER USER` over the socket needs no old password.

**Only PostgreSQL drifts.** ClickHouse, Redis and VersityGW re-apply their
credentials from the environment at every container start — the ClickHouse
entrypoint rewrites `/etc/clickhouse-server/users.d/default-user.xml` each boot,
and that path is not a mounted volume. `HIVE_ENCRYPTION_SECRET` is pinned the
same way `POSTGRES_PASSWORD` is, since it decrypts values already in the
database.

**The two scripts.** Prevention is in `bootstrap-secrets.sh` (carry-forward,
with `--rotate-db` as the deliberate override); cure is
`hive-console/sync-db-password.sh` — probe from a throwaway container, `ALTER
USER` over the socket, re-probe, re-run `migrations`, start
`server`/`workflows`/`usage`. Idempotent: `in sync` and exit 0 when there is
nothing to do, `--check` to report without changing anything.

```bash
./hive-console/sync-db-password.sh            # check and repair
./hive-console/sync-db-password.sh --check    # report only
```

**Never answer a 28P01 here with `down -v`.** It is recoverable with no data
loss, and the accounts, organizations and schema history live in that database.

**`down -v` does not delete Hive's data anyway.** `.hive/` is a set of bind
mounts, not named volumes, so the databases outlive the containers and survive
`down -v` untouched. Only `rm -rf hive-console/.hive` removes them.

**If `.env` is lost while `.hive/` survives**, the generated password is gone but
the data need not be. `bootstrap-secrets.sh` looks in `.env`, then in the running
`db` container's environment; failing both it prints two routes and writes
nothing. Route A keeps everything:

```bash
./hive-console/bootstrap-secrets.sh --rotate-db
docker compose -f docker-compose.yml -f docker-compose.console.yml up -d db
./hive-console/sync-db-password.sh
docker compose -f docker-compose.yml -f docker-compose.console.yml up -d --build
```

Verified 2026-11-19 on a registry holding one account, one organization and one
Federation project: all survived. Rotating `HIVE_ENCRYPTION_SECRET` cost nothing
there because no access tokens, CDN tokens or OIDC integrations existed — if any
do, those specific values become undecryptable. Rotated `SUPERTOKENS_*` keys
invalidate the session cookie only; the password hash is untouched, so it is a
sign-in, not a sign-up. Always count the rows before choosing to start clean:

```bash
docker compose -f docker-compose.yml -f docker-compose.console.yml exec db \
  psql -U postgres -d registry -tAc 'select (select count(*) from users),
  (select count(*) from organizations), (select count(*) from projects)'
```

**If you edit either script, keep `env_val` returning 0.** Both run under
`set -euo pipefail`, and a non-zero return from a command substitution being
*assigned* (`CARRY_PG="$(env_val POSTGRES_PASSWORD)"`) terminates the script
immediately and silently. An early version of the carry-forward block guarded
`env_val` with `[[ -f "$ENV_FILE" ]] && …`, so a missing `.env` aborted the
script before the message explaining the missing `.env` — the script simply
printed nothing and exited 1. `bootstrap-secrets.sh` now carries an `ERR` trap
that reports the failing line number for exactly this class of fault.

## Artifact versioning: the two identifiers

Every artifact response from `/artifacts/v1/<TARGET_UUID>/<artifact>` carries
both, and they answer different questions:

```
x-hive-schema-version-id: c72f8717-f2d1-4177-969e-8a3a7876e164
etag: "fd3f1b3034dbd4a6b412b14ca61301cd"
```

| Header | Identifies | Changes when |
|---|---|---|
| `x-hive-schema-version-id` | the publish **event** | every successful publish, even if the bytes are identical |
| `etag` | the **content** | only when the bytes change |

Verified: republishing the previous schema produced a new version id
(`3590d700-0e89-…`) with the old etag (`"cf9fc47a…"`). So the version id is the
audit trail and the etag is the "did anything actually change" test. A rollback
that produces a *new* etag is not a rollback.

Artifacts this release actually serves — probed, not assumed:

| Artifact | Status | Body |
|---|---|---|
| `supergraph` | 200 | the supergraph, `@join__*` and all; what a runtime loads |
| `sdl` | 200 | the API schema; what a client introspects |
| `services` | 200 | JSON `{name, sdl, url}` per subgraph |
| `metadata` | **404** | not served self-hosted, though the CLI accepts the name |

`hive artifact:fetch --artifact <name> --cdn.endpoint … --cdn.accessToken …`
works against the self-hosted endpoint. Note its stdout is the artifact plus
the CLI's own framing, so do not checksum that pipeline and compare it against
a raw `curl` — they differ, and the difference looks like corruption.

## Three kinds of credential, not interchangeable

| Credential | DB table | Works for |
|---|---|---|
| `HIVE_TOKEN` — target registry token | `tokens` | `hive schema:check`, `schema:publish`, `schema:fetch` |
| `HIVE_CDN_KEY` — CDN access token | `cdn_access_tokens` | `X-Hive-CDN-Key` on the artifact routes |
| organization access token | `organization_access_tokens` | the public GraphQL API at `:8082/graphql` |

This stack has the first two and **none** of the third. The trap: the public
GraphQL API rejects the registry token outright — a bare `{ __typename }` with
it in either `X-API-Token` or `Authorization: Bearer` returns
`{"errors":[{"message":"Invalid token provided"}]}`, while the same query with
**no** auth header succeeds. So a script that tries to read schema versions out
of the public API with `HIVE_TOKEN` fails in a way that reads as a revoked
token. Use the CDN response headers above; they need only the CDN key.

Related: `hive whoami` with no `--registry.endpoint` asks Hive **Cloud**, so it
rejects a self-hosted token with "the registry access token was rejected" even
when the token is perfectly good for publishing.

## The Laboratory

`http://localhost:8080/<org>/<project>/<target>/laboratory` — the Console's
built-in GraphiQL, always backed by the schema the registry has composed. The
fastest way to confirm a publish landed, because it needs no runtime at all.

Three features, each with a table behind it in this release:
`document_collections` + `document_collection_documents` (saved operations,
shared per target) and `document_preflight_scripts` (JavaScript run before each
request, for minting auth headers).

**It cannot execute anything until the target's endpoint is set.** The endpoint
is the per-target `targets.graphql_endpoint_url` column, and it is NULL on all
three targets here:

```bash
docker compose -f docker-compose.yml -f docker-compose.console.yml exec db \
  psql -U postgres -d registry \
  -c "select name, coalesce(graphql_endpoint_url,'<null>') from targets order by name"
```

Set it in Target → Settings, and set it to **`http://localhost:4110/graphql`**,
the Hive **Gateway**, for two reasons:

- **`localhost`, not a container name.** The request leaves your *browser*, so
  it needs a host-reachable address. This is the exact opposite of
  `HIVE_CDN_ENDPOINT`, which must be the in-network `server:3001` form because
  a container fetches it. Mixing the two up is the most common misconfiguration
  on this stack.
- **Gateway, not Router.** Verified: Hive Router 0.3.16 answers
  `OPTIONS /graphql` with **405 Unsupported HTTP method** and sends no
  `Access-Control-*` headers, so a browser request from the Console's origin
  fails its CORS preflight. Hive Gateway 2.15.10 on the identical supergraph
  answers the preflight **204** with
  `access-control-allow-origin: http://localhost:8080`. Both serve the same
  schema from the same artifact, so for a browser-driven tool the gateway is
  simply the one that works.
  ```bash
  for p in 4100 4110; do echo "== :$p"; curl -s -o /dev/null -D - -X OPTIONS \
    "http://localhost:$p/graphql" -H 'Origin: http://localhost:8080' \
    -H 'Access-Control-Request-Method: POST' | grep -i -E '^HTTP|access-control'; done
  ```

And remember what a green Laboratory run does **not** prove: it reads the
registry, so it says nothing about whether any runtime has picked the schema up.
For that, `scripts/supergraph-version.sh`.

## Upgrading

```bash
curl -fsSL -o /tmp/next.yml \
  "https://raw.githubusercontent.com/graphql-hive/console/hive@<VERSION>/docker/docker-compose.community.yml"
diff hive-console/docker-compose.community.yml /tmp/next.yml
```

The vendored file is unedited precisely so this diff is meaningful. Read the
intervening entries in Hive's self-hosting changelog, and update `DOCKER_TAG`
in `.env` to match — the Compose file and the images must come from the same
release.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `required variable HIVE_CDN_ENDPOINT is missing` | Something re-introduced a `:?` in the overlay. Use `:-`. |
| Router logs `No supergraph available yet` then recovers | Normal startup race — it answers one request before the first poll completes. Only a problem if `supergraph loaded successfully` never appears. |
| Router 503s forever, endpoint reads `UNSET-see-README-step-5` | `HIVE_CDN_ENDPOINT` / `HIVE_CDN_KEY` missing from `.env`. |
| `401` from the artifact endpoint | Wrong CDN key, or it was issued before `CDN_AUTH_PRIVATE_KEY` changed. |
| `403` from the artifact endpoint, router loops on `failed to load supergraph`, queries return `NO_SUPERGRAPH_AVAILABLE` | `HIVE_CDN_ENDPOINT` ends with the target name instead of its UUID. |
| Router cannot reach the artifact endpoint | Using `localhost:8082` instead of `server:3001`. |
| CLI: `access token does not have permission` | Token missing Publish/Check/Push, or `--target` not passed. |
| Login page loads, signing in shows **"Failed to fetch"** | `server` never started. Check `docker compose ps server` — `Created` means `migrations` failed. Run `./hive-console/sync-db-password.sh`. |
| `migrations` exits 1 with `password authentication failed for user "postgres"` (28P01) | `.env` disagrees with `.hive/postgres`. `./hive-console/sync-db-password.sh`. Not a reason to `down -v`. |
| `migrations` exits non-zero for some other reason | Read `docker compose logs migrations` before destroying anything. |
| Login fails after regenerating `.env`, with a server error | `SUPERTOKENS_*` changed, invalidating sessions. Clear cookies for `localhost:8080`. |
| Credentials rejected for an account that used to work | The accounts are rows in PostgreSQL; deleting `.hive/` deleted them. `.local-dev-account` is then stale — sign up again. `select count(*) from users` to confirm. |
| `supergraph-compose` exits 0 but the published SDL lacks your change | The composer image COPYs `subgraphs/src`, so it must be rebuilt: `run --rm --build supergraph-compose`. Silent, and it poisons every later gate. |
| Hive Gateway on `:4110` looks stuck on the old schema | It reloads **silently** — no log line at all — a poll behind the router. Query it or run `scripts/supergraph-version.sh`; never grep its log. |
| Laboratory autocompletes but Run does nothing / errors | `targets.graphql_endpoint_url` is NULL, or it points at `:4100` and the browser's CORS preflight fails. Set it to `http://localhost:4110/graphql`. |
| `Invalid token provided` from `:8082/graphql` | The registry token is not an organization access token. Don't use the public API for this; read the CDN response headers. |
| `hive whoami` rejects a token that publishes fine | With no `--registry.endpoint` it queries Hive **Cloud**. |
| `hive introspect http://hive-router:4000/graphql` → `ENOTFOUND` | `hive-cli` used to join only the `stack` network. It now joins `default` too; re-pull the overlay if an old copy is in use. |
| A runtime serves the wrong schema and nothing logs an error | Nothing reports a loaded version; compare fingerprints with `scripts/supergraph-version.sh`. |
| Everything very slow | 24 containers. Raise Docker Desktop memory, or run Console without the POC. |
