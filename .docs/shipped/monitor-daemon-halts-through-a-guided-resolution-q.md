---
slug: monitor-daemon-halts-through-a-guided-resolution-q
spec_hash: cde2a62bace71b412ef3e96a49b8272be9dd29c7535c14f023a6acf8ea33e112
pr: https://github.com/jstoup111/ai-conductor/pull/2818
shipped: 2026-10-04
engine_version: 20261003T201457Z-42a8ad9bcd91
---

## Cost
input: 11058127
output: 1099193
cache_read: 249617934
cache_creation: 2594989
cost_usd: 128.9193
dispatches: 166
retries: 15
halts: 27
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 11057445, output: 805762, cache_read: 228320128, cache_creation: 0, cost_usd: 92.7462, dispatches: 120, cost_unmetered: 0
  claude: input: 682, output: 293431, cache_read: 21297806, cache_creation: 2594989, cost_usd: 36.1731, dispatches: 46, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 2, judged: 8
  security: failures: 0, judged: 8
  testQuality: failures: 1, judged: 8
skip_reasons:
