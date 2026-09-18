FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY gateway.config.ts tagged-cache.ts ./

EXPOSE 4000

# Shell form so $SUPERGRAPH_PATH is expanded. The config flag is -c, not
# --config, and the config file must be named explicitly because Hive only
# auto-discovers `gateway.ts`.
CMD npx hive-gateway supergraph "${SUPERGRAPH_PATH:-/supergraph/supergraph.graphql}" \
    -c /app/gateway.config.ts --host 0.0.0.0 --port 4000
