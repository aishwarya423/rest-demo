# =============================================================================
# `rest-cache` image — tag-invalidated cache at the REST boundary.
# One process, three listeners (accounts :3101, funds :3102, policies :3103).
# Pairs with docker-compose.gateway.yml (service `rest-cache`).
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

# install deps first (better layer caching). package-lock.json included when present.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js tags.js ./

EXPOSE 3101 3102 3103
CMD ["node", "server.js"]
