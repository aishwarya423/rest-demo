FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# SUBGRAPH selects which schema this container serves.
EXPOSE 4001
CMD ["node", "src/server.mjs"]
