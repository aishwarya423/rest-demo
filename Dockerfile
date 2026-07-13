FROM node:20-alpine

WORKDIR /app

ARG NPM_STRICT_SSL=false
RUN npm config set strict-ssl ${NPM_STRICT_SSL}

COPY grafbase.toml .
COPY schema.graphql .
COPY grafbase_extensions ./grafbase_extensions

RUN npm install -g grafbase

RUN npm list -g --depth=0
RUN which grafbase || true
RUN grafbase --version || true

EXPOSE 5050

CMD ["sh"]