# Run Guide — Quick Command Reference

A short, copy-pasteable list of commands to get this repo running. For full
explanations, prerequisites, and troubleshooting, see
[`ONBOARDING.md`](./ONBOARDING.md).

## 1. Clone & checkout

```bash
git clone <repository-url>
cd rest-demo
git checkout <branch-name>
```

## 2. Run with Docker (recommended)

```bash
docker compose up -d
```

Open the GraphiQL UI in your browser:

```
http://localhost:5173/
```

Copy the query from [`queries/2`](../queries/2) (`InsurancePortfolio`), paste
it into the GraphiQL editor, and run it.

```bash
docker compose down
```

## 3. Test schema generation

Regenerate the GraphQL types from the `openapi.yaml` specs and promote them
into the live schema:

```bash
# 1. clear out the old generated types
rm -rf schema-gen/generated/*

# 2. build the schema-gen toolbox image (only needed once, or after package.json changes)
docker compose build schema-gen

# 3. regenerate types from mock-rest-apis/*/openapi.yaml
docker compose run --rm schema-gen npm run schema:generate
# -> types are now auto-generated into schema-gen/generated/

# 4. promote the generated types + hand-written manual/ queries into schema.graphql
docker compose run --rm schema-gen npm run schema:promote
# -> schema-gen/schema.generated.graphql is copied over schema.graphql
```

Restart the Grafbase gateway so it picks up the new `schema.graphql`:

```bash
docker compose down && docker compose up --build -d && sleep 5 && docker compose ps
```

**If something goes wrong:** stop and remove all containers/images for this
project in Docker Desktop, then rebuild from scratch with the command above.

## 4. Run manually (without Docker)

```bash
npm install
npm run start
```

Or run each piece in its own terminal:

```bash
npm run mock-apis
npm run grafbase-start
npm run graphiql
```
