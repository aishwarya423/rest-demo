# Swagger → GraphQL Schema Generation

How this repo generates its Grafbase `schema.graphql` from the Swagger (OpenAPI)
contracts owned by the three mock REST services.

> **Background:** Grafbase's current Gateway + REST-extension architecture has
> **no native Swagger→SDL generator** (the old `connector.OpenAPI` belonged to
> the deprecated `grafbase.config.ts` platform). So this repo uses a small
> custom scaffolder — see `notes/schema-generation/prompt.md` for the full
> analysis of the alternatives (OpenAPI Generator, IBM openapi-to-graphql,
> GraphQL Mesh) and why they were rejected.

---

## 1. The big picture

```
mock-rest-apis/accounts/openapi.yaml ─┐   (Swagger = source of truth,
mock-rest-apis/funds/openapi.yaml    ─┤    co-located with each service,
mock-rest-apis/policies/openapi.yaml ─┘    also served at /openapi.yaml)
                 │
                 ▼  npm run schema:generate
        schema-gen/generate.mjs  ←── schema-gen/config.json (excludes, directive injection)
                 │
                 ▼ writes (OVERWRITES every run)
        schema-gen/generated/
          _shared.graphql          custom scalars (Date)
          accounts.types.graphql   Account, FundHolding + enums
          funds.types.graphql      Fund + enums
          policies.types.graphql   Policy + enums
                 │
                 │  concatenated with (NEVER touched by the generator)
                 │  schema-gen/manual/header.graphql      @link + @restEndpoint
                 │  schema-gen/manual/federation.graphql  Query, @rest wiring, joins
                 ▼
        schema-gen/schema.generated.graphql   ← the composed candidate schema
                 │
                 ▼  npm run schema:promote  (explicit, reviewed step)
        schema.graphql              ← what grafbase.toml actually loads
```

**The one rule:** `generated/` is disposable output — regenerating overwrites
it. `manual/` is where humans work. The two only meet in the composed file.

## 2. Why this split?

A Swagger spec describes **one service's data shapes**. It cannot express what
makes this graph valuable — that `FundHolding.fundId` is a foreign key into the
funds service, that `Account.policies` requires a REST call to a *different*
service, or which fields should be hidden (`@inaccessible`). So:

| Layer | Owner | Contents |
|---|---|---|
| `mock-rest-apis/*/openapi.yaml` | service teams | models: fields, types, enums, required/nullable |
| `schema-gen/generated/` | the generator | GraphQL mirror of those models — never hand-edited |
| `schema-gen/config.json` | you | which schemas to skip, which Grafbase directives to inject onto generated fields |
| `schema-gen/manual/` | you | endpoints, `@rest` wiring + jq selections, cross-service joins |

Directive injection (`config.json → directives`) deserves a note: things like
`Fund @key(fields: "id")` must appear *on the generated type*, but we still
want regeneration to be safe. Putting them in config means they're re-applied
on every run — manual knowledge, machine-applied.

## 3. Mapping rules (Swagger → GraphQL)

| Swagger construct | GraphQL result | Example |
|---|---|---|
| `type: string` | `String` | `holderName: String!` |
| `type: integer` | `Int` | `riskRating: Int!` |
| `type: number` | `Float` | `totalValue: Float!` |
| `type: boolean` | `Boolean` | — |
| `format: date` / `date-time` | custom `scalar Date` (emitted once in `_shared.graphql`) | `openedDate: Date!` |
| property `id` or `*Id` (`*Ids` for arrays) | `ID` | `fundId: ID!`, `fundIds: [ID!]!` |
| `enum: [...]` | GraphQL `enum` | `accountType: AccountType!` |
| enum name conflict across types | all claimants get `TypeName` prefix | `AccountStatus` vs `PolicyStatus` |
| `$ref` | referenced type name | `fundHoldings: [FundHolding!]!` |
| in `required` and not `nullable` | non-null `!` | `holderName: String!` |
| `nullable: true` | nullable (no `!`) | `pensionProvider: String` |
| `type: array` | `[Inner!]`, outer `!` from `required` | `fundIds: [ID!]!` |
| `description` | GraphQL `"""docstring"""` | carried through |
| schemas in `excludeSchemas` | skipped entirely | `Error` (REST plumbing, not graph data) |

Escape hatch: `"enumsAsStrings": true` in `config.json` downgrades every enum
to `String` if the gateway ever rejects enum coercion.

## 4. How to run it

```bash
# 1. regenerate types + compose the candidate schema
npm run schema:generate

# 2. static check: does the schema actually compose under Grafbase?
npm run schema:validate

# 3. full end-to-end check (needs the mocks running: npm run mock-apis)
npm run schema:validate:e2e

# 4. happy? promote the candidate to the live schema (explicit, diffable step)
git diff --no-index schema.graphql schema-gen/schema.generated.graphql   # review first
npm run schema:promote
```

### What each validation does

- **`schema:validate`** — rewrites the docker baseURLs to localhost into
  `schema-gen/validate/schema.validate.graphql`, then runs
  `grafbase compose -c schema-gen/validate/grafbase.toml`. This catches SDL
  syntax errors, directive misuse, and composition failures **without running
  anything**. The federated SDL lands in `schema-gen/validate/composed.federated.graphql`.
