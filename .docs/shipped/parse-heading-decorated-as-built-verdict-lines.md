---
slug: parse-heading-decorated-as-built-verdict-lines
spec_hash: 11bab7c0b5d5bb5a47467d4c26d8c7abd5049c072022d3983ebf083609de1259
pr: https://github.com/jstoup111/ai-conductor/pull/2435
shipped: 2026-09-09
engine_version: 20260909T010219Z-decd14cb6c54
---

## Cost
input: 860321
output: 111945
cache_read: 22217455
cache_creation: 646288
cost_usd: 17.456
dispatches: 25
retries: 1
halts: 3
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 860193, output: 57437, cache_read: 18259072, cache_creation: 0, cost_usd: 7.1758, dispatches: 8, cost_unmetered: 0
  claude: input: 128, output: 54508, cache_read: 3958383, cache_creation: 646288, cost_usd: 10.2802, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
