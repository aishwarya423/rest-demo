# Can we self-host GraphQL Hive Console?

**Audience:** engineering team, architecture review
**Question:** can we use Hive Console's UI and capabilities while keeping our
schemas, API metadata and business information inside our own infrastructure?
**Status:** investigation findings, November 2026
**Related:** [HIVE-EVALUATION.md](./HIVE-EVALUATION.md) ·
[CONFLUENCE-REST-Integration-Options.md](./CONFLUENCE-REST-Integration-Options.md)

---

## TL;DR

**Yes. Nothing has to leave our network, and we lose almost nothing.**

- Hive Console is **MIT licensed**, fully open source, and actively maintained.
- **No feature gating.** The Guild charge for support, not features. Only two
  things are excluded self-hosted, and neither matters to us.
- All data stays local: schemas, orgs, projects, checks, usage analytics.
- Our router and gateway point at our own instance with a one-line config
  override.

**The real cost is not licensing, it is operations.** There is **no official
Kubernetes or Helm deployment**. Docker Compose is the only documented path and
the docs themselves call it an evaluation environment, not production-ready.
A production deployment means porting The Guild's own Pulumi stack.

---

## 1. The four questions, answered

### Q1. Does Hive support self-hosting the Console?

**Yes.** ✅ Verified: [graphql-hive/console](https://github.com/graphql-hive/console)
is **MIT licensed** (confirmed in the repo's `LICENSE`), not archived, and was
last pushed **2 November 2026**. This is the same codebase that runs Hive Cloud,
not a stripped community edition.

### Q2. Can we host the registry, checks, usage analytics and monitoring ourselves, with no data going to Hive's cloud?

**Yes, all of it.** Every store runs inside our perimeter:

| Data | Where it lives |
|---|---|
| Users, organisations, projects, targets, **schemas**, schema checks, config | PostgreSQL 16 |
| **GraphQL operation usage data** (analytics) | ClickHouse |
| Usage reports in flight | Redpanda (Kafka-compatible) |
| Caching and short-lived data | Redis |
| **Schema artifacts** and audit logs | S3-compatible object storage |

No request reaches `app.graphql-hive.com`. Our gateways are redirected by
configuration, not by a fork. See [section 4](#4-how-our-pocs-would-connect).

### Q3. Feature parity and licensing?

**No features are paywalled.** The Guild's pricing page states the on-premise
version "is identical to Hive Cloud" and is free and open source, and that they
charge a premium only for support.

Two exclusions are named in the self-hosting docs:

| Excluded self-hosted | Impact on us |
|---|---|
| High-Availability CDN | **None.** The `server` service exposes fallback artifact endpoints instead. |
| Billing integrations | **None.** Irrelevant to an internal deployment. |

| Capability | Self-hosted status |
|---|---|
| Schema registry, publishing, versioning | ✅ available |
| Schema checks and policy validation | ✅ available (`schema`, `policy` services) |
| Usage analytics and monitoring | ✅ available (`usage`, `usage-ingestor`, ClickHouse) |
| Console UI | ✅ available (`app` service) |
| SSO via OIDC | ✅ documented as available on **all plans, including free** |
| SCIM user provisioning | ⚠️ **unconfirmed.** Appears in the architecture diagram as an optional integration, but the self-hosting docs give no setup steps. **Ask The Guild.** |

### Q4. Architecture and deployment requirements?

See [section 3](#3-what-we-would-actually-run) and
[section 5](#5-the-enterprise-gap).

---

## 2. Cloud vs self-hosted, for context

| | Hobby | Pro | Enterprise | **Self-hosted** |
|---|---|---|---|---|
| Price | Free | $20/mo + $10 per million ops | Custom | **Free** (our infra cost only) |
| Operations/month | 1M | 1M then metered | Custom | **unlimited** |
| Usage retention | 7 days | 90 days | 1 year+ | **our choice** (ClickHouse TTL) |
| Seats | unlimited | unlimited | unlimited | unlimited |
| Support | community | community | dedicated, SLA, DPA | community |

Self-hosting removes the operations cap and the retention cap. What we give up
is the dedicated support and SLA that Enterprise buys.

---

## 3. What we would actually run

✅ Verified from `docker/docker-compose.community.yml` in the repo: **14
containers**, eight Hive services plus six infrastructure components.

### Hive services

| Service | Responsibility |
|---|---|
| `app` | the Console web UI |
| `server` | GraphQL API, authentication, fallback artifact endpoints |
| `schema` | schema validation, composition, artifact generation |
| `policy` | schema policy validation |
| `workflows` | async work: emails, webhooks, alerts |
| `usage` | receives usage reports, publishes to the broker |
| `usage-ingestor` | consumes reports, writes to ClickHouse |
| `migrations` | applies PostgreSQL and ClickHouse migrations |

Images are pulled from GHCR.

### Infrastructure in the bundled stack

| Component | Version in the compose file |
|---|---|
| PostgreSQL | `postgres:16.4-alpine` |
| ClickHouse | `clickhouse/clickhouse-server:26.3.12.3-alpine` |
| Redpanda | `redpandadata/redpanda:v23.3.21` |
| Redis | `bitnamilegacy/redis:7.4.2` |
| S3 gateway | `ghcr.io/versity/versitygw:v1.8.0` |
| Reverse proxy for S3 | `caddy:2.9.1-alpine` |

> ⚠️ **Docs are behind the code.** The self-hosting docs describe **MinIO** for
> S3. The current compose file actually uses **VersityGW**. Trust the file.

### Ports

| Port | Purpose |
|---|---|
| 8080 | Console web app |
| 8081 | usage-reporting API |
| 8082 | GraphQL API, subscriptions, artifact endpoints |
| 8083 | proxy to object storage |
| 9000 / 9001 | S3 API and admin console |
| 9092 / 9644 | Redpanda Kafka listener and admin |

> 🔒 The object storage and Redpanda ports **must not** be exposed to the public
> internet.

---

## 4. How our POCs would connect

This is the part that makes self-hosting concrete. Both of our POCs redirect to
a private Hive with configuration only.

**Hive Router** (`hive-router-poc`) — one optional key:

```yaml
telemetry:
  hive:
    usage_reporting:
      enabled: true
      # Override for self-hosted Hive
      endpoint: "https://hive.internal.ourco/usage"
```

Plus two environment variables:

| Variable | Value |
|---|---|
| `HIVE_ACCESS_TOKEN` | a registry access token with **write** permission |
| `HIVE_TARGET` | `$organizationSlug/$projectSlug/$targetSlug`, or a UUID |

**Schema publishing** via the CLI points `registry.endpoint` in `hive.json` at
our own GraphQL URL (`https://hive.internal.ourco/graphql`).

Two things to get right:

1. A **CDN key cannot write usage.** Fetching the supergraph and reporting usage
   are different credentials.
2. Newer access tokens require the target in the usage URL:
   `/usage/<ORGANIZATION>/<PROJECT>/<TARGET>`.

---

## 5. The enterprise gap

This is the finding that should drive the decision.

**There is no official Kubernetes or Helm deployment.** ✅ Verified: no
`charts/`, `helm/` or equivalent directory exists in the repository. The
self-hosting docs document **Docker Compose only**, and state the bundled stack
runs a single instance of each dependency on local disk and is an evaluation
environment, "not a production-ready architecture."

Community Helm charts exist but neither is official:

| Chart | Status |
|---|---|
| `platzhersh/graphql-hive-helm` | says outright it is for **development and testing only**, not recommended for production |
| `diabolocom/graphql-hive` on Artifact Hub | bundles Bitnami ClickHouse, Kafka and PostgreSQL; **production readiness unverified** |

**What does exist, and is better than it sounds:** the repo's `deployment/`
directory is The Guild's own production infrastructure as code. ✅ Verified: it
is a **Pulumi** project using `@pulumi/aws`, `@pulumi/kubernetes`,
`@pulumi/cloudflare` and `@pulumiverse/grafana`, and it ships Grafana
dashboards. That is our reference architecture, and it is MIT licensed like the
rest.

So the honest framing: we are not installing a supported chart. We are porting
a known-good Pulumi stack, or writing our own Kubernetes manifests from it.

### Production hardening checklist

Everything here is on us. The community stack provides none of it.

- [ ] Managed or properly operated PostgreSQL and ClickHouse
- [ ] Clustered or managed Redpanda and Redis
- [ ] Real object storage (S3, or our own)
- [ ] HTTPS reverse proxy, routing the web app, GraphQL/WebSocket API, artifact
      endpoints and usage API separately
- [ ] **Override every public URL.** Changing only `HIVE_APP_BASE_URL` is not
      enough; the community stack hardcodes `localhost` elsewhere
- [ ] SMTP or Postmark for `workflows` (it defaults to `sendmail`)
- [ ] Backups, configured **and tested**
- [ ] Monitoring: Prometheus, Grafana, OpenTelemetry Collector, Sentry — the
      community stack includes none
- [ ] Restrict infrastructure ports
- [ ] Set `CLICKHOUSE_TTL_TABLES` for our retention policy

---

## 6. Risks and traps

1. **No official Helm chart.** The single largest cost. Anyone assuming one
   exists will badly underestimate the effort.
2. **Retention defaults to 7 days.** Without `CLICKHOUSE_TTL_TABLES`, usage
   retention is capped at 7 days per organisation regardless of what ClickHouse
   physically keeps. Easy to miss, and it silently loses analytics.
3. **Secrets must survive upgrades.** `HIVE_ENCRYPTION_SECRET`,
   `CDN_AUTH_PRIVATE_KEY` and the access-token keys must be preserved or we lose
   access to stored data. Back up before every upgrade and read the self-hosting
   changelog.
4. **`.env` does not run command substitution.** Store resolved secret values,
   not the commands that generate them.
5. **Deleting the `.hive/` data directory destroys the installation.**
6. **Docs lag the code** (the MinIO/VersityGW mismatch). Read the compose file.
7. **SCIM self-hosted is unconfirmed.** If group-based provisioning is a
   requirement, confirm before committing.
8. **Community support only.** No SLA unless we pay for Enterprise support,
   which is the one thing self-hosting does not give us.

---

## 7. Recommendation

**Self-hosting meets the stated objective.** Our schemas, API metadata and usage
analytics stay in our infrastructure, the licence permits it unconditionally,
and the only excluded features are a CDN we do not need and billing we do not
want.

Scope it in two phases and do not conflate them.

**Phase 1 — evaluate (days).** Run the community Docker Compose stack on an
internal VM. Publish our two POC supergraphs to it, wire
`hive-router-poc` usage reporting at it, and judge the Console UI, schema checks
and analytics on real data. This is exactly what the stack is built for.

**Phase 2 — productionise (a platform project, not a side task).** Only if
Phase 1 earns it. Budget for porting the Pulumi stack or authoring Kubernetes
manifests, plus the hardening checklist above. Treat the absence of an official
chart as the main line item.

### Open questions for The Guild

1. Is an official Helm chart or Kubernetes deployment on the roadmap?
2. Does SCIM provisioning work in a self-hosted installation?
3. Can Enterprise support be bought for a self-hosted deployment, decoupled from
   Cloud?

All three change the effort estimate, and all three are cheap to ask.

---

## Sources

| Topic | Link |
|---|---|
| Self-hosting guide (components, env vars, ports, limitations) | https://the-guild.dev/graphql/hive/docs/self-hosting/get-started |
| Self-hosting overview | https://the-guild.dev/graphql/hive/docs/self-hosting |
| Console source and MIT licence | https://github.com/graphql-hive/console |
| Community Compose stack (authoritative service list) | https://github.com/graphql-hive/console/blob/main/docker/docker-compose.community.yml |
| The Guild's own Pulumi deployment (reference architecture) | https://github.com/graphql-hive/console/tree/main/deployment |
| Pricing, plan limits, "identical to Hive Cloud" claim | https://the-guild.dev/graphql/hive/pricing |
| Router usage reporting, self-hosted endpoint override | https://the-guild.dev/graphql/hive/docs/router/observability/usage_reporting |
| Gateway usage reporting | https://the-guild.dev/graphql/hive/docs/gateway/usage-reporting |
| SSO with OIDC (all plans, incl. free) | https://the-guild.dev/graphql/hive/docs/management/sso-oidc-provider |
| Access token migration (usage URL format) | https://the-guild.dev/graphql/hive/docs/migration-guides/organization-access-tokens |
| "No features behind a paywall" claim | https://the-guild.dev/graphql/hive/docs/use-cases/apollo-graphos |
| Community Helm chart (dev/testing only) | https://github.com/platzhersh/graphql-hive-helm |
| Community Helm chart (Artifact Hub) | https://artifacthub.io/packages/helm/graphql-hive/graphql-hive |

### How to read the claims in this page

| Marker | Meaning |
|---|---|
| ✅ Verified | Checked directly against the repository, its licence, or the compose file |
| ⚠️ Unconfirmed | Not stated in the docs; needs confirmation from The Guild |
| unmarked | Taken from The Guild's documentation as cited above, not independently tested |

No part of this evaluation involved deploying the stack. Phase 1 is where that
gets tested.
