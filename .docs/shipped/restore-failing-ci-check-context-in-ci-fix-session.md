---
slug: restore-failing-ci-check-context-in-ci-fix-session
spec_hash: 04d9c0dd42a261ba6a903d3065ad8620e760eebd54189b469ca0e6d54b7c4f67
pr: https://github.com/jstoup111/ai-conductor/pull/2534
shipped: 2026-09-15
engine_version: 20260914T211543Z-5da62d0036d1
---

## Cost
input: 3303257
output: 550554
cache_read: 104695009
cache_creation: 2835136
cost_usd: 101.4296
dispatches: 50
retries: 11
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3302795, output: 299688, cache_read: 76707712, cache_creation: 0, cost_usd: 33.6433, dispatches: 29, cost_unmetered: 0
  claude: input: 462, output: 250866, cache_read: 27987297, cache_creation: 2835136, cost_usd: 67.7864, dispatches: 21, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 5
skip_reasons:
