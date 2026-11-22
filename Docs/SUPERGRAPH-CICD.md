# Running the supergraph lifecycle through CI/CD

**Repository:** `rest-demo` · branch `hive-final-poc`
**Date:** 2026-11-19
**Companion:** [`SUPERGRAPH-CDN-LIFECYCLE.md`](SUPERGRAPH-CDN-LIFECYCLE.md) — the manual lifecycle, verified end to end
**Sample workflow:** [`ci/github-actions-graphql-schema.yml`](ci/github-actions-graphql-schema.yml)

> **Provenance.** CLI flags and their semantics are **[Verified]** against Hive
> CLI 0.68.2 and the self-hosted `hive@15.0.1` registry in this repository —
> every flag quoted below was read from that CLI's own `--help`, and the
> lifecycle the pipeline automates was executed in full
> (`scripts/test-supergraph-lifecycle.sh`, 28/28). The **pipeline itself has
> not been run in GitHub Actions** — this repository has no remote CI — so
> everything about the workflow's behaviour *as a workflow* is
> **[Unverified]** and labelled where it matters. Versions are pinned.

---

## Contents

- [TL;DR](#tldr)
- [1. The pipeline, stage by stage](#1-the-pipeline-stage-by-stage)
- [2. What changes when this runs on a runner](#2-what-changes-when-this-runs-on-a-runner)
- [3. PR validation](#3-pr-validation)
- [4. Schema checks: the flags that matter](#4-schema-checks-the-flags-that-matter)
- [5. Composition in CI](#5-composition-in-ci)
- [6. Publishing, and what "artifact versioning" means here](#6-publishing-and-what-artifact-versioning-means-here)
- [7. CDN deployment — there is no such step](#7-cdn-deployment--there-is-no-such-step)
- [8. Gateway refresh — also not a step, but it needs a gate](#8-gateway-refresh--also-not-a-step-but-it-needs-a-gate)
- [9. Post-deployment verification](#9-post-deployment-verification)
- [10. Rollback](#10-rollback)
- [11. Promotion across environments](#11-promotion-across-environments)
- [12. Secrets and least privilege](#12-secrets-and-least-privilege)
- [13. Deploy ordering — the thing that actually breaks production](#13-deploy-ordering--the-thing-that-actually-breaks-production)
- [14. Adopting the sample workflow](#14-adopting-the-sample-workflow)
- [15. What this does not solve](#15-what-this-does-not-solve)
- [16. Versions pinned](#16-versions-pinned)

---

## TL;DR

The pipeline has three jobs, not six:

```
pull request ──► validate   compose locally, then hive schema:check
                            (writes nothing remote; exit code is the gate)

push to main ──► publish    compose, then hive schema:publish
                            --fail-on-composition-error
                            ** this IS the CDN deployment **
                            record x-hive-schema-version-id + etag

             ──► verify     wait for the runtimes to converge, then prove it
                            (there is nothing to deploy — they poll)
```

**The thing worth understanding before writing any of it:** there is no
artifact to upload, no gateway to restart and no deployment to orchestrate. A
successful `schema:publish` is already live on the artifact routes, and
CDN-sourced runtimes pick it up on their own within a poll interval —
**[Verified]** ~6 seconds on this stack with `poll_interval: 10s`.

That removes the step everyone expects to write, and adds one nobody expects to
need: **proving convergence**. Because the runtimes expose no version
([§8](#8-gateway-refresh--also-not-a-step-but-it-needs-a-gate)), a pipeline that
publishes and goes green has not shown that anything is serving the new schema.
That is what the `verify` job is for.

---

## 1. The pipeline, stage by stage

| Lifecycle stage | CI job | Command | Gate |
|---|---|---|---|
| Subgraph change | — | developer's commit | code review |
| Local composition | `validate` | `docker compose run --rm --build --no-deps supergraph-compose` | non-zero exit if it cannot compose |
| SDL inspection | `validate` | copy out of the `supergraph` volume | fail if any SDL is empty |
| Schema check | `validate` | `hive schema:check` per subgraph | **non-zero exit on a breaking change** |
| Publish | `publish` | `hive schema:publish --fail-on-composition-error` | non-zero on composition failure |
| Registry composition | — | automatic, inside Hive | a version marked not composable |
| Artifact versioning | `publish` | read `x-hive-schema-version-id` + `etag` | fail if the version id did not change |
| CDN deployment | — | **nothing** — see [§7](#7-cdn-deployment--there-is-no-such-step) | — |
| Runtime refresh | — | **nothing** — the runtimes poll | — |
| Post-deploy verification | `verify` | `scripts/supergraph-version.sh --require …` | non-zero on a fingerprint mismatch |
| Rollback | `workflow_dispatch` | republish an older ref | same gates as a normal publish |

Two gates do the real work: `schema:check` on the way in, and the fingerprint
comparison on the way out. Everything between them is bookkeeping.

---

## 2. What changes when this runs on a runner

Four things that work on a laptop and do not work unchanged on a hosted runner.

### The registry has to be reachable

This POC's registry is `http://localhost:8082` — on one laptop. A GitHub-hosted
runner cannot see it. The options, in the order most teams end up choosing
them:

| Option | Trade-off |
|---|---|
| **Self-hosted runner** inside the network | simplest; the runner needs Docker and network access to the registry |
| Expose the registry on an internal hostname reachable by the runner (VPN, Tailscale, private endpoint) | works with hosted runners; the registry is now a production dependency of CI |
| Hive Cloud instead of self-hosted | removes the problem entirely; loses self-hosting, which was the point of this POC |

The sample workflow takes the endpoint from a secret so the choice is
configuration, not a rewrite.

### Container hostnames do not exist on a runner

`--url http://accounts-subgraph:4001/graphql` is baked into the composed
supergraph and must resolve **on the runtime's network**, not on the runner's.
The runner never calls that URL; it only records it. So it is correct for the
runner to publish a hostname it cannot itself resolve — which looks wrong in a
log and is not. Per environment, that URL should be the address the *runtime in
that environment* will use.

### Volume names are project-scoped

`hive-router-poc_supergraph` is `<project>_<volume>`, and the project name is
pinned by `name: hive-router-poc` in the compose file, so it is stable on a
runner too. The sample workflow relies on that when it copies the composed SDL
out with a throwaway `alpine` container.

### The CLI, not the container

The repo runs the CLI through `hive-cli` (a Compose service on the Hive
network). On a runner there is no such network, so install the CLI directly and
pass `--registry.endpoint` explicitly:

```bash
npm install --global --no-audit --no-fund "@graphql-hive/cli@0.68.2"
```

Pin that version. It is the version in `hive-router-poc/hive/Dockerfile` and
the one these flags were verified against.

---

## 3. PR validation

The pull-request job should answer exactly one question: *if we merged this,
would the graph still compose and would any client break?* It must write
nothing to the registry.

```bash
docker compose -f hive-router-poc/docker-compose.yml run --rm --build --no-deps supergraph-compose
```

Composition failing here is the cheapest possible failure — it needs no
credentials and no registry. **[Verified]** it is the same library the registry
uses (`@theguild/federation-composition` 0.27.0), so a local failure reliably
predicts a registry failure.

Then one `schema:check` per subgraph, sharing a `--contextId` so Hive groups
them as one logical check for the pull request. Grouping matters: three
separate checks on one PR produce three separate verdicts, and a reviewer has
to reconcile them by hand.

Checking every subgraph on every PR, rather than only the changed one, is
deliberate. A change to `accounts` can break composition with `policies`
without touching the policies file at all — the whole point of a federated
graph is that the subgraphs are coupled through the composed schema.

---

## 4. Schema checks: the flags that matter

**[Verified]** from `hive schema:check --help` on CLI 0.68.2:

| Flag | What it does | Use it in CI? |
|---|---|---|
| `--contextId <id>` | "Context ID for grouping the schema check" | **yes** — one per PR |
| `--author`, `--commit` | attribution on the check record | **yes** |
| `--experimentalJsonFile <path>` | writes the result as JSON, "useful for e.g. CI scripting with `jq`" | **yes** — this is what makes the result reviewable instead of a log dive |
| `--baseline <file>` | compares against a given schema; accepts `<revision>:<path>`, so a git revision works | useful for pre-merge diffs |
| `--github` | "Connect with GitHub Application" | only with the Hive GitHub integration configured; **[Documented]**, not exercised here |
| `--forceSafe` | "mark the check as safe, breaking changes are expected" | **no** — never in an automated path. It is a human's decision |
| `--service <name>` | which subgraph the candidate schema is | **yes**, always, for federation |
| `--target <org/project/target>` | required: tokens are organization-scoped in Hive 15 | **yes** |

`--forceSafe` deserves the warning. It exists for the case where a breaking
change is intended and already agreed. Putting it in a workflow turns the gate
off permanently, and the next genuinely unintended break sails through. Approve
breaking changes in the Console, on the check's own page, where the approval is
attributable.

---

## 5. Composition in CI

Reuse the repo's composer image rather than reconstructing its dependency
layout:

```bash
docker compose -f hive-router-poc/docker-compose.yml run --rm --build --no-deps supergraph-compose
```

> **`--build` is mandatory and omitting it fails silently.** **[Verified]**
> `compose/Dockerfile` does `COPY subgraphs/src ./subgraphs/src`, so the
> composer imports the subgraph modules from inside its own image. Without a
> rebuild it composes the **previous** modules, **exits 0**, and writes a
> supergraph with the change missing — so CI publishes a schema that does not
> match the code and every gate stays green. This was hit for real while
> building the test script in the companion document.

If you would rather not use Docker in CI, `compose/Dockerfile` records the one
non-obvious constraint: dependencies must be installed at the directory
*above* `compose/`, because `compose.mjs` imports the subgraph modules and Node
resolves their `graphql-tag` import by walking up from `subgraphs/src`.
Installing inside `compose/` puts `node_modules` outside that search path and
the import fails.

**[Documented]** `hive dev --remote` can compose through the registry instead
of locally, which removes the composer from CI entirely. It was not exercised
here, and it trades a local, credential-free failure for a round trip.

---

## 6. Publishing, and what "artifact versioning" means here

```bash
hive schema:publish "out/sdl/$s.graphql" \
  --registry.endpoint "$HIVE_REGISTRY_ENDPOINT" \
  --registry.accessToken "$HIVE_TOKEN" \
  --target "$HIVE_TARGET" \
  --service "$s" \
  --url "$SUBGRAPH_URL" \
  --author "$ACTOR" --commit "$SHA" \
  --fail-on-composition-error \
  --force
```

**[Verified]** flag semantics from `hive schema:publish --help`:

| Flag | Why it is there |
|---|---|
| `--fail-on-composition-error` | "prevent publishing a federation schema if it would cause a composition error". **Without this a publish can succeed while leaving a version that does not compose** — the CDN keeps serving the previous one, and the pipeline is green with nothing deployed. This is the single most important flag on this command |
| `--force` | skips the interactive confirmation on a first publish to a target; required for non-interactive use |
| `--commit` | "the associated commit SHA, or optionally any external identifier" — this is the link from a schema version back to your git history |
| `--metadata` | arbitrary metadata stored with the version; a reasonable place for a build id |
| `--experimental_acceptBreakingChanges` | accepts breaking changes if still composable. Same objection as `--forceSafe`: not in an automated path |

### Versioning is the registry's job, not the pipeline's

There is no artifact to name, tag or upload. **[Verified]** every artifact
response carries two identifiers and they mean different things:

| Header | Identifies | Changes when |
|---|---|---|
| `x-hive-schema-version-id` | the **publish event** | every successful publish, even when the resulting bytes are identical |
| `etag` | the **content** | only when the bytes change |

**[Verified]** republishing the previous schema produced a *new* version id
(`3590d700-0e89-…`) with the *old* etag (`"cf9fc47a9cc89ac6ae4b08f4dd7a3f81"`).
So a pipeline should record both:

- **version id** → the deployment record, the release note, the audit trail
- **etag** → "did anything actually change?", cache invalidation

The sample workflow reads the version id before and after publishing and
**fails if it did not change**. That turns "the publish command exited 0" into
"the registry really produced and is really serving a new version", which are
not the same claim.

---

## 7. CDN deployment — there is no such step

**[Verified]** the artifact routes always serve the latest valid composed
version. Publishing is the deployment. There is nothing to copy, sync,
invalidate or promote.

What the pipeline *should* do instead is record what is being served, which is
one request:

```bash
curl -sS -D - -o /dev/null -H "X-Hive-CDN-Key: $HIVE_CDN_KEY" "$HIVE_CDN_ENDPOINT/supergraph"
```

Two caveats carried over from the companion document, both of which matter more
in CI than on a laptop:

- **`HIVE_CDN_ENDPOINT` must end with the target's UUID, not its name.** With a
  valid key, the name form returns **403** — so in CI it reads as an
  authentication failure and sends you to rotate a perfectly good token.
- **Self-hosted, there is no CDN in the Hive Cloud sense.** The routes are
  served by the `server` container. If `server` is down, schema delivery is
  down for every CDN-sourced runtime in every environment. A pipeline cannot
  fix that; it should at least not pretend otherwise.

---

## 8. Gateway refresh — also not a step, but it needs a gate

CDN-sourced runtimes reload on their own:

| Runtime | Mechanism | **[Verified]** behaviour |
|---|---|---|
| Hive Router `source: hive` | `poll_interval: 10s` | new schema served ~6s after publish; logs `supergraph loaded successfully with changes, updating...` |
| Hive Gateway `--hive-cdn-endpoint` | `POLLING` / `--polling`, default 10s | new schema served within a poll — **and logs nothing at all** |
| Hive Router `source: file` | none | **stale until restarted** |

Three consequences for a pipeline.

**Do not write a restart step for a CDN-sourced runtime.** It is unnecessary,
and it converts a zero-downtime schema change into a rolling restart.

**Do not verify the gateway by reading its log.** **[Verified]** Hive Gateway
2.15.10 logs nothing when it swaps the supergraph. While writing the companion
document this looked exactly like a stuck gateway; it was one poll interval
from correct, with no log line either way. A log-grep gate here would be
flaky in the worst direction — silently passing or failing on timing.

**Do write a convergence gate.** Neither runtime exposes its loaded version:
**[Verified]** Hive Router 0.3.16 answers `/health` and `/readiness` with an
empty `200` and returns its landing page for `/version`, `/metrics` and every
other path, so a `200` from those proves only that the process is up. The
pipeline has to compare schemas instead.

---

## 9. Post-deployment verification

Three levels, and a pipeline should use the strongest one available to it.

| Level | Check | Needs |
|---|---|---|
| Liveness | the runtime answers `{ __schema { queryType { name } } }` | network access to the runtime |
| **Agreement** | the runtime's canonical schema fingerprint equals the CDN's | the same, plus the CDN key |
| Behaviour | a smoke query that exercises the new field returns data | a known-good test fixture |

Level 2 is the one that answers the actual question. `scripts/supergraph-version.sh`
implements it: it canonicalises both the CDN's `sdl` artifact and the runtime's
live introspection through `graphql-js` (`lexicographicSortSchema` +
`printSchema` + sha256) so that equal bytes mean equal schemas, then compares.

```bash
./scripts/supergraph-version.sh --require hive-router-registry   # exit 1 on mismatch
./scripts/supergraph-version.sh --json                           # for jq
```

A file-sourced runtime that differs is reported but does not fail the run —
that is its normal state between a publish and a restart. A **CDN**-sourced
runtime that differs sets the exit code, because that is a delivery failure.

Level 3 is worth adding for the specific change being shipped. "The schema has
the field" and "the field returns data" fail independently: the first passing
while the second fails is the signature of publishing a schema before deploying
the service behind it — see [§13](#13-deploy-ordering--the-thing-that-actually-breaks-production).

---

## 10. Rollback

The registry is append-only; there is no delete. Three approaches, in
descending order of how much this repository can vouch for them:

| Approach | Command | Status |
|---|---|---|
| **Republish the previous schema** | check out the older ref, compose, `schema:publish` | **[Verified]** — stage 12 of `test-supergraph-lifecycle.sh`. CDN-sourced runtimes follow within a poll interval, no restart |
| Promote a known-good version | `hive schema:promote --version <id> --to <org/project/target>` | **[Documented]** from `--help`; the version "must be within the same project as the target". Not exercised |
| Remove a subgraph from the target | `hive schema:delete <service> --dryRun` then `--confirm` | **[Documented]**. Run `--dryRun` first; it reports without acting |

Republishing is the one to automate, which is why the sample workflow's
`workflow_dispatch` takes a `rollback_ref` and simply runs the publish job from
that ref. A rollback is then an ordinary publish, through the same gates, with
the same verification — not a special path that only runs during an incident
and has therefore never been tested.

**[Verified]** the signal to expect: a **new version id** with the **old etag**.
New event, known-good bytes. A rollback that produces a new etag is not a
rollback.

---

## 11. Promotion across environments

The POC has `development`, `staging` and `production` targets; only
`development` holds any schemas, so everything below is **[Unverified]** here.

Two shapes, and the choice matters:

**Publish per environment.** Each environment's pipeline publishes to its own
target, from the git ref that environment runs. Simple, and each target's
history reflects what that environment actually ran. The cost is that the same
SDL is composed more than once, and nothing structurally guarantees that what
you tested in staging is what reaches production.

**Promote between targets.** `hive schema:promote --from <staging> --to <production>`
moves a specific version forward. The artifact production serves is then
*provably* the one staging served. **[Documented]** only, and the flags
constrain it to one project.

Either way, each environment needs its own CDN token and its own
`HIVE_CDN_ENDPOINT` — the UUID in that URL is the target's, so a production
runtime pointed at a development endpoint will happily serve development's
schema with no error anywhere.

---

## 12. Secrets and least privilege

**[Verified]** the three credential kinds on this stack are not
interchangeable, and conflating them wastes an afternoon:

| Secret | Kind | Scope needed |
|---|---|---|
| `HIVE_TOKEN` | target registry token | PR job: **check only**. Publish job: check + publish |
| `HIVE_CDN_KEY` | CDN access token | read the artifact routes |
| — | organization access token | only for the public GraphQL API; **not needed by this pipeline** |

Two separate registry tokens — a check-only one for pull requests and a
publishing one scoped to the protected branch — is worth the small extra setup.
A pull request from a fork should never hold a token that can publish.

**[Verified]** the public GraphQL API at `:8082/graphql` rejects a registry
token outright: a bare `{ __typename }` with it in `X-API-Token` or
`Authorization: Bearer` returns `{"errors":[{"message":"Invalid token provided"}]}`,
while the same query with no auth header succeeds. So do not build a CI step
that reads schema versions out of the public API with `HIVE_TOKEN` — it will
look like a broken token when it is the wrong kind of token. Use the CDN
response headers; they need only the CDN key, and they are what the runtimes
rely on.

Never log a token. The sample workflow passes them as environment variables
from secrets and prints only version ids, etags and checksums.

---

## 13. Deploy ordering — the thing that actually breaks production

Everything above is schema delivery. The failure that actually reaches users is
a mismatch between the schema and the services behind it, and no schema check
can catch it, because the registry only ever sees SDL.

| Change | Safe order | What the wrong order looks like |
|---|---|---|
| **Adding** a field | deploy the service **first**, then publish | the field is in the graph, resolves to an error or null; introspection passes, queries fail |
| **Removing** a field | publish **first**, then deploy | clients can still request a field nothing answers |
| **Changing** a field's type | treat as remove + add, across two releases | immediate client breakage |

A CI pipeline enforces this by putting the publish step **after** the service
deployment for additive changes, and before it for removals. In practice most
teams make every change additive and never remove in the same release, which
collapses the rule to "deploy, then publish".

This is also what makes the level-3 smoke query in
[§9](#9-post-deployment-verification) worth its cost: it is the only gate that
can see this class of mistake.

---

## 14. Adopting the sample workflow

[`Docs/ci/github-actions-graphql-schema.yml`](ci/github-actions-graphql-schema.yml)
is deliberately **not** in `.github/workflows/`, so that committing it cannot
start running CI against a registry nothing can reach.

```bash
mkdir -p .github/workflows && cp Docs/ci/github-actions-graphql-schema.yml .github/workflows/graphql-schema.yml
```

Then, in order:

1. **Decide how the runner reaches the registry** —
   [§2](#2-what-changes-when-this-runs-on-a-runner). Nothing else works until
   this does.
2. **Set the secrets**: `HIVE_REGISTRY_ENDPOINT`, `HIVE_TOKEN`, `HIVE_TARGET`,
   `HIVE_CDN_ENDPOINT`, `HIVE_CDN_KEY`. Check the CDN endpoint ends with the
   target **UUID**.
3. **Set the variables**: `GATEWAY_URL` for the verify job, and
   `RUN_FINGERPRINT_CHECK=true` only on a runner that has this repository's
   stack available.
4. **Fix the subgraph URLs** in the publish job to the addresses the runtime in
   that environment will use.
5. **Run it on a branch first.** The `validate` job is safe — it writes nothing
   remote. Do not let `publish` run until `validate` has passed once.

The workflow is **[Unverified]** as a workflow: its YAML parses and every
command in it was verified against this stack by hand, but it has not executed
in GitHub Actions.

---

## 15. What this does not solve

- **The pipeline has not been run.** No GitHub Actions execution exists for
  this repository. Treat the sample as a reviewed starting point, not a tested
  artefact.
- **Usage-based breaking-change detection is not wired up.** Hive can decide
  whether a removal is safe from whether real traffic uses the field, which
  needs the runtimes to report usage to the registry. Not configured here, so
  every check in this POC was schema-only — which means checks are more
  conservative than they would be in production.
- **No schema proposals / approval workflow.** The CLI exposes
  `--schemaProposalId`; nothing here uses it.
- **`hive schema:promote` is unexercised**, so multi-environment promotion is
  a design sketch.
- **`--github` is unexercised**: it needs the Hive GitHub application
  configured against the self-hosted instance.
- **No HA story for the artifact endpoint.** It is the `server` container. See
  the companion document's limitations section.
- **Nothing here deploys the subgraph services.** The pipeline delivers
  schemas; the ordering constraints in
  [§13](#13-deploy-ordering--the-thing-that-actually-breaks-production) assume
  some other pipeline deploys the code.

---

## 16. Versions pinned

| Component | Version |
|---|---|
| Hive CLI | 0.68.2 — flags verified against this |
| Hive Console (self-hosted) | `hive@15.0.1` |
| Hive Router | 0.3.16 |
| Hive Gateway | 2.15.10 |
| `@theguild/federation-composition` | 0.27.0 |
| GitHub Actions | `actions/checkout@v4`, `actions/upload-artifact@v4` |
