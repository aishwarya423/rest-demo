#!/usr/bin/env bash
# ===========================================================================
# Run a Hive schema check against the self-hosted registry.
# ===========================================================================
#   # check all three subgraphs as they stand
#   docker compose -f docker-compose.yml -f docker-compose.console.yml \
#     run --rm hive-cli hive/check.sh
#
#   # check one subgraph against a modified SDL file
#   docker compose ... run --rm hive-cli hive/check.sh accounts /work/my-change.graphql
#
# A check composes the candidate schema against every OTHER registered
# subgraph and diffs it against the last published version. It writes nothing.
# Exit code is non-zero when the check reports a breaking change, which is what
# makes this usable as a CI gate.
# ===========================================================================
set -euo pipefail

REGISTRY="${HIVE_REGISTRY_ENDPOINT:-http://server:3001/graphql}"
SDL_DIR="${SDL_DIR:-/sdl/sdl}"
# Access tokens are organization-scoped, so the target must be named.
TARGET="${HIVE_TARGET:-}"

if [[ -z "${HIVE_TOKEN:-}" ]]; then
  echo "HIVE_TOKEN is not set. See hive/publish.sh for where to get one."
  exit 1
fi
if [[ -z "$TARGET" ]]; then
  echo "HIVE_TARGET is not set, e.g. rest-demo/insurance-graph/development"
  exit 1
fi

run_check() {
  local name="$1" file="$2"
  echo "--- checking $name  ($file)"
  if hive schema:check "$file" \
      --registry.endpoint "$REGISTRY" \
      --registry.accessToken "$HIVE_TOKEN" \
      --target "$TARGET" \
      --service "$name"; then
    echo "    no breaking changes"
    return 0
  fi
  echo "    check reported problems (exit $?)"
  return 1
}

if [[ $# -ge 1 ]]; then
  name="$1"
  file="${2:-$SDL_DIR/$name.graphql}"
  run_check "$name" "$file"
  exit $?
fi

failed=0
for name in accounts policies funds; do
  run_check "$name" "$SDL_DIR/$name.graphql" || failed=1
  echo
done

if [[ $failed -eq 1 ]]; then
  echo "One or more checks reported problems."
  exit 1
fi
echo "All three subgraphs check clean against the registry."
