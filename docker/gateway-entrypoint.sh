#!/usr/bin/env sh
# =============================================================================
# Entrypoint for the production Grafbase Gateway (Dockerfile.gateway).
#
# The production gateway needs a PRE-COMPOSED federated schema, and — running
# inside the compose network — must reach the other services by their docker
# service names (not localhost). So at startup we:
#   1. rewrite the REST baseURLs in schema.graphql  localhost -> service names
#   2. rewrite the config: schema paths (absolute), the funds subgraph URL
#      (localhost -> service name), and the Redis endpoint ($REDIS_URL)
#   3. compose the federated schema
#   4. exec grafbase-gateway
#
# Env vars expected (set by docker-compose.gateway.yml):
#   REDIS_URL, ACCOUNTS_API_KEY, POLICIES_API_KEY
#   (FUNDS_API_KEY is used by the separate `funds-subgraph` service, not here.)
#
# ─── REST UPSTREAMS ──────────────────────────────────────────────────────────
# ACCOUNTS_UPSTREAM / POLICIES_UPSTREAM select what the REST extension talks to.
# They default to the REST services DIRECTLY (original behaviour). Compose points
# them at the `rest-cache` proxy instead, which adds a tag-invalidated cache in
# front — see rest-cache/README.md. Flipping the cache in or out is therefore
# ONE env var per service, and schema.graphql is never edited (it is regenerated
# by schema-gen and would lose the change).
# =============================================================================
set -e
cd /app

ACCOUNTS_UPSTREAM="${ACCOUNTS_UPSTREAM:-http://accounts-rest:3001}"
POLICIES_UPSTREAM="${POLICIES_UPSTREAM:-http://policies-rest:3003}"
FUNDS_UPSTREAM="${FUNDS_UPSTREAM:-http://funds-rest:3002}"

# Grafbase's entity cache sits IN FRONT of rest-cache for the funds subgraph, so
# it will keep serving a stale `_entities` response for its whole TTL even after
# rest-cache has been invalidated. Default it low so tag invalidation is visible;
# set FUNDS_ENTITY_TTL=120s to restore the original entity-caching demo.
FUNDS_ENTITY_TTL="${FUNDS_ENTITY_TTL:-5s}"

echo "[gateway] 1/4 rewriting REST baseURLs (localhost -> upstreams)"
echo "[gateway]     accounts -> ${ACCOUNTS_UPSTREAM}"
echo "[gateway]     policies -> ${POLICIES_UPSTREAM}"
echo "[gateway]     funds entity-cache ttl -> ${FUNDS_ENTITY_TTL}"
sed -e "s|http://localhost:3001|${ACCOUNTS_UPSTREAM}|" \
    -e "s|http://localhost:3003|${POLICIES_UPSTREAM}|" \
    -e "s|http://localhost:3002|${FUNDS_UPSTREAM}|" \
    schema.graphql > /tmp/schema.docker.graphql

echo "[gateway] 2/4 rewriting config (paths, funds subgraph URL, Redis endpoint)"
# Relative paths in the config resolve against the CONFIG FILE's dir (/tmp here),
# so make the extension + funds SDL paths absolute to /app. The insurance
# schema_path points at the rewritten copy. The funds subgraph URL and the Redis
# endpoint are rewritten to their compose service names / $REDIS_URL (the gateway
# does NOT interpolate {{ env.* }} in these fields).
REDIS_URL="${REDIS_URL:-redis://redis:6379}"
sed -e 's|schema_path = "schema.graphql"|schema_path = "/tmp/schema.docker.graphql"|' \
    -e 's|schema_path = "funds-subgraph/funds.graphql"|schema_path = "/app/funds-subgraph/funds.graphql"|' \
    -e 's|path = "grafbase_extensions/rest/0.5.2"|path = "/app/grafbase_extensions/rest/0.5.2"|' \
    -e 's|http://localhost:3009|http://funds-subgraph:3009|' \
    -e "s|redis://redis:6379|${REDIS_URL}|g" \
    -e "s|ttl = \"120s\"|ttl = \"${FUNDS_ENTITY_TTL}\"|" \
    grafbase.toml > /tmp/grafbase.docker.toml

echo "[gateway] 3/4 composing federated schema"
grafbase compose -c /tmp/grafbase.docker.toml > /tmp/federated.graphql

echo "[gateway] 4/4 starting grafbase-gateway on 0.0.0.0:5060 (REDIS_URL=${REDIS_URL})"
exec grafbase-gateway \
  --config /tmp/grafbase.docker.toml \
  --schema /tmp/federated.graphql \
  --listen-address 0.0.0.0:5060
