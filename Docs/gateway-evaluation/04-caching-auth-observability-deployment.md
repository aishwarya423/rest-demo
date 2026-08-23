# GQL-105/106/108 — Caching, Auth, Observability, Deployment

## Caching

| | Grafbase | Hive Router |
|---|---|---|
| Operation (query-plan) caching | **Verified working**, Redis-backed — see [`../CACHING.md`](../CACHING.md) (pre-existing work, this repo) | Not implemented (open RFC [#312](https://github.com/graphql-hive/router/issues/312)) |
| Entity (subgraph-fetch) caching | **Verified working**, Redis-backed, conditional on a real subgraph boundary — see [`../ENTITY-CACHING-WHY-NOOP.md`](../ENTITY-CACHING-WHY-NOOP.md) (pre-existing work, this repo) | Not implemented (same RFC) |
| Backend | Redis or Valkey (drop-in), configured in `grafbase.toml` | N/A today; RFC proposes Redis + in-memory |

**This is the single most decisive, unambiguous finding in the whole spike.**
Not "different approach, different tradeoffs" — Hive Router has no caching
layer to configure, benchmark, or evaluate. If caching (reducing repeated
query-plan cost, reducing repeated subgraph-fetch cost) is a requirement for
production — and given this repo's own history of dedicated caching spikes
([`../jira/CONFLUENCE-Valkey-Redis-Caching.md`](../jira/CONFLUENCE-Valkey-Redis-Caching.md)),
it clearly is — **Hive Router cannot meet it today.** This alone is close to
disqualifying for a near-term production decision; see the outcome doc's
recommendation.

Not tested in this session (the RFC has no code to test against): what the
RFC's proposed `@cacheControl`-based design would look like in practice, or
whether a self-rolled response-cache middleware in front of Hive Router could
substitute in the meantime.

## Authentication & Authorization

Both gateways document a native JWT/JWKS mechanism (see
[`00-research-findings.md`](./00-research-findings.md) §5) — Hive Router's
`jwt` config section, Grafbase's `extensions.jwt`. On paper, parity.
**Neither was hands-on tested in this PoC** — both subgraphs/REST services
here only forward a static `X-Api-Key` header (already proven working in
both topologies, since every successful query in this spike depended on it).
Field-level authorization: Grafbase has `@authenticated`/`@requires-scopes`
directives (already used as `@inaccessible` in this repo's schemas); Hive
Router's `authorization` config section wasn't inspected in depth. **Real
gap** — recommend a dedicated half-day spike wiring actual JWT validation on
both before this category can be scored with confidence.

## Observability

| | Grafbase (production gateway) | Hive Router |
|---|---|---|
| Log format | Plain-text, leveled, timestamped (`2026-08-21T12:11:48Z INFO ...`) | Structured JSON (`{"timestamp":...,"level":"INFO","target":"router::core","message":...}`) |
| Default per-request log verbosity | Low — no visible per-request line under this session's benchmark load | High — **one INFO line per request** by default; the benchmark runs in this session produced a 677,000-line container log for ~677,000 requests |
| Claimed OTel tracing | Not confirmed either way in this session | Documented (not hands-on tested) |
| Claimed Prometheus metrics | Not confirmed either way in this session | Documented, including a "cache behavior" metric (forward-looking for #312) |

The log-verbosity difference is a real, hands-on operational finding, not
sourced from docs: Hive Router's default logging would need explicit
level-tuning before production use at any real request volume, or log
ingestion costs/noise become a real operational line item. Raw evidence:
[`evidence/hive-router-container-logs.txt`](./evidence/hive-router-container-logs.txt)
(trimmed from 677K lines to a representative sample — the line count is
recorded in the file).

## Deployment footprint

Real, measured (`docker images`, this session):

| Image | Size | What's inside |
|---|---|---|
| Grafbase (true-federation build) | **793 MB** | Debian slim + Node.js + npm + `grafbase` CLI + gateway binary — the CLI is there solely to run `grafbase compose` |
| Hive Router | **128 MB** | Just the Rust binary and its runtime deps |

Startup: Hive Router's own logs show ~48ms from process start
(`hive-router starting...`) to supergraph loaded and serving
(`supergraph loaded successfully`) — see
[`evidence/hive-router-container-logs.txt`](./evidence/hive-router-container-logs.txt).
Grafbase's composition step, in this repo's real deployment pattern
([`../../Dockerfile.gateway`](../../Dockerfile.gateway) +
[`../../docker/gateway-entrypoint.sh`](../../docker/gateway-entrypoint.sh)),
runs `grafbase compose` at **container startup**, not build time — a step
Hive Router never has, because it never composes. Startup-time composition
wasn't independently timed in this session (the true-federation Docker build
baked composition into the image build step instead, for simplicity) — flagged
as a follow-up if cold-start time under real rolling-deploy conditions
matters to the decision.

This is the direct shadow of the architecture difference in
[`00-research-findings.md`](./00-research-findings.md): Grafbase's runtime
image carries its own composition toolchain; Hive Router pushes composition
to a separate pipeline step (this repo's `hive-router/compose.mjs`, meant to
run in CI) and ships a minimal runtime artifact. Neither is free — Grafbase
pays it in image size and (potentially) startup time; Hive Router pays it as
a CI/pipeline dependency that has to exist and be maintained somewhere.
