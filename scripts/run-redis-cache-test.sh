#!/usr/bin/env bash
# =============================================================================
# RUN + TEST entity caching on REDIS — fully in Docker, one command.
#
#   scripts/run-redis-cache-test.sh
#
# Steps: clean slate -> start stack on Redis -> wait for gateway -> flush cache
# -> query across the subgraph boundary -> read the cache -> WRITE A REPORT FILE
# -> print PASS/FAIL. Leaves the stack running so you can poke at it.
#
# Output file: redis-cache-test-report.txt  (query response + cache keys + TTLs)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- backend (the ONLY difference vs the valkey script) --------------------
LABEL="REDIS"
CACHE_IMAGE="redis:7-alpine"
CACHE_CLI="redis-cli"
# ----------------------------------------------------------------------------

COMPOSE="docker compose -f docker-compose.gateway.yml"
GRAPHQL="http://localhost:5060/graphql"
QUERY='{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { id name currency } } } }"}'
REPORT="redis-cache-test-report.txt"

cli() { $COMPOSE exec -T redis "$CACHE_CLI" "$@" </dev/null; }

echo "==================================================================="
echo "  ${LABEL} — run + test entity caching (Docker)"
echo "==================================================================="

echo "[1/6] clean slate (compose down -v) ..."
$COMPOSE down -v >/dev/null 2>&1 || true

echo "[2/6] starting stack on ${LABEL} (${CACHE_IMAGE}) — build may take a minute ..."
CACHE_IMAGE="$CACHE_IMAGE" CACHE_CLI="$CACHE_CLI" $COMPOSE up --build -d >/dev/null

echo "[3/6] waiting for the gateway (${GRAPHQL}) ..."
ok="no"
for _ in $(seq 1 40); do
  if curl -sf "$GRAPHQL" -H 'content-type: application/json' \
       -d '{"query":"{ __typename }"}' >/dev/null 2>&1; then ok="yes"; break; fi
  sleep 2
done
if [ "$ok" != "yes" ]; then
  echo "  ERROR: gateway did not become ready"; $COMPOSE logs grafbase-gateway | tail -20; exit 1
fi

echo "[4/6] flushing cache + querying across the subgraph boundary (x2) ..."
cli FLUSHALL >/dev/null
RESP=$(curl -s "$GRAPHQL" -H 'content-type: application/json' -d "$QUERY")
curl -s "$GRAPHQL" -H 'content-type: application/json' -d "$QUERY" >/dev/null
sleep 1

echo "[5/6] reading the cache + writing ${REPORT} ..."
VER=$(cli INFO server 2>/dev/null | grep -iE 'server_name|valkey_version|redis_version' | tr -d '\r' | paste -sd' ' - || true)
ENTKEYS=$(cli --scan --pattern 'insurance-entitycache*' | tr -d '\r' | sort || true)
OPKEYS=$(cli --scan --pattern 'insurance-opcache*' | tr -d '\r' | sort || true)
ENT=$(printf '%s\n' "$ENTKEYS" | grep -c . || true)
OPS=$(printf '%s\n' "$OPKEYS" | grep -c . || true)
FIRST=$(printf '%s\n' "$ENTKEYS" | head -1)
TTL=0; [ -n "$FIRST" ] && TTL=$(cli TTL "$FIRST" | tr -d '\r')

{
  echo "############################################################"
  echo "#  ${LABEL} entity-caching test report"
  echo "#  $(date)"
  echo "############################################################"
  echo
  echo "backend image : ${CACHE_IMAGE}"
  echo "backend info  : ${VER}"
  echo "GraphQL       : ${GRAPHQL}"
  echo
  echo "== query =="
  echo "${QUERY}"
  echo
  echo "== response =="
  echo "${RESP}"
  echo
  echo "== entity-cache keys (${ENT}) =="
  printf '%s\n' "${ENTKEYS}"
  echo
  echo "== operation-cache keys (${OPS}) =="
  printf '%s\n' "${OPKEYS}"
  echo
  echo "== cache entries (KEY | TYPE | TTL) =="
  printf '%s\n' "${ENTKEYS}" "${OPKEYS}" | grep . | while IFS= read -r k; do
    t=$(cli TYPE "$k" | tr -d '\r'); l=$(cli TTL "$k" | tr -d '\r')
    echo "  ${k} | ${t} | ${l}s"
  done
  echo
} > "$REPORT"

echo "[6/6] verdict ..."
PASS="yes"
[ "${ENT:-0}" -ge 1 ] || { echo "  FAIL: no entity-cache keys — entity caching did NOT engage"; PASS="no"; }
[ "${OPS:-0}" -ge 1 ] || { echo "  FAIL: no operation-cache keys"; PASS="no"; }
[ "${TTL:-0}" -gt 0 ] 2>/dev/null || { echo "  FAIL: entity key has no TTL"; PASS="no"; }

echo
echo "backend   : ${VER}"
echo "entity    : ${ENT} key(s)  (expect 3)"
echo "operation : ${OPS} key(s)  (expect >= 1)"
echo "entity TTL: ${TTL}s"
echo "report    : ${REPORT}"
echo
if [ "$PASS" = "yes" ]; then echo "RESULT: PASS (${LABEL})"; else echo "RESULT: FAIL (${LABEL})"; fi
echo
echo "stack left running — GraphQL: ${GRAPHQL}"
echo "tear down when done:  ${COMPOSE} down -v"
[ "$PASS" = "yes" ]
