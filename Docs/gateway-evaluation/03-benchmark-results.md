# GQL-107 — Benchmark Results

**Methodology caveat up front, because it matters more than the numbers:**
this is **1 run per scenario**, on a single developer machine, with no CPU/
memory pinning, against trivial in-memory mock REST APIs (near-zero backend
latency). The spike plan (§5) calls for 3 repetitions with median reporting,
resource-pinned containers, and multiple load levels (cold/warm/concurrent/
soak). None of that rigor was applied here — this is a **directional pilot**,
not a publishable performance verdict. Treat the *pattern* (which gateway is
faster, by roughly how much) as signal; treat the exact numbers as
illustrative only.

Tool: `autocannon` (via `npx`, no install), `-c 20 -d 20` (20 connections, 20
seconds) per run.

## The networking confound (and why it's called out explicitly)

The first pass ran Grafbase **natively on the host** against Hive Router **in
Docker** (reaching host subgraphs via `host.docker.internal`). The gap was
enormous — Grafbase native showed ~48k req/s on the flat query vs Hive
Router's ~24k. That result would be **wrong to report** — it mostly measures
"does this process pay Docker's bridge-network tax," not "which gateway is
faster." So Grafbase was rebuilt as a Docker image
([`grafbase-federation/Dockerfile`](../../grafbase-federation/Dockerfile))
reaching the same subgraphs the same way (`host.docker.internal`), and
re-benchmarked. **The Docker-vs-Docker numbers below are the ones that count.**
Native-vs-Docker numbers are kept in the evidence folder for transparency but
are not used in the comparison matrix.

## Docker-vs-Docker results (the controlled comparison)

Both gateways: Docker containers, both reaching `accounts-subgraph`/
`policies-subgraph`/`funds-subgraph` on the host via `host.docker.internal`.
Grafbase: production `grafbase-gateway` binary (not `grafbase dev`), true-
federation topology (no REST extension), no caching configured in either
gateway for this run (fair — Hive Router has none to configure; see
[`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md)).

### B1 — flat query (`account(id) { id holderName totalValue }`)

Single upstream call, no fan-out. Measures gateway overhead floor.

| | Grafbase (Docker) | Hive Router |
|---|---|---|
| p50 latency | 1 ms | 0 ms |
| p97.5 latency | 3 ms | 1 ms |
| p99 latency | 3 ms | 1 ms |
| Avg latency | 1.20 ms | 0.17 ms |
| Throughput (avg req/s) | 11,748 | 23,922 |
| Total requests (20s) | 235,000 | 478,000 |

**Hive Router: ~2.0x the throughput, ~1/7th the average latency.**

### B3 — full 3-way join (`InsurancePortfolio`: account → policies → linkedFunds, account → fundHoldings → fund)

The realistic worst case — cross-subgraph entity fan-out on every request.

| | Grafbase (Docker) | Hive Router |
|---|---|---|
| p50 latency | 3 ms | 1 ms |
| p97.5 latency | 5 ms | 3 ms |
| p99 latency | 6 ms | 3 ms |
| Avg latency | 3.34 ms | 1.44 ms |
| Throughput (avg req/s) | 5,221 | 9,932 |
| Total requests (20s) | 104,000 | 199,000 |

**Hive Router: ~1.9x the throughput, less than half the average latency.**

Raw autocannon output: [`evidence/grafbase-docker-b1.txt`](./evidence/grafbase-docker-b1.txt),
[`evidence/grafbase-docker-b3.txt`](./evidence/grafbase-docker-b3.txt),
[`evidence/hive-b1.txt`](./evidence/hive-b1.txt),
[`evidence/hive-b3.txt`](./evidence/hive-b3.txt).

## Interpretation

- **Directionally consistent with Hive Router's own published claims**
  (Rust core, zero-copy JSON, arena allocation — see
  [`00-research-findings.md`](./00-research-findings.md)) — a ~2x factor here
  is plausible and not surprising for a purpose-built Rust query executor vs.
  a gateway that also carries an embedded WASM extension runtime and (in this
  build) a full Node/npm composition toolchain in the same image.
- **Not surprising, and not yet decisive.** At this request volume both
  gateways are almost certainly *not* the bottleneck in a real deployment —
  the REST backends and network hops to them dominate in production, and this
  PoC's mock APIs return in well under a millisecond, which is not
  representative. The gap could compress, hold, or widen against real
  backend latency; that's exactly why the plan calls for testing against a
  staging-like backend before this number informs a production decision.
- **Single biggest unknown left by this pilot:** cache-hit performance.
  Grafbase's operation+entity caching (verified working in this repo's
  existing docs) could close or invert this gap for repeated queries, since
  Hive Router has nothing to cache with yet. B4 (repeat-query, cache-hit
  scenario) from the original plan was **not run** — there's no fair
  cache-vs-no-cache comparison to make until Hive Router ships #312. Running
  B4 for Grafbase alone, without a Hive Router counterpart, would bias the
  writeup — so it's deferred rather than run one-sided.

## What the original plan called for but wasn't executed here

- 3 repetitions per scenario with median reporting
- Cold-start and soak-test load levels
- CPU/memory-pinned containers
- B2 (dedup fan-out) and B5 (concurrent breadth) scenarios
- Any load level beyond 20 concurrent connections

These are real gaps, not oversights — flagged explicitly in the outcome doc's
Next Steps rather than glossed over.
