# Onboarding Guide

This guide gets a brand-new machine from `git clone` to a working GraphQL API
end to end. It covers prerequisites, cloning, running everything with Docker
(recommended) or locally without Docker, what each service does, and a short
primer on how the GraphQL schema is generated.

If you get stuck beyond what's here, the deep-dive docs are in this same
`Docs/` folder:

- [`HOW_TO_RUN.md`](./HOW_TO_RUN.md) — minimal local run (countries demo only)
- [`REST_FEDERATION.md`](./REST_FEDERATION.md) — how the 3 REST services are joined into one GraphQL API
- [`SCHEMA_GENERATION.md`](./SCHEMA_GENERATION.md) — full Swagger → GraphQL generator reference
- [`HOW_TO_IMPLEMENT.md`](./HOW_TO_IMPLEMENT.md) — REST extension internals / troubleshooting the extension registry

---

## 1. What this project is

A demo GraphQL API built with the [Grafbase Gateway](https://grafbase.com/)
that federates **three mock REST services** (Accounts, Policies, Funds — plus
a bonus Countries service) into a **single GraphQL endpoint**, without writing
any custom resolver code. The GraphQL schema itself is generated from each
service's Swagger/OpenAPI contract.

```
                         ┌───────────────────────┐
   GraphQL client  ────▶ │   Grafbase Gateway     │  :5050/graphql
   (curl / Bruno /       │   (schema.graphql)     │
    GraphiQL UI)         └───────────┬───────────┘
                                     │ REST calls
              ┌──────────────┬──────┴───────┬──────────────┐
              ▼              ▼              ▼              ▼
        accounts-rest   policies-rest   funds-rest   countries-rest
           :3001            :3003          :3002          :3004
```

A GraphiQL explorer UI is also included so you can browse and run queries in
a browser instead of curl.

---

## 2. Prerequisites

| Tool | Why you need it | Check you have it |
|---|---|---|
| **Git** | to clone the repo | `git --version` |
| **Docker Desktop** (or Docker Engine + Compose) | recommended way to run everything | `docker --version` |
| **Node.js** (v20+) | only needed for the *local, non-Docker* run path, or to run `npm` scripts (schema generation, etc.) on the host | `node --version` |

You do **not** need Node installed if you're only running things through
Docker — the containers bring their own Node runtime.

### If a command isn't found

- **`git: command not found`** → install Git from the official page:
  https://git-scm.com/downloads (macOS: also available via `xcode-select --install`)
- **`docker: command not found`** → install Docker Desktop from the official page:
  https://www.docker.com/products/docker-desktop/
- **`node: command not found`** → install Node.js (LTS) from the official page:
  https://nodejs.org/en/download

After installing any of these, open a **new terminal window** before retrying
— PATH changes don't apply to already-open shells.

---

## 3. Clone the repository

```bash
git clone <repository-url>
cd rest-demo
```

If `git clone` fails with a permission/authentication error, confirm you have
access to the repo and that your SSH key or credentials are set up — see
GitHub's official guide: https://docs.github.com/en/authentication.

---

## 4. Environment variables

Copy the example env file — Docker Compose and the local npm scripts both read
from it:

```bash
cp .env.example .env
```

The defaults work out of the box for local development; the only values you'd
ever need to change are the mock API keys and `COUNTRIES_BASE_URL`.

---

## 5. Run everything with Docker (recommended)

This is the simplest path — one command brings up all four REST services, the
Grafbase gateway, and the GraphiQL UI.

```bash
docker compose up --build -d
```

Then check everything started:

```bash
docker compose ps
```

You should see `accounts-rest`, `policies-rest`, `funds-rest`,
`countries-rest`, `grafbase`, and `graphiql` all `Up`.

### What you can reach afterwards

| Service | URL |
|---|---|
| GraphQL API (Grafbase gateway) | http://localhost:5050/graphql |
| GraphiQL UI (browser query explorer) | http://localhost:5173 |
| Accounts REST mock | http://localhost:3001 |
| Policies REST mock | http://localhost:3003 |
| Funds REST mock | http://localhost:3002 |
| Countries REST mock | http://localhost:3004 |

### Try a query

```bash
curl -s http://localhost:5050/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query { account(id:\"acct-1001\"){ id holderName accountType totalValue } }"}'
```

Or open http://localhost:5173 and run queries visually.

### Stopping / restarting

```bash
npm run docker:down      # or: docker compose down
npm run docker:restart   # down + up -d
npm run docker:logs      # tail all container logs
```

### If Docker commands fail

- **Docker daemon not running** ("Cannot connect to the Docker daemon") →
  open the Docker Desktop app and wait for it to say "Running", then retry.
- **Port already in use** (`bind: address already in use`) → something else on
  your machine is using one of the ports above. Free it, e.g. for port 3001:
  ```bash
  lsof -iTCP:3001 -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs kill -9
  ```
- **`npm install` fails inside the build behind a corporate proxy/TLS
  interception** → rebuild with `--build-arg NPM_STRICT_SSL=true`, e.g.:
  ```bash
  docker compose build --build-arg NPM_STRICT_SSL=true grafbase
  ```
- Full command reference (rebuild single service, kill stuck ports, etc.) is
  in the root [`README.md`](../README.md).

---

## 6. Run locally without Docker (alternative)

Useful if you want faster iteration without rebuilding containers. Needs
Node.js installed (see prerequisites above).

```bash
npm install
npm start
```

`npm start` runs three things concurrently (see `package.json`):
- the three mock REST servers (accounts, policies, funds) on ports 3001–3003
- the Grafbase dev server on `127.0.0.1:5050`
- the GraphiQL UI (`graphiql-vite`) via `yarn dev`

Or run pieces individually:

```bash
npm run mock-apis        # just the 3 mock REST servers
npm run grafbase-start   # just the Grafbase gateway
npm run graphiql         # just the GraphiQL UI
```

> Note: `schema.graphql`'s `@restEndpoint` base URLs are currently set for the
> Docker service names (e.g. `accounts-rest:3001`). Running the gateway on the
> host requires those to point at `localhost` instead — see the "Option B"
> section in [`REST_FEDERATION.md`](./REST_FEDERATION.md#7-how-to-run) for the
> exact toggle.

---

## 7. The services, in short

| Service | Port | Role |
|---|---|---|
| **accounts-rest** | 3001 | Mock REST API for insurance accounts + fund holdings |
| **policies-rest** | 3003 | Mock REST API for policies |
| **funds-rest** | 3002 | Mock REST API for fund data |
| **countries-rest** | 3004 | Mock REST API for country data (demo/bonus service) |
| **grafbase** | 5050 | The GraphQL gateway — federates all of the above into one API using `schema.graphql` |
| **graphiql** | 5173 (Docker) | Browser UI for writing/running GraphQL queries against the gateway |

Each REST service is independent and has no knowledge of the others — all the
joining logic (e.g. `Account → Policies → linked Funds`) lives in the gateway,
driven entirely by directives in `schema.graphql`. See
[`REST_FEDERATION.md`](./REST_FEDERATION.md) for exactly how that federation
works.

---

## 8. Schema generation, briefly

`schema.graphql` (the file the gateway actually loads) isn't hand-written from
scratch — it's generated from each REST service's Swagger/OpenAPI contract
(`mock-rest-apis/*/openapi.yaml`), then combined with a small hand-written
layer that defines the cross-service joins.

```
mock-rest-apis/*/openapi.yaml   (source of truth, one per service)
            │
            ▼  npm run schema:generate
   schema-gen/generated/*.graphql        ← types/enums, auto-generated, never hand-edited
            │  + concatenated with
   schema-gen/manual/*.graphql           ← hand-written: endpoints, joins, jq selections
            ▼
   schema-gen/schema.generated.graphql   ← the composed candidate schema
            │  npm run schema:promote  (explicit review step)
            ▼
   schema.graphql                        ← what grafbase.toml actually loads
```

In short: if a REST service's data model changes, update its `openapi.yaml`,
regenerate, review the diff, then promote. You never hand-edit the generated
files, and the join logic (which lives in `schema-gen/manual/`) is untouched by
regeneration.

Everyday commands:

```bash
npm run schema:generate       # openapi.yaml specs -> generated/ -> schema.generated.graphql
npm run schema:validate       # static check: does it compose under Grafbase?
npm run schema:validate:e2e   # + boots a disposable gateway and runs a real federated query
npm run schema:promote        # copies the reviewed candidate over schema.graphql
```

If you'd rather not install Node/the Grafbase CLI on your host for this, a
Dockerized toolbox is available — see
[`schema-gen/DOCKER.md`](../schema-gen/DOCKER.md).

For the full mapping rules (Swagger types → GraphQL types), directive
injection, and the day-2 workflow for adding a field, read
[`SCHEMA_GENERATION.md`](./SCHEMA_GENERATION.md) in full — this section is
just the mental model.

---

## 9. Quick troubleshooting reference

| Symptom | Likely fix |
|---|---|
| `git: command not found` | Install Git — https://git-scm.com/downloads |
| `docker: command not found` / daemon not running | Install/start Docker Desktop — https://www.docker.com/products/docker-desktop/ |
| `node: command not found` | Install Node.js — https://nodejs.org/en/download |
| Port already in use | `lsof -iTCP:<port> -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs kill -9`, then retry |
| Extension `404` downloading `rest/0.5.0` | Known registry issue, already worked around in this repo — see [`HOW_TO_IMPLEMENT.md`](./HOW_TO_IMPLEMENT.md) |
| Schema change not reflected | Did you run `npm run schema:generate` **and** `npm run schema:promote`? Generating alone only updates the candidate file, not `schema.graphql` |
| `npm install` fails behind a proxy | Retry the Docker build with `--build-arg NPM_STRICT_SSL=true` |

---

## 10. Next steps

- Explore existing example queries in the [`bruno/`](../bruno/) folder (open
  with the [Bruno](https://www.usebruno.com/) API client) or in
  [`queries/`](../queries/).
- Read [`REST_FEDERATION.md`](./REST_FEDERATION.md) to understand how a single
  GraphQL query fans out into multiple REST calls under the hood.
- Read [`SCHEMA_GENERATION.md`](./SCHEMA_GENERATION.md) before changing any
  `openapi.yaml` file.