- **`schema:validate:e2e`** — same, then boots a disposable gateway on
  `127.0.0.1:5099` and fires a federated query that deliberately crosses all
  three services (account → holdings → fund lookups, account → policies →
  linkedFunds fan-out). Fails loudly on any GraphQL error; gateway log is in
  `schema-gen/validate/gateway.log`. Root `grafbase.toml`/`schema.graphql`
  are never touched.

### Verified result (2026-07-21, from the Swagger YAML specs)

Both checks pass. The e2e query returned live joined data — e.g. enums
(`EQUITY`, `IN_FORCE`), the `Date` scalar (`2018-06-01`), a 3-way holding→fund
fan-out and a policy→linkedFunds fan-out — proving the types generated from the
YAML specs compose and resolve through the REST extension. `schema.graphql` was
then promoted from this generated output.

## 5. The regeneration workflow (day-2 story)

Say the funds service adds a `launchDate` field:

1. Service team edits `mock-rest-apis/funds/openapi.yaml` — adds the property
   (+ `required` if applicable). The running service picks it up at
   `/openapi.yaml` automatically (server.js serves the same file).
2. `npm run schema:generate` — `Fund` gains `launchDate: Date!`; nothing else
   changes; `manual/` untouched.
3. **The one manual coupling:** if the field is non-null, add `launchDate` to
   the `fund` jq `selection` in `manual/federation.graphql` (a selection that
   omits a non-null field would return null and error at runtime). The
   validate step exists to catch exactly this.
4. `npm run schema:validate:e2e` → `npm run schema:promote`.

New service? Add one line to `config.json → services`, author its
`openapi.yaml`, add its `@restEndpoint` + Query fields in `manual/`.

## 6. File-by-file reference

| File | Generated? | Purpose |
|---|---|---|
| `mock-rest-apis/*/openapi.yaml` | hand-written | Swagger contract per service (source of truth) |
| `mock-rest-apis/*/server.js` | hand-written | serves the co-located spec at `/openapi.yaml` |
| `schema-gen/config.json` | hand-written | services list, excluded schemas, directive injection, enum escape hatch |
| `schema-gen/generate.mjs` | hand-written (the tool) | Swagger-YAML scaffolder + composer (uses the `yaml` lib) |
| `schema-gen/generated/*` | **generated** | GraphQL types/enums/scalars — do not edit |
| `schema-gen/manual/header.graphql` | hand-written | `@link` imports + the three `@restEndpoint`s |
| `schema-gen/manual/federation.graphql` | hand-written | `Query` fields, `@rest` + jq selections, `extend type` joins |
| `schema-gen/schema.generated.graphql` | **generated** (composed) | the candidate schema |
| `schema-gen/validate/grafbase.toml` | hand-written | validation-only gateway config (localhost) |
| `schema-gen/validate/validate.sh` | hand-written | static + e2e validation runner |
| `schema.graphql` | promoted copy | what the real gateway loads (via root `grafbase.toml`) |

## 7. Differences vs the old hand-written schema.graphql

The generated schema is a **superset** with stronger typing:

- All spec fields are exposed (`status`, `openedDate`, `pensionProvider`,
  `riskProfile`, `contributionRate`, `units`, `isin`, `currency`, …the old
  schema exposed a subset).
- Enums instead of `String` for `accountType`, `status`, `riskProfile`,
  `assetClass`, `sustainabilityLabel`, `policyType`.
- `Date` scalar for dates; `ID` for all `*Id` fields (the old schema had
  `customerId: String`).
- `pensionProvider` is correctly nullable — encoded in the spec, enforced in
  the schema.

## 8. Limitations & honest caveats

- **Selection coupling** (see §5): jq selections in `manual/federation.graphql`
  must keep up with non-null generated fields. Mitigated, not eliminated, by
  validation.
- The generator handles the Swagger subset these services use (objects, arrays,
  enums, `$ref`, nullable/required, date formats). It does **not** handle
  `allOf`/`oneOf`/`anyOf`, inline nested objects, or recursive `$ref`s — extend
  `gqlType()` in `generate.mjs` when a spec first needs them.
- `ID` inference is a naming heuristic (`id`/`*Id`/`*Ids`). A field like
  `isValid` would not match (doesn't end in capital-I `Id`), but review new
  specs with the heuristic in mind.
- Generated files are committed (so diffs show up in review), which means a
  spec change without regeneration can drift. CI should run
  `npm run schema:generate && git diff --exit-code schema-gen/` to enforce
  freshness, then `npm run schema:validate` to enforce composability.
- **Format:** specs are Swagger **YAML** (`openapi.yaml`), the required format.
  The generator parses them with the `yaml` package and also accepts `.json`
  (extension-based, see `loadSpec()` in `generate.mjs`) — so a service could
  supply JSON without any code change. The mock servers serve the raw YAML
  verbatim at `/openapi.yaml` (no parser needed server-side).

## 9. CI/CD sketch

```yaml
# in your pipeline
- run: npm run schema:generate
- run: git diff --exit-code schema-gen/ schema.graphql   # generated output is fresh & promoted
- run: npm run schema:validate                            # composes under Grafbase
# optionally spin up the mocks and run schema:validate:e2e
```

No Java, no Docker, no third-party code generator — the whole toolchain is Node
plus one tiny library, `yaml` (to parse the Swagger specs; already in the tree),
and the Grafbase CLI (already a dependency).
