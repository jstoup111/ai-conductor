---
slug: flatten-refused-restack-halt-prescribes-a-recovery
spec_hash: 02a03ebd646de558666f14b060870c497a18dd5fa5fbc75e6e293cc2513b5b37
pr: https://github.com/jstoup111/ai-conductor/pull/3615
shipped: 2026-11-08
engine_version: 20261107T232453Z-618de874b750
---

## Cost
input: 3394981
output: 276621
cache_read: 58223424
cache_creation: 1963400
cost_usd: 46.6352
dispatches: 65
retries: 2
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3394775, output: 177462, cache_read: 51498624, cache_creation: 0, cost_usd: 27.599, dispatches: 38, cost_unmetered: 0
  claude: input: 206, output: 99159, cache_read: 6724800, cache_creation: 1963400, cost_usd: 19.0362, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 3, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 0, judged: 6
skip_reasons:
