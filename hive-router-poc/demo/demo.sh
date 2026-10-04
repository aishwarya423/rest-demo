#!/usr/bin/env bash
# ===========================================================================
# Hive Router POC walkthrough: MISS -> HIT -> targeted purge -> MISS
#
#   ./demo.sh
#
# Override for a host-run stack:
#   ROUTER=http://localhost:4000/graphql VK="docker exec <valkey> valkey-cli" ./demo.sh
#
# The proof of a cache hit is the REST log, not the latency: on a hit the
# subgraph containers print no "REST GET" line at all.
# ===========================================================================
set -uo pipefail

ROUTER="${ROUTER:-http://localhost:4000/graphql}"
INVALIDATOR="${INVALIDATOR:-http://localhost:8090}"
COMPOSE="${COMPOSE:-docker compose -f ../docker-compose.yml}"
VK="${VK:-$COMPOSE exec -T valkey valkey-cli}"
ACCOUNT_ID="${ACCOUNT_ID:-acct-1001}"
FUND_ID="${FUND_ID:-fund-global-equity}"

bold() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }
vk() { $VK "$@"; }

# These queries contain no double quotes, so printf is enough to build the JSON.
Q_OVERVIEW='query AccountOverview($id: String!) { account(id: $id) { holderName policies { policyNumber } fundHoldings { fund { name } } } }'
Q_NAME='query AccountName($id: String!) { account(id: $id) { id holderName } }'
Q_FUND='query FundDetail($id: String!) { fund(id: $id) { id name isin } }'

payload() { printf '{"operationName":"%s","query":"%s","variables":{"id":"%s"}}' "$1" "$2" "$3"; }
gql() { curl -s "$ROUTER" -H 'content-type: application/json' -d "$(payload "$1" "$2" "$3")"; }
timed() {
  curl -s -o /dev/null -w 'took %{time_total}s\n' "$ROUTER" \
    -H 'content-type: application/json' -d "$(payload "$1" "$2" "$3")"
}

rest_calls() {
  # Count upstream REST calls logged by the three subgraphs so far.
  $COMPOSE logs accounts-subgraph policies-subgraph funds-subgraph 2>/dev/null \
    | grep -c 'REST GET' || true
}

bold "0. Start from an empty cache"
vk FLUSHALL
echo "DBSIZE: $(vk DBSIZE)"
BASE_CALLS=$(rest_calls)
echo "REST calls so far: $BASE_CALLS"

bold "1. First request -> cache MISS, REST called through all three subgraphs"
timed AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"
echo "response:"
gql AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID" | head -c 400; echo
AFTER_MISS=$(rest_calls)
echo "REST calls after miss: $AFTER_MISS (delta $((AFTER_MISS - BASE_CALLS)))"

bold "2. Valkey now holds response bodies plus real SET tags"
echo "--- cached response bodies (one per subgraph operation) ---"
vk --scan --pattern 'sg:*' | sort
echo "--- entity tag SETs ---"
for tag in "Account:$ACCOUNT_ID" "Policy:pol-life-3001" "Fund:$FUND_ID"; do
  printf '%-28s -> ' "$tag"
  vk SMEMBERS "$tag" | tr '\n' ' '; echo
done
echo "DBSIZE: $(vk DBSIZE)"

bold "3. Same request again -> cache HIT, zero new REST calls"
timed AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"
AFTER_HIT=$(rest_calls)
echo "REST calls after hit: $AFTER_HIT (delta $((AFTER_HIT - AFTER_MISS)))  <-- must be 0"

bold "4. Add a second account operation and one unrelated fund operation"
gql AccountName "$Q_NAME" "$ACCOUNT_ID" > /dev/null
gql FundDetail "$Q_FUND" "$FUND_ID" > /dev/null
vk --scan --pattern 'sg:*' | sort
echo "DBSIZE: $(vk DBSIZE)"

bold "5. Dry run: what does purging Account:$ACCOUNT_ID affect?"
curl -s "$INVALIDATOR/cache/entity/Account/$ACCOUNT_ID"

bold "6. Purge that one entity (stands in for an update in the REST tier)"
curl -s -X DELETE "$INVALIDATOR/cache/entity/Account/$ACCOUNT_ID"

bold "7. Account-derived responses gone; the unrelated fund response survives"
vk --scan --pattern 'sg:*' | sort
echo "DBSIZE: $(vk DBSIZE)"

bold "8. Next request -> MISS again, refetched and re-cached"
BEFORE_REFETCH=$(rest_calls)
timed AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"
AFTER_REFETCH=$(rest_calls)
echo "REST calls on refetch: $((AFTER_REFETCH - BEFORE_REFETCH))  <-- must be > 0"
vk --scan --pattern 'sg:*' | sort

bold "Done"
