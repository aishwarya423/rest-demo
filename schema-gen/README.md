# schema-gen — Swagger → GraphQL scaffolder

Generates the Grafbase GraphQL schema from the Swagger contracts in
`mock-rest-apis/*/openapi.yaml`. Full documentation: [`Docs/SCHEMA_GENERATION.md`](../Docs/SCHEMA_GENERATION.md).

```bash
npm run schema:generate       # specs -> generated/ -> schema.generated.graphql
npm run schema:validate       # grafbase compose (static check, nothing running)
npm run schema:validate:e2e   # + live gateway on :5099 + federated smoke query
npm run schema:promote        # copy candidate over schema.graphql (review diff first!)
```

Layout:

- `config.json` — services, excluded schemas, directive injection (`@key`, `@inaccessible`)
- `generate.mjs` — the zero-dependency generator/composer
- `generated/` — **machine-owned**, overwritten on every run, never edit
- `manual/` — **human-owned**: `header.graphql` (endpoints), `federation.graphql` (@rest wiring + joins)
- `schema.generated.graphql` — the composed candidate schema
- `validate/` — validation harness (own `grafbase.toml`, touches nothing at repo root)
