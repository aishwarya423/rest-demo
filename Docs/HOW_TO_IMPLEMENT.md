# How to Implement REST Extensions with Grafbase

## The Problem: 404 Error

When running `npx grafbase dev`, you likely saw this error:

```
Error: HTTP error downloading extension from 
https://extensions.grafbase.com/extensions/rest/0.5.0/extension.wasm: 404 Not Found
```

**Why this happens:**
- The Grafbase extension registry endpoint was returning 404
- Version `0.5.0` was either removed or unavailable on the registry
- Without the `.wasm` file, Grafbase couldn't load the REST extension

## The Solution: Build Locally

Instead of relying on remote downloads, we build the REST extension locally and point Grafbase to the local build. This is more reliable and gives you control over the extension.

## How to Build a REST Extension

### Step 1: Clone the Grafbase Extensions Repository
```bash
git clone https://github.com/grafbase/extensions.git
cd extensions/rest
```

### Step 2: Build the Extension
Use the Grafbase CLI to build:

```bash
npx grafbase extension build --output-dir /path/to/your/project/grafbase_extensions/rest/0.5.2
```

This generates two files in the output directory:
- `extension.wasm` - The compiled WebAssembly module
- `manifest.json` - Extension metadata

### Step 3: Update grafbase.toml
Instead of specifying a version that downloads from the registry:

**Before (causes 404):**
```toml
[extensions.rest]
version = "0.5.0"
```

**After (use local build):**
```toml
[extensions.rest]
path = "grafbase_extensions/rest/0.5.2"
```

The `path` tells Grafbase to load the extension from a local directory instead of downloading it.

## How to Use the REST Extension

### 1. Define REST Endpoints in Your Schema
In `schema.graphql`, specify where the REST API is:

```graphql
extend schema
  @link(url: "https://grafbase.com/extensions/rest/0.5.2", import: ["@restEndpoint", "@rest"])
  @restEndpoint(name: "countries", baseURL: "http://localhost:3001")
```

### 2. Map GraphQL Fields to REST Endpoints
Use the `@rest` directive to connect a GraphQL field to a REST endpoint:

```graphql
type Country {
  name: String!
}

type Query {
  countries: [Country!]!
    @rest(
      http: { GET: "/all?fields=name" },
      endpoint: "countries",
      selection: "[.[] | { name: .name.official }]"
    )
}
```

**What each part does:**
- `http: { GET: "/all?fields=name" }` - REST method and path
- `endpoint: "countries"` - Matches the `@restEndpoint` name
- `selection` - jq filter to transform REST response → GraphQL response

### 3. Transform Data with jq
The `selection` field uses jq filters to map REST JSON to GraphQL:

```
selection: "[.[] | { name: .name.official }]"
```

This takes REST response like:
```json
[
  { "name": { "official": "Afghanistan", "common": "... " } },
  ...
]
```

And transforms it to:
```json
[
  { "name": "Afghanistan" },
  ...
]
```

## Why We Did This

1. **Avoid Registry Dependency** - No more 404 errors from remote endpoints
2. **Faster Development** - Extensions load instantly from local disk
3. **Version Control** - Keep extension binaries in your repo if needed
4. **Custom Builds** - Modify and rebuild extensions for your use case
5. **Offline Development** - Work without internet access to the registry

## Summary

| Step | What | Why |
|------|------|-----|
| Build locally | `npx grafbase extension build` | Avoid 404 from registry |
| Use `path` config | `path = "grafbase_extensions/rest/0.5.2"` | Load from disk instead of download |
| Use `@restEndpoint` | Define REST API base URL | Tell Grafbase where to fetch data |
| Use `@rest` directive | Map GraphQL field to REST endpoint + jq filter | Transform REST into GraphQL |

This approach gives you reliability, control, and fast local development.
