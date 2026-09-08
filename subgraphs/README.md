# `subgraphs/` — REST-backed federation subgraphs with tag-based caching

Three GraphQL federation subgraphs (GraphQL Yoga + `@apollo/subgraph`), each a
thin facade over one mock REST service, each caching its own REST calls in
Valkey with entity tags and exposing a purge API.

```
lib/cache.js        the whole cache: key naming, tagsForRoute(), cachedRequestJson(),
                    purgeTags(), and the management HTTP server
accounts/           Account entity      -> accounts REST :3001   graphql :3011  mgmt :4011
policies/           Policy entity, and  -> policies REST :3003   graphql :3013  mgmt :4013
                    Account.policies / Fund.policies
funds/              Fund entity         -> funds REST :3002      graphql :3012  mgmt :4012
Dockerfile          one image for all three; $SUBGRAPH picks the server
```

Full explanation, run instructions and caveats: [`../Docs/CACHE-TAGS.md`](../Docs/CACHE-TAGS.md).

## Run

In Docker (recommended — this is what the compose stack does):

```bash
npm run tagcache:up          # from the repo root
```

On the host (needs the mock REST APIs and a Valkey/Redis on :6379):

```bash
npm run mock-apis            # repo root, terminal 1
cd subgraphs && npm install
REDIS_URL=redis://localhost:6379 npm run start:accounts   # terminal 2
REDIS_URL=redis://localhost:6379 npm run start:policies   # terminal 3
REDIS_URL=redis://localhost:6379 npm run start:funds      # terminal 4
```

Set `REDIS_URL=disabled` to run a subgraph with caching off (every request hits
REST) — handy when debugging resolvers.

## Not the same as `../funds-subgraph/`

`funds-subgraph/` exists to demonstrate the **gateway's** entity caching
(`insurance-entitycache*` keys, `docker-compose.gateway.yml`). It does no caching
of its own. `subgraphs/funds/` is the tag-caching version of the same subgraph.
