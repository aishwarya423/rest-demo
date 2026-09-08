#!/usr/bin/env sh
# =============================================================================
# Entrypoint for the gateway of the TAG-CACHING stack
# (docker-compose.tagcache.yml + grafbase.tagcache.toml).
#
# Same shape as gateway-entrypoint.sh, minus the REST extension and Redis
# rewrites — this gateway does no caching of its own; the subgraphs cache their
# REST calls themselves. At startup we:
#   1. rewrite subgraph URLs + schema paths for the compose network
#   2. compose the 3-subgraph federated schema
#   3. exec grafbase-gateway
# =============================================================================
set -e
cd /app

echo "[tagcache-gateway] 1/3 rewriting subgraph URLs + schema paths for Docker"
sed -e 's|http://localhost:3011|http://accounts-subgraph:3011|' \
    -e 's|http://localhost:3013|http://policies-subgraph:3013|' \
    -e 's|http://localhost:3012|http://funds-subgraph:3012|' \
    -e 's|schema_path = "subgraphs/|schema_path = "/app/subgraphs/|' \
    grafbase.tagcache.toml > /tmp/grafbase.tagcache.docker.toml

echo "[tagcache-gateway] 2/3 composing federated schema"
grafbase compose -c /tmp/grafbase.tagcache.docker.toml > /tmp/federated.tagcache.graphql

echo "[tagcache-gateway] 3/3 starting grafbase-gateway on 0.0.0.0:5070"
exec grafbase-gateway \
  --config /tmp/grafbase.tagcache.docker.toml \
  --schema /tmp/federated.tagcache.graphql \
  --listen-address 0.0.0.0:5070
