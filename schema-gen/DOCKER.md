# Running schema-gen via Docker

`schema:generate` needs the `yaml` npm package, and `schema:validate[:e2e]` needs
the `grafbase` CLI (fetched via `npx`) — both of those `npm install`s can fail
behind a corporate proxy. This gives you a toolbox container with both baked
in already, so nothing gets installed on your host.

The repo is bind-mounted into the container, so anything the scripts write
(`schema-gen/generated/`, `schema-gen/schema.generated.graphql`,
`schema-gen/validate/composed.federated.graphql`, ...) lands straight back in
your working tree, same as running the scripts locally.

## One-time setup

Build the image (only needs to be redone if `package.json` or
`schema-gen/Dockerfile` change):

```bash
docker compose build schema-gen
```

If your proxy does TLS interception and `npm install` still fails inside the
build, pass `--build-arg NPM_STRICT_SSL=true` (or configure npm's proxy/CA
settings) — same escape hatch the root `Dockerfile` already uses.

## Everyday use

```bash
docker compose run --rm schema-gen npm run schema:generate
docker compose run --rm schema-gen npm run schema:validate
```

## e2e validation

`schema:validate:e2e` additionally starts a gateway and hits the three mock
REST APIs on `localhost:3001-3003`, so start those first:

```bash
docker compose up -d accounts-rest policies-rest funds-rest
docker compose run --rm schema-gen npm run schema:validate:e2e
docker compose down
```

The `schema-gen` service runs with `network_mode: host` so its `localhost`
checks can reach the other containers' published ports. On Docker Desktop
(Mac/Windows) this requires host networking to be enabled under
**Settings → Resources → Network**; on Linux it works out of the box.

## Promoting the schema

`schema:promote` just copies a file — no dependencies involved, so run it
directly with `npm run schema:promote`, no Docker needed.
