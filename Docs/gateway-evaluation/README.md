# GraphQL Gateway Evaluation — Grafbase vs Hive Router

Execution record for the spike planned in
[`GraphQL-Gateway-Evaluation-Spike-Plan.md`](./GraphQL-Gateway-Evaluation-Spike-Plan.md).
This folder documents what was actually built, run, and measured — not a
projection of what a 3-week spike would find, but the real output of running
both gateways against genuine multi-subgraph federation on this machine on
2026-08-21.

**Start with [`CONFLUENCE-WDCS-23671-Gateway-Evaluation.md`](./CONFLUENCE-WDCS-23671-Gateway-Evaluation.md)**
— the consolidated, publishable evaluation for Jira WDCS-23671, covering all
three candidates and carrying the current recommendation (**Hive Gateway**).

[`CONFLUENCE-Outcome.md`](./CONFLUENCE-Outcome.md) is the **earlier two-way**
Grafbase-vs-Hive-Router outcome. Its findings stand but **its recommendation is
superseded** — a third candidate was built afterwards and changed the answer. It
carries a banner explaining what changed.

The numbered files below are the supporting evidence both documents draw on.

| File | Covers |
|---|---|
| [`CONFLUENCE-WDCS-23671-Gateway-Evaluation.md`](./CONFLUENCE-WDCS-23671-Gateway-Evaluation.md) | **The spike deliverable.** All three candidates, 14-section Confluence format, current recommendation |
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
plan scoped as 3 weeks.

**Closed since, on 2026-10-23** (see §9 of the consolidated doc):
- GraphQL Mesh as the REST→subgraph path — built and verified as `hive-poc/`
- Caching and explicit invalidation for both Hive paths — built and verified
- Federation parity for both gateways — re-verified from a clean checkout

Still explicitly **not** done:
- Multi-repetition benchmarks (plan calls for 3 reps/median; this is 1 run per scenario)
- Soak testing (15 min sustained load)
- Resource-pinned containers (CPU/memory limits)
- **Any** performance benchmark of Hive Gateway — the recommended option
- Hands-on JWT auth wiring for any gateway (found in docs, not built)
- OpenTelemetry/Prometheus wiring for any gateway (found in docs, not built)
- A breaking schema change (only the non-breaking case was executed)
- A production-realistic backend (mock REST APIs are trivial — near-zero latency, no failure injection)
