#!/usr/bin/env sh
# =============================================================================
# Entrypoint for the gateway running the FORKED, CACHING rest extension
# (grafbase.cached.toml + grafbase_extensions/rest-cached/build).
#
# Sibling of gateway-entrypoint.sh. Differences: one virtual subgraph instead of
# two, the extension path points at the fork, and the Redis endpoint the
# EXTENSION uses is substituted here (the gateway itself does no caching in this
# setup, so there is nothing to rewrite in [entity_caching]).
#
# Env: REDIS_URL, ACCOUNTS_API_KEY, POLICIES_API_KEY, FUNDS_API_KEY
# =============================================================================
set -e
cd /app

REDIS_URL="${REDIS_URL:-redis://valkey:6379}"

echo "[cached-gateway] 1/3 rewriting config (paths + cache endpoint ${REDIS_URL})"
# Relative paths resolve against the CONFIG FILE's directory (/tmp here), so
# make them absolute to /app.
sed -e 's|path = "grafbase_extensions/rest-cached/build"|path = "/app/grafbase_extensions/rest-cached/build"|' \
    -e 's|schema_path = "schema-gen/schema.generated.graphql"|schema_path = "/app/schema-gen/schema.generated.graphql"|' \
    -e "s|redis://redis:6379|${REDIS_URL}|g" \
    grafbase.cached.toml > /tmp/grafbase.cached.docker.toml

echo "[cached-gateway] 2/3 composing federated schema"
grafbase compose -c /tmp/grafbase.cached.docker.toml > /tmp/federated.cached.graphql

echo "[cached-gateway] 3/3 starting grafbase-gateway on 0.0.0.0:5065"
exec grafbase-gateway \
  --config /tmp/grafbase.cached.docker.toml \
  --schema /tmp/federated.cached.graphql \
  --listen-address 0.0.0.0:5065
