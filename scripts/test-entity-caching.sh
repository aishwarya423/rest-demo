#!/usr/bin/env bash
# =============================================================================
# Automated entity-caching test — all Docker, against Redis and/or Valkey.
#
# Brings up the production-gateway stack (mocks + funds subgraph + cache +
# gateway), fires a cross-subgraph query, and ASSERTS that entity caching
# populated the cache (one key per Fund), that operation caching populated, and
# that entity keys carry a TTL. Prints PASS/FAIL and exits non-zero on failure.
#
# Usage:
#   scripts/test-entity-caching.sh [redis|valkey|both] [--keep]
#     redis  (default) : test against Redis  (redis:7-alpine)
#     valkey           : test against Valkey (valkey/valkey:8-alpine)
#     both             : run redis then valkey
#     --keep           : leave the stack running after the test (default: down)
#
# Examples:
#   scripts/test-entity-caching.sh
#   scripts/test-entity-caching.sh valkey
#   scripts/test-entity-caching.sh both
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.gateway.yml"
GRAPHQL="http://localhost:5060/graphql"
QUERY='{"query":"{ account(id:\"acct-1001\"){ fundHoldings { fund { id name currency } } } }"}'
KEEP="no"

MODE="${1:-redis}"
[ "${2:-}" = "--keep" ] && KEEP="yes"
[ "${1:-}" = "--keep" ] && { MODE="redis"; KEEP="yes"; }

run_one() {
  backend="$1"
  case "$backend" in
    redis)  img="redis:7-alpine";         cli="redis-cli" ;;
    valkey) img="valkey/valkey:8-alpine";  cli="valkey-cli" ;;
    *) echo "unknown backend '$backend' (use redis|valkey|both)"; return 2 ;;
  esac

  echo "======================================================================"
  echo "  entity-caching test :: backend=$backend  image=$img  cli=$cli"
  echo "======================================================================"

  echo "[1/5] starting stack ..."
  CACHE_IMAGE="$img" CACHE_CLI="$cli" $COMPOSE up --build -d >/dev/null

  echo "[2/5] waiting for the gateway to be ready ..."
  ready="no"
  for _ in $(seq 1 40); do
    if curl -sf "$GRAPHQL" -H 'content-type: application/json' \
         -d '{"query":"{ __typename }"}' >/dev/null 2>&1; then ready="yes"; break; fi
    sleep 2
  done
  if [ "$ready" != "yes" ]; then
    echo "  FAIL: gateway did not become ready"; $COMPOSE logs grafbase-gateway | tail -20
    [ "$KEEP" = "yes" ] || $COMPOSE down >/dev/null 2>&1; return 1
  fi

  echo "[3/5] flushing cache + firing the cross-subgraph query (x2) ..."
  $COMPOSE exec -T redis "$cli" FLUSHALL >/dev/null
  for _ in 1 2; do curl -s "$GRAPHQL" -H 'content-type: application/json' -d "$QUERY" >/dev/null; done
  sleep 1

  echo "[4/5] reading cache ..."
  ent=$($COMPOSE exec -T redis "$cli" --scan --pattern 'insurance-entitycache*' | grep -c . | tr -d ' ')
  ops=$($COMPOSE exec -T redis "$cli" --scan --pattern 'insurance-opcache*' | grep -c . | tr -d ' ')
  k=$($COMPOSE exec -T redis "$cli" --scan --pattern 'insurance-entitycache*' | head -1 | tr -d '\r')
  ttl="0"; [ -n "$k" ] && ttl=$($COMPOSE exec -T redis "$cli" TTL "$k" | tr -d '\r')
  ver=$($COMPOSE exec -T redis "$cli" INFO server 2>/dev/null | grep -iE 'valkey_version|redis_version|server_name' | tr -d '\r' | paste -sd' ' -)

  echo "      backend        : $ver"
  echo "      entity-cache   : $ent key(s)   (expect 3)"
  echo "      operation-cache: $ops key(s)   (expect >= 1)"
  echo "      entity TTL     : ${ttl}s        (expect > 0)"

  echo "[5/5] asserting ..."
  pass="yes"
  [ "$ent" -ge 1 ] || { echo "  FAIL: no entity-cache keys — entity caching did NOT engage"; pass="no"; }
  [ "$ops" -ge 1 ] || { echo "  FAIL: no operation-cache keys"; pass="no"; }
  [ "$ttl" -gt 0 ] 2>/dev/null || { echo "  FAIL: entity key has no TTL"; pass="no"; }

  if [ "$KEEP" = "yes" ]; then
    echo "  (stack left running — GraphQL: $GRAPHQL)"
  else
    $COMPOSE down >/dev/null 2>&1
  fi

  if [ "$pass" = "yes" ]; then echo "  RESULT: PASS ($backend)"; return 0
  else echo "  RESULT: FAIL ($backend)"; return 1; fi
}

rc=0
case "$MODE" in
  both)
    run_one redis  || rc=1
    run_one valkey || rc=1
    echo "======================================================================"
    [ "$rc" -eq 0 ] && echo "OVERALL: PASS (redis + valkey)" || echo "OVERALL: FAIL"
    ;;
  redis|valkey)
    run_one "$MODE" || rc=1
    ;;
  *)
    echo "usage: $0 [redis|valkey|both] [--keep]"; exit 2 ;;
esac
exit "$rc"
