---
slug: when-composer-runs-inside-herdr-or-tmux-rename-the
spec_hash: 7b578b0a0e283df13c9ff3313928f93ecf9543347bd04c9ffa4f21c56771cf77
pr: https://github.com/jstoup111/ai-conductor/pull/3413
shipped: 2026-10-25
engine_version: 20261025T013958Z-b1af2e6fb396
---

## Cost
input: 719754
output: 72595
cache_read: 12396291
cache_creation: 361495
cost_usd: 10.0213
dispatches: 22
retries: 2
halts: 0
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 719682, output: 44701, cache_read: 11045120, cache_creation: 0, cost_usd: 6.3009, dispatches: 13, cost_unmetered: 0
  claude: input: 72, output: 27894, cache_read: 1351171, cache_creation: 361495, cost_usd: 3.7204, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
