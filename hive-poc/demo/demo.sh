#!/usr/bin/env bash
# ===========================================================================
# Hive POC walkthrough: cache MISS -> HIT -> targeted invalidation -> MISS
#
# Docker (default):
#   ./demo.sh
#
# Host-run stack:
#   VK="docker exec hive-poc-valkey valkey-cli" ./demo.sh
#
# Every step prints the Redis keys so the cache effect is shown, not asserted.
# ===========================================================================
set -uo pipefail

GATEWAY="${GATEWAY:-http://localhost:4000/graphql}"
INVALIDATOR="${INVALIDATOR:-http://localhost:8090}"
VK="${VK:-docker compose -f ../docker-compose.yml exec -T valkey valkey-cli}"
ACCOUNT_ID="${ACCOUNT_ID:-acct-1001}"
FUND_ID="${FUND_ID:-fund-global-equity}"

bold() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }
vk() { $VK "$@"; }

Q_OVERVIEW='query AccountOverview($id: String!) { account(id: $id) { id holderName policies { id policyNumber } fundHoldings { allocationPercent fund { id name } } } }'
Q_NAME='query AccountName($id: String!) { account(id: $id) { id holderName } }'
Q_FUND='query FundDetail($id: String!) { fund(id: $id) { id name isin } }'

# The query strings below contain no double quotes or backslashes, so a plain
# printf is enough to build the JSON body — no jq or python dependency.
payload() {
  printf '{"operationName":"%s","query":"%s","variables":{"id":"%s"}}' "$1" "$2" "$3"
}

gql() {
  curl -s "$GATEWAY" -H 'content-type: application/json' -d "$(payload "$1" "$2" "$3")"
}

timed() {
  curl -s -o /dev/null -w 'took %{time_total}s\n' "$GATEWAY" \
    -H 'content-type: application/json' -d "$(payload "$1" "$2" "$3")"
}

bold "0. Start from an empty cache"
vk FLUSHALL
echo "DBSIZE: $(vk DBSIZE)"

bold "1. First request -> cache MISS, all three REST services are called"
# Time the FIRST call, before anything is cached. Anything after this is a hit.
timed AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"
echo "response shape:"
gql AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID" | head -c 400; echo

bold "2. Redis now holds the response body plus one tag per entity"
vk --scan --pattern 'response-cache:*' | sort
echo "DBSIZE: $(vk DBSIZE)"

bold "3. Same request again -> cache HIT, zero REST traffic"
timed AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"

bold "4. Add a second account operation and one unrelated fund operation"
gql AccountName "$Q_NAME" "$ACCOUNT_ID" > /dev/null
gql FundDetail "$Q_FUND" "$FUND_ID" > /dev/null
echo "cached response bodies:"
vk --scan --pattern 'response-cache:gql.*' | awk -F: 'NF==2' | sort
echo "DBSIZE: $(vk DBSIZE)"

bold "5. Dry run: which cached responses is Account.$ACCOUNT_ID tagged in?"
curl -s "$INVALIDATOR/cache/entity/Account/$ACCOUNT_ID"

bold "6. Invalidate that one entity (simulates an update in the REST tier)"
curl -s -X DELETE "$INVALIDATOR/cache/entity/Account/$ACCOUNT_ID"

bold "7. Both account responses are gone; the unrelated fund response survives"
vk --scan --pattern 'response-cache:*' | sort
echo "DBSIZE: $(vk DBSIZE)"

bold "8. Next request -> MISS again, fresh data fetched and re-cached"
timed AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"
vk --scan --pattern 'response-cache:*' | sort
echo "DBSIZE: $(vk DBSIZE)"

bold "Done"
