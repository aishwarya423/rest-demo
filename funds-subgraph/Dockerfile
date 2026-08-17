# =============================================================================
# `funds` federation subgraph image (GraphQL Yoga + @apollo/subgraph).
# A real GraphQL subgraph over HTTP — the piece that makes entity caching work.
# Pairs with docker-compose.gateway.yml (service `funds-subgraph`, port 3009).
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

# install deps first (better layer caching). package-lock.json included when present.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js funds.graphql ./

EXPOSE 3009
CMD ["node", "server.js"]
