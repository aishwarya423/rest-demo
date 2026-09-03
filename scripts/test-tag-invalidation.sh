#!/usr/bin/env bash
# =============================================================================
# TEST tag-based cache invalidation at the REST boundary (rest-cache).
#
#   scripts/test-tag-invalidation.sh            # Redis  (default)
#   CACHE_IMAGE=valkey/valkey:8-alpine CACHE_CLI=valkey-cli \
#     scripts/test-tag-invalidation.sh          # Valkey
#
# This is the POSITIVE counterpart to the entity-caching tests: it proves the
# thing Grafbase Entity Cache cannot do — deleting exactly the cache entries
# belonging to one logical entity, and nothing else.
#
# Proves, in order:
#   1. rest-cache stores responses as STRINGs and a tag index as real SETs
#   2. Grafbase's own cache (db 0) is strings only — SMEMBERS returns WRONGTYPE
#   3. its payload has no entity id, so it cannot be matched from outside
#   4. invalidating one account deletes ITS keys and leaves others intact
#   5. stale -> invalidate -> fresh, end to end through the gateway
#
# Assumes the stack is already up (docker-compose.gateway.yml). Writes a dated
# report file. Leaves the stack running.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.gateway.yml"
CACHE_CLI="${CACHE_CLI:-redis-cli}"
GRAPHQL="http://localhost:5060/graphql"
CACHE_ADMIN="http://localhost:3101"
ACCOUNTS_REST="http://localhost:3001"
ACCOUNTS_KEY="${ACCOUNTS_API_KEY:-accounts-local-key}"
REPORT="tag-invalidation-report-$(date +%Y%m%d-%H%M%S).txt"

cli() { $COMPOSE exec -T redis "$CACHE_CLI" "$@" </dev/null 2>&1 | tr -d '\r'; }
# NOTE: fundHoldings.fund is required — it forces an `_entities` fetch into the
# funds subgraph, which is the ONLY thing that makes Grafbase write an
# entity-cache key. Without it there is nothing in db 0 to contrast against.
gql() {
  curl -s "$GRAPHQL" -H 'content-type: application/json' \
    -d "{\"query\":\"{ account(id:\\\"$1\\\"){ holderName policies { id } fundHoldings { fund { id name currency } } } }\"}"
}
fail=0
check() { # check <label> <expected-substring> <actual>
  if printf '%s' "$3" | grep -q "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1 (wanted '$2', got '$3')"; fail=1; fi
}

exec > >(tee "$REPORT") 2>&1

echo "############################################################"
echo "#  Tag-based invalidation test — rest-cache"
echo "#  $(date)"
echo "############################################################"
echo "cache CLI : $CACHE_CLI"
echo "backend   : $(cli INFO server | grep -iE 'server_name|redis_version' | tr '\n' ' ')"
echo

echo "[1/6] waiting for the gateway and rest-cache ..."
for _ in $(seq 1 40); do
  curl -sf "$GRAPHQL" -H 'content-type: application/json' -d '{"query":"{ __typename }"}' >/dev/null 2>&1 \
    && curl -sf "$CACHE_ADMIN/_health" >/dev/null 2>&1 && break
  sleep 1
done
curl -s "$CACHE_ADMIN/_health"; echo

echo
echo "[2/6] clean slate (db 0 = Grafbase, db 1 = rest-cache) ..."
cli -n 0 FLUSHDB >/dev/null; cli -n 1 FLUSHDB >/dev/null
gql acct-1001 >/dev/null; gql acct-2001 >/dev/null
sleep 1

echo
echo "== db 1 — rest-cache (KEY | TYPE) =="
db1_types=""
for k in $(cli -n 1 --scan | sort); do
  t=$(cli -n 1 TYPE "$k"); db1_types="$db1_types$t "
  printf '  %-56s %s\n' "$k" "$t"
done
check "tag index exists as a Redis SET" "set" "$db1_types"

echo
echo "== db 0 — Grafbase entity cache, for contrast =="
K=$(cli -n 0 --scan --pattern 'insurance-entitycache*' | head -1)
if [ -n "$K" ]; then
  printf '  %-56s %s\n' "$K" "$(cli -n 0 TYPE "$K")"
  echo "  SMEMBERS -> $(cli -n 0 SMEMBERS "$K")"
  echo "  GET      -> $(cli -n 0 GET "$K")"
  check "Grafbase key is a plain string"      "string"    "$(cli -n 0 TYPE "$K")"
  check "Grafbase key rejects SET commands"   "WRONGTYPE" "$(cli -n 0 SMEMBERS "$K")"
  check "Grafbase payload carries no id"      "^{\"name\"" "$(cli -n 0 GET "$K")"
else
  echo "  (no entity-cache key — FUNDS_ENTITY_TTL may have expired it; skipping)"
fi

echo
echo "[3/6] tag membership"
echo "  tag:account:acct-1001 ->"; cli -n 1 SMEMBERS 'tag:account:acct-1001' | sed 's/^/    /'

echo
echo "[4/6] selective invalidation — acct-1001 only"
before=$(cli -n 1 --scan --pattern 'rc:*' | sort)
echo "  before:"; echo "$before" | sed 's/^/    /'
resp=$(curl -s -XPOST "$CACHE_ADMIN/_invalidate" -H 'content-type: application/json' \
        -d '{"tags":["account:acct-1001"]}')
echo "  response: $(printf '%s' "$resp" | tr -d '\n ')"
after=$(cli -n 1 --scan --pattern 'rc:*' | sort)
echo "  after:"; echo "$after" | sed 's/^/    /'
if printf '%s' "$after" | grep -q 'acct-1001'; then
  echo "  FAIL  acct-1001 entries deleted (still present)"; fail=1
else
  echo "  PASS  acct-1001 entries deleted"
fi
check "acct-2001 entries survived" "acct-2001" "$after"

echo
echo "[5/6] end to end: stale -> invalidate -> fresh"
NEW="Anika Rao (UPDATED $(date +%H%M%S))"
before_name=$(gql acct-1001 | grep -o '"holderName":"[^"]*"' | head -1)
curl -s -XPATCH "$ACCOUNTS_REST/accounts/acct-1001" \
  -H 'content-type: application/json' -H "X-Api-Key: $ACCOUNTS_KEY" \
  -d "{\"holderName\":\"$NEW\"}" >/dev/null
stale_name=$(gql acct-1001 | grep -o '"holderName":"[^"]*"' | head -1)
curl -s -XPOST "$CACHE_ADMIN/_invalidate" -H 'content-type: application/json' \
  -d '{"tags":["account:acct-1001"]}' >/dev/null
fresh_name=$(gql acct-1001 | grep -o '"holderName":"[^"]*"' | head -1)
echo "  before change        : $before_name"
echo "  after change, cached : $stale_name   <- correctly STALE"
echo "  after invalidation   : $fresh_name   <- FRESH"
check "cache served stale before invalidation" "$before_name" "$stale_name"
check "cache served fresh after invalidation"  "UPDATED"       "$fresh_name"

echo
echo "[6/6] restoring the mock record"
curl -s -XPATCH "$ACCOUNTS_REST/accounts/acct-1001" \
  -H 'content-type: application/json' -H "X-Api-Key: $ACCOUNTS_KEY" \
  -d '{"holderName":"Anika Rao"}' >/dev/null
curl -s -XPOST "$CACHE_ADMIN/_invalidate" -H 'content-type: application/json' \
  -d '{"tags":["account:acct-1001"]}' >/dev/null

echo
echo "############################################################"
if [ "$fail" -eq 0 ]; then echo "#  RESULT: PASS"; else echo "#  RESULT: FAIL"; fi
echo "#  report: $REPORT"
echo "############################################################"
exit "$fail"
