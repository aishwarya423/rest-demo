# WDCS-27923 — SPIKE: Integrate self-hosted Hive Console for schema publishing, compatibility checks and registry-driven supergraph delivery on Mock repos

**Jira:** WDCS-27923 · **Status:** Complete — ready for closure
**Parent:** WDCS-25285 · **Predecessor:** [WDCS-25885 — Hive Capability Analysis closure](./CONFLUENCE-WDCS-25885-Spike-Closure.md)
**Domain:** Insurance APIs — Accounts, Policies, Funds
**Repository:** `rest-demo` · branch `hive-final-poc`
**Executed:** 2026-11-04 (registry stood up) · 2026-11-19 (delivery lifecycle verified)
**Versions:** Hive Console `hive@15.0.1` · Hive Router 0.3.16 · Hive CLI 0.68.2 · Hive Gateway 2.15.10 — all MIT

> Every outcome below was executed against a running stack. Where something was
> read from vendor documentation but not exercised, it says so.

---

## Index

| § | Section |
|---|---|
| 1 | [Overview](#1-overview) |
| 2 | [Background](#2-background) |
| 3 | [Scope](#3-scope) |
| 3.1 | [Proof of Concept & Demo](#31-proof-of-concept--demo) |
| 3.2 | [Test flow](#32-test-flow) |
| 4 | [Risks](#4-risks) |
| 5 | [Recommendation](#5-recommendation) |
| 6 | [Next Steps](#6-next-steps) |
| 7 | [Spike Closure](#7-spike-closure) |

*Section numbering runs 1–7; the reference template's §4 and §5 covered product
capability evaluation, which was completed in WDCS-25885 and is not repeated here.*

---

## 1. Overview

This spike asked one practical question: **can a schema registry we host
ourselves deliver the GraphQL schema to a running gateway, without anyone
restarting or redeploying it?**

**Yes** — proved end to end against the existing mock insurance APIs, with all
nine acceptance criteria met.

A developer publishes a schema change. The registry checks it against everything
already published, composes the combined schema and serves it. The gateway picks
it up on its own, within seconds. Nothing is deployed in between.

```
BEFORE  — the schema can only travel with a deployment

   edit schema ──► rebuild image ──► restart gateway ──► live
                └──── minutes, a deploy, a change window ────┘

AFTER   — the schema travels on its own

   publish  ──►  registry checks it, composes it, serves it
                            │
                            ▼
                 gateway asks "anything new?" every 10s  ──► live
                └──────────── seconds, no deploy ────────────┘
```

Both routes now run side by side in the POC. The original file-based gateway was
untouched throughout — which was an explicit acceptance criterion, and is also
the safest migration story: introduce the registry alongside what exists, switch
when there is confidence.

---

## 2. Background

- Three insurance REST APIs — **Accounts, Policies, Funds** — are presented as
  one GraphQL API through federation.
- **WDCS-25885** recommended Hive as the platform and identified the schema
  registry as the untested piece. Its first listed next step was *"Stand up Hive
  Console and validate schema checks, policy linting and breaking-change
  detection with the three subgraphs."* **This spike is that step.**
- Hive Console is the control plane — registry, schema checks, version history.
  MIT licensed, and runnable either as a managed cloud service or on our own
  infrastructure. This spike tested the **self-hosted** option.

**What was genuinely unknown.** Hive's high-availability CDN is a cloud-only
feature, so there was a real risk that self-hosting would leave us with a
registry that records schemas but cannot ship them to a gateway.

It does not. The same delivery endpoints are served by the self-hosted
installation and both Hive runtimes consume them unchanged. That is the central
finding of this spike.

---

## 3. Scope

| # | Acceptance criterion | Outcome |
|---|---|---|
| 1 | Self-hosted Hive Console starts and is accessible locally | ✅ Pass |
| 2 | Accounts, Policies and Funds schemas publish successfully | ✅ Pass |
| 3 | Schema checks and breaking changes can be validated | ✅ Pass — both directions |
| 4 | Registry generates and provides the composed supergraph | ✅ Pass |
| 5 | Registry-based router serves federated GraphQL requests | ✅ Pass |
| 6 | File-based and registry-based routers return equivalent data | ✅ Pass — byte-identical |
| 7 | Valid schema changes picked up without restarting the router | ✅ Pass — seconds, no restart |
| 8 | Existing file-based router remains unaffected | ✅ Pass |
| 9 | Setup, configuration, limitations and findings documented | ✅ Pass |

**Out of scope, as agreed:** production deployment and high availability;
production TLS, backups and disaster recovery; automated organisation/project/
token onboarding; usage analytics validation; Kubernetes deployment.

### 3.1 Proof of Concept & Demo

Everything lives in the existing `rest-demo` repository. No new repository, and
the original POC's behaviour was not changed.

```
   HIVE CONSOLE (control plane)          publishes the combined schema
   registry · checks · versions                      │
   14 containers, self-hosted                        │
                                 ┌──────────────────┴──────────────────┐
                                 ▼                                     ▼
                     Registry-fed router  :4100            File-fed router  :4000
                     (reads the registry)                  (reads a mounted file)
                                 └──────────────────┬──────────────────┘
                                                    ▼
                                    Accounts · Policies · Funds
                                    (the three existing services)
```

| Asset | What it is |
|---|---|
| [`hive-router-poc/`](../../hive-router-poc/) | The POC: three mock REST APIs, three GraphQL services, both gateways |
| [`hive-router-poc/README.md`](../../hive-router-poc/README.md) | Setup from nothing to running, including the one-off manual steps |
| [`Docs/SUPERGRAPH-CDN-LIFECYCLE.md`](../SUPERGRAPH-CDN-LIFECYCLE.md) | The lifecycle in full — change, check, publish, deliver, verify, roll back |
| [`Docs/SUPERGRAPH-CICD.md`](../SUPERGRAPH-CICD.md) | The same path through a build pipeline, with a sample workflow |
| [`scripts/test-supergraph-lifecycle.sh`](../../scripts/test-supergraph-lifecycle.sh) | The whole lifecycle as one automated test — **28 of 28 checks passing** |
| [`scripts/supergraph-version.sh`](../../scripts/supergraph-version.sh) | Reports which schema version each gateway is actually serving |

**One-off manual setup.** Creating the account, organisation, project, target
and the two access tokens is done through the Console's web interface. There is
no documented API for it, so this cannot currently be scripted — see §4. The
README covers it step by step.

### 3.2 Test flow

The sequence below reproduces every claim in this page. All commands run from
the repository root. Each has a visible result; none requires reading code.

**Start the stack** — the POC plus the self-hosted Console, 24 containers.

```bash
docker compose -f hive-router-poc/docker-compose.yml \
  -f hive-router-poc/docker-compose.console.yml --profile registry up -d --build
```

Console at `http://localhost:8080`. Complete the one-off setup, then record the
tokens in `hive-router-poc/.env`.

---

**Step 1 — Publish the three schemas.** *AC 2*

```bash
docker compose -f hive-router-poc/docker-compose.yml \
  -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/publish.sh
```

> *Expected:* each service confirmed published, ending `All three subgraphs
> published.` The Console lists all three with their addresses.

**Step 2 — Confirm the registry composed them.** *AC 4*

Open the Console's query editor (**Laboratory**) for the target. The combined
schema shows fields from all three services — proof the registry composed them
into one graph.

**Step 3 — Run a compatibility check with nothing changed.** *AC 3*

```bash
docker compose -f hive-router-poc/docker-compose.yml \
  -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/check.sh
```

> *Expected:* `✔ No changes` for each service, each with a link to a full report
> in the Console, ending `All three subgraphs check clean against the registry.`

**Step 4 — Query the registry-fed gateway.** *AC 5*

```bash
curl -s localhost:4100/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName policies{ policyNumber } } }"}'
```

> *Expected:* real data joined across all three services —
> `{"data":{"account":{"holderName":"Anika Rao","policies":[{"policyNumber":"LIF-UK-3001"},{"policyNumber":"ANN-RET-3002"}]}}}`

**Step 5 — Compare the two gateways.** *AC 6*

```bash
for p in 4000 4100; do curl -s localhost:$p/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName totalValue } }"}'; echo; done
```

> *Expected:* two **identical** responses. Same services, same data, two
> different schema sources.

---

**Step 6 — Make a change and publish it.** *AC 7 — the core test*

Add a field — `holdingsCount` on `Account` — to the Accounts service, then
rebuild, recompose and publish:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml up -d --build accounts-subgraph
```

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --build supergraph-compose
```

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/publish.sh
```

**Step 7 — Watch the registry-fed gateway pick it up, with no restart.**

```bash
docker compose -f hive-router-poc/docker-compose.yml \
  -f hive-router-poc/docker-compose.console.yml --profile registry \
  logs -f --tail 5 hive-router-registry
```

> *Expected, within seconds:* `supergraph loaded successfully with changes,
> updating...` — then Ctrl-C. Measured at **~6 seconds**. Nothing was restarted.

**Step 8 — Query the new field on each gateway.** *AC 7 and AC 8*

```bash
for p in 4100 4000; do curl -s localhost:$p/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName holdingsCount } }"}'; echo; done
```

> *Expected:* `:4100` returns the new field. `:4000` **rejects** it — it is still
> serving the schema it started with, exactly as a file-based gateway should.

```
   THE MOMENT WORTH SHOWING IN A DEMO

   publish  ──►  registry: checked ✓  composed ✓  new version recorded
                                 │
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
   REGISTRY-FED  :4100                        FILE-FED  :4000
            │                                         │
   +6s      ▼                                         ▼
   new field answers ✓                       new field REJECTED ✗
   nothing restarted                         restart required
```

**Step 9 — Restart the file-based gateway; it catches up.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml restart hive-router
```

> *Expected:* `:4000` now answers the new field too. This is the step the
> registry path removes.

---

**Step 10 — Prove a breaking change is caught.** *AC 3*

Remove a field clients use, rebuild and recompose it (the first two commands
from Step 6 — the check reads the composed schema, not your working copy), then:

```bash
docker compose -f hive-router-poc/docker-compose.yml \
  -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/check.sh accounts
```

> *Expected:* the check **fails**, naming the removed field, and exits non-zero —
> which is what makes it usable as an automated gate on a pull request. Today
> nothing catches this until a client breaks in an environment.

**Step 11 — Roll back by republishing the previous schema.**

Restore the file, then repeat Step 6's three commands.

> *Expected:* both gateways return to the previous schema; the registry-fed one
> within seconds and without a restart.

**Step 12 — Confirm what each gateway is actually serving.**

```bash
./scripts/supergraph-version.sh
```

> *Expected:* the registry's current version and a per-gateway verdict of
> `MATCHES CDN`. Neither Hive runtime exposes its loaded schema version, so this
> tool was built during the spike to answer "did the change actually land?" — it
> is intended as a post-deployment check in a pipeline.

**The whole flow, automated.** Steps 1–12 run as a single assertion-checked test
that leaves the environment exactly as it found it:

```bash
./scripts/test-supergraph-lifecycle.sh
```

> *Expected:* `28 passed, 0 failed`. Pass `--dry-run` to stop before anything is
> published.

---

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The bundled Console stack is evaluation-grade — single instance, local disk, no backups, no TLS. The vendor says so, and it is correct | **High** | Use managed PostgreSQL/ClickHouse/Redis/Kafka and real storage, add TLS and monitoring — or use Hive Console Cloud |
| Self-hosted delivery has no high-availability tier; if the Console is down, gateways receive no schema updates | **Medium** | Running gateways keep answering queries with the schema they hold — a registry outage delays schema changes, it does not take the API down. Decide consciously |
| No official Helm chart — Docker Compose only | **Medium** | Port it, or use Cloud, if Kubernetes is the target |
| A publish can succeed while leaving a schema that does not compose | **Medium** | Make the composition-error gate mandatory in the pipeline, and run checks on every pull request |
| Gateways cannot report which schema version they are serving | **Medium** | Addressed — `scripts/supergraph-version.sh` was built for this and is documented for pipeline use |
| Account, organisation and token creation cannot be automated | **Medium** | One-off per environment; capture as a runbook step |
| Regenerating the installation's credentials after first run breaks the database | **Medium** | Documented, with a repair script in the repo; do not regenerate casually |
| Usage analytics not validated — out of scope | **Low** | Services are running and the capability is present; validate during implementation |
| Hive Router is pre-1.0 | **Low** | Pin the version; re-check configuration on upgrade |
| 24 containers is heavy for local development | **Low** | The original file-based POC still runs standalone without the Console |

---

## 5. Recommendation

**Adopt registry-driven schema delivery. It works self-hosted, it removes a
deployment step, and it adds a breaking-change gate we do not have today.**

1. **The capability question is settled.** Publishing, compatibility checks,
   composition and registry-driven delivery all work on an installation we host
   ourselves, against our own services, with both Hive runtimes. Nothing in the
   self-hosted build blocks this.
2. **The governance benefit is immediate and independent of the delivery
   benefit.** Even with no change to how schemas reach the gateway, putting
   schema checks on pull requests catches breaking changes before they merge.
   That is worth having on its own, and it is the cheapest item on the list.
3. **The remaining decision is operational, not technical:** self-hosted or
   Cloud. Self-hosted is free and keeps everything inside our network, at the
   cost of running five stateful services properly, with no Helm chart and no
   bundled monitoring. Cloud removes that work at a usage-based cost and adds a
   high-availability delivery tier. **Take that decision before implementation
   starts** — it changes the shape of the work considerably.

A low-risk migration exists and was demonstrated: run both gateways side by
side, move traffic when there is confidence, keep the file-based path as a
fallback. The POC ran both throughout without interference.

**Confidence:** **High** on capability, composition, checks and registry-driven
delivery — all executed. **Medium** on the operational cost of running the
Console in production, assessed from a local installation rather than a
production one.

---

## 6. Next Steps

1. **Decide self-hosted versus Cloud for Hive Console.** Everything else depends
   on it.
2. **Add schema checks to pull requests** — highest value, lowest effort, and
   useful either way. Sample pipeline in [`Docs/SUPERGRAPH-CICD.md`](../SUPERGRAPH-CICD.md).
3. **Add publishing to the main-branch pipeline**, with the composition-error
   gate enabled and the post-deployment verification check.
4. **If self-hosting:** replace the bundled data services with managed ones, add
   TLS, backups and monitoring; author Helm charts if Kubernetes is the target.
5. **Validate usage analytics** — out of scope here, and it is what enables
   usage-aware breaking-change detection, the most valuable governance feature
   Hive offers.
6. **Write the environment runbook** covering the manual setup steps and token
   rotation.
7. **Agree deployment ordering** between service code and schema publishing:
   additive changes deploy before publishing, removals publish first. This is the
   one failure mode no automated check can catch.

---

## 7. Spike Closure

| # | Acceptance criterion | Outcome |
|---|---|---|
| 1 | Self-hosted Hive Console starts and is accessible locally | ✅ Done |
| 2 | Accounts, Policies and Funds schemas publish successfully | ✅ Done — §3.2 step 1 |
| 3 | Schema checks and breaking changes can be validated | ✅ Done — §3.2 steps 3 and 10 |
| 4 | Registry generates and provides the composed supergraph | ✅ Done — §3.2 step 2 |
| 5 | Registry-based router serves federated GraphQL requests | ✅ Done — §3.2 step 4 |
| 6 | File-based and registry-based routers return equivalent data | ✅ Done — byte-identical, §3.2 step 5 |
| 7 | Valid schema changes picked up without restarting the router | ✅ Done — ~6s, §3.2 steps 6–8 |
| 8 | Existing file-based router remains unaffected | ✅ Done — §3.2 step 8 |
| 9 | Setup, configuration, limitations and findings documented | ✅ Done — repo README and `Docs/` |
| | **Decision** | **Registry-driven delivery confirmed viable self-hosted. Proceed to implementation; decide self-hosted vs Cloud first.** |

**Delivered beyond the stated criteria:** Hive Gateway verified against the same
registry endpoint, so one registry serves both runtimes; a verification tool
reporting which schema version each gateway is serving; the full lifecycle
automated as a repeatable test; and a documented CI/CD design with a sample
pipeline.

**Outstanding, with reasons:** usage analytics, production hardening and
Kubernetes deployment (all out of scope), and automated tenant onboarding (no
vendor API exists today).

The spike can be closed.
