---
slug: shipped-record-timing-never-reaches-measured-the-l
spec_hash: 1cb66379881dfc79d877c4b6facc6cd7fde9178b10df3de0b3a0af714cf46a0c
pr: https://github.com/jstoup111/ai-conductor/pull/1727
shipped: 2026-08-19
engine_version: 20260819T013135Z-da5ab6992a4a
---

## Cost
input: 2775983
output: 304842
cache_read: 67397019
cache_creation: 2314245
cost_usd: 38.8014
dispatches: 77
retries: 13
halts: 2
unmetered: count: 19, duration_ms: 0
cost_unmetered: count: 37
providers:
  codex: input: 2775497, output: 163177, cache_read: 43167232, cache_creation: 0, cost_usd: 0, dispatches: 37, cost_unmetered: 37
  claude: input: 486, output: 141665, cache_read: 24229787, cache_creation: 2314245, cost_usd: 38.8014, dispatches: 27, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 38
infrastructure_failures: 3
rubrics:
  completeness: failures: 0, judged: 15
  rootCause: failures: 15, judged: 18
  scope: failures: 0, judged: 18
  tautology: failures: 6, judged: 18
skip_reasons:
