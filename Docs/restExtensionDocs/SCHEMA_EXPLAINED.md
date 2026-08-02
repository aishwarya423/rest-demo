# `schema.graphql` Explained — The Core Logic, In Detail

> **Purpose of this doc:** After reading it you should understand *exactly* what
> [`schema.graphql`](../schema.graphql) is, what every directive in it does, and
> **how a single GraphQL query becomes multiple REST calls that get joined back
> together** — with real request/response examples from this project.
>
> This is the "brain" of the whole project. There is **no resolver code** — this
> one file *is* the logic. Everything the gateway does at runtime is driven by
> the directives here.

---

## 1. What this file actually is

`schema.graphql` is a **single virtual subgraph**. It does two jobs at once:

1. **Defines the public GraphQL API** — the types and fields clients can query
   (`Account`, `Policy`, `Fund`, etc.).
2. **Tells the gateway how to *fetch* each field** — using directives that map
   fields to REST calls and describe how the pieces join together.

Think of every field as having a hidden instruction attached: *"to get my value,
call this REST endpoint and reshape the result like this."* The gateway reads
those instructions and executes them on demand. **We never wrote a line of
fetching/joining code** — we described the *what*, and the extension does the
*how*.

The whole schema is powered by two imported directive sets, declared at the top:

```graphql
extend schema
  @link(url: "https://grafbase.com/extensions/rest/0.5.2", import: ["@restEndpoint", "@rest"])
  @link(
    url: "https://specs.grafbase.com/composite-schemas/v1"
    import: ["@lookup", "@key", "@is", "@derive", "@require", "@inaccessible"]
  )
```

| `@link` | What it brings in | Job |
|---------|-------------------|-----|
| REST extension `0.5.2` | `@restEndpoint`, `@rest` | Call a **single** REST endpoint and reshape its JSON. |
| Composite Schemas `v1` | `@lookup`, `@key`, `@is`, `@derive`, `@require`, `@inaccessible` | Join data **across** endpoints (parent → child relationships). |

> **The one big idea to hold onto:** `@rest` handles *one* call. The
> composite-schema directives handle the *relationships between* calls. All the
> "magic" is those two working together.

---

## 2. Declaring the REST endpoints (`@restEndpoint`)

Right after the links, the schema declares the three REST services it talks to:

```graphql
  @restEndpoint(
    name: "accounts"
    baseURL: "http://accounts-rest:3001"
    headers: [{ name: "X-Api-Key", value: "{{ config.accountsApiKey }}" }]
  )
  @restEndpoint(
    name: "policies"
    baseURL: "http://policies-rest:3003"
    headers: [{ name: "X-Api-Key", value: "{{ config.policiesApiKey }}" }]
  )
  @restEndpoint(
    name: "funds"
    baseURL: "http://funds-rest:3002"
    headers: [{ name: "X-Api-Key", value: "{{ config.fundsApiKey }}" }]
  )
```

Each `@restEndpoint` is just a **named base URL + headers**. It does not fetch
anything by itself — it is a reusable target that `@rest` fields point at by
`name`.

**Three things to understand here:**

- **`name`** — the handle (`"accounts"`) that `@rest` directives reference. It
  must be unique in the subgraph.
- **`baseURL`** — the root of the service. Note these use **docker service DNS
  names** (`accounts-rest:3001`) because the gateway runs inside docker-compose.
  When you run the gateway on your host with `grafbase dev`, you swap these for
  `http://localhost:3001` etc. (the commented-out lines in the file). **This is
  the #1 thing that trips people up.**
- **`headers`** — sent on every call to that endpoint. The value is a
  **template**: `{{ config.accountsApiKey }}` is resolved from `grafbase.toml`,
  which in turn reads it from an environment variable. So the secret is injected
  server-side and **never appears in the schema or the repo**.

### Where `config.*` comes from

```toml
# grafbase.toml
[extensions.rest.config.subgraphs.insurance]
accountsApiKey = "{{ env.ACCOUNTS_API_KEY }}"
policiesApiKey = "{{ env.POLICIES_API_KEY }}"
fundsApiKey    = "{{ env.FUNDS_API_KEY }}"
```

So the chain for a header value is:

```
env var  →  grafbase.toml config  →  {{ config.* }}  →  X-Api-Key header on the REST call
```

The mock services check that header (`X-Api-Key`) and return `401` if it's
missing or wrong — which is why forwarding it correctly matters.

---

## 3. The two template contexts (why we need more than `@rest`)

This is the single most important concept for understanding the schema. A
`@rest` directive can only build its request from **two** sources of data:

| Template | Meaning | Example |
|----------|---------|---------|
| `{{ args.* }}` | the field's **own GraphQL arguments** | `account(id:)` → `{{ args.id }}` |
| `{{ config.* }}` | static config from `grafbase.toml` | `{{ config.accountsApiKey }}` |

**That's it.** A `@rest` directive **cannot see the parent object.**

That's perfectly fine for a *root* call like `account(id: "acct-1001")` — the
`id` is a client-supplied argument. But every *nested* relationship needs data
from its parent:

| Field | Needs from its parent | Can `@rest` alone do it? |
|-------|-----------------------|--------------------------|
| `Query.account(id)` | nothing (client passes `id`) | ✅ yes |
| `Account.policies` | the parent `account.id` | ❌ no — no parent access |
| `Policy.linkedFunds` | the parent `policy.fundIds[]` (a **list**) | ❌ no |
| `FundHolding.fund` | the parent `holding.fundId` | ❌ no |

A field like `Account.policies` has **no arguments of its own**, so `{{ args }}`
is empty and `@rest` has nothing to build a URL from.

**This gap is exactly why the composite-schema directives exist.** They feed
parent data into a child field so that `@rest` then has an argument to work with.
Keep this table in mind — the rest of the schema is just four different answers
to *"how do I get the parent's data into this REST call?"*

---

## 4. The `@rest` directive, dissected

Every REST-backed field uses `@rest` with up to three arguments:

```graphql
@rest(
  endpoint: "accounts"                     # WHICH @restEndpoint to call
  http: { GET: "/accounts/{{ args.id }}" } # WHICH method + path (path is templated)
  selection: """ ... jq filter ... """     # HOW to reshape the JSON response
)
```

- **`endpoint`** — must match a `@restEndpoint` name.
- **`http`** — exactly one HTTP method, whose value is the **path template**.
  Here it's always `GET`; the extension also supports `POST`/`PUT`/etc. with a
  request `body`.
- **`selection`** — a **[jq](https://jqlang.org/manual/) filter** that transforms
  the raw REST JSON into the exact shape of the GraphQL field. This is where
  "REST → GraphQL translation" literally happens.

### Why `selection` matters (real example)

The Accounts service returns a **fat** object with many fields:

```jsonc
// GET /accounts/acct-1001  →  raw REST response (trimmed)
{
  "id": "acct-1001",
  "customerId": "cust-501",
  "holderName": "Anika Rao",
  "accountType": "PENSION",
  "status": "ACTIVE",           // not in our GraphQL type
  "openedDate": "2016-04-18",   // not in our GraphQL type
  "pensionProvider": "Northstar Retirement",  // not in our type
  "riskProfile": "BALANCED",    // not in our type
  "totalValue": 186420.75,
  "contributionRate": 8.5,      // not in our type
  "fundHoldings": [
    { "fundId": "fund-global-equity", "allocationPercent": 45, "units": 1230.52, "currentValue": 83900.12 },
    { "fundId": "fund-green-bond",    "allocationPercent": 30, "units": 812.08,  "currentValue": 55926.22 },
    { "fundId": "fund-cash-plus",     "allocationPercent": 25, "units": 512.2,   "currentValue": 46594.41 }
  ]
}
```

The `selection` on `Query.account` keeps only what the `Account` type needs and
renames/reshapes as required:

```jq
{
  id,
  customerId,
  holderName,
  accountType,
  totalValue,
  fundHoldings: [.fundHoldings[] | { fundId, allocationPercent, currentValue }]
}
```

Result the gateway hands upward (note `status`, `units`, etc. are dropped):

```jsonc
{
  "id": "acct-1001",
  "customerId": "cust-501",
  "holderName": "Anika Rao",
  "accountType": "PENSION",
  "totalValue": 186420.75,
  "fundHoldings": [
    { "fundId": "fund-global-equity", "allocationPercent": 45, "currentValue": 83900.12 },
    { "fundId": "fund-green-bond",    "allocationPercent": 30, "currentValue": 55926.22 },
    { "fundId": "fund-cash-plus",     "allocationPercent": 25, "currentValue": 46594.41 }
  ]
}
```

> **Reading the jq bit:** `.fundHoldings[]` streams each element of the array,
> `| { ... }` reshapes each one into just those three keys, and the outer
> `[ ... ]` collects them back into an array. Same pattern used everywhere in
> this schema.

---

## 5. The core logic — a type-by-type walkthrough

Now the heart of the file. We'll go field by field and, for each one, answer the
same question: **how does the parent's data reach the REST call?**

### 5.1 `Query.account` — a pure `@rest` root call

```graphql
account(id: ID!): Account
  @rest(
    endpoint: "accounts"
    http: { GET: "/accounts/{{ args.id }}" }
    selection: """{ id, customerId, holderName, accountType, totalValue,
                    fundHoldings: [.fundHoldings[] | { fundId, allocationPercent, currentValue }] }"""
  )
```

- The client passes `id` → `{{ args.id }}` fills the path → `GET /accounts/acct-1001`.
- No parent involved. This is the **only** kind of call `@rest` can do entirely
  on its own. It's the **entry point** for the whole graph.

### 5.2 `Account.policies` — parent id pushed down with `@require`

```graphql
policies(accountId: ID! @require(field: "id")): [Policy!]!
  @rest(
    endpoint: "policies"
    http: { GET: "/accounts/{{ args.accountId }}/policies" }
    selection: """[.[] | { policyNumber, productName, status, fundIds }]"""
  )
```

This is the first **join**. Walk through it slowly:

1. `policies` is nested under `Account`, and it has **no client argument** — so
   `@rest` has nothing to build the URL with.
2. `@require(field: "id")` says: *"take the `id` field from the parent `Account`
   and inject it as the `accountId` argument of this field."*
3. Now `{{ args.accountId }}` is populated (with `acct-1001`), so the path
   becomes `GET /accounts/acct-1001/policies` on the **policies** service.
4. `accountId` is a "virtual" argument — it exists only to carry parent data.
   **Clients never pass it and never see it** (it's an implementation detail of
   the join).

The policies service returns full policy objects; the `selection` trims each to
`{ policyNumber, productName, status, fundIds }`. Note it **keeps `fundIds`** —
we need that list for the *next* join, even though we'll hide it from clients.

> **`@require` in one line:** *"copy this field off my parent into one of my
> arguments so `@rest` can use it."*

### 5.3 `Fund` — an entity resolvable by id (`@key` + `@lookup`)

Before we can join *funds*, we declare how to fetch **one fund by id**:

```graphql
type Fund @key(fields: "id") {   # Fund is an entity, identified by `id`
  id: ID!
  name: String!
  assetClass: String!
  riskRating: Int!
  oneYearReturnPercent: Float!
  sustainabilityLabel: String!
}

# In type Query:
fund(id: ID!): Fund
  @inaccessible          # hidden from clients — internal machinery only
  @lookup                # THE canonical "give me one Fund by id" resolver
  @rest(
    endpoint: "funds"
    http: { GET: "/funds/{{ args.id }}" }
    selection: """{ id, name, assetClass, riskRating, oneYearReturnPercent, sustainabilityLabel }"""
  )
```

- `@key(fields: "id")` marks `Fund` as an **entity**: something the gateway can
  fetch on its own if it knows the `id`.
- `@lookup` on `Query.fund` marks it as **the resolver** the gateway calls
  whenever it needs a `Fund` by id → `GET /funds/{id}`.
- `@inaccessible` hides `Query.fund` from the public schema. It's plumbing —
  clients don't call it directly; the gateway calls it *for* them during joins.

This is the reusable building block the next two joins stand on.

### 5.4 `FundHolding.fund` — build one entity from a parent field (`@derive` + `@is`)

```graphql
type FundHolding {
  fundId: ID! @inaccessible          # kept for the join, hidden from clients
  allocationPercent: Float!
  currentValue: Float!

  fund: Fund @derive @is(field: "{ id: fundId }")
}
```

Here the parent `FundHolding` already carries a `fundId` (it came in with the
account). We want to turn that id into a full `Fund`:

- `@derive` means *"don't fetch this field with its own `@rest`; **construct** it
  from data already on the parent."*
- `@is(field: "{ id: fundId }")` says *"build the key for the lookup by taking
  the parent's `fundId` and using it as the Fund's `id`."*
- The gateway then calls the `Fund` `@lookup` → `GET /funds/fund-global-equity`,
  and slots the result in as `fund`.

So there's **no `@rest` on this field at all** — it reuses the `@lookup` from
5.3. `fundId` is marked `@inaccessible` so the public `FundHolding` only exposes
`allocationPercent`, `currentValue`, and the resolved `fund`.

### 5.5 `Policy.linkedFunds` — build a **list** of entities (`@derive` + `@is` over an array)

```graphql
type Policy {
  policyNumber: String!
  productName: String!
  status: String!
  fundIds: [ID!]! @inaccessible      # list kept for the join, hidden

  linkedFunds: [Fund!]! @derive @is(field: "fundIds[{ id: . }]")
}
```

Same idea as 5.4, but the parent carries a **list** of ids (`fundIds`):

- `@is(field: "fundIds[{ id: . }]")` reads as: *"for each element `.` in
  `fundIds`, build a key `{ id: . }`."* That produces a list of Fund keys.
- The gateway resolves **each** key through the `Fund` `@lookup` → one
  `GET /funds/{id}` per id — and returns them as `linkedFunds: [Fund!]!`.

So a policy with `fundIds: ["fund-global-equity", "fund-green-bond"]` triggers
two funds lookups and yields two `Fund` objects. `fundIds` itself stays
`@inaccessible`.

---

## 6. Putting it together — one query, traced end to end

The demo query asks for data spanning **all three services** in a single request:

```graphql
query InsurancePortfolio {
  account(id: "acct-1001") {      # accounts service
    id
    holderName
    accountType
    totalValue
    policies {                    # policies service (via @require)
      policyNumber
      productName
      status
      linkedFunds {               # funds service (via @derive over a list)
        name
        assetClass
        oneYearReturnPercent
      }
    }
    fundHoldings {                # embedded in the account payload
      allocationPercent
      currentValue
      fund {                      # funds service (via @derive, single)
        name
        riskRating
        sustainabilityLabel
      }
    }
  }
}
```

Here is exactly what the gateway does, in order:

```
1. Query.account(id: "acct-1001")
   → @rest  GET http://accounts-rest:3001/accounts/acct-1001      [accounts]
   → selection trims to { id, holderName, accountType, totalValue, fundHoldings[] }

2. Account.policies   (@require injects account.id as accountId)
   → @rest  GET http://policies-rest:3003/accounts/acct-1001/policies   [policies]
   → returns 2 policies for acct-1001; selection keeps fundIds for step 3
     • pol-annuity-3002  fundIds: [fund-global-equity, fund-green-bond]
     • pol-life-3001     fundIds: []

3. Policy.linkedFunds  (@derive + @is over fundIds[])  → Fund @lookup per id
   → GET /funds/fund-global-equity        [funds]
   → GET /funds/fund-green-bond           [funds]
   (pol-life-3001 has no fundIds → empty list, no calls)

4. Account.fundHoldings[].fund  (@derive + @is, single id)  → Fund @lookup per holding
   → GET /funds/fund-global-equity        [funds]   (may be deduped with step 3)
   → GET /funds/fund-green-bond           [funds]
   → GET /funds/fund-cash-plus            [funds]

5. Gateway assembles everything into ONE GraphQL response and returns it.
```

Five logical steps, **three different services**, and the client sent exactly
**one** query and had no idea there were separate REST backends behind it.

---

## 7. The mechanisms, side by side

The entire schema is built from just **four** resolution patterns. If you
internalize this table, you understand the file:

| Field | Pattern | How parent data gets in | REST call(s) made |
|-------|---------|-------------------------|-------------------|
| `Query.account` | `@rest` only | client arg `{{ args.id }}` | `GET /accounts/{id}` |
| `Account.policies` | `@rest` + `@require` | parent `id` → `accountId` arg | `GET /accounts/{accountId}/policies` |
| `FundHolding.fund` | `@derive` + `@is` + `@lookup` | parent `fundId` → key | `GET /funds/{id}` (×1) |
| `Policy.linkedFunds` | `@derive` + `@is` + `@lookup` | parent `fundIds[]` → keys | `GET /funds/{id}` (×N) |
| `Query.fund` | `@lookup` + `@rest` (`@inaccessible`) | called *by the gateway*, not clients | `GET /funds/{id}` |

And the supporting cast:

| Directive | One-line job |
|-----------|--------------|
| `@restEndpoint` | Name a REST base URL + its headers. |
| `@rest` | Call one endpoint (method + path) and reshape JSON via jq `selection`. |
| `@require(field:)` | Inject a **parent field** as a hidden argument on a child field. |
| `@key(fields:)` | Declare a type as an **entity** identified by those fields. |
| `@lookup` | Mark the canonical "fetch one entity by key" resolver. |
| `@derive` | Build this field from parent data instead of fetching it directly. |
| `@is(field:)` | Describe *how* to build the entity key from the parent (single or list). |
| `@inaccessible` | Hide an internal field/resolver from the public API. |

---

## 8. Why it's designed this way (the "what it is", summarized)

- **It's declarative.** The schema says *what* each field is and *where* its data
  lives. The gateway + REST extension figure out *how* to fetch and join. There
  is **no resolver code to maintain**.
- **`@rest` = one call; composite directives = the joins.** That split is the
  whole design. `@rest` can't see parents, so `@require`/`@derive`/`@is`/`@lookup`
  carry parent data across service boundaries.
- **jq `selection` is the translator.** It turns each service's real (fat) JSON
  into the clean GraphQL shape, field by field.
- **The public API stays clean.** `@inaccessible` hides the join plumbing
  (`fundId`, `fundIds`, the `accountId` argument, the `Query.fund` lookup) so
  clients only see meaningful fields.
- **Secrets stay out.** API keys flow `env → grafbase.toml → {{ config.* }} →
  header`, never touching the schema.

> **If you remember one sentence:** *This schema is a set of instructions that
> turns one GraphQL query into the right sequence of REST calls and stitches the
> responses back together — and `@rest` does each call while the composite-schema
> directives feed parent data into the next call.*

---

## 9. Common gotchas when reading/editing this file

- **Wrong base URLs by environment.** In-docker uses service DNS names
  (`accounts-rest:3001`); host `grafbase dev` uses `localhost:3001`. Swapping
  these wrong = connection errors. Both variants live in the file (one commented).
- **A `selection` that doesn't match the payload.** If the REST JSON shape
  changes, the jq filter must change too, or the field returns null/errors. Test
  filters with `curl <endpoint> | jq '<selection>'` before pasting them in.
- **Forgetting to keep a join field.** `fundIds`/`fundId` are `@inaccessible` but
  **must still be selected** in the `selection`, because the `@derive` joins read
  them. Hidden ≠ not fetched.
- **List vs. single in `@is`.** `{ id: fundId }` builds one key;
  `fundIds[{ id: . }]` builds a list of keys. Match it to whether the field is
  `Fund` or `[Fund!]!`.
- **Fan-out cost.** `linkedFunds`/`fundHoldings` issue one funds call per id.
  Deep queries can generate many downstream calls — a good future target for
  caching.

---

### See also
- [`schema.graphql`](../schema.graphql) — the file itself
- [`Docs/REST_FEDERATION.md`](REST_FEDERATION.md) — the join story, step by step
- [`grafbase.toml`](../grafbase.toml) — extension load + API-key config
- REST extension docs: https://grafbase.com/extensions/rest
- Composite Schemas / resolver guide: https://grafbase.com/guides/implementing-a-gateway-resolver-extension
- jq manual (for `selection`): https://jqlang.org/manual/
