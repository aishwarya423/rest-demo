# =============================================================================
# Production Grafbase Gateway, TRUE-FEDERATION topology (no REST extension),
# built ONLY for the gateway-evaluation spike's Docker-vs-Docker performance
# comparison against the Hive Router container (both reach the three
# subgraphs via host.docker.internal, so neither gets a "runs natively on the
# host" networking advantage over the other).
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g grafbase

RUN curl -fsSL https://grafbase.com/downloads/gateway | sh \
 && mv ./grafbase-gateway /usr/local/bin/grafbase-gateway \
 && grafbase-gateway --version

COPY grafbase-federation/grafbase.docker.toml ./grafbase.toml
COPY accounts-subgraph/accounts.graphql ./accounts-subgraph/accounts.graphql
COPY policies-subgraph/policies.graphql ./policies-subgraph/policies.graphql
COPY funds-subgraph/funds.graphql ./funds-subgraph/funds.graphql

RUN grafbase compose -c grafbase.toml > /app/federated.graphql

EXPOSE 5072
CMD ["grafbase-gateway", "--config", "grafbase.toml", "--schema", "/app/federated.graphql", "--listen-address", "0.0.0.0:5072"]
