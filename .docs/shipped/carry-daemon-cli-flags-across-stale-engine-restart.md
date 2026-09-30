---
slug: carry-daemon-cli-flags-across-stale-engine-restart
spec_hash: e131d03afd16b8e8d33fd68141bba8438990b42f8dfe0f659650e36031463aec
pr: https://github.com/jstoup111/ai-conductor/pull/2837
shipped: 2026-09-29
engine_version: 20260929T224340Z-3ed99833a1db
---

## Cost
input: 654706
output: 48907
cache_read: 8017907
cache_creation: 222758
cost_usd: 6.9037
dispatches: 14
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 654656, output: 35854, cache_read: 7120640, cache_creation: 0, cost_usd: 4.7242, dispatches: 8, cost_unmetered: 0
  claude: input: 50, output: 13053, cache_read: 897267, cache_creation: 222758, cost_usd: 2.1794, dispatches: 6, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: not reached
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 1, judged: 1
skip_reasons:
