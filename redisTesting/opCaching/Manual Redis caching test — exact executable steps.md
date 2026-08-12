how to check redis testing in executable steps give me step by step what run automatic
give me in manual

## Manual Redis caching test — exact executable steps

Use these commands one by one from the repo root:

### 1. Start Redis
```bash
docker run -d --name redis-test -p 6379:6379 redis:7-alpine
docker exec redis-test redis-cli ping
```

Expected output:
```bash
PONG
```

---

### 2. Start mock REST services
```bash
npm run mock-apis
```

Keep that terminal open. It must stay running for the gateway to talk to the mock APIs.

---

### 3. Create a host-local schema copy
```bash
sed -e 's|http://accounts-rest:3001|http://localhost:3001|' \
    -e 's|http://policies-rest:3003|http://localhost:3003|' \
    -e 's|http://funds-rest:3002|http://localhost:3002|' \
    schema.graphql > /tmp/schema.localhost.graphql
```

---

### 4. Create a host-local Grafbase config copy
```bash
sed -e 's|redis://redis:6379|redis://127.0.0.1:6379|g' \
    -e 's|schema_path = "schema.graphql"|schema_path = "/tmp/schema.localhost.graphql"|' \
    grafbase.toml > /tmp/grafbase.local.toml
```

---

### 5. Fix the REST extension path in grafbase.local.toml
If the copied config still uses a relative extension path, change it to the repo absolute path:

```bash
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
```

---

### 6. Compose the federated schema
```bash
export ACCOUNTS_API_KEY=accounts-local-key
export POLICIES_API_KEY=policies-local-key
export FUNDS_API_KEY=funds-local-key

npx grafbase compose -c /tmp/grafbase.local.toml > /tmp/federated.graphql
```

---

### 7. Download the production gateway
```bash
curl -fsSL https://grafbase.com/downloads/gateway | sh
chmod +x ./grafbase-gateway
```

---

### 8. Run the production gateway
```bash
./grafbase-gateway --config /tmp/grafbase.local.toml \
                   --schema /tmp/federated.graphql \
                   --listen-address 127.0.0.1:5097
```

Leave this running.

---

### 9. Verify the gateway responds
In a new terminal:
```bash
curl -s localhost:5097/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { name } } } }"}'
```

Expected response: valid JSON with `account` data.

---

### 10. Check Redis before and after
In another terminal:

```bash
docker exec redis-test redis-cli FLUSHALL
docker exec redis-test redis-cli DBSIZE
```

Then run the query again:
```bash
curl -s localhost:5097/graphql -H 'content-type: application/json' \
  -d '{"query":"{ account(id:\"acct-1001\"){ holderName fundHoldings { fund { name } } } }"}'
```

Now inspect Redis:
```bash
docker exec redis-test redis-cli DBSIZE
docker exec redis-test redis-cli --scan --pattern 'insurance-opcache*'
```

---

### 11. Success condition
Your test is successful if:
- the gateway returns a valid GraphQL response
- `DBSIZE` increases from `0`
- `--scan --pattern 'insurance-opcache*'` returns at least one key

Example key:
```text
insurance-opcacheop.blake3.<hash>
```

---

### 12. Cleanup
```bash
docker rm -f redis-test
pkill -f 'grafbase-gateway' || true
pkill -f 'npm run mock-apis' || true
```

---

## Optional automatic run
If you want the same process automated, run this script in the repo root:

```bash
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
```

Use the manual steps above if you want to run each command interactively.