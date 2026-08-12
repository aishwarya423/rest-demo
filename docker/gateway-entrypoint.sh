#!/usr/bin/env sh
# =============================================================================
# Entrypoint for the production Grafbase Gateway (Dockerfile.gateway).
#
# The production gateway needs a PRE-COMPOSED federated schema, and — running
# inside the compose network — must reach the mock REST services by their docker
# service names (not localhost). So at startup we:
#   1. rewrite the schema baseURLs  localhost -> compose service names
#   2. point schema_path at the rewritten schema
#   3. compose the federated schema
#   4. exec grafbase-gateway
#
# Env vars expected (set by docker-compose.gateway.yml):
#   REDIS_URL, ACCOUNTS_API_KEY, POLICIES_API_KEY, FUNDS_API_KEY
# =============================================================================
set -e
cd /app

echo "[gateway] 1/4 rewriting REST baseURLs (localhost -> compose service names)"
sed -e 's|http://localhost:3001|http://accounts-rest:3001|' \
    -e 's|http://localhost:3003|http://policies-rest:3003|' \
    -e 's|http://localhost:3002|http://funds-rest:3002|' \
    schema.graphql > /tmp/schema.docker.graphql

echo "[gateway] 2/4 rewriting config paths + Redis endpoint (REDIS_URL=${REDIS_URL})"
# The gateway resolves relative paths in the config against the CONFIG FILE's
# directory (/tmp here), so make the extension path absolute to /app; schema_path
# points at the rewritten schema (ignored by the gateway at runtime, used by compose).
# Also substitute the Redis endpoint from $REDIS_URL — the gateway does NOT
# interpolate {{ env.* }} in the caching redis.url, so we do it here.
REDIS_URL="${REDIS_URL:-redis://redis:6379}"
sed -e 's|schema_path = "schema.graphql"|schema_path = "/tmp/schema.docker.graphql"|' \
    -e 's|path = "grafbase_extensions/rest/0.5.2"|path = "/app/grafbase_extensions/rest/0.5.2"|' \
    -e "s|redis://redis:6379|${REDIS_URL}|g" \
    grafbase.toml > /tmp/grafbase.docker.toml

echo "[gateway] 3/4 composing federated schema"
grafbase compose -c /tmp/grafbase.docker.toml > /tmp/federated.graphql

echo "[gateway] 4/4 starting grafbase-gateway on 0.0.0.0:5060 (REDIS_URL=${REDIS_URL})"
exec grafbase-gateway \
  --config /tmp/grafbase.docker.toml \
  --schema /tmp/federated.graphql \
  --listen-address 0.0.0.0:5060
