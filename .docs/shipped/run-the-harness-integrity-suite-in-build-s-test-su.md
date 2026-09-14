---
slug: run-the-harness-integrity-suite-in-build-s-test-su
spec_hash: bbf0453f353c5551e730c44042090ffb2fb505b98c723a244f2d801e79583934
pr: https://github.com/jstoup111/ai-conductor/pull/2548
shipped: 2026-09-14
engine_version: 20260914T211543Z-5da62d0036d1
---

## Cost
input: 1016313
output: 96480
cache_read: 18333447
cache_creation: 111551
cost_usd: 10.5195
dispatches: 13
retries: 4
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1016275, output: 83925, cache_read: 17384064, cache_creation: 0, cost_usd: 8.6152, dispatches: 11, cost_unmetered: 0
  claude: input: 38, output: 12555, cache_read: 949383, cache_creation: 111551, cost_usd: 1.9043, dispatches: 2, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish,step:test_suite

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
