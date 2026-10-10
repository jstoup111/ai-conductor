---
slug: atx-numbered-adr-decision-headings-are-uncitable-s
spec_hash: 2cf28f1919eec3077fe97a39a2cc13d27b9e1f1ad5c60d3431ca9103817f1b00
pr: https://github.com/jstoup111/ai-conductor/pull/3115
shipped: 2026-10-10
engine_version: 20261010T180413Z-fbbc3bdb2533
---

## Cost
input: 434808
output: 35181
cache_read: 5842230
cache_creation: 187327
cost_usd: 6.3033
dispatches: 11
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 434762, output: 19610, cache_read: 5080960, cache_creation: 0, cost_usd: 4.3408, dispatches: 6, cost_unmetered: 0
  claude: input: 46, output: 15571, cache_read: 761270, cache_creation: 187327, cost_usd: 1.9625, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","e1fd4cc1-e42b-4b55-952c-89e3f1f88cf7","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
