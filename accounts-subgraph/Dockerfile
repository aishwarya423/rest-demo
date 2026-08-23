# =============================================================================
# `accounts` federation subgraph image (GraphQL Yoga + @apollo/subgraph).
# Mirrors funds-subgraph/Dockerfile.
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js accounts.graphql ./

EXPOSE 3010
CMD ["node", "server.js"]
