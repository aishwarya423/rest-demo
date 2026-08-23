# GQL-109 — Comparison Matrix

Scored 1–5 per category, weighted per the original plan's decision-driver
ranking ([`GraphQL-Gateway-Evaluation-Spike-Plan.md`](./GraphQL-Gateway-Evaluation-Spike-Plan.md)
§8.1). Every score links to the evidence file that backs it — no un-sourced
scores, consistent with the plan's rule for this table. Scores reflect what
was actually measured in this session, not vendor claims for anything marked
"not hands-on tested."

| Category | Weight | Grafbase | Hive Router | Evidence |
|---|---|---|---|---|
| Schema-evolution automation | 20% | **3** — type-level generation is automatic; field exposure has a silent-failure trap (jq allow-list) that this demo caught live | **4** — no generator at all (con), but the passthrough-resolver pattern it requires has no silent-failure mode (pro); net safer, still fully manual | [`02-schema-automation-demo.md`](./02-schema-automation-demo.md) |
| True federation capability | 15% | **5** — proven to compose and execute true Federation v2 correctly, byte-identical to Hive Router's output | **5** — proven to compose and execute true Federation v2 correctly | [`01-poc-architecture.md`](./01-poc-architecture.md) |
| REST integration effort | 15% | **5** — declarative `@rest`/`@restEndpoint` directives, no subgraph server to write, already proven in production for this repo | **2** — no native path; requires hand-written subgraphs (as built here) or standing up GraphQL Mesh (not evaluated) | [`00-research-findings.md`](./00-research-findings.md) §1/§3 |
| Performance (B1/B3 throughput, Docker-controlled) | 15% | **2** — roughly half the throughput, ~2-7x the latency of Hive Router in this pilot | **5** — ~2x throughput, well under half the latency | [`03-benchmark-results.md`](./03-benchmark-results.md) — **single-run pilot, not statistically rigorous; see caveats** |
| Caching model fit | 10% | **5** — operation + entity caching verified working, Redis-backed | **1** — not implemented; open RFC only | [`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md) |
| Operational overhead (deploy, image size, startup) | 10% | **2** — 793MB image, composition toolchain baked into the runtime container | **4** — 128MB image, ~48ms cold start, no composition toolchain at runtime | [`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md) |
| Developer experience | 10% | **4** — declarative REST integration is genuinely fast to iterate on; `grafbase dev` hot-reloaded the schema change with zero restart during this session | **2** — every subgraph/SDL change needs an explicit external recompose + restart; no native REST facade means writing subgraph servers by hand | Hands-on, this session (both `01-poc-architecture.md` and `02-schema-automation-demo.md`) |
| Observability | 5% | **3** — low default log verbosity observed; OTel/Prometheus support not independently verified | **3** — structured JSON logs (a plus) but noisy per-request default verbosity (a real cost) observed; OTel/Prometheus claimed, not verified | [`04-caching-auth-observability-deployment.md`](./04-caching-auth-observability-deployment.md) |

## Weighted total

| | Grafbase | Hive Router |
|---|---|---|
| Schema-evolution automation (20%) | 0.60 | 0.80 |
| True federation (15%) | 0.75 | 0.75 |
| REST integration (15%) | 0.75 | 0.30 |
| Performance (15%) | 0.30 | 0.75 |
| Caching (10%) | 0.50 | 0.10 |
| Operational overhead (10%) | 0.20 | 0.40 |
| Developer experience (10%) | 0.40 | 0.20 |
| Observability (5%) | 0.15 | 0.15 |
| **Total (out of 5)** | **3.65** | **3.45** |

## Applying the plan's own decision rule

The plan (§8.1) says: if the gap is **>0.5 points**, that's the
recommendation; if **≤0.5**, decide on the highest-weight category
(schema-evolution automation) plus the risk register instead of the
aggregate.

The gap here is **0.20** — inside the ≤0.5 tie-break zone. Per the plan's own
rule, the aggregate score is **not** the basis for the recommendation.
Schema-evolution automation is the tiebreaker, and on that category Hive
Router scored higher (4 vs 3) — but not because Hive Router does anything
about schema automation; it's because Grafbase's *specific existing
implementation choice* (REST extension + jq allow-list) has a silent-failure
mode that the alternative architecture (hand-written passthrough subgraphs,
available under *either* gateway) doesn't have. See the outcome doc for how
this resolves the recommendation.
