#!/usr/bin/env bash
# ===========================================================================
# Publish the three subgraph schemas to the self-hosted Hive registry.
# ===========================================================================
# Runs inside the hive-cli container, on the Hive network, so it reaches the
# registry at http://server:3001/graphql rather than through a published port.
#
#   docker compose -f docker-compose.yml -f docker-compose.console.yml \
#     run --rm hive-cli hive/publish.sh
#
# Requires HIVE_TOKEN in .env (Target -> Settings -> Access Tokens, with
# "Publish schema" permission).
#
# The SDL files come from the supergraph volume, written by supergraph-compose
# out of the same modules the subgraph servers run. If they are missing, bring
# the POC up first so that build step runs.
# ===========================================================================
set -euo pipefail

REGISTRY="${HIVE_REGISTRY_ENDPOINT:-http://server:3001/graphql}"
SDL_DIR="${SDL_DIR:-/sdl/sdl}"
# Access tokens in Hive 15 are ORGANIZATION-scoped, so every CLI call has to
# name the target it acts on, as "<org>/<project>/<target>".
TARGET="${HIVE_TARGET:-}"

if [[ -z "${HIVE_TOKEN:-}" ]]; then
  echo "HIVE_TOKEN is not set."
  echo "Create an access token in Hive Console:"
  echo "  http://localhost:8080 -> organization -> Settings -> Access Tokens"
  echo "  permissions: Check schema, Publish schema, Push schema"
  echo "then put it in hive-router-poc/.env as HIVE_TOKEN=..."
  exit 1
fi

if [[ -z "$TARGET" ]]; then
  echo "HIVE_TARGET is not set."
  echo "It is the full path of the target, for example:"
  echo "  HIVE_TARGET=rest-demo/insurance-graph/development"
  echo "Set it in hive-router-poc/.env."
  exit 1
fi

# Subgraph name -> the URL the ROUTER will use to reach it. Hive bakes this
# into the composed supergraph, so it must be resolvable from the router's
# network, not from your laptop.
declare -A SUBGRAPH_URLS=(
  [accounts]="${ACCOUNTS_SUBGRAPH_URL:-http://accounts-subgraph:4001/graphql}"
  [policies]="${POLICIES_SUBGRAPH_URL:-http://policies-subgraph:4002/graphql}"
  [funds]="${FUNDS_SUBGRAPH_URL:-http://funds-subgraph:4003/graphql}"
)

echo "registry : $REGISTRY"
echo "target   : $TARGET"
echo "SDL dir  : $SDL_DIR"
echo

missing=0
for name in accounts policies funds; do
  [[ -f "$SDL_DIR/$name.graphql" ]] || { echo "missing $SDL_DIR/$name.graphql"; missing=1; }
done
if [[ $missing -eq 1 ]]; then
  echo
  echo "The subgraph SDL files are written by the supergraph-compose service."
  echo "Bring the POC up first:  docker compose up -d supergraph-compose"
  exit 1
fi

failed=0
for name in accounts policies funds; do
  url="${SUBGRAPH_URLS[$name]}"
  echo "--- publishing $name -> $url"
  # --force skips the interactive confirmation the CLI shows for a first
  # publish on a target; everything else is the documented invocation.
  if hive schema:publish "$SDL_DIR/$name.graphql" \
      --registry.endpoint "$REGISTRY" \
      --registry.accessToken "$HIVE_TOKEN" \
      --target "$TARGET" \
      --service "$name" \
      --url "$url" \
      --author "hive-router-poc" \
      --commit "$(date -u +%Y%m%d%H%M%S)" \
      --force; then
    echo "    published"
  else
    echo "    FAILED"
    failed=1
  fi
  echo
done

if [[ $failed -eq 1 ]]; then
  echo "At least one subgraph failed to publish. See the output above."
  exit 1
fi

echo "All three subgraphs published."
echo "Check composition in Hive Console: http://localhost:8080"
