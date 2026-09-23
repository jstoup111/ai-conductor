---
slug: install-requires-a-manual-git-clone-no-curl-based-
spec_hash: 588109541bff2993d2b9b25558f41930b7a157cf4abeab9e0e651f881793caf0
pr: https://github.com/jstoup111/ai-conductor/pull/2626
shipped: 2026-09-23
engine_version: 20260923T174345Z-bac5a548b9cc
---

## Cost
input: 2978486
output: 715949
cache_read: 85897795
cache_creation: 4103883
cost_usd: 103.6377
dispatches: 111
retries: 5
halts: 17
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2977534, output: 314677, cache_read: 52271744, cache_creation: 0, cost_usd: 31.3955, dispatches: 40, cost_unmetered: 0
  claude: input: 952, output: 401272, cache_read: 33626051, cache_creation: 4103883, cost_usd: 72.2422, dispatches: 71, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 2
infrastructure_failures: 4
rubrics:
  security: failures: 0, judged: 15
  testQuality: failures: 5, judged: 13
skip_reasons:
