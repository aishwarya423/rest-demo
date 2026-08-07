# REST → GraphQL Federation Demo (Grafbase)

A working example of federating multiple independent REST services into a
single GraphQL API using the [Grafbase Gateway](https://grafbase.com/), the
[REST extension](https://grafbase.com/extensions/rest), and the
[Composite Schemas spec](https://specs.grafbase.com/composite-schemas/v1) —
**with zero resolver code**. Every field-to-REST-call mapping and every
parent → child join lives declaratively in [`schema.graphql`](schema.graphql).

## What this demonstrates

Three mock REST services — **Accounts**, **Policies**, and **Funds** — are
composed into one GraphQL query that the gateway resolves by making several
REST calls and joining the results, deduplicating repeated lookups along the
way:

```graphql
query InsurancePortfolio {
  account(id: "acct-1001") {
    holderName
    totalValue
    policies {
      policyNumber
      status
      linkedFunds { name assetClass oneYearReturnPercent }
    }
    fundHoldings {
      allocationPercent
      fund { name riskRating sustainabilityLabel }
    }
  }
}
```

```
account(id)         ──@rest────▶  GET /accounts/acct-1001            (accounts)
Account.policies    ──@require─▶  GET /accounts/acct-1001/policies   (policies)
Policy.linkedFunds  ──@derive──▶  GET /funds/{id} × N                (funds)
FundHolding.fund    ──@derive──▶  GET /funds/{id} (deduped)          (funds)
                              │
                              ▼
                    single merged GraphQL response
```

The REST services never change and never know about each other — all
composition happens in the gateway. See
[`Docs/REST_FEDERATION.md`](Docs/REST_FEDERATION.md) for the full breakdown of
how each directive works, and [`Docs/restExtensionDocs/SCHEMA_EXPLAINED.md`](Docs/restExtensionDocs/SCHEMA_EXPLAINED.md)
for a line-by-line walkthrough of `schema.graphql`.

## Architecture

```
                         ┌──────────────────────┐
   GraphQL client  ───▶  │   Grafbase Gateway    │  :5050/graphql
  (Bruno / curl /        │  (schema.graphql +    │
   GraphiQL)              grafbase.toml)         │
                         └──────────┬────────────┘
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
             accounts-rest   policies-rest      funds-rest
                :3001            :3003             :3002
```

A standalone `countries-rest` service (:3004) and matching `@restEndpoint`
in an earlier version of the schema also demonstrate a single, non-federated
REST → GraphQL mapping — see [`Docs/HOW_TO_IMPLEMENT.md`](Docs/HOW_TO_IMPLEMENT.md).

## Project structure

```
schema.graphql            GraphQL schema + @rest / composite-schema join directives (the core logic)
grafbase.toml              Gateway config: extension path, per-subgraph API key config
docker-compose.yml         Runs all REST services + the gateway + GraphiQL UI
Dockerfile                 Gateway image (installs the Grafbase CLI, copies schema/config)
grafbase_extensions/rest/  Locally-built REST extension (.wasm), used instead of the registry
mock-rest-apis/            Express mock services: accounts, policies, funds, countries
graphiql-vite/             Vite + React GraphiQL explorer UI
explorer/                  Static GraphiQL explorer (nginx), alternative to graphiql-vite
bruno/                     Bruno API collection — sample queries + local environment
Docs/                      How to run, how the REST extension was implemented, federation deep-dive
notes/                     Working notes from building this out (not required reading)
```

## Prerequisites

- Node.js (v18+) and npm
- Docker + Docker Compose (for the containerizedf workflow)
- [Grafbase CLI](https://grafbase.com/docs/cli) (`npx grafbase` works without a global install)

## Quickstart

### Option A — Docker (recommended)

Runs every service, the gateway, and the GraphiQL UI in containers:

```bash
docker compose up --build -d
docker compose ps
```

- GraphQL API: `http://localhost:5050/graphql`
- GraphiQL UI: `http://localhost:5173`

Stop everything:

```bash
docker compose down
```

### Option B — Run on the host

Starts the three mock REST APIs, the Grafbase dev server, and the GraphiQL UI
concurrently:

```bash
npm install
npm start
```

- GraphQL API: `http://localhost:5050/graphql`
- GraphiQL UI: served by `graphiql-vite` (`npm run graphiql` alone)

> When running the gateway on the host against dockerized REST services, swap
> the `@restEndpoint` `baseURL`s in `schema.graphql` from the docker service
> names (`accounts-rest:3001`, …) to `localhost` — see the commented
> alternative on each line. Full details in
> [`Docs/REST_FEDERATION.md`](Docs/REST_FEDERATION.md#7-how-to-run).

### Try it

```bash
curl -s http://localhost:5050/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query { account(id:\"acct-1001\") { holderName totalValue policies { policyNumber linkedFunds { name } } } }"}'
```

Or open the Bruno collection in [`bruno/`](bruno/) (see [`bruno/README.md`](bruno/README.md)) for ready-made requests.

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Purpose | Default |
|---|---|---|
| `ACCOUNTS_API_KEY` | `X-Api-Key` the gateway sends to the accounts service | `accounts-local-key` |
| `POLICIES_API_KEY` | `X-Api-Key` the gateway sends to the policies service | `policies-local-key` |
| `FUNDS_API_KEY` | `X-Api-Key` the gateway sends to the funds service | `funds-local-key` |
| `COUNTRIES_BASE_URL` | Base URL for the standalone countries demo service | `http://localhost:3004` |

Keys are read into the gateway via `[extensions.rest.config.subgraphs.insurance]`
in [`grafbase.toml`](grafbase.toml) and injected into REST headers as
`{{ config.* }}` — no secrets are committed to the repo.

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Runs mock REST APIs + Grafbase dev server + GraphiQL together |
| `npm run mock-apis` | Runs only the three mock REST services |
| `npm run grafbase-start` | Runs only the Grafbase dev server (`:5050`) |
| `npm run graphiql` | Runs only the GraphiQL UI |
| `npm run docker:build:up` | `docker compose up --build -d` |
| `npm run docker:up` / `docker:down` | Start / stop containers without rebuilding |
| `npm run docker:logs` | Tail logs from all containers |
| `npm run docker:restart` | `docker compose down && docker compose up -d` |

## Documentation

- [`Docs/HOW_TO_RUN.md`](Docs/HOW_TO_RUN.md) — minimal steps to run the original single-service demo
- [`Docs/HOW_TO_IMPLEMENT.md`](Docs/HOW_TO_IMPLEMENT.md) — building the REST extension locally, `@restEndpoint`/`@rest` basics, jq `selection` filters
- [`Docs/REST_FEDERATION.md`](Docs/REST_FEDERATION.md) — how three REST services are joined into one graph (`@require`, `@key`, `@lookup`, `@derive`, `@is`)
- [`Docs/restExtensionDocs/SCHEMA_EXPLAINED.md`](Docs/restExtensionDocs/SCHEMA_EXPLAINED.md) — annotated, line-by-line walkthrough of `schema.graphql`
- [`Docs/restExtensionDocs/CONFLUENCE_REST_EXTENSIONS.md`](Docs/restExtensionDocs/CONFLUENCE_REST_EXTENSIONS.md) / [`DEMO_SCRIPT.md`](Docs/restExtensionDocs/DEMO_SCRIPT.md) — write-up and demo script for presenting this project

## Troubleshooting

**`404 Not Found` downloading `extensions.grafbase.com/.../rest/0.5.0/extension.wasm`**
The registry version referenced by an older config was unavailable. This repo
works around it by building the extension locally into
`grafbase_extensions/rest/0.5.2` and pointing `grafbase.toml` at that path
instead of a registry version. See
[`Docs/HOW_TO_IMPLEMENT.md`](Docs/HOW_TO_IMPLEMENT.md) if you need to rebuild it.

**Empty/missing `X-Api-Key` header** — API keys must be nested under
`[extensions.rest.config.subgraphs.<name>]` in `grafbase.toml`, matching the
`{{ config.* }}` reference in `schema.graphql`. A flat table is silently
ignored by the REST extension.

**Port already in use** — the gateway listens on `5050`, mock services on
`3001`–`3004`, GraphiQL on `5173` (Docker) or via Vite dev server (host). Free
the port or stop the conflicting container before retrying.

## License

ISC
