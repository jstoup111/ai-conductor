---
slug: manual-reviewer-edits-cannot-be-landed-safely-in-t
spec_hash: 6d7779aae323a92272ff9bf28706a119e4ffb3ff467f1002632a28a21c224d88
pr: https://github.com/jstoup111/ai-conductor/pull/3453
shipped: 2026-10-28
engine_version: 20261027T031452Z-97f09b9bd067
---

## Cost
input: 7871605
output: 891204
cache_read: 206728461
cache_creation: 5873028
cost_usd: 140.2712
dispatches: 131
retries: 4
halts: 14
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 7870995, output: 550331, cache_read: 169662208, cache_creation: 0, cost_usd: 79.0539, dispatches: 83, cost_unmetered: 0
  claude: input: 610, output: 340873, cache_read: 37066253, cache_creation: 5873028, cost_usd: 61.2174, dispatches: 48, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","718c5b7b-9a7c-447f-b782-0ff77a8f4341","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 38
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 20
  security: failures: 0, judged: 4
  testQuality: failures: 6, judged: 18
skip_reasons:
  disabled: 20
  leaf-only: 16
  test_quality_empty_scope: 2


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `206d860e-9562-4c91-b9a1-afa94144620e` — source ids: `testQuality:sha256:2b60d8add7c3aee65b6c1bc3a2a4024bf65f3b3e3ac849441d582d5506fa1fef`, `testQuality:sha256:13a00ea87cff0320f0a07785e6e9274f5f3b99e32f51908d8b6fcc3e96510d7f`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->