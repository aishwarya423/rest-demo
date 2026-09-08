# =============================================================================
# One image for all three tag-caching federation subgraphs.
#
# Which one runs is chosen at RUNTIME by $SUBGRAPH (accounts | policies | funds),
# because the three servers differ only in their SDL, resolvers and REST target —
# they share lib/cache.js and the same dependency set.
#
# Pairs with docker-compose.tagcache.yml.
# =============================================================================
FROM node:20-bookworm-slim

WORKDIR /app

# install deps first (better layer caching); package-lock.json included when present
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY lib ./lib
COPY accounts ./accounts
COPY policies ./policies
COPY funds ./funds

ENV SUBGRAPH=accounts
CMD ["sh", "-c", "node ${SUBGRAPH}/server.js"]
