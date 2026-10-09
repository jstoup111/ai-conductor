---
slug: remediation-dispositions-honor-the-engine-owned-in
spec_hash: ec6c73e1a997c063f1e3026fb1b7991f67c373c41ff0ba764ce053f23973d3ce
pr: https://github.com/jstoup111/ai-conductor/pull/3040
shipped: 2026-10-09
engine_version: 20261008T202636Z-81e35748ef5a
---

## Cost
input: 5900391
output: 642373
cache_read: 184059412
cache_creation: 2728798
cost_usd: 86.4425
dispatches: 54
retries: 6
halts: 3
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5900147, output: 515224, cache_read: 166142976, cache_creation: 0, cost_usd: 58.4849, dispatches: 40, cost_unmetered: 0
  claude: input: 244, output: 127149, cache_read: 17916436, cache_creation: 2728798, cost_usd: 27.9576, dispatches: 14, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","880453fc-9878-41b4-85a7-8b51f5e1ba8c","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","a12355c3-2e3d-40c5-ab35-46b957cc30a4","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","cab3b761-3a75-41fc-8e74-41ff3cb79e05","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","d77d3bb0-9d41-4a27-a036-5b661ffa0289","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","f27d6933-fbca-4465-b226-f270fe43690b","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 1, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
