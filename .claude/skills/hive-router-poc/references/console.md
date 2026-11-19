# Self-hosted Hive Console

The registry. Adds schema versioning, composition, schema checks, policy
linting and usage analytics, with no dependency on Hive Cloud. Everything runs
locally.

Verified end to end on 2026-11-04 against `hive@15.0.1`, `hive-router` 0.3.12
and Hive CLI 0.68.2.

## Contents

- [What is and is not available self-hosted](#what-is-and-is-not-available-self-hosted)
- [The stack](#the-stack)
- [Setup](#setup)
- [Publishing and checking](#publishing-and-checking)
- [Connecting the router](#connecting-the-router)
- [Gotchas](#gotchas)
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

**Regenerating secrets is destructive.** `bootstrap-secrets.sh --force` rotates
`SUPERTOKENS_*` (invalidating all sessions) and `CDN_AUTH_PRIVATE_KEY`
(invalidating every issued CDN token). Delete `hive-console/.hive/` too, or the
databases will disagree with the new credentials.

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
| Router cannot reach the artifact endpoint | Using `localhost:8082` instead of `server:3001`. |
| CLI: `access token does not have permission` | Token missing Publish/Check/Push, or `--target` not passed. |
| `migrations` exits non-zero | Usually credentials differing from a previous `.env`. `down -v`, delete `hive-console/.hive/`, start again. |
| Login fails after regenerating `.env` | `SUPERTOKENS_*` changed, invalidating sessions. Clear cookies, or reset `hive-console/.hive/`. |
| Everything very slow | 24 containers. Raise Docker Desktop memory, or run Console without the POC. |
