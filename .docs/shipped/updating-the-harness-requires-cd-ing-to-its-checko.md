---
slug: updating-the-harness-requires-cd-ing-to-its-checko
spec_hash: 1c6bcdd8c9d821c296337beb15f46d8affa1bd3360179633ed7fde6d5cc310ff
pr: https://github.com/jstoup111/ai-conductor/pull/2610
shipped: 2026-09-19
engine_version: 20260919T150707Z-077af7755956
---

## Cost
input: 540258
output: 91670
cache_read: 12876369
cache_creation: 440343
cost_usd: 12.0415
dispatches: 12
retries: 1
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 540168, output: 43215, cache_read: 8969984, cache_creation: 0, cost_usd: 4.0702, dispatches: 7, cost_unmetered: 0
  claude: input: 90, output: 48455, cache_read: 3906385, cache_creation: 440343, cost_usd: 7.9713, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 1, judged: 2
skip_reasons:
  disabled: 1
