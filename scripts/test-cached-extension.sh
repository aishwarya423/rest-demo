#!/usr/bin/env bash
# =============================================================================
# RUN + TEST the forked caching rest extension — one command, all in Docker.
#
#   scripts/test-cached-extension.sh
#
# Proves the thing the gateway's own entity cache cannot do: a fund that changed
# in some other system is invalidated by NAME, with a plain DEL, and only that
# fund is re-fetched.
#
# Steps: clean slate -> start stack -> cold query (with a MONITOR capture) ->
# warm query -> different field selection (same keys) -> serve a doctored value
# from the cache -> DEL that one key -> confirm it refetched -> tag purge ->
# write a report -> PASS/FAIL. Leaves the stack running.
#
# Output: extension-cache-test-report.txt (+ extension-cache-monitor.txt)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.cached.yml"
CACHE_CLI="${CACHE_CLI:-valkey-cli}"
GRAPHQL="http://localhost:5065/graphql"
REPORT="extension-cache-test-report.txt"
MONITOR_LOG="extension-cache-monitor.txt"

FUND_KEY="rest:funds:/funds/fund-green-bond"
QUERY='{"query":"{ account(id:\"acct-1001\"){ holderName policies { policyNumber } fundHoldings { fund { id name } } } }"}'
# Same resources, completely different fields — must reuse the same cache keys.
QUERY_ALT='{"query":"{ account(id:\"acct-1001\"){ riskProfile fundHoldings { fund { isin riskRating } } } }"}'

cli() { $COMPOSE exec -T valkey "$CACHE_CLI" "$@" </dev/null | tr -d '\r'; }
gql() { curl -s "$GRAPHQL" -H 'content-type: application/json' -d "${1:-$QUERY}"; }
# Extension log lines produced since the given number of gateway log lines.
since() { $COMPOSE logs cached-gateway 2>&1 | tail -n "+$1" | grep -oE '\[rest-cache\] (HIT|MISS|SET) +[^ ]*' || true; }
loglines() { $COMPOSE logs cached-gateway 2>&1 | wc -l | tr -d ' '; }
fundname() { python3 -c "import json,sys; d=json.load(sys.stdin)['data']['account']['fundHoldings']; print(next(f['fund']['name'] for f in d if f['fund']['id']=='fund-green-bond'))"; }

echo "==================================================================="
echo "  Forked rest extension — REST cache with readable keys"
echo "==================================================================="

echo "[1/8] clean slate (compose down -v) ..."
$COMPOSE down -v >/dev/null 2>&1 || true

echo "[2/8] starting the stack — build may take a minute ..."
$COMPOSE up --build -d >/dev/null

echo "[3/8] waiting for the gateway (${GRAPHQL}) ..."
ok="no"
for _ in $(seq 1 40); do
  if curl -sf "$GRAPHQL" -H 'content-type: application/json' \
       -d '{"query":"{ __typename }"}' >/dev/null 2>&1; then ok="yes"; break; fi
  sleep 2
done
if [ "$ok" != "yes" ]; then
  echo "  ERROR: gateway did not become ready"; $COMPOSE logs cached-gateway | tail -20; exit 1
fi

echo "[4/8] cold query, capturing valkey MONITOR ..."
cli FLUSHALL >/dev/null
$COMPOSE exec -T valkey sh -c "timeout 8 $CACHE_CLI MONITOR" > "$MONITOR_LOG" 2>&1 &
MON_PID=$!
sleep 2
MARK=$(loglines)
COLD_RESP=$(gql)
sleep 1
COLD_TRACE=$(since "$MARK")
wait $MON_PID 2>/dev/null || true
MONITOR=$(grep -vE '"(ping|COMMAND|INFO)"' "$MONITOR_LOG" | cut -c1-140 || true)

KEYS=$(cli --scan --pattern 'rest:*' | sort)
TAGS=$(cli --scan --pattern 'tag:*' | sort)
TTLS=""
for k in $(printf '%s\n' "$KEYS" "$TAGS"); do
  TTLS="${TTLS}$(printf '  %-48s %s' "$k" "$(cli TTL "$k")")"$'\n'
done

echo "[5/8] warm query + a different field selection ..."
MARK=$(loglines); gql >/dev/null; sleep 1; WARM_TRACE=$(since "$MARK")
MARK=$(loglines); gql "$QUERY_ALT" >/dev/null; sleep 1; ALT_TRACE=$(since "$MARK")
KEYS_AFTER_ALT=$(cli --scan --pattern 'rest:*' | sort)

echo "[6/8] proving reads come from the cache (doctoring one entry) ..."
# Rewrite the cached fund with a name the REST API never returns. If the gateway
# serves it, the read path is definitely the cache.
ORIGINAL=$(cli --no-raw GET "$FUND_KEY" >/dev/null 2>&1; cli GET "$FUND_KEY")
DOCTORED=$(printf '%s' "$ORIGINAL" | python3 -c "import json,sys; d=json.load(sys.stdin); d['name']='CACHED VALUE (not from REST)'; print(json.dumps(d))")
$COMPOSE exec -T valkey "$CACHE_CLI" SET "$FUND_KEY" "$DOCTORED" EX 300 >/dev/null </dev/null
SERVED_FROM_CACHE=$(gql | fundname)

echo "[7/8] invalidating that one fund with DEL ..."
DELETED=$(cli DEL "$FUND_KEY")
MARK=$(loglines)
SERVED_AFTER_PURGE=$(gql | fundname)
sleep 1
PURGE_TRACE=$(since "$MARK")

