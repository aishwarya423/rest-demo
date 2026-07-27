# Toolbox image for the schema-gen npm scripts (schema:generate / schema:validate[:e2e]).
#
# Exists because `npm install` for the `yaml` devDependency (and `npx grafbase`'s
# registry fetch) can fail behind a corporate proxy. Building this image once
# bakes both in; after that, all schema-gen work runs in the container with the
# repo bind-mounted, so generated files are written straight back to your working
# tree — see schema-gen/DOCKER.md for usage.
FROM node:20-alpine

WORKDIR /app

# validate.sh is a bash script; alpine's default shell is ash/sh, not bash.
RUN apk add --no-cache bash curl

# Same proxy/SSL escape hatch already used by the root Dockerfile.
ARG NPM_STRICT_SSL=false
RUN npm config set strict-ssl ${NPM_STRICT_SSL}

COPY package.json package-lock.json ./
RUN npm install

# grafbase CLI, used by schema-gen/validate/validate.sh via `npx grafbase`.
# Installed globally so npx resolves it from PATH instead of hitting the registry.
RUN npm install -g grafbase

CMD ["sh"]
