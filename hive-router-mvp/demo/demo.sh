#!/usr/bin/env bash
# ===========================================================================
# Hive Router MVP walkthrough: federated queries across the three REST APIs.
#
#   ./demo.sh
#
# Override for a host-run stack:
#   ROUTER=http://localhost:4000/graphql ./demo.sh
#
# Each query is followed by the REST calls the subgraphs made for it, so you
# can see one GraphQL request fan out to Accounts, Policies and Funds.
# ===========================================================================
set -uo pipefail

ROUTER="${ROUTER:-http://localhost:4000/graphql}"
COMPOSE="${COMPOSE:-docker compose -f ../docker-compose.yml}"
ACCOUNT_ID="${ACCOUNT_ID:-acct-1001}"
FUND_ID="${FUND_ID:-fund-global-equity}"
POLICY_ID="${POLICY_ID:-pol-life-3001}"

bold() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }

# These queries contain no double quotes, so printf is enough to build the JSON.
Q_OVERVIEW='query AccountOverview($id: String!) { account(id: $id) { holderName policies { policyNumber } fundHoldings { fund { name } } } }'
Q_PORTFOLIO='query InsurancePortfolio($id: String!) { account(id: $id) { id holderName totalValue policies { policyNumber productName linkedFunds { name assetClass } } fundHoldings { allocationPercent fund { name riskRating } } } }'
Q_FUND='query FundDetail($id: String!) { fund(id: $id) { id name isin } }'
Q_POLICY='query PolicyWithAccount($id: String!) { policy(id: $id) { policyNumber account { id holderName accountType } } }'

payload() { printf '{"operationName":"%s","query":"%s","variables":{"id":"%s"}}' "$1" "$2" "$3"; }

rest_calls() {
  # Count upstream REST calls logged by the three subgraphs so far.
  $COMPOSE logs accounts-subgraph policies-subgraph funds-subgraph 2>/dev/null \
    | grep -c 'REST GET' || true
}

run() {
  local before after
  before=$(rest_calls)
  curl -s -w '\ntook %{time_total}s\n' "$ROUTER" \
    -H 'content-type: application/json' -d "$(payload "$1" "$2" "$3")"
  after=$(rest_calls)
  echo "REST calls for this query: $((after - before))"
}

bold "1. AccountOverview: accounts -> policies -> funds in one request"
run AccountOverview "$Q_OVERVIEW" "$ACCOUNT_ID"

bold "2. InsurancePortfolio: policies.linkedFunds and fundHoldings.fund via federation"
run InsurancePortfolio "$Q_PORTFOLIO" "$ACCOUNT_ID"

bold "3. FundDetail: single-subgraph query"
run FundDetail "$Q_FUND" "$FUND_ID"

bold "4. PolicyWithAccount: reverse join from policy back to its account"
run PolicyWithAccount "$Q_POLICY" "$POLICY_ID"

bold "5. Recent REST calls made by the subgraphs"
$COMPOSE logs --no-log-prefix accounts-subgraph policies-subgraph funds-subgraph 2>/dev/null \
  | grep 'REST GET' | tail -15

bold "Done"