# Tag purge: drop every key registered under tag:Fund in one round trip.
TAG_MEMBERS=$(cli SMEMBERS tag:Fund | sort)
TAG_PURGED=$(cli EVAL 'local ks=redis.call("SMEMBERS",KEYS[1]); if #ks>0 then redis.call("DEL",unpack(ks)) end; redis.call("DEL",KEYS[1]); return #ks' 1 tag:Fund)
KEYS_AFTER_TAG_PURGE=$(cli --scan --pattern 'rest:funds:*' | sort)

echo "[8/8] writing ${REPORT} ..."

fail=0
RESULTS=""
check() { if [ "$2" = "0" ]; then RESULTS="${RESULTS}  PASS  $1"$'\n'; echo "  PASS  $1";
          else RESULTS="${RESULTS}  FAIL  $1"$'\n'; echo "  FAIL  $1"; fail=1; fi; }

echo "$COLD_RESP" | grep -q '"holderName":"Anika Rao"'; check "query resolves across accounts, policies and funds" $?
echo "$KEYS" | grep -q "^${FUND_KEY}$"; check "cache key is readable and per-fund (${FUND_KEY})" $?
echo "$KEYS" | grep -q '^rest:accounts:/accounts/acct-1001$'; check "accounts entry cached under its URL" $?
echo "$KEYS" | grep -q '^rest:policies:/accounts/acct-1001/policies$'; check "policies entry cached under its URL" $?
[ "$(printf '%s\n' "$KEYS" | grep -c '^rest:funds:')" = "3" ]; check "one key per fund, not one per query shape" $?
echo "$TAGS" | grep -q '^tag:Fund:fund-green-bond$'; check "tag index built from the config rules" $?
echo "$COLD_TRACE" | grep -q 'MISS'; check "cold query recorded MISSes" $?
[ -z "$(echo "$WARM_TRACE" | grep MISS || true)" ] && echo "$WARM_TRACE" | grep -q HIT
check "warm query fully served from cache (REST not called)" $?
[ -z "$(echo "$ALT_TRACE" | grep MISS || true)" ]; check "different field selection reuses the same entries" $?
[ "$KEYS" = "$KEYS_AFTER_ALT" ]; check "…and creates no extra keys" $?
[ "$SERVED_FROM_CACHE" = "CACHED VALUE (not from REST)" ]; check "gateway serves the cached copy, not the REST API" $?
[ "$DELETED" = "1" ]; check "DEL removed the fund entry" $?
[ "$SERVED_AFTER_PURGE" = "Green Bond Income" ]; check "after DEL the fund is refetched from REST" $?
echo "$PURGE_TRACE" | grep -q "MISS.*fund-green-bond"; check "…and only that fund missed" $?
[ -z "$(echo "$PURGE_TRACE" | grep 'MISS.*fund-cash-plus' || true)" ]; check "…the other funds stayed cached" $?
[ "$TAG_PURGED" -ge 1 ]; check "tag purge dropped every Fund entry in one call" $?
[ -z "$KEYS_AFTER_TAG_PURGE" ]; check "no fund entries left after the tag purge" $?

{
  echo "==================================================================="
  echo " Forked rest extension (extensions/rest-cached) — test report"
  echo " $(date)"
  echo "==================================================================="
  echo
  echo "STACK    docker-compose.cached.yml — gateway :5065, valkey :6379"
  echo "CACHE    $(cli INFO server | grep -iE 'server_name|valkey_version|redis_version' | paste -sd' ' -)"
  echo "CONFIG   grafbase.cached.toml -> [extensions.rest.config.cache]"
  echo
  echo "--- RESULTS -------------------------------------------------------"
  printf '%s' "$RESULTS"
  echo
  echo "--- CACHE KEYS + TTLs (after the cold query) ----------------------"
  printf '%s' "$TTLS"
  echo
  echo "--- COLD QUERY ----------------------------------------------------"
  echo "$COLD_TRACE" | sed 's/^/  /'
  echo
  echo "--- WARM QUERY ----------------------------------------------------"
  echo "$WARM_TRACE" | sed 's/^/  /'
  echo
  echo "--- DIFFERENT FIELD SELECTION (same URLs -> same entries) ---------"
  echo "$ALT_TRACE" | sed 's/^/  /'
  echo
  echo "--- INVALIDATION --------------------------------------------------"
  echo "  cached value doctored in redis, gateway served : $SERVED_FROM_CACHE"
  echo "  \$ valkey-cli DEL \"$FUND_KEY\"  ->  $DELETED"
  echo "  gateway served after the DEL                   : $SERVED_AFTER_PURGE"
  echo "$PURGE_TRACE" | sed 's/^/  /'
  echo
  echo "--- TAG PURGE (tag:Fund) ------------------------------------------"
  echo "$TAG_MEMBERS" | sed 's/^/  member: /'
  echo "  EVAL smembers+del -> $TAG_PURGED key(s) removed"
  echo
  echo "--- VALKEY MONITOR, cold query (truncated) ------------------------"
  echo "$MONITOR" | sed 's/^/  /'
  echo
  if [ "$fail" = "0" ]; then echo "OVERALL: PASS"; else echo "OVERALL: FAIL"; fi
} > "$REPORT"

echo
echo "-------------------------------------------------------------------"
if [ "$fail" = "0" ]; then echo "  OVERALL: PASS — report in ${REPORT}"; else echo "  OVERALL: FAIL — see ${REPORT}"; fi
echo "  MONITOR trace: ${MONITOR_LOG}"
echo "  Stack left running: ${GRAPHQL}"
echo "-------------------------------------------------------------------"
exit "$fail"
