#!/usr/bin/env bash
# =============================================================================
# RUN + TEST the TAG-BASED REST CACHE — fully in Docker, one command.
#
#   scripts/run-tag-cache-test.sh
#
# Steps: clean slate -> start the tagcache stack -> wait for the gateway ->
# flush the cache -> query across all three subgraphs while capturing
# `valkey-cli MONITOR` -> show keys/tags/TTLs -> prove the 2nd query is served
# from cache -> PURGE BY TAG and prove the right entries (and only those) died
# -> WRITE A REPORT FILE -> print PASS/FAIL. Leaves the stack running.
#
# Output file: tag-cache-test-report.txt
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.tagcache.yml"
CACHE_CLI="${CACHE_CLI:-valkey-cli}"
GRAPHQL="http://localhost:5070/graphql"
ACCOUNTS_MGMT="http://localhost:4011"
REPORT="tag-cache-test-report.txt"
MONITOR_LOG="tag-cache-monitor.txt"

# One query that crosses ALL THREE subgraphs: account (accounts) -> policies
# (policies) -> fundHoldings.fund (funds).
QUERY='{"query":"{ account(id:\"acct-1001\"){ holderName policies { policyNumber } fundHoldings { fund { id name } } } }"}'

cli() { $COMPOSE exec -T valkey "$CACHE_CLI" "$@" </dev/null | tr -d '\r'; }
gql() { curl -s "$GRAPHQL" -H 'content-type: application/json' -d "$QUERY"; }
hits() { $COMPOSE logs --since "${1}s" accounts-subgraph policies-subgraph funds-subgraph 2>&1 \
           | grep -oE '\[cache (HIT|MISS)\]  ?subgraph:.*' | sort || true; }

echo "==================================================================="
echo "  TAG-BASED REST CACHE — run + test (Docker / Valkey)"
echo "==================================================================="

echo "[1/7] clean slate (compose down -v) ..."
$COMPOSE down -v >/dev/null 2>&1 || true

echo "[2/7] starting the tagcache stack — build may take a minute ..."
$COMPOSE up --build -d >/dev/null

echo "[3/7] waiting for the gateway (${GRAPHQL}) ..."
ok="no"
for _ in $(seq 1 40); do
  if curl -sf "$GRAPHQL" -H 'content-type: application/json' \
       -d '{"query":"{ __typename }"}' >/dev/null 2>&1; then ok="yes"; break; fi
  sleep 2
done
if [ "$ok" != "yes" ]; then
  echo "  ERROR: gateway did not become ready"; $COMPOSE logs tagcache-gateway | tail -20; exit 1
fi

echo "[4/7] cold query (cache flushed) while capturing valkey MONITOR ..."
cli FLUSHALL >/dev/null
# busybox `timeout` bounds the capture so the script never hangs on MONITOR.
$COMPOSE exec -T valkey sh -c "timeout 8 $CACHE_CLI MONITOR" > "$MONITOR_LOG" 2>&1 &
MON_PID=$!
sleep 2
COLD_RESP=$(gql)
sleep 1
COLD_TRACE=$(hits 6)
wait $MON_PID 2>/dev/null || true
MONITOR=$(grep -vE '"(ping|COMMAND|INFO)"' "$MONITOR_LOG" | cut -c1-160 || true)

echo "[5/7] warm query (should be served entirely from cache) ..."
sleep 1
WARM_RESP=$(gql)
sleep 1
WARM_TRACE=$(hits 4)

KEYS=$(cli --scan --pattern 'subgraph:*' | sort)
TAGS=$(cli --scan --pattern 'tag:*' | sort)
TTLS=""
for k in $(printf '%s\n' "$KEYS" "$TAGS"); do
  # NB: $( ) strips the trailing newline, so re-add it with $'\n'.
  TTLS="${TTLS}$(printf '  %-52s %s' "$k" "$(cli TTL "$k")")"$'\n'
done
TAGMEMBERS=$(curl -s "${ACCOUNTS_MGMT}/tags/Account:acct-1001")

echo "[6/7] purging tag Account:acct-1001 (via the accounts management API) ..."
PURGE=$(curl -s -XPOST "${ACCOUNTS_MGMT}/purge" -H 'content-type: application/json' \
          -d '{"tags":["Account:acct-1001"]}')
KEYS_AFTER=$(cli --scan --pattern 'subgraph:*' | sort)
sleep 1
gql >/dev/null
sleep 1
REPURGE_TRACE=$(hits 4)

echo "[7/7] writing ${REPORT} ..."

# ---- assertions -------------------------------------------------------------
fail=0
note() { echo "  $1"; RESULTS="${RESULTS}  $1"$'\n'; }
RESULTS=""
check() { # check <description> <condition-result>
  if [ "$2" = "0" ]; then note "PASS  $1"; else note "FAIL  $1"; fail=1; fi
}

echo "$COLD_RESP" | grep -q '"holderName":"Anika Rao"'; check "query returns data across all 3 subgraphs" $?
echo "$KEYS" | grep -q '^subgraph:accounts:/accounts/acct-1001$'; check "accounts entry cached" $?
echo "$KEYS" | grep -q '^subgraph:policies:/accounts/acct-1001/policies$'; check "policies entry cached" $?
echo "$KEYS" | grep -q '^subgraph:funds:/funds/fund-global-equity$'; check "funds entries cached (one per Fund)" $?
echo "$TAGS" | grep -q '^tag:Account:acct-1001$'; check "per-entity tag index created" $?
echo "$TAGMEMBERS" | grep -q 'subgraph:accounts:' && echo "$TAGMEMBERS" | grep -q 'subgraph:policies:'
check "tag Account:acct-1001 spans BOTH accounts and policies entries" $?
echo "$COLD_TRACE" | grep -q 'cache MISS'; check "cold query recorded MISSes" $?
[ -z "$(echo "$WARM_TRACE" | grep 'cache MISS' || true)" ] && echo "$WARM_TRACE" | grep -q 'cache HIT'
check "warm query served entirely from cache (no MISS, REST not called)" $?
echo "$PURGE" | grep -q '"purgedKeys":2'; check "purge removed exactly the 2 tagged keys" $?
[ -z "$(echo "$KEYS_AFTER" | grep -E 'accounts:/accounts/acct-1001|policies:/accounts/acct-1001/policies' || true)" ]
check "purged entries gone from the cache" $?
echo "$KEYS_AFTER" | grep -q '^subgraph:funds:/funds/fund-global-equity$'; check "untagged-by-that-tag funds entries survived" $?
echo "$REPURGE_TRACE" | grep -q 'cache MISS.*accounts'; check "post-purge query re-fetched accounts from REST" $?
echo "$REPURGE_TRACE" | grep -q 'cache HIT.*funds'; check "post-purge query still hit cache for funds" $?

{
  echo "==================================================================="
  echo " TAG-BASED REST CACHE — test report"
  echo " $(date)"
  echo "==================================================================="
  echo
  echo "STACK   docker-compose.tagcache.yml (gateway :5070, mgmt :4011/:4012/:4013)"
  echo "CACHE   $(cli INFO server | grep -iE 'server_name|valkey_version|redis_version' | paste -sd' ' -)"
  echo "QUERY   { account(id:\"acct-1001\"){ holderName policies { policyNumber }"
  echo "                                     fundHoldings { fund { id name } } } }"
  echo
  echo "--- RESULTS -------------------------------------------------------"
  printf '%s' "$RESULTS"
  echo
  echo "--- CACHE KEYS + TTLs (after the cold query) ----------------------"
  printf '%s' "$TTLS"
  echo
  echo "--- TAG Account:acct-1001 (GET :4011/tags/Account:acct-1001) ------"
  echo "  $TAGMEMBERS"
  echo
  echo "--- COLD QUERY (subgraph logs) ------------------------------------"
  echo "$COLD_TRACE" | sed 's/^/  /'
  echo
  echo "--- WARM QUERY (subgraph logs) ------------------------------------"
  echo "$WARM_TRACE" | sed 's/^/  /'
  echo
  echo "--- PURGE (POST :4011/purge {\"tags\":[\"Account:acct-1001\"]}) ------"
  echo "  $PURGE"
  echo
  echo "--- QUERY AFTER PURGE (subgraph logs) -----------------------------"
  echo "$REPURGE_TRACE" | sed 's/^/  /'
  echo
  echo "--- VALKEY MONITOR, cold query (truncated to 160 cols) ------------"
  echo "$MONITOR" | sed 's/^/  /'
  echo
  if [ "$fail" = "0" ]; then echo "OVERALL: PASS"; else echo "OVERALL: FAIL"; fi
} > "$REPORT"

echo
echo "-------------------------------------------------------------------"
if [ "$fail" = "0" ]; then
  echo "  OVERALL: PASS — report written to ${REPORT}"
else
  echo "  OVERALL: FAIL — see ${REPORT}"
fi
echo "  Full MONITOR trace: ${MONITOR_LOG}"
echo "  Stack left running: ${GRAPHQL}"
echo "-------------------------------------------------------------------"
exit "$fail"
