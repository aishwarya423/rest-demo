# Build context is the REPO ROOT so the existing OpenAPI specs can be copied in.
FROM node:22-alpine
WORKDIR /app/hive-poc/mesh

COPY hive-poc/mesh/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY hive-poc/mesh/mesh.config.ts ./

# The three REST contracts. Read-only inputs; the services are never modified.
COPY mock-rest-apis/accounts/openapi.yaml /app/mock-rest-apis/accounts/openapi.yaml
COPY mock-rest-apis/policies/openapi.yaml /app/mock-rest-apis/policies/openapi.yaml
COPY mock-rest-apis/funds/openapi.yaml    /app/mock-rest-apis/funds/openapi.yaml

# One-shot job: writes the composed supergraph into the shared volume.
CMD ["npx", "mesh-compose", "-o", "/out/supergraph.graphql"]
