# Federating 3 REST Services into 1 GraphQL API

This document explains how the **Accounts**, **Policies**, and **Funds** REST
services are federated into a single GraphQL API by the Grafbase Gateway —
**without changing a single line of REST server code**.

The whole solution lives in three files:

- [`schema.graphql`](../schema.graphql) — the unified GraphQL schema + join directives
- [`grafbase.toml`](../grafbase.toml) — gateway + REST-extension config (API keys)
- [`docker-compose.yml`](../docker-compose.yml) — runs the services + gateway

---

## 1. The goal

Serve this one query, where the gateway fetches and joins data from all three
services automatically:

```graphql
query InsurancePortfolio {
  account(id: "acct-1001") {
    id
    holderName
    accountType
    totalValue

    policies {                       # from the Policies service
      policyNumber
      productName
      status
      linkedFunds {                  # from the Funds service
        name
        assetClass
        oneYearReturnPercent
      }
    }

    fundHoldings {                   # embedded in the Account
      allocationPercent
      currentValue
      fund {                         # from the Funds service
        name
        riskRating
        sustainabilityLabel
      }
    }
  }
}
```

Under the hood the gateway makes these REST calls, in order, and merges the
results:

```
1. GET /accounts/acct-1001                         (accounts :3001)
2. GET /accounts/acct-1001/policies                (policies :3003)
3. For each policy fundId:  GET /funds/{fundId}    (funds    :3002)
4. For each holding fundId: GET /funds/{fundId}    (funds    :3002)  ← deduplicated
```

---

## 2. Why `@rest` directives *alone* cannot do this

The `@rest` directive can only build its URL from two template contexts:

- `{{ args.* }}` — the field's own GraphQL arguments
- `{{ config.* }}` — static config from `grafbase.toml`

It has **no access to the parent object**. That's fine for the root
`account(id:)` call (the `id` is a client argument), but every deeper hop needs
data from its parent:

| Field | Needs from parent | `@rest` alone? |
|-------|-------------------|----------------|
| `Query.account(id)` | nothing (client arg) | ✅ |
| `Account.policies` | the parent `account.id` | ❌ no parent access |
| `Policy.linkedFunds` | the parent `policy.fundIds[]` (a **list**) | ❌ |
| `FundHolding.fund` | the parent `holding.fundId` | ❌ |

A nested field like `Account.policies` has **no arguments** of its own, so
`{{ args }}` is empty and `@rest` cannot reach `account.id`.

**Conclusion:** `@rest` on its own resolves independent root fields. It cannot
express parent → child joins. For that we add the gateway's composite-schema
directives — and, importantly, **no custom Rust extension is required**.

---

## 3. The join directives (composite schemas spec)

These come from the second `@link` in `schema.graphql`:

```graphql
@link(
  url: "https://specs.grafbase.com/composite-schemas/v1"
  import: ["@lookup", "@key", "@is", "@derive", "@require", "@inaccessible"]
)
```

| Directive | What it does here |
|-----------|-------------------|
| `@require(field: "id")` | Injects a **parent field** into a resolver field as a hidden argument. Turns `account.id` into the `accountId` argument for the `policies` call. |
| `@key(fields: "id")` | Marks `Fund` as an **entity** resolvable by its `id`. |
| `@lookup` | Marks `Query.fund(id)` as the canonical "fetch one Fund by id" resolver. |
| `@derive` + `@is` | Builds a `Fund` (or a **list** of Funds) from an id / list-of-ids on the parent, resolving each through the `@lookup`. |
| `@inaccessible` | Hides internal join fields (`fundId`, `fundIds`) from the public API. |

---

## 4. Schema walkthrough — one join at a time

### Step 1 — root fetch (`@rest` only)

```graphql
type Query {
  account(id: ID!): Account
    @rest(endpoint: "accounts", http: { GET: "/accounts/{{ args.id }}" }, selection: "...")
}
```

The client's `id` fills the URL directly. → `GET /accounts/acct-1001`.

### Step 2 — parent id → child call (`@require`)

```graphql
type Account {
  id: ID!
  policies(accountId: ID! @require(field: "id")): [Policy!]!
    @rest(endpoint: "policies", http: { GET: "/accounts/{{ args.accountId }}/policies" }, selection: "...")
}
```

`@require(field: "id")` copies the parent `Account.id` into the `accountId`
argument (invisible to clients), which `@rest` then puts in the URL.
→ `GET /accounts/acct-1001/policies`.

### Step 3 — list of ids → list of entities (`@derive` fan-out)

```graphql
type Policy {
  fundIds: [ID!]! @inaccessible
  linkedFunds: [Fund!]! @derive @is(field: "fundIds[{ id: . }]")
}
```

`@is(field: "fundIds[{ id: . }]")` maps **each** element of `fundIds` to a Fund
key `{ id: <that id> }`. Each key is resolved through the `Fund` lookup below,
so a policy with two fund ids produces two `GET /funds/{id}` calls.

### Step 4 — single id → entity (`@derive`)

```graphql
type FundHolding {
  fundId: ID! @inaccessible
  fund: Fund @derive @is(field: "{ id: fundId }")
}
```

