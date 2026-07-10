FROM node:20-alpine

WORKDIR /app

COPY grafbase.toml .
COPY schema.graphql .
COPY grafbase_extensions ./grafbase_extensions

RUN npm install -g grafbase

RUN npm list -g --depth=0
RUN which grafbase || true
RUN grafbase --version || true

EXPOSE 5050

CMD ["sh"]