# GQL-104 — Schema-Automation Demo (the question the spike was really about)

The original ask: *"if my REST APIs' request/response shape changes, with
less or no changes can my code automatically update schema GraphQL files, and
can changed queries dynamically follow?"*

This was tested for real — not reasoned about — by adding a genuine field to
a REST contract and tracing it through both architectures end to end,
breaking and fixing things live to see the actual failure mode.

## The change

`mock-rest-apis/funds/server.js` and `mock-rest-apis/funds/openapi.yaml` both
got a new field, exactly as a service team would ship it:

```yaml
launchDate:
  type: string
  format: date
  nullable: true
  description: null for funds launched before this field was tracked
  example: "2012-03-01"
```

Non-breaking by construction (nullable, not in `required`) — two of the four
mock funds got real values, two stayed without it, to test null-handling
honestly rather than with a uniformly-populated fixture.

## Path A: Grafbase's REST-extension pipeline (the existing schema-gen tool)

```bash
npm run schema:generate
```

**Step 1 result — fully automatic, as designed:**

```diff
 type Fund @key(fields: "id") {
   ...
   sustainabilityLabel: SustainabilityLabel!
+  """null for funds launched before this field was tracked"""
+  launchDate: Date
 }
```

`schema-gen/generate.mjs` picked up the new OpenAPI property, inferred the
`Date` scalar from `format: date`, marked it nullable, and carried the
description through — zero hand-written GraphQL. `npm run schema:validate`
composed cleanly. This part of the pipeline works exactly as
[`../SCHEMA_GENERATION.md`](../SCHEMA_GENERATION.md) documents.

**Step 2 result — the finding this demo actually exists to surface:**

Querying the new field through the live (disposable, validation-only)
gateway:

```bash
curl http://127.0.0.1:5098/graphql -d \
  '{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { name launchDate } } } }"}'
```

```json
{"data":{"account":{"fundHoldings":[
  {"fund":{"name":"Global Equity Index","launchDate":null}},
  {"fund":{"name":"Green Bond Income","launchDate":null}},
  {"fund":{"name":"Cash Plus Reserve","launchDate":null}}
]}}}
```

**`null` — for a fund that has real data (`"2012-03-01"`) sitting right there
in the REST response.** Not an error. Not a warning in the gateway log.
Silently wrong.

**Root cause:** `schema-gen/manual/federation.graphql`'s `fund(id: ID!)`
lookup uses a jq `selection` that is an **explicit allow-list**:

```graphql
selection: """
{ id, isin, name, assetClass, currency, riskRating,
  ongoingChargePercent, oneYearReturnPercent, threeYearReturnPercent,
  sustainabilityLabel }
"""
```

Any field not named here is simply absent from what the REST extension
returns to the gateway — regardless of whether it's in the GraphQL type,
regardless of nullability. [`../SCHEMA_GENERATION.md`](../SCHEMA_GENERATION.md)
§5/§8 documents "the one manual coupling" as being about **non-null** fields
specifically (a missing required field errors at runtime, caught by
`schema:validate:e2e`). This demo shows the coupling is broader than
documented: **every** field needs the jq selection updated to actually
resolve, non-null or not — and for nullable fields, the failure is silent,
not caught by any existing validation step, because `null` is a
type-valid response.

**The fix** — one line added to the jq selection:

```diff
-        sustainabilityLabel
+        sustainabilityLabel,
+        launchDate
```

Re-running `npm run schema:generate` + the same query:

```json
{"data":{"account":{"fundHoldings":[
  {"fund":{"name":"Global Equity Index","launchDate":"2012-03-01"}},
  {"fund":{"name":"Green Bond Income","launchDate":"2018-06-15"}},
  {"fund":{"name":"Cash Plus Reserve","launchDate":null}}
]}}}
```

Correct now — real dates for the two funds that have them, genuine `null`
for the one that doesn't.

## Path B: The true-federation subgraphs (used by both Grafbase-federated and Hive Router)

`funds-subgraph`'s resolver has no jq shaping step — it returns the raw REST
JSON object and lets GraphQL's default resolver read matching field names off
it directly:

```js
Fund: {
  __resolveReference: (ref) => fetchFund(ref.id),   // returns the whole REST object
}
```

The change required was **one line in the subgraph's own SDL**, no resolver
code touched:

```diff
   sustainabilityLabel: SustainabilityLabel!
+  launchDate: Date
 }
+scalar Date
```

Tested at three levels, all correct immediately, no allow-list to update:

1. **The subgraph directly** (`curl localhost:3009/graphql`) — correct data.
2. **Grafbase, true-federation topology** (`localhost:5070`) — correct data,
   and notably `grafbase dev` picked up the subgraph schema change **without
   a restart** (its dev-mode file watching recomposed automatically).
3. **Hive Router** (`localhost:4000`) — required one explicit step this
   architecture always requires: `npm run compose` (recompose the supergraph
   SDL) + a container restart, since Hive Router only ever reads a static
   pre-composed file. Correct data after that.

## What this actually proves — and what it doesn't

**It's not a Grafbase-vs-Hive-Router finding.** Both gateways executed the
passthrough-subgraph topology correctly and identically. **It's an
architecture finding**: REST-extension-with-jq-shaping (what this repo's
original Grafbase PoC uses) has a strictly-more-manual, strictly-riskier
schema-drift story than hand-written-subgraph-with-passthrough-resolvers
(what both true-federation PoCs use) — because the REST-extension's shaping
step can silently drop a field, while the passthrough resolver physically
cannot (it returns everything the REST API returns; only the SDL gates what's
queryable, and an SDL gap is loud — `Cannot query field "X"` — not silent).

**What's still open:** neither path here is what the original ask
envisioned ("less or no changes"). Path A needs a human to update a jq
selection; Path B needs a human to write one line of SDL — both are
"detect and fix in under a minute," not "zero-touch." A tool that watches
OpenAPI diffs and auto-opens a PR for exactly this line (either the jq
selection or the SDL field) is the realistic automation target, not further
gateway evaluation — this is a tooling investment orthogonal to the
Grafbase-vs-Hive-Router choice. See the outcome doc's Next Steps.

Also open, and explicitly **not** tested here: a **breaking** change (a new
required field, a removed field, a type change). The spike plan called for
testing both; only the non-breaking case was executed in this session. A
breaking change would fail loudly in Path A (`schema:validate:e2e` catches
missing-required-field at composition or runtime) and would fail loudly in
Path B too (subgraph composition would reject a genuinely incompatible
change) — but this is inferred from the architecture, not verified
hands-on. Flagged as a follow-up.
