# The supergraph lifecycle — registry, CDN, runtime, client

**Repository:** `rest-demo` · branch `hive-final-poc`
**Date of investigation:** 2026-11-19
**Stack:** self-hosted Hive Console (`hive@15.0.1`), Hive Router 0.3.16, Hive Gateway 2.15.10, Hive CLI 0.68.2
**Related:** [`hive-router-poc/README.md`](../hive-router-poc/README.md) · [`SUPERGRAPH-CICD.md`](SUPERGRAPH-CICD.md)

> **Provenance.** Findings are labelled **[Verified]** (executed against this
> running stack on the date above), **[Documented]** (stated by the CLI's own
> `--help` or vendor docs, not exercised here) or **[Unverified]**. Nothing is
> asserted from memory. Versions are pinned throughout. Every command below was
> run; the outputs quoted are real outputs, not illustrations.

---

## Contents

- [TL;DR — the whole lifecycle](#tldr--the-whole-lifecycle)
- [1. Four different things get called "the schema"](#1-four-different-things-get-called-the-schema)
- [2. The four stages, and who owns each](#2-the-four-stages-and-who-owns-each)
- [3. What is automated and what is manual](#3-what-is-automated-and-what-is-manual)
- [4. Ports and runtimes](#4-ports-and-runtimes)
- [5. Stage 1 — change a subgraph](#5-stage-1--change-a-subgraph)
- [6. Stage 2 — compose locally and inspect the SDL](#6-stage-2--compose-locally-and-inspect-the-sdl)
- [7. Stage 3 — schema checks](#7-stage-3--schema-checks)
- [8. Stage 4 — publish to the registry](#8-stage-4--publish-to-the-registry)
- [9. Hive Console Laboratory, step by step](#9-hive-console-laboratory-step-by-step)
- [10. Stage 5 — the CDN: how a version becomes an artifact](#10-stage-5--the-cdn-how-a-version-becomes-an-artifact)
- [11. Stage 6 — point a runtime at the CDN](#11-stage-6--point-a-runtime-at-the-cdn)
- [12. Stage 7 — verify what a runtime is actually serving](#12-stage-7--verify-what-a-runtime-is-actually-serving)
- [13. Serving the CDN supergraph on :4000](#13-serving-the-cdn-supergraph-on-4000)
- [14. The automated end-to-end test](#14-the-automated-end-to-end-test)
- [15. Rollback](#15-rollback)
- [16. The complete manual walkthrough](#16-the-complete-manual-walkthrough)
- [17. Troubleshooting](#17-troubleshooting)
- [18. What this does not prove](#18-what-this-does-not-prove)
- [19. Versions pinned](#19-versions-pinned)

---

## TL;DR — the whole lifecycle

One field, added to a subgraph, followed all the way to a client query.
**[Verified]** — this is the shape of `scripts/test-supergraph-lifecycle.sh`,
which passed 28/28 assertions on this stack.

```
 you edit                 subgraphs/src/accounts.mjs
     |
     v  docker compose up -d --build accounts-subgraph
 the subgraph serves it    :4001  _service { sdl }
     |
     v  docker compose run --rm --build supergraph-compose
 LOCAL COMPOSITION         supergraph volume: supergraph.graphql + sdl/*.graphql
     |
     v  hive schema:check                     <-- the CI gate, writes nothing
 the gate passes
     |
     v  hive schema:publish
 THE REGISTRY              Hive Console composes, stores a new schema VERSION
     |
     v  (automatic, no command)
 THE CDN                   GET /artifacts/v1/<target-uuid>/supergraph
     |                     answers with x-hive-schema-version-id + etag
     |
     +---------------------------+---------------------------+
     v poll_interval 10s         v POLLING 10s               v  (nothing)
 Hive Router :4100          Hive Gateway :4110          Hive Router :4000
 hot-reloads in ~6s         hot-reloads silently        STALE until restarted
     |                           |                           |
     +---------------------------+---------------------------+
     v
 the client queries the new field
```

The last row is the entire point. `:4000` and `:4100` run **the same image
against the same subgraphs**. The only difference is where the supergraph comes
from, and that difference is what the registry-and-CDN path buys you: the
schema can change without anyone restarting, rebuilding or redeploying a
runtime.

---

## 1. Four different things get called "the schema"

Most confusion in this area is vocabulary, so fix it first.

| Term | What it actually is | Where it lives here |
|---|---|---|
| **Subgraph schema** | One service's own SDL, with federation directives (`@key`) | `subgraphs/src/<name>.mjs`, served by the subgraph at `_service { sdl }` |
| **Supergraph** | All subgraph schemas composed into one executable plan, carrying `@join__*` directives that record which subgraph owns each field | `supergraph.graphql` in the `supergraph` volume; the `supergraph` CDN artifact |
| **API schema** (public SDL) | The supergraph with federation plumbing stripped — what a client sees through introspection | `supergraph.public.graphql` locally; the `sdl` CDN artifact |
| **Schema version** | The registry's record of one successful publish-and-compose, identified by a UUID | `schema_versions` in Hive's Postgres; the `x-hive-schema-version-id` response header |

**[Verified]** The supergraph is what a runtime loads; the API schema is what a
client introspects. They are different documents of different sizes — on this
stack, 5,055 bytes against 2,228 for the same version. Comparing one to the
other and concluding "they do not match" is the most common false alarm in this
whole area.

---

## 2. The four stages, and who owns each

The request this document answers used "registry", "composition", "CDN" and
"gateway" fairly loosely. They are four separate things:

| Stage | Component | Responsibility | Fails how |
|---|---|---|---|
| **Composition** | `@theguild/federation-composition` 0.27.0 — locally in `compose/compose.mjs`, and again inside Hive Console | Turn N subgraph SDLs into one supergraph, or refuse | Non-zero exit with the conflicting types listed |
| **Registry** | Hive Console `server` | Store every published subgraph schema, compose them, keep version history, run checks | Publish succeeds but the version is marked not composable |
| **CDN distribution** | the same `server`, with `CDN_API=1` | Serve the composed artifacts over HTTP, authenticated by a CDN key, with a version id and an etag | 403 / 401 on the artifact route |
| **Runtime consumption** | Hive Router / Hive Gateway | Poll the artifact, swap the supergraph in memory, keep serving | `NO_SUPERGRAPH_AVAILABLE` on every query |

Local composition is not redundant with registry composition. It is the same
library, which is why a local failure predicts a registry failure — so you
compose locally first and never spend a CI round trip on a change that cannot
compose.

> **There is no CDN in the Hive Cloud sense.** The High-Availability CDN is a
> Hive Cloud feature. Self-hosted, the artifact **routes** are served by the
> `server` container itself. The routes are identical and the runtimes cannot
> tell the difference, but there is no edge, no POPs and no separate
> availability domain. See [§10](#10-stage-5--the-cdn-how-a-version-becomes-an-artifact)
> for what that does and does not mean, and for the two ways to put real
> distribution in front of it.

---

## 3. What is automated and what is manual

| Step | Automated? | How |
|---|---|---|
| Rebuild a subgraph after editing it | **Automated** | `docker compose up -d --build accounts-subgraph` |
| Compose the supergraph locally | **Automated** | `docker compose run --rm --build supergraph-compose` |
| Inspect the generated SDL | **Automated** | reads the shared volume; see [§6](#6-stage-2--compose-locally-and-inspect-the-sdl) |
| Schema check against the registry | **Automated** | `hive/check.sh` |
| Publish all three subgraphs | **Automated** | `hive/publish.sh` |
| Registry composition + new version | **Automatic** | happens inside Hive on publish; no command |
| CDN artifact publication | **Automatic** | same; the artifact route always serves the latest valid version |
| Runtime reload (`:4100`, `:4110`) | **Automatic** | polling, no restart |
| Runtime reload (`:4000`) | **Manual** | `docker compose restart hive-router` |
| Verify version / checksum / fields | **Automated** | `scripts/supergraph-version.sh` |
| Whole lifecycle, as a test | **Automated** | `scripts/test-supergraph-lifecycle.sh` |
| **Create the organization, project and target** | **MANUAL, once** | Console UI — README step 3 |
| **Create a registry access token** | **MANUAL, once** | Console UI — README step 4. Cannot be scripted; the token is shown once |
| **Create a CDN access token** | **MANUAL, once** | Console UI — README step 5 |
| **Set the Laboratory's endpoint** | **MANUAL, once** | Console UI — [§9](#9-hive-console-laboratory-step-by-step) |
| Approve a breaking change | **MANUAL** | Console UI, on the check's page |

The four manual steps are all one-time credential or tenancy setup. Everything
on the recurring path — the part CI would run — is scripted.

---

## 4. Ports and runtimes

| Port | Service | Supergraph source | Reloads on publish? |
|---|---|---|---|
| 4000 | `hive-router` | **file**, from the `supergraph` volume | No — restart required |
| 4100 | `hive-router-registry` | **CDN**, `source: hive` | Yes, ~6s **[Verified]** |
| 4110 | `hive-gateway-cdn` | **CDN**, `--hive-cdn-endpoint` | Yes, silently |
| 4010 | `gateway-router-runtime` | file (comparison runtime) | No |
| 4001/4002/4003 | the three subgraphs | n/a | n/a |
| 8080 | Hive Console UI | n/a | n/a |
| 8082 | Hive Console API **and the artifact routes** | n/a | n/a |

`:4110` is new in this work. It exists because the request asked specifically
how to make **Hive Gateway** consume the supergraph from the CDN rather than
from a local SDL file, and the answer turned out to be worth having as a
running service rather than a paragraph.

Start the two CDN-sourced runtimes:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile registry --profile gateway-cdn up -d
```

---

## 5. Stage 1 — change a subgraph

The example used throughout is `Account.holdingsCount`, an additive field
derived from data the accounts REST payload already returns. It is deliberately
additive: it demonstrates the happy path, and §15 covers what a breaking change
does instead.

**Why derived and not a new REST field:** `mock-rest-apis/` stands in for
systems this team does not own and is read-only in this repo. Deriving the
field in the resolver adds a field to the graph without adding an upstream
call — which is also why it is free.

Edit `hive-router-poc/subgraphs/src/accounts.mjs`. In `typeDefs`, inside
`type Account`:

```graphql
    "Percent; 0 when not contributing"
    contributionRate: Float!
    "Number of fund holdings. Derived from GET /accounts/{id}; no new REST call."
    holdingsCount: Int!
```

and in `createResolvers`, inside `Account`:

```js
    Account: {
      holdingsCount: (account) => (account.fundHoldings || []).length,

      // Entity resolver.
      __resolveReference: (reference) => rest.get(`/accounts/${encodeURIComponent(reference.id)}`),
    },
```

Rebuild and restart just that subgraph:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml up -d --build accounts-subgraph
```

**Verify the deployed service really has it** — not the file, the running
process. The federation `_service { sdl }` field is the subgraph's own account
of its schema, and it is the only source of truth at this stage:

```bash
curl -s http://localhost:4001/graphql -H 'content-type: application/json' -d '{"query":"{ _service { sdl } }"}' | grep -o 'holdingsCount: Int!'
```

Expected: `holdingsCount: Int!`. Nothing printed means the container is still
running the old image — the `--build` was skipped or failed.

---

## 6. Stage 2 — compose locally and inspect the SDL

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --build supergraph-compose
```

> **`--build` is not optional, and leaving it off fails silently.**
> **[Verified]** `compose/Dockerfile` does `COPY subgraphs/src ./subgraphs/src`,
> so the composer imports the subgraph modules *from its own image*. That is
> deliberate — it is what guarantees the published SDL and the running schema
> cannot drift. The cost is that composing without a rebuild composes the
> **old** modules, **exits 0**, and writes a supergraph with your change
> missing. This cost a debugging cycle while writing this document; the test
> script now always passes `--build`.

Composition writes three things into the `supergraph` Docker volume:

| File | What it is |
|---|---|
| `supergraph.graphql` | the supergraph — what `:4000` serves |
| `supergraph.public.graphql` | the API schema, federation plumbing stripped |
| `sdl/<name>.graphql` | per-subgraph SDL — **what gets published to the registry** |

Inspect what was actually written. The host-side copy of `supergraph.graphql`
goes stale; the volume is the truth:

```bash
docker run --rm -v hive-router-poc_supergraph:/v alpine cat /v/supergraph.graphql | grep -n -A1 holdingsCount
```

**[Verified]** output:

```
holdingsCount: Int! @join__field(graph: ACCOUNTS)
```

That `@join__field(graph: ACCOUNTS)` is the composition doing its job: the
supergraph records which subgraph owns the field, which is how the router knows
where to send the sub-request. A field with no `@join__field` is owned by every
subgraph that declares it.

List everything in the volume:

```bash
docker run --rm -v hive-router-poc_supergraph:/v alpine ls -la /v /v/sdl
```

---

## 7. Stage 3 — schema checks

A check composes your candidate schema against **every other registered
subgraph** and diffs the result against the last published version. It writes
nothing, and its exit code is non-zero on a breaking change — which is what
makes it a CI gate rather than a report.

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/check.sh
```

**[Verified]** output for the additive field:

```
--- checking accounts  (/sdl/sdl/accounts.graphql)
✔ No changes
View full report:
http://localhost:8080/sw/insurance/development/checks/4b367e08-46eb-495a-9125-086f265818ad
    no breaking changes
...
All three subgraphs check clean against the registry.
```

Two things worth noticing:

- `✔ No changes` refers to the **API schema**, not to your source. Adding a
  field that composes cleanly and breaks no client is, from the registry's
  point of view, not a change worth flagging.
- The check produces a **URL into the Console**. That link is the artefact a
  reviewer wants on a pull request, and §SUPERGRAPH-CICD puts it there.

Check one subgraph against a file that is not the composed one — useful for
trying a change before you even build it:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm -v "$PWD/hive-router-poc/tmp:/work/tmp" hive-cli hive/check.sh accounts /work/tmp/candidate.graphql
```

To see a check **fail**, make a breaking change instead — rename a field, or
change `holdingsCount: Int!` to `String!`. The check then exits non-zero and
the report lists the breaking changes. Breaking changes can be approved in the
Console on the check's own page; that approval is **manual** by design.

---

## 8. Stage 4 — publish to the registry

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/publish.sh
```

This publishes all three subgraph SDLs from the volume, each with the URL the
router will use to reach it. **[Verified]** the URL matters: Hive bakes it into
the composed supergraph, so it must resolve on the router's network
(`http://accounts-subgraph:4001/graphql`), never `localhost`.

What publishing does, in order:

1. stores the subgraph SDL as a new revision of that service
2. composes it against the other registered subgraphs
3. if composition succeeds, creates a new **schema version** and marks it valid
4. the artifact routes immediately begin serving it

Step 4 needs no command and has no deploy step. That is the whole value
proposition of the registry-as-delivery-mechanism.

### A note on tokens, because they are not interchangeable

**[Verified]** on this stack there are two distinct credentials and a third
kind that does not exist yet:

| Credential | Used for | Works for |
|---|---|---|
| `HIVE_TOKEN` — a **target registry token** (`tokens` table) | `hive schema:check`, `schema:publish` | the CLI's registry operations |
| `HIVE_CDN_KEY` — a **CDN access token** (`cdn_access_tokens` table) | the artifact routes | `X-Hive-CDN-Key` on `/artifacts/v1/...` |
| An **organization access token** (`organization_access_tokens` table) | the public GraphQL API at `:8082/graphql` | **none created here** |

The third row is a real trap. The public GraphQL API rejects the registry token
outright — **[Verified]**, a bare `{ __typename }` with the registry token in
either `X-API-Token` or `Authorization: Bearer` returns
`{"errors":[{"message":"Invalid token provided"}]}`, while the same query with
**no** auth header succeeds. So do not try to read schema versions out of the
public API with `HIVE_TOKEN`; it will look like the token is broken when it is
simply the wrong kind. Use the CDN response headers instead
([§12](#12-stage-7--verify-what-a-runtime-is-actually-serving)) — they need
only the CDN key, and they are what the runtimes themselves rely on.

---

## 9. Hive Console Laboratory, step by step

`http://localhost:8080/sw/insurance/development/laboratory`

The Laboratory is the Console's built-in GraphiQL. It always knows the schema
the registry has composed for that target, which makes it the fastest way to
confirm a publish landed — faster than curling a runtime, because it needs no
runtime at all.

### What it gives you

**[Verified]** from the tables this release creates
(`document_collections`, `document_collection_documents`,
`document_preflight_scripts`), the Laboratory in `hive@15.0.1` has three
features that matter:

| Feature | Backed by | What it is for |
|---|---|---|
| Editor with the target's schema | the registry's latest valid version | autocomplete and validation against what is actually published |
| **Collections** of saved operations | `document_collections` | the queries your team keeps re-running, shared per target |
| **Preflight script** | `document_preflight_scripts` | JavaScript run before each request — typically to mint or refresh an auth header |

### Step by step

1. **Sign in** at `http://localhost:8080` and open the target
   `sw` → `insurance` → `development`, then the **Laboratory** tab. The URL
   above goes there directly.

2. **Confirm the schema is the published one.** Open the Docs/Explorer pane and
   look for the field you just published — `Account.holdingsCount`. If it is
   there, the registry has composed your publish. This is a check on the
   *registry*, not on any runtime.

3. **Write a query.** The editor validates against the target's schema, so a
   typo is caught before you run anything:

   ```graphql
   query AccountOverview {
     account(id: "acct-1001") {
       holderName
       holdingsCount
       policies { policyNumber }
     }
   }
   ```

4. **Point the Laboratory at a real endpoint before pressing Run.**
   This is the step people miss. **[Verified]** the endpoint is a per-target
   setting — the `targets.graphql_endpoint_url` column — and on this stack it
   is `NULL` for all three targets:

   ```bash
   docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml exec db psql -U postgres -d registry -c "select name, coalesce(graphql_endpoint_url,'<null>') as laboratory_endpoint from targets order by name"
   ```

   Until it is set, the Laboratory can validate and autocomplete but has
   nowhere to send a request. Set it in **Target → Settings** to a
   browser-reachable address:

   ```
   http://localhost:4110/graphql
   ```

   > **Use `:4110` (Gateway), not `:4100` (Router), and here is why.**
   > **[Verified]** Hive Router 0.3.16 answers `OPTIONS /graphql` with
   > **405 Unsupported HTTP method** and sends no `Access-Control-*` headers at
   > all, so a browser request from the Console's origin (`localhost:8080`)
   > fails its CORS preflight. Hive Gateway 2.15.10 on the same supergraph
   > answers the preflight **204** with
   > `access-control-allow-origin: http://localhost:8080`. Both serve the
   > identical schema from the identical CDN artifact, so for a browser-driven
   > tool the gateway is simply the one that works.
   >
   > Reproduce both in one go:
   > ```bash
   > for p in 4100 4110; do echo "== :$p"; curl -s -o /dev/null -D - -X OPTIONS "http://localhost:$p/graphql" -H 'Origin: http://localhost:8080' -H 'Access-Control-Request-Method: POST' | grep -i -E '^HTTP|access-control'; done
   > ```
   > It is also a `localhost` address because the request leaves **your
   > browser**, not the server — the exact opposite of `HIVE_CDN_ENDPOINT`,
   > which must be the in-network `server:3001` form because it is fetched by a
   > container. Mixing these two up is the single most common configuration
   > error on this stack.

5. **Run it.** Expected: `"holdingsCount": 3` for `acct-1001`, which has three
   fund holdings.

6. **Save it into a collection** so the next person does not retype it. Shared
   per target, which makes it a decent home for a demo script.

7. **Optional — a preflight script** if your endpoint needs auth. The POC's
   runtimes need none, so this stays empty here.

### What the Laboratory does not tell you

It reads the **registry**. A green Laboratory run against the registry's schema
says nothing about whether `:4000` has restarted, or whether a runtime in
another environment has polled yet. For that, see the next two sections — this
distinction is the reason §12 exists at all.

---

## 10. Stage 5 — the CDN: how a version becomes an artifact

No command publishes to the CDN. **[Verified]** the artifact routes always
serve the latest valid composed version, so a successful `schema:publish` *is*
the CDN deployment.

### The routes

With `CDN_API=1` (which the vendored community Compose file sets), `server`
serves:

```
GET <server>/artifacts/v1/<TARGET_UUID>/<artifact>
     header: X-Hive-CDN-Key: <cdn access token>
```

**[Verified]** on `hive@15.0.1`, probing every artifact name the CLI accepts:

| Artifact | Status | Body |
|---|---|---|
| `supergraph` | **200** | the supergraph, `@join__*` directives and all — what a runtime loads |
| `sdl` | **200** | the API schema — what a client introspects |
| `services` | **200** | JSON array of `{name, sdl, url}` per subgraph |
| `metadata` | **404** | not served by this self-hosted release |

Fetch them with the CLI rather than curl if you prefer — **[Verified]** this
works against the self-hosted endpoint:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --entrypoint hive hive-cli artifact:fetch --artifact supergraph --cdn.endpoint "$(sed -n 's/^HIVE_CDN_ENDPOINT=//p' hive-router-poc/.env | tail -1)" --cdn.accessToken "$(sed -n 's/^HIVE_CDN_KEY=//p' hive-router-poc/.env | tail -1)"
```

> **The endpoint must end with the target's UUID, never its name.**
> **[Verified]** with one valid key: `…/artifacts/v1/development` → **403**,
> `…/artifacts/v1/cc74f9a2-dbd0-4ba6-bcbf-4ece2b2d0a4a` → **200**. Because the
> wrong path answers 403 rather than 404, every instinct says the *key* is
> wrong. Get the UUIDs with:
> ```bash
> docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml exec db psql -U postgres -d registry -tAc 'select id, name from targets order by name'
> ```

### Versioning and checksums — what the headers give you

This is the part that makes "is the Gateway serving the latest supergraph?" an
answerable question. **[Verified]** every artifact response carries:

```
x-hive-schema-version-id: c72f8717-f2d1-4177-969e-8a3a7876e164
etag: "fd3f1b3034dbd4a6b412b14ca61301cd"
content-type: text/plain
content-length: 5197
```

| Header | Identifies | Changes when |
|---|---|---|
| `x-hive-schema-version-id` | the **publish event** — the registry's own version UUID | every successful publish, even if the resulting schema is byte-identical |
| `etag` | the **content** | only when the artifact bytes change |

**[Verified] and worth internalising:** after the test's revert republished the
original schema, the version id was a brand-new `3590d700-0e89-…` while the
etag came back to the exact earlier value `"cf9fc47a9cc89ac6ae4b08f4dd7a3f81"`.
So:

- **the version id is your audit trail** — it tells you *which publish*
- **the etag is your cache key** — it tells you *which bytes*

A deploy that needs to know "has the schema actually changed?" should compare
etags. A release note that needs to say "we shipped version X" should quote the
version id. Both are one `curl` away:

```bash
docker run --rm --network hive curlimages/curl:8.11.1 -sS -D - -o /dev/null -H "X-Hive-CDN-Key: $(sed -n 's/^HIVE_CDN_KEY=//p' hive-router-poc/.env | tail -1)" "$(sed -n 's/^HIVE_CDN_ENDPOINT=//p' hive-router-poc/.env | tail -1)/supergraph"
```

### Putting real distribution in front of it

The request offered a lightweight Nginx CDN simulation as an alternative. It is
not needed, because this repo already has **two** working distribution
channels, and a third would add a moving part without adding a finding:

| Channel | Where | Status |
|---|---|---|
| Hive artifact routes (`source: hive`) | `hive-router-poc`, this document | **[Verified]** |
| S3-compatible object storage (`source: storage`) | `hive-registry-poc` | **[Verified]** in that POC — and note `poll_interval` defaults to **disabled** under `source: storage`, so a router there loads once and silently never reloads |
| An HTTP cache in front of the artifact route | not built | **[Unverified]** |

If you do want the third — for example to demonstrate edge caching, or to
survive the registry being briefly down — the shape is a reverse proxy with
`proxy_cache` in front of `server:3001`, keyed on the path and the
`X-Hive-CDN-Key` header, honouring the `etag`. Both runtimes would then be
pointed at the proxy instead. That is a genuinely different reliability story
and is **not claimed here**, because it was not built or exercised.

---

## 11. Stage 6 — point a runtime at the CDN

### 11a. Hive Router — `source: hive`

`router/router.registry.config.yaml`, already in the repo:

```yaml
supergraph:
  source: hive
  endpoint:
    expression: env("HIVE_CDN_ENDPOINT")
  key:
    expression: env("HIVE_CDN_KEY")
  poll_interval: 10s
  request_timeout: 30s
  connect_timeout: 10s
  retry_policy:
    max_retries: 10
```

`poll_interval` is set explicitly even though **[Documented]** `source: hive`
defaults to 10s, because the sibling `source: storage` defaults to polling
*disabled* and the two configs should not read differently on the one setting
whose default is dangerous.

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile registry up -d hive-router-registry
```

**[Verified]** the log line that means it worked:

```
supergraph loaded successfully with changes, updating...
```

### 11b. Hive Gateway — `--hive-cdn-endpoint`

**[Verified]** Hive Gateway 2.15.10 consumes the same artifact endpoint
natively. The flags are `--hive-cdn-endpoint` and `--hive-cdn-key`, and both
have environment equivalents (`HIVE_CDN_ENDPOINT`, `HIVE_CDN_KEY`) — which
means **no positional supergraph path is needed**; with those two variables set,
`hive-gateway supergraph` fetches from the CDN instead of reading a file.

The new service in `docker-compose.console.yml`:

```yaml
  hive-gateway-cdn:
    profiles: ["gateway-cdn"]
    image: ghcr.io/graphql-hive/gateway:latest
    command: ["supergraph", "--host", "0.0.0.0", "--port", "4000"]
    ports: ["${CDN_GATEWAY_PORT:-4110}:4000"]
    networks: [default, stack]
    environment:
      HIVE_CDN_ENDPOINT: ${HIVE_CDN_ENDPOINT:-UNSET-see-README-step-5}
      HIVE_CDN_KEY: ${HIVE_CDN_KEY:-UNSET-see-README-step-5}
      POLLING: ${CDN_GATEWAY_POLLING:-10s}
```

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile gateway-cdn up -d hive-gateway-cdn
```

**[Verified]** the log lines that mean it worked:

```
INF Using Hive CDN endpoint http://server:3001/artifacts/v1/cc74f9a2-dbd0-4ba6-bcbf-4ece2b2d0a4a
INF Loading supergraph from Hive CDN
INF Listening on http://localhost:4000
```

> **[Verified] The gateway reloads silently.** The router announces each swap;
> the gateway logs *nothing at all* when it picks up a new supergraph. While
> writing this document that briefly looked like a bug — the gateway appeared
> stuck on the previous schema after a revert — and it was simply a poll
> interval away from being correct, with no log line to say so. Verify the
> gateway by querying it or by `scripts/supergraph-version.sh`, never by
> reading its log.

### Both networks, and why

Both CDN-sourced runtimes join two Docker networks: `default` to reach the
subgraphs, `stack` to reach `server:3001` for the artifact. A runtime on only
one of them fails in a way that reads like the other problem.

---

## 12. Stage 7 — verify what a runtime is actually serving

### The problem

**[Verified]** Hive Router 0.3.16 has **no endpoint that reports its loaded
supergraph**. `/health` and `/readiness` return an empty `200`; `/version`,
`/metrics` and every other path return the router's HTML landing page, so a
`200` from them means nothing. Hive Gateway 2.15.10 is the same. There is
nothing to read a version out of — do not go looking for one.

So the question is answered by comparing schemas, in three layers:

| Layer | What it proves | Cost |
|---|---|---|
| 1. `x-hive-schema-version-id` | which publish the **CDN** is serving | one request |
| 2. `etag` / `sha256` of the body | which **bytes** the CDN is serving | one request |
| 3. **canonical fingerprint** of the runtime's introspection vs the CDN's `sdl` | which schema the **runtime** is serving | an introspection plus two parses |

Only layer 3 proves delivery. Layers 1 and 2 describe the artifact and say
nothing about any runtime.

### The instrumentation

`scripts/supergraph-version.sh` does all three. The hard part is layer 3: the
CDN's `sdl` artifact and a runtime's introspection are printed by different
code paths, so they differ in declaration order and whitespace even when the
schema is identical. A byte comparison is useless and a line-based normaliser
gets descriptions wrong — a triple-quoted one-liner like
`"""0 when not applicable"""` defeats any toggle-based parser, which is exactly
the bug the first attempt had.

`scripts/lib/schema-fingerprint.mjs` therefore runs both sides through
`graphql-js` — parse, `lexicographicSortSchema`, `printSchema`, sha256 — inside
the existing composer image. After that, equal bytes really do mean equal
schemas.

```bash
./scripts/supergraph-version.sh
```

**[Verified]** output on the published-and-reverted stack:

```
CDN artifact
  endpoint            http://server:3001/artifacts/v1/cc74f9a2-dbd0-4ba6-bcbf-4ece2b2d0a4a
  schema version id   3590d700-0e89-4be4-b7bf-b49c152c2431
  etag                "cf9fc47a9cc89ac6ae4b08f4dd7a3f81"
  supergraph          5055 bytes  sha256 45673b1f7a4a60bc…
  api sdl             2228 bytes  sha256 93e798b5e25f055d…
  api fingerprint     80fde3bcca55650024641d594c8ee16c91df2160d9c3d7d1ea267b2b84b1d9d6  2137 bytes  9 types  50 fields

Runtimes
  service                  source   fingerprint  verdict
  ------------------------ -------- ------------ -------
  hive-router              file     80fde3bcca55… MATCHES CDN
  hive-router-registry     cdn      80fde3bcca55… MATCHES CDN
  hive-gateway-cdn         cdn      80fde3bcca55… MATCHES CDN

Every CDN-sourced runtime is serving the published supergraph.
```

And with the extra field published, **[Verified]** the fingerprint moves and
the field count goes up — `3efcceaff33c8744…  2250 bytes  9 types  51 fields`.
That delta, 50 → 51 fields, is the "newly introduced field" check in its
cheapest possible form.

Other modes:

```bash
./scripts/supergraph-version.sh --require hive-router-registry   # exit 1 unless that one matches
./scripts/supergraph-version.sh --diff hive-router               # canonical SDL diff
./scripts/supergraph-version.sh --json                           # for CI
```

A **file**-sourced runtime that differs is reported, not failed — that is the
normal state between a publish and a restart. A **CDN**-sourced runtime that
differs sets the exit code, because that is a delivery failure.

### Verifying a new field by hand

Three independent checks, cheapest first:

```bash
# 1. is it in the published API schema at all?
./scripts/supergraph-version.sh | grep 'api fingerprint'

# 2. does the runtime's introspection have it?
curl -s http://localhost:4100/graphql -H 'content-type: application/json' -d '{"query":"{ __type(name:\"Account\"){ fields { name } } }"}' | grep -o holdingsCount

# 3. does it return data?
curl -s http://localhost:4100/graphql -H 'content-type: application/json' -d '{"query":"query { account(id:\"acct-1001\") { holderName holdingsCount } }"}'
```

**[Verified]** step 3 returns
`{"data":{"account":{"holderName":"Anika Rao","holdingsCount":3}}}`.

Check 2 passing while check 3 errors means the schema arrived but the subgraph
behind it did not — the classic symptom of publishing before deploying.

---

## 13. Serving the CDN supergraph on :4000

The request asked to verify the CDN-fed runtime at
`http://localhost:4000/graphql`. By default `:4000` is the **file**-sourced
router, deliberately: the base POC must keep working with no registry at all.

Rather than change that default, the registry router's host port is now
overridable, so the CDN-sourced runtime can take over `:4000` for a
like-for-like demonstration:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml stop hive-router
REGISTRY_ROUTER_PORT=4000 docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile registry up -d --force-recreate hive-router-registry
curl -s http://localhost:4000/graphql -H 'content-type: application/json' -d '{"query":"query { account(id:\"acct-1001\") { holderName } }"}'
```

Put it back:

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile registry up -d --force-recreate hive-router-registry
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml start hive-router
```

`CDN_GATEWAY_PORT` does the same for the gateway. The defaults are unchanged,
so nothing in the existing README or demo breaks.

For most purposes, though, keeping both up on their own ports is more
instructive than moving one — having the stale `:4000` next to the live `:4100`
is what makes the difference visible.

---

## 14. The automated end-to-end test

```bash
./scripts/test-supergraph-lifecycle.sh
```

**[Verified] 28 passed, 0 failed** on this stack. Twelve stages:

| Stage | Asserts |
|---|---|
| 1 Preflight | `.env` complete; endpoint ends with a UUID; services up; CDN reachable; the field is **absent** to begin with |
| 2 Add the field | the edit applied; the subgraph rebuilt; `_service { sdl }` reports it |
| 3 Compose | exit 0; the field is in `sdl/accounts.graphql` **and** `supergraph.graphql`; prints the `@join__field` line |
| 4 Check | all three clean; prints the Console report URL |
| 5 Publish | all three published |
| 6 CDN | `x-hive-schema-version-id` **changed**; the artifact contains the field; prints etag and sha256 |
| 7 `:4100` | the field appears with **no restart**; a real query returns data |
| 8 `:4000` | the field is **absent** — the stale window, asserted rather than ignored |
| 9 `:4000` after restart | the field appears; a real query returns data |
| 10 `:4110` | Hive Gateway serves it from the same endpoint |
| 11 Probe | every CDN-sourced runtime matches the canonical fingerprint |
| 12 Revert | source restored, republished, and the field is gone from all runtimes |

Stage 8 is the one worth reading the code for. The supergraph volume already
holds the new schema at that point, so the only reason `:4000` is stale is that
it read the file at startup and nothing has told it to read again. The test
asserts that staleness, because it is the behaviour the registry path exists to
remove.

```bash
./scripts/test-supergraph-lifecycle.sh --dry-run        # stop after schema:check, change nothing remote
./scripts/test-supergraph-lifecycle.sh --keep           # leave the field live, for a demo
./scripts/test-supergraph-lifecycle.sh --field myField  # a different field name
./scripts/test-supergraph-lifecycle.sh --skip-gateway
```

**What it mutates:** `subgraphs/src/accounts.mjs` (restored unless `--keep`),
the accounts-subgraph image, the `supergraph` volume, and the Hive registry —
which gains schema versions. Registry history is append-only and the test does
not remove it; the revert is a republish, exactly as a production rollback
would be.

---

## 15. Rollback

The registry is append-only. There is no "delete that version" — and that is
the right design, because the audit trail is the point.

| Approach | How | Status |
|---|---|---|
| **Republish the previous SDL** | check out the old subgraph source, recompose, `hive/publish.sh` | **[Verified]** — this is what the test's stage 12 does, and the CDN-sourced runtimes follow within a poll interval with no restart |
| **Promote a known-good version** | `hive schema:promote --version <id> --to <org/project/target>` | **[Documented]** from the CLI's own `--help`; the version "must be within the same project as the target". Not exercised here |
| **Delete a subgraph from the target** | `hive schema:delete <service> --dryRun`, then `--confirm` | **[Documented]**. `--dryRun` reports without acting; use it first |

Republishing is the one to reach for. It needs no new concepts, it is identical
to rolling forward, and **[Verified]** the CDN then issues a *new version id*
with the *old etag* — which is precisely the signal a deployment system wants:
new event, known-good bytes.

A rollback does **not** roll back the subgraph *services*. Publishing the old
schema while the new code is still deployed leaves fields in the graph that the
services no longer back, and vice versa. Deploy order matters: additive schema
after the code, removals before it.

---

## 16. The complete manual walkthrough

Everything above, in order, with nothing skipped. **Run every one of these
from the repository root** — each block is a single, self-contained,
copy-pasteable command, and none of them changes your working directory.

> **[Verified]** These do not need `cd hive-router-poc` even though the
> credentials live in `hive-router-poc/.env`. Compose takes its *project
> directory* from the directory of the first `-f` file and loads `.env` from
> there, so `-f hive-router-poc/docker-compose.yml` picks up that `.env`
> whatever your shell's current directory is. Commands that read the file
> themselves — the `sed` one-liners that pull out a key — do need the
> `hive-router-poc/.env` path, and have it.

**0. Preconditions** — the stack up, including the registry profile, and `.env`
holding `HIVE_TOKEN`, `HIVE_TARGET`, `HIVE_CDN_ENDPOINT`, `HIVE_CDN_KEY` (README
steps 1–5).

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile registry --profile gateway-cdn up -d
```

**1. Record the starting point.**

```bash
./scripts/supergraph-version.sh
```

**2. Edit the subgraph.** Add `holdingsCount` to `type Account` in
`hive-router-poc/subgraphs/src/accounts.mjs`, plus its resolver — see
[§5](#5-stage-1--change-a-subgraph).

**3. Rebuild the subgraph.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml up -d --build accounts-subgraph
```

**4. Confirm the running service has it.**

```bash
curl -s http://localhost:4001/graphql -H 'content-type: application/json' -d '{"query":"{ _service { sdl } }"}' | grep -o 'holdingsCount: Int!'
```

**5. Compose locally — `--build` or it composes the old modules.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --build supergraph-compose
```

**6. Inspect the generated supergraph.**

```bash
docker run --rm -v hive-router-poc_supergraph:/v alpine cat /v/supergraph.graphql | grep -A1 holdingsCount
```

**7. Inspect the per-subgraph SDL that will be published.**

```bash
docker run --rm -v hive-router-poc_supergraph:/v alpine cat /v/sdl/accounts.graphql | grep -B2 -A2 holdingsCount
```

**8. Schema check — the gate.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/check.sh
```

**9. Publish.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/publish.sh
```

**10. Watch the CDN issue a new version id.**

```bash
docker run --rm --network hive curlimages/curl:8.11.1 -sS -D - -o /dev/null -H "X-Hive-CDN-Key: $(sed -n 's/^HIVE_CDN_KEY=//p' hive-router-poc/.env | tail -1)" "$(sed -n 's/^HIVE_CDN_ENDPOINT=//p' hive-router-poc/.env | tail -1)/supergraph"
```

**11. Confirm the artifact carries the field.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --entrypoint hive hive-cli artifact:fetch --artifact supergraph --cdn.endpoint "$(sed -n 's/^HIVE_CDN_ENDPOINT=//p' hive-router-poc/.env | tail -1)" --cdn.accessToken "$(sed -n 's/^HIVE_CDN_KEY=//p' hive-router-poc/.env | tail -1)" | grep -A1 holdingsCount
```

**12. Watch the registry-sourced router reload, without restarting it.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml --profile registry logs -f --tail 5 hive-router-registry
```

Expect `supergraph loaded successfully with changes, updating...` within the
poll interval, then Ctrl-C.

**13. Query the new field through the CDN-sourced router.**

```bash
curl -s http://localhost:4100/graphql -H 'content-type: application/json' -d '{"query":"query { account(id:\"acct-1001\") { holderName holdingsCount } }"}'
```

**14. Prove the file-sourced router is still on the old schema.**

```bash
curl -s http://localhost:4000/graphql -H 'content-type: application/json' -d '{"query":"query { account(id:\"acct-1001\") { holdingsCount } }"}'
```

Expect a validation error naming `holdingsCount` — this is the moment the whole
exercise is about.

**15. Restart it and watch it catch up.**

```bash
docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml restart hive-router && sleep 5 && curl -s http://localhost:4000/graphql -H 'content-type: application/json' -d '{"query":"query { account(id:\"acct-1001\") { holderName holdingsCount } }"}'
```

**16. Same artifact through Hive Gateway.**

```bash
curl -s http://localhost:4110/graphql -H 'content-type: application/json' -d '{"query":"query { account(id:\"acct-1001\") { holderName holdingsCount } }"}'
```

**17. Verify versions, checksums and fingerprints together.**

```bash
./scripts/supergraph-version.sh
```

**18. Run it in the Laboratory** at
`http://localhost:8080/sw/insurance/development/laboratory` — see
[§9](#9-hive-console-laboratory-step-by-step), including the endpoint setting.

**19. Roll back by republishing.**

```bash
git checkout -- hive-router-poc/subgraphs/src/accounts.mjs && docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml up -d --build accounts-subgraph && docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --build supergraph-compose && docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm hive-cli hive/publish.sh && docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml restart hive-router
```

**20. Confirm you are back where you started.**

```bash
./scripts/supergraph-version.sh
```

---

## 17. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `NO_SUPERGRAPH_AVAILABLE` on `:4100` | the router never obtained an artifact | read its log; the HTTP status there names the cause (below) |
| `403` in the router log | `HIVE_CDN_ENDPOINT` ends with the target **name**, or the key is scoped to another target | use the target UUID — [§10](#10-stage-5--the-cdn-how-a-version-becomes-an-artifact) |
| `401` in the router log | the CDN key was issued before `CDN_AUTH_PRIVATE_KEY` was last regenerated | reissue the CDN token in the Console |
| `404` in the router log | wrong host or path prefix | the route is `/artifacts/v1/<uuid>/supergraph` |
| DNS / connection refused in the router log | `localhost:8082` used instead of `server:3001` | the router is a container; use the in-network form |
| `RejectedByCircuitBreaker` | not a new fault — the router backing off after repeated failures | fix the error logged above it; ignore this line |
| Composition exits 0 but the change is missing | the composer image was not rebuilt | always `run --rm --build supergraph-compose` |
| The field is in the registry but `:4000` 400s on it | `:4000` reads the file at startup only | `docker compose restart hive-router` |
| The gateway looks stuck on the old schema | it reloads **silently**, a poll behind the router | query it, or run `scripts/supergraph-version.sh`; do not read its log |
| `Invalid token provided` from `:8082/graphql` | the registry token is not an organization access token | don't use the public API for this; use the CDN headers |
| Laboratory validates but cannot Run | `targets.graphql_endpoint_url` is NULL | set the target's endpoint — [§9](#9-hive-console-laboratory-step-by-step) step 4 |
| Laboratory Run fails with a CORS error | pointed at `:4100`; the router sends no CORS headers | point it at `:4110` (Gateway) |
| `hive introspect http://hive-router:4000/graphql` → ENOTFOUND | `hive-cli` was on the `stack` network only | fixed: it now joins `default` too |
| `hive whoami` rejects the token | with no `--registry.endpoint` it asks Hive **Cloud** | pass `--registry.endpoint http://server:3001/graphql`, and note whoami still wants an org token |
| Console login shows "Failed to fetch" | `server` never started — usually a drifted Postgres password | `./hive-console/sync-db-password.sh`; never `down -v` |

---

## 18. What this does not prove

Named explicitly, because the verified parts are only worth trusting if the
gaps are too.

- **No real CDN.** Self-hosted Hive serves the artifact *routes* from the
  `server` container. There is no edge, no POPs, no independent availability
  domain. If `server` is down, so is schema delivery to every CDN-sourced
  runtime. Mitigating that is the untested third row in
  [§10](#10-stage-5--the-cdn-how-a-version-becomes-an-artifact).
- **`hive schema:promote` was not exercised.** Rollback here is verified only
  by republishing.
- **The Nginx caching layer was not built.** Its shape is described; nothing
  about it is claimed.
- **No multi-environment promotion.** `staging` and `production` targets exist
  but hold no schemas; everything here ran against `development`.
- **Usage-based checks were not exercised.** Hive can gate a breaking change on
  whether real traffic uses the field, which needs the runtimes to report usage;
  that is not wired up, so every check here was schema-only.
- **The `metadata` artifact 404s** on this release. If something needs it, that
  is a gap in the self-hosted build, not a configuration error.
- **Load and failure behaviour untested.** Nobody measured what a runtime does
  when the artifact endpoint goes away mid-poll, or how stale it is willing to
  run.
- **One target, one project, one organization.** Nothing here says how this
  behaves across many.

---

## 19. Versions pinned

| Component | Version | Source of the number |
|---|---|---|
| Hive Console (self-hosted) | `hive@15.0.1` | `HIVE_VERSION` in `.env`; vendored community Compose file |
| Hive Router | **0.3.16** | `org.opencontainers.image.version` on `ghcr.io/graphql-hive/router:latest`, as pulled |
| Hive Gateway | **2.15.10** | `hive-gateway supergraph --version`, and its own startup log |
| Hive CLI | 0.68.2 | pinned in `hive/Dockerfile` |
| `@theguild/federation-composition` | ^0.27.0 | `compose/package.json` |
| `graphql` | ^16.12.0 | `compose/package.json` |
| Federation spec | v2.3 | the `@link` in each subgraph's `typeDefs` |
| PostgreSQL | 16.4-alpine | vendored community Compose file |
| curl image used by the scripts | `curlimages/curl:8.11.1` | `scripts/*.sh` |

Note the router version: earlier notes in this repository say 0.3.12 and 0.3.14.
Both are stale — the image tracked by `:latest` on this machine reports
**0.3.16**, and both running routers were created from it. Re-check with:

```bash
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' ghcr.io/graphql-hive/router:latest
```
