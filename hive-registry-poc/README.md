# hive-registry-poc — registry-style supergraph delivery over S3

Minimal MVP for **WDCS-25885**. It answers the one delivery question that
self-hosted Hive Console leaves open, and that no existing POC in this repo
covered.

> With Hive Console's **High-Availability CDN unavailable in self-hosted
> installs**, can Hive Router boot from — and hot-reload — a supergraph artifact
> held in S3-compatible object storage?

**Answer: yes, with one configuration caveat that is easy to miss.** Details in
[Results](#results).

Full analysis: [`../Docs/Hive-docs/CONFLUENCE-WDCS-25885-Hive-Capability-Analysis.md`](../Docs/Hive-docs/CONFLUENCE-WDCS-25885-Hive-Capability-Analysis.md)

---

## Why this exists, and why it is this small

Hive Console's managed offering serves the composed supergraph from its HA CDN,
and a router consumes it with `supergraph.source: hive`. The self-hosting
documentation states plainly that **"The High-Availability CDN and billing
integrations are not available"** in self-hosted installs, which instead fall
back to artifact endpoints served by the `server` service. The community stack
keeps schema artifacts in S3-compatible storage (MinIO).

So for a self-hosted deployment the delivery leg is **S3, not the CDN** — and
that is the leg nothing in this repo had tested.

This POC deliberately does **not** stand up Hive Console. That needs PostgreSQL,
ClickHouse, Redis, Redpanda, MinIO, Caddy and around nine Hive services, and its
own docs call the bundled stack "not as a production-ready architecture." Testing
the delivery mechanism does not require the control plane that produces the
artifact.

It also does not duplicate anything: the three subgraphs and the composed
supergraph come from [`../hive-router-poc`](../hive-router-poc/README.md) via an
external network and an external volume.

## Architecture

```
  hive-router-poc  (prerequisite, already running)
  ┌──────────────────────────────────────────────┐
  │ accounts-subgraph:4001                       │
  │ policies-subgraph:4002   ── REST APIs below  │
  │ funds-subgraph:4003                          │
  │ supergraph-compose ──► volume: supergraph    │
  └───────────────────────────┬──────────────────┘
                              │ (external volume, read-only)
  hive-registry-poc           ▼
  ┌──────────────────────────────────────────────┐
  │ publish-artifact  ──►  s3 (S3Mock :9090)     │
  │   stands in for            bucket:           │
  │   `hive schema:publish`    router-artifacts/ │
  │                            supergraph/       │
  │                              current.graphql │
  │                                  │           │
  │ hive-router-registry :4100 ◄──────┘          │
  │   supergraph.source: storage                 │
  │   poll_interval: 10s                         │
  └──────────────────────────────────────────────┘
                              │
                              ▼ queries the subgraphs above
```

## Choice of S3 server

Hive Router's `storages` documentation gives both MinIO and LocalStack as
examples. Neither is freely pullable any more, which is itself worth recording:

| Image | Status, 2026-10-23 |
|---|---|
| `minio/minio`, `minio/mc` | `401 pull access denied` on Docker Hub |
| `quay.io/minio/minio`, `quay.io/minio/mc` | `401 UNAUTHORIZED` |
| `localstack/localstack:latest` | starts, then exits 55 — **licence required**, Pro only |
| `localstack/localstack:s3-latest` | exits 1 — **"discontinued with the release of v2026.03"**, Pro only |
| `adobe/s3mock:latest` | ✅ pulls and runs anonymously |

Adobe S3Mock is used purely to keep this reproducible without a licence. **The
router configuration is identical for MinIO or real AWS S3** — only `endpoint`
changes, and `allow_http` is dropped once TLS terminates in front.

## Run it

```bash
# 1. prerequisite: the subgraphs and the composed supergraph
docker compose -f hive-router-poc/docker-compose.yml up -d

# 2. this stack
docker compose -f hive-registry-poc/docker-compose.yml up -d

# 3. confirm the artifact was published
docker compose -f hive-registry-poc/docker-compose.yml logs publish-artifact
```

GraphQL endpoint: `http://localhost:4100/graphql` (port 4100 so it runs
alongside `hive-router-poc`'s router on 4000).

### Verify it boots from S3

```bash
curl -s localhost:4100/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName policies{ policyNumber } fundHoldings{ fund{ name isin } } } }"}'
```

### Verify hot reload on republish

```bash
# pull the live artifact down, append a probe scalar, publish it back
docker run --rm --network hive-router-poc_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  -v /tmp:/host amazon/aws-cli:latest \
  --endpoint-url http://s3:9090 s3 cp s3://router-artifacts/supergraph/current.graphql /host/sg.graphql

printf '\nscalar RolloutProbe\n' >> /tmp/sg.graphql

docker run --rm --network hive-router-poc_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  -v /tmp:/host amazon/aws-cli:latest \
  --endpoint-url http://s3:9090 s3 cp /host/sg.graphql s3://router-artifacts/supergraph/current.graphql

# within ~10s the new type is live, with no restart
curl -s localhost:4100/graphql -H 'content-type: application/json' \
  -d '{"query":"{ __type(name: \"RolloutProbe\") { name } }"}'
```

> Note: `docker compose up --force-recreate hive-router-registry` re-runs
> `publish-artifact`, which republishes the pristine supergraph from the volume
> and so discards hand-appended probes. That is expected.

### Tear down

```bash
docker compose -f hive-registry-poc/docker-compose.yml down -v
```

---

## Results

Executed 2026-10-23 against `hive-router` **0.3.1**.

| # | Check | Result |
|---|---|---|
| 1 | Artifact published to `s3://router-artifacts/supergraph/current.graphql` | ✅ 5,055 bytes |
| 2 | Router boots with `supergraph.source: storage` | ✅ `supergraph loaded successfully with changes, updating...` |
| 3 | Full three-way federated query through the S3-sourced router | ✅ correct — Anika Rao, £186,420.75, 2 policies, 3 fund holdings resolved |
| 4 | Republish artifact **without** `poll_interval` | ❌ **no reload observed in 80 s** |
| 5 | Republish artifact **with** `poll_interval: 10s` | ✅ **live in ~2 s, no restart** |
| 6 | Federated data still correct after two hot reloads | ✅ unchanged |

### The caveat worth carrying into production

`poll_interval` is documented under `supergraph.source: hive` (the CDN path). It
is **not** shown in the `storage` example, and omitting it gives a router that
loads the artifact **once at startup and never again** — no error, no warning.
Check 4 above is that failure, reproduced deliberately.

The router does accept `poll_interval` under `source: storage`, and with it set
the rollout was effectively immediate. **Set it explicitly.** A self-hosted
deployment that omits it will appear to work and then silently serve a stale
schema after every publish.

### What this does not prove

- Hive Console itself was never run. The publish step is an `aws s3 cp` standing
  in for `hive schema:publish` plus Console-side composition. Registry features —
  schema checks, breaking-change detection, policy linting, usage analytics,
  conditional breaking changes — are **documented, not exercised here**.
- No authentication, TLS, or signature verification was tested. S3Mock ignores
  credentials.
- Single instance, no HA, no failover between endpoint mirrors.
- Hot reload was verified with an additive SDL change only. Rollout behaviour on
  an invalid or breaking artifact was not tested — notably, the managed CDN's
  documented guarantee that it "serves the latest **valid** supergraph" is a
  Console-side property this S3 path does not reproduce.
