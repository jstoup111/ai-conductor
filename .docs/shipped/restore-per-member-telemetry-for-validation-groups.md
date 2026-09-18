---
slug: restore-per-member-telemetry-for-validation-groups
spec_hash: 99c857dc64defe0accb43f742adb19da6b26a7b5f73b07da55f3976e280e8363
pr: https://github.com/jstoup111/ai-conductor/pull/2514
shipped: 2026-09-18
engine_version: 20260918T114042Z-85a6c2193c48
---

## Cost
input: 4346580
output: 793384
cache_read: 210711068
cache_creation: 5196431
cost_usd: 168.1573
dispatches: 67
retries: 6
halts: 9
unmetered: count: 15, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4345742, output: 398992, cache_read: 141973376, cache_creation: 0, cost_usd: 50.2572, dispatches: 42, cost_unmetered: 0
  claude: input: 838, output: 394392, cache_read: 68737692, cache_creation: 5196431, cost_usd: 117.9001, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 2, judged: 8
skip_reasons:
