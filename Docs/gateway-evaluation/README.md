# GraphQL Gateway Evaluation — Grafbase vs Hive Router

Execution record for the spike planned in
[`GraphQL-Gateway-Evaluation-Spike-Plan.md`](./GraphQL-Gateway-Evaluation-Spike-Plan.md).
This folder documents what was actually built, run, and measured — not a
projection of what a 3-week spike would find, but the real output of running
both gateways against genuine multi-subgraph federation on this machine on
2026-08-21.

**Start with [`CONFLUENCE-Outcome.md`](./CONFLUENCE-Outcome.md)** — the
publishable summary with the recommendation. The numbered files below are the
supporting evidence it draws on.

| File | Covers |
|---|---|
| [`00-research-findings.md`](./00-research-findings.md) | What Hive Router actually is, sourced from its own docs/repo (GQL-101) |
| [`01-poc-architecture.md`](./01-poc-architecture.md) | The 3-subgraph PoC built for both gateways, and how to run it (GQL-102/103) |
| [`02-schema-automation-demo.md`](./02-schema-automation-demo.md) | The core question — a real REST field addition traced through both architectures (GQL-104) |
| [`03-benchmark-results.md`](./03-benchmark-results.md) | Real (single-run, methodology-caveated) throughput/latency numbers (GQL-107) |
| [`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md) | Caching, auth, observability, deployment footprint (GQL-105/106/108) |
| [`05-comparison-matrix.md`](./05-comparison-matrix.md) | Scored matrix with evidence links (GQL-109) |
| [`evidence/`](./evidence/) | Raw autocannon output, container logs, the composed supergraph SDL |

## What's real vs. what's a documented gap

Everything reported as a result below was actually executed on this machine —
subgraphs built and run, gateways composed and queried, benchmarks fired,
REST contracts changed and traced end-to-end. Nothing here is a projection.

That said, this is a compressed single-session execution of what the spike
plan scoped as 3 weeks. Explicitly **not** done, and called out again in
§"Follow-ups" of the outcome doc:
- Multi-repetition benchmarks (plan calls for 3 reps/median; this is 1 run per scenario)
- Soak testing (15 min sustained load)
- Resource-pinned containers (CPU/memory limits)
- Hands-on JWT auth wiring for either gateway (found in docs, not built)
- OpenTelemetry/Prometheus wiring for either gateway (found in docs, not built)
- A production-realistic backend (mock REST APIs are trivial — near-zero latency, no failure injection)
