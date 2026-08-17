---
slug: finish-publication-burns-its-retry-budget-on-an-un
spec_hash: a2d11c83acc01ed79d55251958ca462f618d29a1cb28f58c748fb277dc6e1cc4
pr: https://github.com/jstoup111/ai-conductor/pull/1565
shipped: 2026-08-17
engine_version: 20260817T161751Z-f6143c05d7fb
---

## Cost
input: 130004237
output: 639260
cache_read: 148671898
cache_creation: 1493547
cost_usd: 32.1427
dispatches: 104
retries: 25
halts: 6
unmetered: count: 17, duration_ms: 0
cost_unmetered: count: 58
providers:
  codex: input: 130003799, output: 446155, cache_read: 123917056, cache_creation: 0, cost_usd: 0, dispatches: 58, cost_unmetered: 58
  claude: input: 438, output: 193105, cache_read: 24754842, cache_creation: 1493547, cost_usd: 32.1427, dispatches: 34, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 6
skipped: 0
cache_hits: 39
infrastructure_failures: 6
rubrics:
  completeness: failures: 13, judged: 14
  rootCause: failures: 7, judged: 17
  scope: failures: 10, judged: 17
  tautology: failures: 7, judged: 14
skip_reasons:
