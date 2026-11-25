# WDCS-27923 — SPIKE: Integrate self-hosted Hive Console for schema publishing, compatibility checks and registry-driven supergraph delivery on Mock repos

**Jira:** WDCS-27923 · **Status:** Complete — ready for closure
**Parent:** WDCS-25285 · **Predecessor:** [WDCS-25885 — Hive Capability Analysis closure](./CONFLUENCE-WDCS-25885-Spike-Closure.md)
**Domain:** Insurance APIs — Accounts, Policies, Funds
**Repository:** `rest-demo` · branch `hive-final-poc`
**Work executed:** 2026-11-04 (registry stood up) and 2026-11-19 (full delivery lifecycle verified)

> **Provenance.** Every outcome in this page was executed against a running
> stack, not inferred from documentation. Where something was read from vendor
> docs but not exercised, it says so. Versions are pinned throughout.

---

## Index

| § | Section |
|---|---|
| 1 | [Overview](#1-overview) |
| 2 | [Background](#2-background) |
| 3 | [Scope](#3-scope) |
| 3.1 | [Proof of Concept & Demo](#31-proof-of-concept--demo) |
| 3.2 | [Test flow — how it was proved](#32-test-flow--how-it-was-proved) |
| 4 | [Evaluation Summary](#4-evaluation-summary) |
| 4.1 | [Self-hosted Hive Console — hive@15.0.1, MIT](#41-self-hosted-hive-console--hive1501-mit) |
| 4.2 | [Schema publishing and checks — Hive CLI 0.68.2, MIT](#42-schema-publishing-and-checks--hive-cli-0682-mit) |
| 4.3 | [Federation 2 composition through the registry — Confirmed](#43-federation-2-composition-through-the-registry--confirmed) |
| 4.4 | [Registry-driven delivery — Hive Router 0.3.16 and Hive Gateway 2.15.10, MIT](#44-registry-driven-delivery--hive-router-0316-and-hive-gateway-21510-mit) |
| 4.5 | [Enterprise capability assessment](#45-enterprise-capability-assessment) |
| 5 | [Comparison Matrix](#5-comparison-matrix) |
| 6 | [Risks](#6-risks) |
| 7 | [Recommendation](#7-recommendation) |
| 8 | [Next Steps](#8-next-steps) |
| 9 | [Spike Closure](#9-spike-closure) |

---

## 1. Overview

This spike asked a practical question: **can a schema registry we host ourselves
take over the job of delivering the GraphQL schema to our gateways, without
anyone restarting or redeploying anything?**

The answer is **yes**, and it was proved end to end on the existing mock
insurance APIs.

The working shape is simple enough to describe in a sentence. A developer
changes one service's schema and publishes it. The registry checks the change
against everything else already published, composes the combined schema, and
starts serving it. The gateway notices on its own, within seconds, and begins
answering queries against the new schema. Nobody deploys anything in between.

```
BEFORE  — the schema can only travel with a deployment

   developer            build                gateway
   edits the   ──────►  rebuild the  ──────► restart it  ──────►  new schema
   schema               image                                      is live
                   └──────── minutes, a deploy, a change window ────────┘


AFTER   — the schema travels on its own

   developer            registry                      gateway
   publishes   ──────►  checks it                     keeps asking
   the schema           composes it      ──────────►  "anything new?"  ──►  new schema
                        serves it                     picks it up            is live
                                                      (no restart)
                   └──────────────── seconds, no deploy ────────────────┘
```

| Today | With the registry |
|---|---|
| The combined schema is built as a file and mounted into the gateway | The registry builds it and publishes it |
| Changing it means rebuilding and restarting the gateway | The gateway polls and picks it up on its own |
| Nothing checks whether a change breaks clients | Every change is checked before it is accepted |
| No history of who changed what | Every publish is a numbered, attributed version |

Both routes now run side by side in the POC, deliberately. The original
file-based gateway was untouched throughout, which was one of the acceptance
criteria and is also the safest migration story: the registry can be introduced
alongside what exists and switched over when there is confidence.

---

## 2. Background

- Three insurance REST APIs — **Accounts, Policies, Funds** — are presented as
  one GraphQL API through federation.
- The previous spike, **WDCS-25885**, recommended Hive as the platform and
  identified the schema registry as the missing piece. Its closing list of next
  steps began with *"Stand up Hive Console and validate schema checks, policy
  linting and breaking-change detection with the three subgraphs."* **This spike
  is that step.**
- Hive Console is the control plane: the registry, schema checks, version
  history and analytics. It is MIT licensed and can be run either as a managed
  cloud service or on our own infrastructure. This spike tested the
  **self-hosted** option, because that is the one with unanswered questions.

```
   WHO DOES WHAT

   schema changes          ┌──────────────────────────────────────┐
   from developers         │          HIVE CONSOLE                │
   ─────────────────────►  │          "control plane"             │
                           │                                      │
                           │   checks the change is safe          │
                           │   composes the combined schema       │
                           │   keeps every version, attributed    │
                           │   serves the result to gateways      │
                           └──────────────────┬───────────────────┘
                                              │  the combined schema
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                   ┌─────────────────────┐       ┌─────────────────────┐
                   │    Hive Router      │       │    Hive Gateway     │
                   │    "data plane"     │       │    "data plane"     │
                   │  answers queries    │       │  answers queries    │
                   └──────────┬──────────┘       └──────────┬──────────┘
                              │      client queries         │
                              └───────────────┬─────────────┘
                                              ▼
                              Accounts  ·  Policies  ·  Funds

   The control plane never sits in the path of a customer request.
   If it stops, queries keep being answered — only updates stop.
```

What was genuinely unknown going in: whether the self-hosted build can actually
deliver schemas to a running gateway. The vendor's high-availability CDN is a
cloud-only feature, so there was a real risk that self-hosting would leave us
with a registry that records schemas but cannot ship them.

**It does not.** The same delivery endpoints are served by the self-hosted
installation, and both Hive gateways consume them unchanged. That was the single
most important finding of this spike.

---

## 3. Scope

| Acceptance criterion | Covered | Outcome |
|---|---|---|
| 1. Self-hosted Hive Console starts and is accessible locally | ✅ §4.1 | Pass |
| 2. Accounts, Policies and Funds schemas publish successfully | ✅ §4.2 | Pass |
| 3. Schema checks and breaking changes can be validated | ✅ §4.2 | Pass |
| 4. Registry generates and provides the composed supergraph | ✅ §4.3 | Pass |
| 5. Registry-based router serves federated GraphQL requests | ✅ §4.4 | Pass |
| 6. File-based and registry-based routers return equivalent data | ✅ §4.4 | Pass — byte-identical |
| 7. Valid schema changes picked up without restarting the router | ✅ §4.4 | Pass — seconds, no restart |
| 8. Existing file-based router remains unaffected | ✅ §4.4 | Pass |
| 9. Setup, configuration, limitations and findings documented | ✅ §4.5, §6 | Pass |

**Out of scope, as agreed:** production deployment and high availability,
production TLS, backups and disaster recovery, automated organisation/project/
token onboarding, usage analytics validation, and Kubernetes deployment.

### 3.1 Proof of Concept & Demo

Everything is in the existing `rest-demo` repository. No new repository, and the
original POC was not modified in any way that changes its behaviour.

| Asset | What it is |
|---|---|
| [`hive-router-poc/`](../../hive-router-poc/) | The POC: three mock REST APIs, three GraphQL services in front of them, and the gateways |
| [`hive-router-poc/README.md`](../../hive-router-poc/README.md) | Setup from nothing to running, step by step, including the manual one-off steps |
| [`Docs/SUPERGRAPH-CDN-LIFECYCLE.md`](../SUPERGRAPH-CDN-LIFECYCLE.md) | The full lifecycle — change, check, publish, deliver, verify, roll back |
| [`Docs/SUPERGRAPH-CICD.md`](../SUPERGRAPH-CICD.md) | How the same path runs through a build pipeline, with a sample workflow |
| [`scripts/test-supergraph-lifecycle.sh`](../../scripts/test-supergraph-lifecycle.sh) | The whole lifecycle as one automated test |
| [`scripts/supergraph-version.sh`](../../scripts/supergraph-version.sh) | Reports which schema version each gateway is actually serving |

**Demo in one command.** With the stack running, `scripts/test-supergraph-lifecycle.sh`
performs the entire lifecycle and asserts every step. It passed **28 of 28
checks** on 2026-11-19 and leaves the environment exactly as it found it.

### 3.2 Test flow — how it was proved

This is the sequence a reviewer can follow, or watch, to confirm the spike's
claims. Each step has a visible result; none of it requires reading code.

**Setup, once.** Start the stack, create an account, organisation, project and
target in the Hive Console web interface, and generate two tokens — one for
publishing, one for the gateway to read schemas with. These four steps are
manual and cannot currently be scripted; see §6.

| # | What you do | What you should see |
|---|---|---|
| 1 | Open the Hive Console in a browser | The registry's dashboard, listing the project and its environments |
| 2 | Publish the three service schemas | Each one confirmed published; the Console lists all three with their addresses |
| 3 | Open the registry's query editor (the "Laboratory") | The combined schema, with every field from all three services — proof the registry composed them |
| 4 | Run a schema check with nothing changed | *"No changes"* for all three, and a link to a full report |
| 5 | Query the registry-fed gateway | Real data: account holder, their policies, and the funds behind them — a single question answered across all three services |
| 6 | Run the same query against the original file-fed gateway | **Identical** response, byte for byte |

**The change, which is the actual test.**

| # | What you do | What you should see |
|---|---|---|
| 7 | Add a new field to the Accounts service and publish it | Published successfully |
| 8 | Check the registry again | A **new version number** recorded against the target |
| 9 | Wait a few seconds, then query the registry-fed gateway for the new field | It works — **and nothing was restarted or redeployed** |
| 10 | Ask the file-fed gateway for the same field | It **rejects** the query, because it is still serving the schema it was started with |
| 11 | Restart the file-fed gateway | It now answers too |

Steps 9 and 10 side by side are the whole point of the spike, and the clearest
thing to show in a demo. Same code, same services, same data — the only
difference is where the schema came from, and that difference removes a deploy.

```
   THE MOMENT WORTH SHOWING

   publish a new field
         │
         ├──►  REGISTRY     checks it ✓    composes it ✓    new version recorded
         │                                        │
         │                       both gateways read their schema from here
         │                                        │
         │              ┌─────────────────────────┴─────────────────────────┐
         │              ▼                                                   ▼
         │     REGISTRY-FED GATEWAY                               FILE-FED GATEWAY
         │     (reads from the registry)                     (read a file, at startup)
         │              │                                                   │
    +0s  │              │   asking "anything new?"                          │
    +6s  │              ▼                                                   │
         │     new field answers ✓                                          │
         │     nothing restarted                                            ▼
         │                                                     new field REJECTED ✗
         │                                                                  │
         │                                                        restart required
         │                                                                  ▼
         │                                                     new field answers ✓

   Same code. Same services. Same data.
   The only difference is where the schema came from — and that removes a deploy.
```

**The safety net.**

| # | What you do | What you should see |
|---|---|---|
| 12 | Make a *breaking* change — remove a field clients use — and run a check | The check **fails**, naming the removed field. This is what stops it reaching anyone |
| 13 | Roll back by publishing the previous schema | The gateways return to the old schema within seconds, again with no restart |
| 14 | Run the version report | Every registry-fed gateway confirmed as serving the published version |

Step 12 is the governance argument in one line: today nothing catches that
change until a client breaks in an environment.

---

## 4. Evaluation Summary

### 4.1 Self-hosted Hive Console — hive@15.0.1, MIT

**Runs, and runs locally.** The official community installation starts as 14
containers — the Console itself plus PostgreSQL, ClickHouse, Redis, Redpanda
and S3-compatible storage. Alongside the existing POC that is 24 containers in
total, which is the headline operational number for this option.

Confirmed working self-hosted:

- Web interface, sign-up, organisation, project and per-environment targets.
- Schema registry with full version history and attribution per publish.
- Federation composition, performed by the registry itself.
- Schema checks and breaking-change detection.
- Schema policy linting.
- The delivery endpoints that gateways read schemas from.
- A built-in query editor against the registered schema.

**The installation file is vendored unmodified**, so it can be re-fetched and
compared on upgrade rather than being a hand-maintained fork.

**The honest caveat:** the vendor describes this bundled stack as an evaluation
environment, not a production architecture, and that is correct. It is
single-instance, stores everything on local disk, has no backups and no TLS.
See §6.

### 4.2 Schema publishing and checks — Hive CLI 0.68.2, MIT

All three services publish cleanly through the command-line tool, which is how a
build pipeline would do it. Scripts for publishing and checking live in the repo
so neither is a hand-typed command.

**Checks are the feature that justifies the registry.** A check takes a proposed
schema, composes it against everything else already published, and compares the
result against the current live version. It writes nothing, and it **exits with
a failure code when the change would break clients** — which is exactly what
makes it usable as an automated gate on a pull request. Verified both ways:

| Change | Result |
|---|---|
| No change | *"No changes"*, passes |
| New field added | Passes — correctly treated as safe |
| Field removed | **Fails**, naming the field |

```
   THE GATE WE DO NOT HAVE TODAY

                     a developer proposes a schema change
                                    │
                                    ▼
                          ┌──────────────────┐
                          │   schema check   │   composes it against everything
                          │   (automatic)    │   already published, then compares
                          └────────┬─────────┘   it with what is live now
                                   │
                 ┌─────────────────┴──────────────────┐
                 ▼                                    ▼
          nothing breaks                      a client would break
                 │                                    │
                 ▼                                    ▼
          merge  ──►  publish  ──►  live       BLOCKED, naming the field
                                              and linking to a full report

   Today there is no box in the middle: the change reaches an environment,
   and a client finds out for us.
```

Every check also produces a link to a full report in the Console, which is the
artefact worth putting on a pull request for a reviewer.

One finding worth flagging to whoever builds the pipeline: by default, a publish
can succeed even when the result would not compose. There is a flag that
prevents this, and it should be considered mandatory. Without it a pipeline goes
green while nothing has actually been delivered.

### 4.3 Federation 2 composition through the registry — Confirmed

The registry composes the three services into one combined schema itself, using
the same composition library the POC uses locally. That matters more than it
sounds: it means a change that composes on a developer's machine will compose in
the registry, so failures surface early and cheaply rather than after a publish.

```
   WHAT "COMPOSED" MEANS, IN ONE PICTURE

   one question from a client                 three services that already exist

   {                                              ┌───────────────────┐
     account {               ┌─────────────────►  │     Accounts      │
       holderName            │                    └───────────────────┘
       policies {            │                    ┌───────────────────┐
         policyNumber   ─────┼─────────────────►  │     Policies      │
         funds {             │                    └───────────────────┘
           name         ─────┼─────────────────►  ┌───────────────────┐
         }                   │                    │      Funds        │
       }               the gateway splits the     └───────────────────┘
     }                 question up, calls each
   }                   service, and joins the
                       answers back together

   The client asks once. It never learns there were three services.
   The registry is what works out which service owns which field.
```

Confirmed:

- All three services registered, with their addresses, and merged into one
  schema.
- The composed result correctly records which service owns each field, which is
  how the gateway knows where to send each part of a query.
- The composed schema is served on request, and is what both gateways load.
- A four-hop federated query — account → policies → funds → fund detail —
  returns correct data through the registry-fed gateway.

### 4.4 Registry-driven delivery — Hive Router 0.3.16 and Hive Gateway 2.15.10, MIT

This is the part that was genuinely uncertain, and it works.

**Hive Router**, pointed at the self-hosted registry, loads the composed schema
on start-up and re-checks every ten seconds. Verified:

| Check | Result |
|---|---|
| Serves federated queries from the registry schema | ✅ |
| Same response as the file-based router | ✅ **Byte-identical** |
| Picks up a republish with no restart | ✅ Live in **seconds** |
| Rolls back the same way when the old schema is republished | ✅ |
| Original file-based router unaffected throughout | ✅ Never restarted, never reloaded |

**Hive Gateway** — the Node.js runtime from the previous spike — consumes the
same registry endpoint natively, with no extra components. It was added during
this spike and verified serving identical results. This is a useful finding
beyond the stated scope: **one registry serves both runtimes**, so the choice of
gateway per workload stays open and is not constrained by how schemas are
delivered.

**A practical gap, and what was built for it.** Neither gateway exposes any way
to ask it which schema version it is currently serving. That makes "did the
change actually reach production?" an awkward question to answer during a
release. A small reporting tool was added to the repo that answers it by
comparing what the registry publishes against what each gateway is actually
serving, and fails if they disagree. It is intended for use as a post-deployment
check in a pipeline.

### 4.5 Enterprise capability assessment

**Licensing.** Unchanged from the previous spike and still favourable: Hive
Console, Hive Router and Hive Gateway are all **MIT**. Self-hosting carries no
licence cost. Hive Console Cloud is usage-based with a free tier.

**Operational cost of self-hosting.** Now measured rather than estimated:

| Dimension | Finding |
|---|---|
| Containers | 14 for the Console; 24 with the POC alongside |
| Supporting services needed | PostgreSQL, ClickHouse, Redis, Redpanda, S3-compatible storage |
| Memory | Docker Desktop below 8 GB struggles |
| State after a short session | ~180 MB |
| Install method | Docker Compose only — **no Helm chart** |
| Monitoring | None bundled |

**Delivery, self-hosted versus cloud.** The cloud offering serves schemas from a
high-availability CDN. Self-hosted, the same endpoints are served by the Console
itself. Functionally identical from a gateway's point of view — but there is no
edge and no separate availability domain, so **if the Console is down, schema
delivery is down**. Running gateways keep serving the schema they already hold;
they simply stop receiving updates. That is a mild failure mode, but it should
be a conscious decision rather than a surprise.

```
   THE ONE REAL DIFFERENCE BETWEEN THE TWO OPTIONS

   CLOUD                                    SELF-HOSTED

   registry                                 registry
      │                                        │
      ▼                                        │
   high-availability CDN                       │   (no edge, no replica —
   (replicated, at the edge)                   │    the Console serves it
      │                                        │    directly)
      ▼                                        ▼
   gateways                                 gateways


   If the registry goes down:

   gateways keep receiving              gateways KEEP ANSWERING QUERIES
   schema updates from the CDN          with the schema they already hold,
                                        but stop receiving updates

   Note what is NOT at risk in either case: customer traffic.
   A registry outage delays schema changes; it does not take the API down.
```

**Setup effort.** Starting the stack is one command. Creating the account,
organisation, project and the two tokens is four manual steps through the web
interface, with no documented API or CLI to automate them. A fully scripted
clone-to-running setup is therefore not achievable today.

---

## 5. Comparison Matrix

| Capability | File-based delivery (today) | Self-hosted Hive Console | Hive Console Cloud |
|---|---|---|---|
| Schema change reaches the gateway | Rebuild + restart | **Automatic, seconds** | Automatic, seconds |
| Breaking-change detection | None | ✅ | ✅ |
| Usage-aware breaking-change detection | None | ✅ capability present, not exercised | ✅ |
| Version history and attribution | Git only | ✅ Per publish | ✅ |
| Roll back a schema | Rebuild + restart | ✅ Republish, seconds | ✅ |
| Schema policy linting | None | ✅ | ✅ |
| Works with Hive Router | ✅ | ✅ | ✅ |
| Works with Hive Gateway | ✅ | ✅ | ✅ |
| Delivery availability | N/A — local file | Single instance; no edge | High-availability CDN |
| Infrastructure to run | None beyond the gateway | 14 containers + 5 data services | None |
| Licence cost | — | Free (MIT) | Usage-based, free tier |
| Kubernetes support | N/A | No Helm chart | N/A |

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Bundled Console stack is evaluation-grade — single instance, local disk, no backups, no TLS | **High** | Use managed PostgreSQL/ClickHouse/Redis/Kafka and real storage, add TLS and monitoring — or use Hive Console Cloud |
| Self-hosted delivery has no high-availability tier; if the Console is down, no gateway receives schema updates | **Medium** | Running gateways keep serving their current schema. Decide consciously; consider Cloud if this is unacceptable |
| No Helm chart — Docker Compose only | **Medium** | Port it, or use Cloud, if Kubernetes is the target |
| A publish can succeed while leaving a schema that does not compose | **Medium** | Make the "fail on composition error" flag mandatory in the pipeline, and run checks on every pull request |
| Gateways cannot report which schema version they are serving | **Medium** | Addressed — a verification tool was built and is documented for pipeline use |
| Account, organisation and token creation cannot be automated | **Medium** | One-off per environment; document it as a runbook step |
| Changing the installation's generated credentials after first run breaks the database | **Medium** | Documented, with a repair script in the repo; do not regenerate credentials casually |
| Usage analytics not validated — out of scope | **Low** | Services are running and the capability is present; configure and validate in implementation |
| Hive Router is still pre-1.0 | **Low** | Pin the version; re-check configuration on upgrade |
| Operational burden of 24 containers for local development | **Low** | The original file-based POC still runs standalone without the Console |

---

## 7. Recommendation

**Adopt the registry-driven delivery model. It works self-hosted, it removes a
deployment step, and it adds the breaking-change gate we currently do not have.**

Three points behind that:

1. **The capability question is settled.** Schema publishing, compatibility
   checks, composition and registry-driven delivery all work on an
   installation we host ourselves, against our own mock services, with both
   Hive runtimes. Nothing in the self-hosted build blocks this.
2. **The governance benefit is immediate and independent of the delivery
   benefit.** Even without changing how schemas reach the gateway, putting
   schema checks on pull requests catches breaking changes before they are
   merged. That is worth having on its own.
3. **The remaining decision is operational, not technical:** self-hosted or
   Cloud. Self-hosted is free and keeps everything inside our network, at the
   cost of running five stateful services properly, with no Helm chart and no
   bundled monitoring. Cloud removes that work at a usage-based cost and adds a
   high-availability delivery tier. **This spike recommends taking that decision
   explicitly before implementation starts**, because it changes the shape of
   the work considerably.

A low-risk migration exists and was demonstrated: run both gateways side by side,
move traffic when there is confidence, and keep the file-based path as a
fallback. The POC ran both throughout without interference.

**Confidence:** **High** on capability, Federation 2 composition, checks and
registry-driven delivery — all executed. **Medium** on the operational cost of
running the Console in production, which was assessed from a local installation
rather than a production one.

---

## 8. Next Steps

1. **Decide self-hosted versus Cloud for Hive Console.** Everything else depends
   on it.
2. **Add schema checks to pull requests** — the highest value, lowest effort
   item, and useful regardless of decision 1. A sample pipeline is documented in
   [`Docs/SUPERGRAPH-CICD.md`](../SUPERGRAPH-CICD.md).
3. **Add publishing to the main-branch pipeline**, with the composition-error
   gate enabled and the post-deployment verification check.
4. **If self-hosting:** replace the bundled data services with managed ones, add
   TLS, backups and monitoring, and author Helm charts if Kubernetes is the
   target.
5. **Validate usage analytics**, which was out of scope here — it is what
   enables usage-aware breaking-change detection, the most valuable governance
   feature Hive offers.
6. **Write the environment runbook** covering the four manual setup steps and
   token rotation.
7. **Agree deployment ordering** between service code and schema publishing.
   Additive changes deploy before publishing; removals publish first. This is
   the one failure mode no automated check can catch.

---

## 9. Spike Closure

| Acceptance criterion | Outcome |
|---|---|
| 1. Self-hosted Hive Console starts and is accessible locally | ✅ Done — §4.1 |
| 2. Accounts, Policies and Funds schemas publish successfully | ✅ Done — §4.2 |
| 3. Schema checks and breaking changes can be validated | ✅ Done — §4.2, both directions |
| 4. Hive registry generates and provides the composed supergraph | ✅ Done — §4.3 |
| 5. Registry-based Hive Router serves federated GraphQL requests | ✅ Done — §4.4 |
| 6. File-based and registry-based routers return equivalent data | ✅ Done — **byte-identical** |
| 7. Valid schema changes picked up without restarting the router | ✅ Done — seconds, no restart |
| 8. Existing file-based router remains unaffected | ✅ Done — §4.4 |
| 9. Setup, configuration, limitations and findings documented | ✅ Done — repo README and `Docs/` |
| **Decision** | **Registry-driven delivery confirmed viable self-hosted. Proceed to implementation; decide self-hosted vs Cloud first.** |

**Delivered beyond the stated criteria:**

- Hive Gateway verified against the same registry endpoint, so one registry
  serves both runtimes.
- A verification tool that reports which schema version each gateway is actually
  serving, for use as a post-deployment check.
- The complete lifecycle automated as a repeatable test — 28 of 28 checks
  passing.
- A documented CI/CD design with a sample pipeline.

**Outstanding, with reasons:** usage analytics (out of scope), production
hardening and Kubernetes deployment (out of scope), and automated tenant
onboarding (no vendor API exists today).

The spike can be closed.
