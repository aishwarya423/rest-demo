cd /Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo
set -e

docker rm -f redis-test >/dev/null 2>&1 || true
docker run -d --name redis-test -p 6379:6379 redis:7-alpine
sleep 3
docker exec redis-test redis-cli ping

nohup npm run mock-apis > /tmp/mock-apis.log 2>&1 &
sleep 5

sed -e 's|http://accounts-rest:3001|http://localhost:3001|' \
    -e 's|http://policies-rest:3003|http://localhost:3003|' \
    -e 's|http://funds-rest:3002|http://localhost:3002|' \
    schema.graphql > /tmp/schema.localhost.graphql

sed -e 's|redis://redis:6379|redis://127.0.0.1:6379|g' \
    -e 's|schema_path = "schema.graphql"|schema_path = "/tmp/schema.localhost.graphql"|' \
    grafbase.toml > /tmp/grafbase.local.toml

python3 <<'PY'
from pathlib import Path
repo = Path('/Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo')
text = Path('/tmp/grafbase.local.toml').read_text()
text = text.replace(
    'path = "grafbase_extensions/rest/0.5.2"',
    f'path = "{repo / "grafbase_extensions/rest/0.5.2"}"'
)
Path('/tmp/grafbase.local.toml').write_text(text)
PY

export ACCOUNTS_API_KEY=accounts-local-key
export POLICIES_API_KEY=policies-local-key
export FUNDS_API_KEY=funds-local-key

npx grafbase compose -c /tmp/grafbase.local.toml > /tmp/federated.graphql

curl -fsSL https://grafbase.com/downloads/gateway | sh
chmod +x ./grafbase-gateway

nohup ./grafbase-gateway --config /tmp/grafbase.local.toml \
                        --schema /tmp/federated.graphql \
                        --listen-address 127.0.0.1:5097 \
                        > /tmp/grafbase-gateway.log 2>&1 &
sleep 8

docker exec redis-test redis-cli FLUSHALL
docker exec redis-test redis-cli DBSIZE
curl -s localhost:5097/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { name } } } }"}'
docker exec redis-test redis-cli DBSIZE
docker exec redis-test redis-cli --scan --pattern 'insurance-opcache*'