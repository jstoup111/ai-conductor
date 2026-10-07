---
slug: engine-cannot-represent-more-than-one-branch-step-
spec_hash: 187d4de7f2620f64082e5bdddc763985bdd9bc5bdd89356d5e64778e1690762e
pr: https://github.com/jstoup111/ai-conductor/pull/3019
shipped: 2026-10-07
engine_version: 20261007T021826Z-70eda29b4b7f
---

## Cost
input: 2390889
output: 305244
cache_read: 39217694
cache_creation: 4404351
cost_usd: 56.3592
dispatches: 155
retries: 11
halts: 28
unmetered: count: 44, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2385693, output: 132600, cache_read: 30255104, cache_creation: 0, cost_usd: 23.4634, dispatches: 71, cost_unmetered: 0
  claude: input: 260, output: 172386, cache_read: 8909472, cache_creation: 4404351, cost_usd: 32.8933, dispatches: 57, cost_unmetered: 0
  pi: input: 4936, output: 258, cache_read: 53118, cache_creation: 0, cost_usd: 0.0025, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","017c53ef-7ba4-44a1-a4b8-576da27a7c2c","lifecycle-step","build_review"],step:execution\u0000["timing-rollup","persisted-ledger","0b0b161f-d16b-426f-baa6-ad657e575e20","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","1a757bdd-b0c5-45ad-be5b-ca2e1a890040","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","5134f027-c62d-45e6-9302-75a8d7739fdd","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","c4d285f5-6e99-42fe-a51d-42afa50c4328","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 17
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 3
skip_reasons:
