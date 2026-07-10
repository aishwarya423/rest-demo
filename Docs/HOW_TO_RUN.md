# How to Run This Project

## Prerequisites
- Node.js installed
- npm or npx available
- Rust toolchain (for building extensions from source, if needed)

## Steps to Run

### 1. Start the Mock Countries Server
The mock REST API server provides countries data on port 3001:

```bash
cd mock-rest-apis
node countries-server.js
```

You should see:
```
countries REST API listening on port 3001
```

### 2. Start Grafbase Dev Server
In a new terminal, from the project root:

```bash
npx grafbase dev
```

You should see output like:
```
Grafbase CLI 0.105.1
Installing extensions...
✨ Grafbase dev server running at http://localhost:5000
```

### 3. Test the GraphQL Query
Use curl or any GraphQL client (Bruno, Postman, etc.):

```bash
curl -X POST http://localhost:5000/graphql \
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

## Ports Used
- **3001**: Mock Countries REST API server
- **5000**: Grafbase GraphQL gateway

## Stopping Services
```bash
# Kill Grafbase dev server
pkill -f 'grafbase dev'

# Kill mock server
pkill -f 'countries-server.js'
```
