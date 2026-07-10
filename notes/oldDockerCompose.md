services:
  accounts-rest:
    build:
      context: ./mock-rest-apis/accounts
    environment:
      SERVICE_NAME: accounts
      PORT: 3000
      EXPECTED_API_KEY: ${ACCOUNTS_API_KEY:-accounts-local-key}
    ports:
      - "3001:3000"

  policies-rest:
    build:
      context: ./mock-rest-apis/policies
    environment:
      SERVICE_NAME: policies
      PORT: 3000
      EXPECTED_API_KEY: ${POLICIES_API_KEY:-policies-local-key}
    ports:
      - "3002:3000"

  funds-rest:
    build:
      context: ./mock-rest-apis/funds
    environment:
      SERVICE_NAME: funds
      PORT: 3000
      EXPECTED_API_KEY: ${FUNDS_API_KEY:-funds-local-key}
    ports:
      - "3003:3000"

  # valkey:
  #   image: valkey/valkey:8-alpine
  #   restart: unless-stopped
  #   ports:
  #     - "6379:6379"
  #   volumes:
  #     - valkey-data:/data
  #   healthcheck:
  #     test: ["CMD", "valkey-cli", "ping"]
  #     interval: 5s
  #     timeout: 3s
  #     retries: 5

  grafbase:
    # Enterprise image — required for persistent Redis/Valkey entity caching.
    # Set GRAFBASE_LICENSE_KEY in .env (get the key from https://grafbase.com dashboard).
    image: ghcr.io/grafbase/gateway:latest
    # environment:
    #   GRAFBASE_LICENSE_KEY: ${GRAFBASE_LICENSE_KEY}
    command:
      - --config
      - /etc/grafbase/grafbase.toml
      - --schema
      - /etc/grafbase/supergraph.graphql
      - --listen-address
      - 0.0.0.0:5000
    volumes:
      - ./grafbase/grafbase.toml:/etc/grafbase/grafbase.toml:ro
      - ./grafbase/supergraph.graphql:/etc/grafbase/supergraph.graphql:ro
    ports:
      - "5050:5000"
    # depends_on:
      # valkey:
      #   condition: service_healthy

  graphiql:
    build:
      context: ./explorer
    ports:
      - "8080:8080"
    depends_on:
      - grafbase

# volumes:
#   valkey-data: