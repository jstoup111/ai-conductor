---
slug: mergeable-autoresolve-tier-2-escalates-every-conte
spec_hash: c5a35f6f982ac49f33d9897c2fa7a4cec95559bf323c43db1909a62f4f971154
pr: https://github.com/jstoup111/ai-conductor/pull/2646
shipped: 2026-09-24
engine_version: 20260923T231757Z-437f09322025
---

## Cost
input: 3402471
output: 696509
cache_read: 83640620
cache_creation: 3292836
cost_usd: 100.7653
dispatches: 111
retries: 8
halts: 14
unmetered: count: 18, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3401669, output: 340981, cache_read: 56660992, cache_creation: 0, cost_usd: 35.0472, dispatches: 43, cost_unmetered: 0
  claude: input: 802, output: 355528, cache_read: 26979628, cache_creation: 3292836, cost_usd: 65.7181, dispatches: 68, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","291fdaff-eeec-4741-a111-776e0d9eeb7d","lifecycle-step","build"],step:execution\u0000["timing-rollup","persisted-ledger","a027227d-a33f-41e7-a824-a409e3bab815","lifecycle-step","build"],step:execution\u0000["timing-rollup","persisted-ledger","d594f8e7-4233-449e-968b-2f1d829533a2","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 8
infrastructure_failures: 6
rubrics:
  security: failures: 0, judged: 16
  testQuality: failures: 0, judged: 16
skip_reasons:
