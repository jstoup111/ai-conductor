---
slug: live-daemon-e2e-tier-covers-only-claude-no-real-ag
spec_hash: bc454dfa026beff8234d450a1c4d6f4c2231dcf380299768f5373e87b6790b91
pr: https://github.com/jstoup111/ai-conductor/pull/1575
shipped: 2026-08-18
engine_version: 20260817T210345Z-38388d04343a
---

## Cost
input: 121538949
output: 535246
cache_read: 148539175
cache_creation: 2142407
cost_usd: 42.6378
dispatches: 77
retries: 26
halts: 5
unmetered: count: 15, duration_ms: 0
cost_unmetered: count: 47
providers:
  codex: input: 121538507, output: 328327, cache_read: 116462080, cache_creation: 0, cost_usd: 0, dispatches: 47, cost_unmetered: 47
  claude: input: 442, output: 206919, cache_read: 32077095, cache_creation: 2142407, cost_usd: 42.6378, dispatches: 19, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 6
skipped: 0
cache_hits: 40
infrastructure_failures: 0
rubrics:
  completeness: failures: 12, judged: 16
  rootCause: failures: 3, judged: 16
  scope: failures: 0, judged: 16
  tautology: failures: 9, judged: 16
skip_reasons:
