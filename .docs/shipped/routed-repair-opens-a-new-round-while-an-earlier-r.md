---
slug: routed-repair-opens-a-new-round-while-an-earlier-r
spec_hash: bfa1dda1d700f04e1e3d50c5569d32ad7e41cef615114092937dcd0214dc2180
pr: https://github.com/jstoup111/ai-conductor/pull/3521
shipped: 2026-10-29
engine_version: 20261029T135834Z-54bb2b838304
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "No story, plan task or remediation task covers ClaudeProvider tests; the change is unrelated to routed-round admission and drain. It weakens environment isolation in an unrelated test and adds no feature behavior."
    accepted: false
    authority: engine
---

## Cost
input: 5418355
output: 457754
cache_read: 96657335
cache_creation: 2188740
cost_usd: 64.4301
dispatches: 99
retries: 16
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 10
providers:
  codex: input: 5418077, output: 312290, cache_read: 85890432, cache_creation: 0, cost_usd: 41.8564, dispatches: 67, cost_unmetered: 10
  claude: input: 278, output: 145464, cache_read: 10766903, cache_creation: 2188740, cost_usd: 22.5737, dispatches: 32, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","00fa67fa-ae2d-499d-81f5-a233d19a3014","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 9
  implementationQuality: failures: 5, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 0, judged: 9
skip_reasons:
