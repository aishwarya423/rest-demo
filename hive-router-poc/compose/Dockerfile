# Build context is hive-router-poc/ so the subgraph SDLs can be imported.
FROM node:22-alpine
WORKDIR /app

# Install at /app, not /app/compose. The composer imports the subgraph modules
# from /app/subgraphs/src, and Node resolves their `graphql-tag` import by
# walking up to /app/node_modules. Installing inside /app/compose would put
# node_modules out of that search path and the import would fail.
COPY compose/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY compose/compose.mjs ./compose/
# Imported directly, so the composed SDL and the running schema cannot drift.
COPY subgraphs/src ./subgraphs/src

# One-shot job: writes the supergraph into the shared volume and exits.
CMD ["node", "compose/compose.mjs", "/out/supergraph.graphql"]
