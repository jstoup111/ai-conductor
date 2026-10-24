---
slug: a-routed-fix-is-never-carried-up-the-stack-or-foll
spec_hash: 71c16f2f4dd3fd7bc553ff2c8154e51764a3ca43ee32080f9bddfd6e257b3564
pr: https://github.com/jstoup111/ai-conductor/pull/3389
shipped: 2026-10-24
engine_version: 20261024T094223Z-8d8e019bfff7
---

## Cost
input: 8428320
output: 1004733
cache_read: 235121801
cache_creation: 5103296
cost_usd: 142.1946
dispatches: 125
retries: 14
halts: 12
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 8427922, output: 680298, cache_read: 203924224, cache_creation: 0, cost_usd: 88.6384, dispatches: 81, cost_unmetered: 0
  claude: input: 398, output: 324435, cache_read: 31197577, cache_creation: 5103296, cost_usd: 53.5562, dispatches: 44, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 17
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 13
  security: failures: 0, judged: 9
  testQuality: failures: 3, judged: 13
skip_reasons:
  disabled: 13
  leaf-only: 4
