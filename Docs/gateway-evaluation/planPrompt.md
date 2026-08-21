I'll quickly check the repo to ground this plan in your actual POC setup (Docker config, existing docs) before drafting the full execution plan.

Now I have solid grounding — your current Grafbase POC uses the REST WASM extension as a single virtual subgraph (which is why entity caching was a no-op until you split out `funds-subgraph`), a hand-rolled Swagger→SDL generator with a manual promote step, and Redis-backed operation caching that's verified working. I'll write the plan against these specifics rather than generic vendor claims.

I saved the plan to [Docs/jira/GraphQL-Gateway-Evaluation-Spike-Plan.md](Docs/jira/GraphQL-Gateway-Evaluation-Spike-Plan.md), following your existing `Docs/jira/` convention.

**What's grounded in your actual repo** (not generic vendor comparison):

- The schema-automation question is reframed as its own top-weighted evaluation category (20%), scoped honestly — a breaking REST change can't be made zero-touch by any tool, so the demo (GQL-104) tests one non-breaking and one breaking change against both gateways' regeneration paths, benchmarked against your current `schema:generate` → `schema:validate` → `schema:promote` pipeline.
- The biggest structural risk gets a dedicated de-risking task (GQL-101) up front: Hive Router is a Federation v2 router expecting real GraphQL subgraphs, unlike Grafbase's REST-extension virtual-subgraph model. That likely means the Hive Router PoC needs per-service subgraphs generalizing the pattern you already proved with `funds-subgraph` — I flagged this to verify against current docs rather than asserting it, since gateway tooling moves fast.
- Caching evaluation (GQL-106) explicitly re-tests the entity-caching-needs-a-real-subgraph-boundary finding from [ENTITY-CACHING-WHY-NOOP.md](Docs/ENTITY-CACHING-WHY-NOOP.md) — it can't be assumed to hold for Hive Router.
- Grafbase evaluation rows point at what already exists (`REST_FEDERATION.md`, `CACHING.md`, the Bruno collection) so that side of the work is largely reuse/extension, not a rebuild.
- Benchmarks reuse your existing `InsurancePortfolio` query as the primary load-test scenario (B3/B4) since it's already your proof query.

Includes a full 3-week plan, 9 Jira subtasks with acceptance criteria and DoD, a weighted scoring matrix with a decision rule for near-ties, an 8-item risk register, and a fill-in-the-blanks recommendation template.

Want me to also publish this as a shareable Artifact for easier navigation, or draft the `HIVE_ROUTER_FEDERATION.md` skeleton file the plan references?