# Accounts REST API

Base URL (local): `http://localhost:3001`

Served by [`server.js`](./server.js). The published `/openapi.json` only lists
endpoint summaries, so this file documents the **actual response keys** returned
by each endpoint.

## Endpoints

| Method | Path                                | Description                     | Returns          |
| ------ | ----------------------------------- | ------------------------------- | ---------------- |
| GET    | `/accounts`                         | List all accounts               | `Account[]`      |
| GET    | `/accounts/{id}`                    | Get a single account by id      | `Account`        |
| GET    | `/customers/{customerId}/accounts`  | List accounts for one customer  | `Account[]`      |
| GET    | `/health`                           | Health check                    | `{ service, ok }`|
| GET    | `/openapi.json`                     | OpenAPI summary (no schemas)    | OpenAPI document |

### Auth
If the `EXPECTED_API_KEY` env var is set, every endpoint except `/health` and
`/openapi.json` requires the header `X-Api-Key: <key>`. Otherwise auth is open.

### Errors
| Status | Body                                        | When                        |
| ------ | ------------------------------------------- | --------------------------- |
| 401    | `{ "error": "Missing or invalid X-Api-Key" }` | API key required but wrong |
| 404    | `{ "error": "Not found" }`                  | Unknown id / path           |

## `Account` object

| Key                | Type              | Nullable | Example                  | Notes                                             |
| ------------------ | ----------------- | -------- | ------------------------ | ------------------------------------------------- |
| `id`               | string            | no       | `"acct-1001"`            | Unique account id                                 |
| `customerId`       | string            | no       | `"cust-501"`             | Owning customer id                                |
| `holderName`       | string            | no       | `"Anika Rao"`            | Account holder                                    |
| `accountType`      | string (enum)     | no       | `"PENSION"`              | `PENSION` \| `INVESTMENT_ISA`                     |
| `status`           | string (enum)     | no       | `"ACTIVE"`               | e.g. `ACTIVE`                                      |
| `openedDate`       | string (ISO date) | no       | `"2016-04-18"`           | `YYYY-MM-DD`                                       |
| `pensionProvider`  | string            | **yes**  | `"Northstar Retirement"` | `null` for non-pension accounts                   |
| `riskProfile`      | string (enum)     | no       | `"BALANCED"`             | `CAUTIOUS` \| `BALANCED` \| `GROWTH`             |
| `totalValue`       | number            | no       | `186420.75`              | Total account value                               |
| `contributionRate` | number            | no       | `8.5`                    | Percent; `0` when not contributing                |
| `fundHoldings`     | `FundHolding[]`   | no       | see below                | Array of fund allocations                         |

### `FundHolding` object

| Key                 | Type   | Example              | Notes                          |
| ------------------- | ------ | -------------------- | ------------------------------ |
| `fundId`            | string | `"fund-global-equity"` | Fund identifier              |
| `allocationPercent` | number | `45`                 | Percent of account in this fund |
| `units`             | number | `1230.52`            | Units held                     |
| `currentValue`      | number | `83900.12`           | Current value of the holding   |

## Example response — `GET /accounts/acct-1001`

```json
{
  "id": "acct-1001",
  "customerId": "cust-501",
  "holderName": "Anika Rao",
  "accountType": "PENSION",
  "status": "ACTIVE",
  "openedDate": "2016-04-18",
  "pensionProvider": "Northstar Retirement",
  "riskProfile": "BALANCED",
  "totalValue": 186420.75,
  "contributionRate": 8.5,
  "fundHoldings": [
    { "fundId": "fund-global-equity", "allocationPercent": 45, "units": 1230.52, "currentValue": 83900.12 },
    { "fundId": "fund-green-bond", "allocationPercent": 30, "units": 812.08, "currentValue": 55926.22 },
    { "fundId": "fund-cash-plus", "allocationPercent": 25, "units": 512.2, "currentValue": 46594.41 }
  ]
}
```

## Known enum values (from current mock data)

- **accountType**: `PENSION`, `INVESTMENT_ISA`
- **status**: `ACTIVE`
- **riskProfile**: `CAUTIOUS`, `BALANCED`, `GROWTH`

> These are derived from the seeded mock accounts in `server.js`; add new values
> here as the data set grows.
