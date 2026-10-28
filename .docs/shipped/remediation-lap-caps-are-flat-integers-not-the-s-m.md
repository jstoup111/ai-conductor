---
slug: remediation-lap-caps-are-flat-integers-not-the-s-m
spec_hash: a8093377382d6ab66d437a3c5bc27ab3a30007fbfed4e45a5604926523f54fa6
pr: https://github.com/jstoup111/ai-conductor/pull/3443
shipped: 2026-10-26
engine_version: 20261026T015452Z-d74b2ab722ef
---

## Cost
input: 1502875
output: 129151
cache_read: 32000193
cache_creation: 441559
cost_usd: 17.2066
dispatches: 23
retries: 4
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1502805, output: 98659, cache_read: 30058368, cache_creation: 0, cost_usd: 12.6756, dispatches: 16, cost_unmetered: 0
  claude: input: 70, output: 30492, cache_read: 1941825, cache_creation: 441559, cost_usd: 4.531, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 1, judged: 2
skip_reasons:
  disabled: 2
