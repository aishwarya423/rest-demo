Here are the exact commands and paths I used to build and use the REST extension:

## 1. Clone Grafbase Extensions Repository
```bash
rm -rf /tmp/grafbase-rest-extension && \
git clone --depth 1 https://github.com/grafbase/extensions.git /tmp/grafbase-rest-extension
```

## 2. Build the REST Extension Locally
```bash
cd /tmp/grafbase-rest-extension/extensions/rest && \
npx --yes grafbase@latest extension build \
  --output-dir /Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo/grafbase_extensions/rest/0.5.2
```

**Output you'll see:**
```
Grafbase CLI 0.105.1
🔨 Building extension...
✨ Extension rest built successfully
- Extension version: 0.5.2
- Minimum Grafbase Gateway version: 0.47.1
- SDK version: 0.22.1
```

## 3. Verify the Build Output
```bash
ls -R /Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo/grafbase_extensions/rest/0.5.2
```

Should show:
```
extension.wasm
manifest.json
```

## 4. Update grafbase.toml
Replace the `version` line with a `path` line:

**File:** grafbase.toml

```toml
[extensions.rest]
path = "grafbase_extensions/rest/0.5.2"

[subgraphs.countries]
schema_path = "schema.graphql"
```

## 5. Update schema.graphql
**File:** schema.graphql

Point to your local mock server:
```graphql
extend schema
  @link(url: "https://grafbase.com/extensions/rest/0.5.2", import: ["@restEndpoint", "@rest"])
  @restEndpoint(name: "countries", baseURL: "http://localhost:3001")

type Country {
  name: String!
}

type Query {
  countries: [Country!]!
    @rest(http: { GET: "/all?fields=name" }, endpoint: "countries", selection: "[.[] | { name: .name.official }]")
}
```

## 6. Start Mock REST Server
```bash
cd /Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo/mock-rest-apis && \
node countries-server.js
```

**Output:**
```
countries REST API listening on port 3001
```

## 7. Start Grafbase Dev Server (New Terminal)
```bash
cd /Users/aishwaryapalarapu/Desktop/aishprojects/rest-demo && \
npx grafbase dev
```

## 8. Test the GraphQL Query
```bash
curl -X POST http://127.0.0.1:5000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"query { countries { name } }"}'
```

**Expected response:**
```json
{
  "data": {
    "countries": [
      {"name": "Afghanistan"},
      {"name": "Albania"},
      ...
    ]
  }
}
```

## Quick Reference: Ports
- **3001** - Mock REST server (countries-server.js)
- **5000** - Grafbase GraphQL gateway

## Quick Cleanup
```bash
# Kill both servers
pkill -f 'grafbase dev'
pkill -f 'countries-server.js'
```

That's it! The key was building locally instead of downloading from the failing registry. 🎯