---
slug: nothing-proves-a-faithful-fake-still-matches-its-r
spec_hash: af5ade76de63a21e6fde05e869b4e743372c02790f497fec3ff838d00278253b
pr: https://github.com/jstoup111/ai-conductor/pull/3680
shipped: 2026-11-09
engine_version: 20261109T141237Z-60702f2beb31
---

## Cost
input: 1624462
output: 136163
cache_read: 24396454
cache_creation: 691944
cost_usd: 17.9092
dispatches: 39
retries: 4
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1624342, output: 85481, cache_read: 21340416, cache_creation: 0, cost_usd: 10.7483, dispatches: 26, cost_unmetered: 0
  claude: input: 120, output: 50682, cache_read: 3056038, cache_creation: 691944, cost_usd: 7.1609, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 3
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  implementationQuality: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 2, judged: 3
skip_reasons:
  paths-unmatched: 3
