---
slug: malformed-as-built-clause-forces-an-operator-decis
spec_hash: 1db32b747dbb4c15a602255aef962406563333f962d90bd49b8a6c962c64e8b0
pr: https://github.com/jstoup111/ai-conductor/pull/2593
shipped: 2026-09-18
engine_version: 20260918T114042Z-85a6c2193c48
---

## Cost
input: 491634
output: 55956
cache_read: 8616040
cache_creation: 228292
cost_usd: 7.3087
dispatches: 9
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 491588, output: 35046, cache_read: 6966400, cache_creation: 0, cost_usd: 3.3625, dispatches: 6, cost_unmetered: 0
  claude: input: 46, output: 20910, cache_read: 1649640, cache_creation: 228292, cost_usd: 3.9463, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
