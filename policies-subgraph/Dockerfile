# =============================================================================
# `policies` federation subgraph image (GraphQL Yoga + @apollo/subgraph).
# Mirrors funds-subgraph/Dockerfile.
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js policies.graphql ./

EXPOSE 3011
CMD ["node", "server.js"]
