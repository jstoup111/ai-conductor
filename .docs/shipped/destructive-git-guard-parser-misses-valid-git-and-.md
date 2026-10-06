---
slug: destructive-git-guard-parser-misses-valid-git-and-
spec_hash: 55541cece7e61770f9d36c5fa16c160c0bd1f40f6ce6f45848f836095ec8f0fd
pr: https://github.com/jstoup111/ai-conductor/pull/2997
shipped: 2026-10-06
engine_version: 20261006T095922Z-fd83edec5ce4
---

## Cost
input: 2633820
output: 284417
cache_read: 44155429
cache_creation: 1304070
cost_usd: 37.4671
dispatches: 92
retries: 3
halts: 10
unmetered: count: 35, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2633602, output: 141337, cache_read: 38073344, cache_creation: 0, cost_usd: 21.8105, dispatches: 38, cost_unmetered: 0
  claude: input: 218, output: 143080, cache_read: 6082085, cache_creation: 1304070, cost_usd: 15.6566, dispatches: 54, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4466271a-1ce4-443c-b7b2-25b9ef05ac27","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 8
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
