#!/usr/bin/env bash
# Validate the generated schema (schema-gen/schema.generated.graphql).
#
#   bash schema-gen/validate/validate.sh          # static: grafbase compose
#   bash schema-gen/validate/validate.sh --e2e    # + start gateway, run a live query
#
# Static mode needs nothing running. E2E mode needs the three mock REST APIs
# on localhost:3001-3003 (start them with: npm run mock-rest).
set -euo pipefail
cd "$(dirname "$0")"

export ACCOUNTS_API_KEY="${ACCOUNTS_API_KEY:-accounts-local-key}"
export POLICIES_API_KEY="${POLICIES_API_KEY:-policies-local-key}"
export FUNDS_API_KEY="${FUNDS_API_KEY:-funds-local-key}"

# The generated schema uses docker DNS names (repo convention); swap in
# localhost for host-side validation.
sed -e 's|http://accounts-rest:3001|http://localhost:3001|' \
    -e 's|http://policies-rest:3003|http://localhost:3003|' \
    -e 's|http://funds-rest:3002|http://localhost:3002|' \
    ../schema.generated.graphql > schema.validate.graphql

echo "==> grafbase compose (static composition check)"
npx grafbase compose -c grafbase.toml > composed.federated.graphql
echo "    OK — federated SDL written to schema-gen/validate/composed.federated.graphql"

if [[ "${1:-}" != "--e2e" ]]; then
  exit 0
fi

echo "==> e2e: checking mock REST APIs"
for p in 3001 3002 3003; do
  curl -sf -m 2 "http://localhost:$p/health" > /dev/null \
    || { echo "    mock on port $p is not running — start with: npm run mock-rest"; exit 1; }
done

echo "==> e2e: starting gateway on 127.0.0.1:5099"
npx grafbase dev -c grafbase.toml --listen-address 127.0.0.1:5099 > gateway.log 2>&1 &
GW_PID=$!
trap 'kill $GW_PID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  sleep 1
  if curl -sf -m 2 "http://127.0.0.1:5099/graphql" \
      -H 'content-type: application/json' \
      -d '{"query":"{ __typename }"}' > /dev/null 2>&1; then
    break
  fi
  if [[ $i == 30 ]]; then echo "    gateway did not become ready — see schema-gen/validate/gateway.log"; exit 1; fi
done

echo "==> e2e: running federated query (account -> policies -> linkedFunds, holdings -> fund)"
curl -s "http://127.0.0.1:5099/graphql" -H 'content-type: application/json' -d '{
  "query": "{ account(id: \"acct-1001\") { id holderName accountType status openedDate riskProfile fundHoldings { allocationPercent units fund { name assetClass sustainabilityLabel } } policies { policyNumber policyType status startDate linkedFunds { name riskRating } } } }"
}' | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const r=JSON.parse(d);
  if (r.errors) { console.error('ERRORS:', JSON.stringify(r.errors, null, 2)); process.exit(1); }
  console.log(JSON.stringify(r.data, null, 2));
  console.log('\n==> e2e OK');
});"