Same idea, single value: build one Fund key from `fundId`.

### The entity + its lookup

```graphql
type Query {
  fund(id: ID!): Fund
    @inaccessible          # internal — clients don't call it directly
    @lookup
    @rest(endpoint: "funds", http: { GET: "/funds/{{ args.id }}" }, selection: "...")
}

type Fund @key(fields: "id") {
  id: ID!
  name: String!
  # ...
}
```

Both Step 3 and Step 4 funnel into this one `@lookup`. Because the gateway runs
a **dataloader** over it, a fund id requested by several holdings/policies is
fetched only **once** per request.

> **`selection`** on each `@rest` is a [jq](https://jqlang.org/manual/) filter
> that reshapes the raw REST JSON to match the GraphQL type (e.g. picking only
> the fields we expose and flattening `fundHoldings`).

---

## 5. Authentication (`X-Api-Key`)

The mock services require an `X-Api-Key` header (set via `EXPECTED_API_KEY` in
docker-compose). Each REST endpoint forwards a per-service key:

```graphql
@restEndpoint(
  name: "accounts"
  baseURL: "http://accounts-rest:3001"
  headers: [{ name: "X-Api-Key", value: "{{ config.accountsApiKey }}" }]
)
```

The key values are supplied in `grafbase.toml`, **nested under
`config.subgraphs.<subgraph-name>`** (this exact nesting is what the rest
extension reads — a flat table silently renders an empty header):

```toml
[extensions.rest.config.subgraphs.insurance]
accountsApiKey = "{{ env.ACCOUNTS_API_KEY }}"
policiesApiKey = "{{ env.POLICIES_API_KEY }}"
fundsApiKey    = "{{ env.FUNDS_API_KEY }}"
```

Values come from environment variables, so **no secrets live in the repo**.

---

## 6. End-to-end execution flow

```
GraphQL client
      │  InsurancePortfolio query
      ▼
┌─────────────────────────── Grafbase Gateway ───────────────────────────┐
│                                                                         │
│  account(id)      ──@rest──▶  GET /accounts/acct-1001        (accounts) │
│  Account.policies ──@require─▶ GET /accounts/acct-1001/policies (policies)│
│  Policy.linkedFunds ─@derive─▶ GET /funds/{id}  × N          (funds)    │
│  FundHolding.fund  ──@derive─▶ GET /funds/{id}  (deduped)    (funds)    │
│                                                                         │
│  merge → single nested JSON response                                    │
└─────────────────────────────────────────────────────────────────────────┘
      │
      ▼
   one GraphQL response
```

The three REST services never change and never know about each other — all
composition happens in the gateway.

---

## 7. How to run

### Option A — everything in Docker (current default)

`schema.graphql` uses the docker **service-name** baseURLs
(`accounts-rest:3001`, etc.), and `docker-compose.yml` passes the API keys into
the gateway container.

```bash
docker compose up --build
# GraphQL at http://localhost:5050/graphql
```

### Option B — services in Docker, gateway on the host

Switch the three `baseURL`s in `schema.graphql` to the `localhost` variants
(commented on each line), then:

```bash
export ACCOUNTS_API_KEY=accounts-local-key \
       POLICIES_API_KEY=policies-local-key \
       FUNDS_API_KEY=funds-local-key
grafbase dev --listen-address 127.0.0.1:5050
```

> `@restEndpoint.baseURL` is a static string (not templatable), so the
> host-vs-docker URL is a one-line comment toggle.

### Run the query

```bash
curl -s http://localhost:5050/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query InsurancePortfolio { account(id:\"acct-1001\"){ id holderName accountType totalValue policies { policyNumber productName status linkedFunds { name assetClass oneYearReturnPercent } } fundHoldings { allocationPercent currentValue fund { name riskRating sustainabilityLabel } } } }"}'
```

**Verified result:** account *Anika Rao* (£186,420.75), policy `ANN-RET-3002`
links `Global Equity Index` + `Green Bond Income`, and all three fund holdings
resolve their fund (`Global Equity Index`, `Green Bond Income`,
`Cash Plus Reserve`) — with shared funds fetched only once.

---

## 8. Do we need a custom Rust resolver extension?

**No.** The stock `rest` extension + composite-schema directives cover every
join in this API, which is the Grafbase-recommended approach. A custom Rust
`ResolverExtension` would only be warranted for things directives can't express
— e.g. batching into a bulk endpoint that doesn't exist, request signing/HMAC
auth, or conditional multi-call orchestration. None of that applies here, so
writing Rust would only reimplement functionality the gateway already provides.

---

## 9. Files changed (and what stayed untouched)

| File | Change |
|------|--------|
| `schema.graphql` | Replaced the `countries` demo with the federated Account/Policy/FundHolding/Fund schema + join directives + auth headers |
| `grafbase.toml` | Added `[extensions.rest.config.subgraphs.insurance]` (env → API keys) |
| `docker-compose.yml` | Passed `ACCOUNTS/POLICIES/FUNDS_API_KEY` into the gateway container |
| `mock-rest-apis/**` | **Untouched** — no REST server code, endpoints, or JSON changed |
| Rust extension project | **Untouched** — not needed |
