---
slug: unresolved-covers-marker-on-a-changed-test-exhaust
spec_hash: 49cbe9d6094886a4717bb34ec3137a462775e02a75bf7bd80cafa0923ba2ec26
pr: https://github.com/jstoup111/ai-conductor/pull/3087
shipped: 2026-10-10
engine_version: 20261010T132818Z-14d7967cd432
findings:
  - gate: architecture_review_as_built
    finding: "as-built:931f17d3-fffe-41ee-8c6f-135cc5c47b0c:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-12-cumulative-build-review-convergence-bound decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: conductor.ts:11993–12016 consumes the build_review budget but checks only exhausted, ignoring cumulativeExhausted. Tree-changing repair laps reset the per-tree count and can continue past the effective cumulative cap. Apply the existing configured cumulative-cap halt handling before routing to BUILD."
  - gate: architecture_review_as_built
    finding: "as-built:931f17d3-fffe-41ee-8c6f-135cc5c47b0c:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-12-cumulative-build-review-convergence-bound decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: conductor.ts:11995–12001 emits the new build_review kickback without cumulativeCount, although the consumed budget increments it. Include kickback.entry.cumulative in the existing event as required by D5."
---

## Cost
input: 1040796
output: 93547
cache_read: 15112488
cache_creation: 436790
cost_usd: 13.7797
dispatches: 28
retries: 3
halts: 1
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1040690, output: 58839, cache_read: 13435776, cache_creation: 0, cost_usd: 9.2554, dispatches: 16, cost_unmetered: 0
  claude: input: 106, output: 34708, cache_read: 1676712, cache_creation: 436790, cost_usd: 4.5242, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fb718e2a-b138-4630-ab8e-702c7090418a","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
