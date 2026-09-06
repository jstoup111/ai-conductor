---
slug: gh-cli-capability-probe-report-an-unsupported-json
spec_hash: 96a5ec25a92542405bbab0ad95452e95e558caf910474eae1519919b1ff15071
pr: https://github.com/jstoup111/ai-conductor/pull/2243
shipped: 2026-09-06
engine_version: 20260906T032235Z-0c471cd2a03d
---

## Cost
input: 2719534
output: 370866
cache_read: 70712276
cache_creation: 1283824
cost_usd: 52.2626
dispatches: 45
retries: 3
halts: 2
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2719136, output: 212900, cache_read: 54890112, cache_creation: 0, cost_usd: 27.5621, dispatches: 20, cost_unmetered: 0
  claude: input: 398, output: 157966, cache_read: 15822164, cache_creation: 1283824, cost_usd: 24.7005, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 4
skip_reasons:
