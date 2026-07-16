We have an OpenAPI (Swagger) specification for our REST services. Does Grafbase provide any built-in capability, CLI command, extension, or recommended workflow to automatically generate the corresponding GraphQL schema (`schema.graphql`) from an OpenAPI specification? If so, please explain the available approaches, how they work, any limitations, and provide examples. If Grafbase does not support this natively, what are the recommended alternatives or best practices for generating a Grafbase-compatible `schema.graphql` from an OpenAPI spec?


Good question. Let me look at how your project currently uses Grafbase, then verify against Grafbase's current capabilities before answering.

Now I understand your setup precisely. Let me verify the current state of Grafbase's OpenAPI tooling against their live docs before answering, since this area has changed a lot.

Let me pull the specifics from the two most relevant Grafbase pages — the OpenAPI connector doc and the current REST extension doc.

Short answer: **not in the architecture your project uses.** There's an important split in Grafbase's history that determines the answer, so let me be precise.

## The two Grafbase architectures

Your project is on the **current** stack: Grafbase Gateway + `grafbase.toml` + the `rest` extension (`@restEndpoint`/`@rest`), with composite-schemas directives (`@lookup`, `@derive`, `@require`, `@key`). I confirmed against Grafbase's docs that **this stack has no OpenAPI→`schema.graphql` generator**. The REST extension exposes exactly two directives, both hand-authored, and the only CLI commands are `grafbase extension install/build` and `grafbase publish` — no introspect-from-OpenAPI, no scaffolder.

There *was* a native capability, but it belongs to the **legacy** stack:

### Legacy OpenAPI connector (deprecated Grafbase Edge / `grafbase.config.ts`)
The old TypeScript-SDK platform had a first-class `connector.OpenAPI`:

```ts
import { connector, graph } from '@grafbase/sdk'
const g = graph.Standalone()
const accounts = connector.OpenAPI('Accounts', {
  schema: 'http://localhost:3001/openapi.json',
  headers: (h) => h.set('X-Api-Key', g.env('ACCOUNTS_API_KEY')),
})
g.datasource(accounts)   // namespaces the generated types
```

How it worked and its limits:
- It **introspected the spec at dev/deploy time** and materialized a GraphQL API automatically — you did *not* maintain a `schema.graphql`.
- It generated **namespaced, 1:1 wrapper types** (one query field per operation). It could not express cross-service joins, entity keys, or derived fields.
- It's part of the sunset hosted platform and is **not compatible** with your `grafbase.toml` gateway + extensions setup. So it's not an option for you, even though it technically "does" OpenAPI→GraphQL.

## Why nothing fully generates *your* schema

This is the crux: **your `schema.graphql` encodes information that does not exist in any OpenAPI spec.** Look at what it does — `Account.policies` joins accounts→policies via `@require(field: "id")`, `FundHolding.fund` fans out via `@derive @is(field: "{ id: fundId }")`, `Fund @key(fields: "id")` is an entity resolved by a `@lookup`. Those are federation/composition semantics spanning three separate REST services. An OpenAPI spec describes one service's endpoints in isolation; it has no concept of "this `fundId` string is a foreign key into the funds service." So no generator can produce your graph — the interesting 60% is the wiring, which only you know.

## Recommended approaches for your setup

**1. Third-party OpenAPI→GraphQL generators — use only for a first-draft type layer.**
- [IBM `openapi-to-graphql`](https://github.com/IBM/openapi-to-graphql) and [OpenAPI Generator's `graphql-schema`](https://openapi-generator.tech/docs/generators/graphql-schema/) both emit SDL from a spec.
- Limitation: they emit **plain SDL with their own resolver assumptions** — no `@restEndpoint`/`@rest`/`@rest.selection`, no composite directives. You'd strip their query wrappers and re-add all the extension directives by hand. Net value: a starting set of `type` definitions, nothing more.

**2. Write a tiny scaffolder from `components.schemas` — best fit for you.** Since you just enriched [`server.js`](mock-rest-apis/accounts/server.js) so `/openapi.json` now carries real `components.schemas`, a ~40-line script can convert each schema into a GraphQL `type` plus a stub `@rest` field, then you fill in `selection` and the join directives. Rough sketch:

```js
// scaffold-schema.js — OpenAPI components.schemas -> GraphQL type stubs
const spec = await (await fetch('http://localhost:3001/openapi.json')).json();
const map = { string: 'String', number: 'Float', integer: 'Int', boolean: 'Boolean' };
for (const [name, s] of Object.entries(spec.components.schemas)) {
  const req = new Set(s.required || []);
  const fields = Object.entries(s.properties).map(([k, p]) => {
    let t = p.type === 'array'
      ? `[${p.items.$ref?.split('/').pop() ?? map[p.items.type]}!]`
      : p.$ref ? p.$ref.split('/').pop() : map[p.type] ?? 'String';
    return `  ${k}: ${t}${req.has(k) && !p.nullable ? '!' : ''}`;
  });
  console.log(`type ${name} {\n${fields.join('\n')}\n}\n`);
}
```

That deterministically gives you `Account`, `FundHolding`, etc. as GraphQL types straight from the spec — the mechanical part — leaving you to author only the `@rest`/composite directives.

**3. Best practice — keep `schema.graphql` hand-authored as the source of truth.** For a composite/federated graph, the SDL *is* the design artifact. Generation is useful for the boring type-mirroring; the resolver wiring and cross-service joins stay manual by nature. If you want introspection-style tooling, `grafbase introspect` works on a running **GraphQL** endpoint (to pull a subgraph's SDL), not on an OpenAPI document.

## Bottom line

| Approach | Auto-generates from OpenAPI? | Fits your stack? |
|---|---|---|
| REST extension (`@rest`) — your current setup | No | ✅ (manual) |
| Legacy `connector.OpenAPI` | ✅ Yes, at runtime | ❌ Deprecated, incompatible |
| IBM / OpenAPI-Generator SDL tools | Partial (types only) | ⚠️ Draft types, rewrite directives |
| Custom `components.schemas` scaffolder | Partial (types only) | ✅ Best trade-off |

No native OpenAPI→`schema.graphql` path exists for the gateway+extensions model. Generate the **type definitions** from your spec if you want to save keystrokes, but the `@restEndpoint`/`@rest`/`@derive`/`@require`/`@key` wiring — the actual value of your graph — is inherently hand-authored.

Want me to turn that scaffolder into a real `scripts/` file and an npm script (e.g. `npm run scaffold:schema`) that reads all three services' `/openapi.json` and emits draft types?

Sources: [Grafbase REST extension](https://grafbase.com/extensions/rest), [Grafbase OpenAPI connector docs (legacy)](https://grafbase.com/docs/connectors/openapi), [OpenAPI connector changelog](https://grafbase.com/changelog/openapi-connector), [IBM openapi-to-graphql](https://github.com/IBM/openapi-to-graphql), [OpenAPI Generator graphql-schema](https://openapi-generator.tech/docs/generators/graphql-schema/)