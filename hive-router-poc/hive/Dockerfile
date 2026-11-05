# Hive CLI, used to talk to the self-hosted registry.
#
# There is no official ghcr.io/graphql-hive/cli image -- the Hive docs ship the
# CLI as a standalone binary or an npm package. Installing the npm package into
# a small Node image keeps the version pinned and avoids re-downloading it on
# every `docker compose run`.
FROM node:22-alpine

# Pin: must be compatible with the registry release in .env (HIVE_VERSION).
ARG HIVE_CLI_VERSION=0.68.2
RUN npm install --global --no-audit --no-fund "@graphql-hive/cli@${HIVE_CLI_VERSION}"

# bash for the publish/check scripts; curl to probe the artifact endpoints.
RUN apk add --no-cache bash curl jq

WORKDIR /work
ENTRYPOINT ["/bin/bash"]
