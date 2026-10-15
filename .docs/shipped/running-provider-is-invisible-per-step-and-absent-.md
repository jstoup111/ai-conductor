---
slug: running-provider-is-invisible-per-step-and-absent-
spec_hash: ca5c16b51915eadc6668a67b68a88176a7dabb2755e582e1c407743ca5bab18f
pr: https://github.com/jstoup111/ai-conductor/pull/3245
shipped: 2026-10-15
engine_version: 20261015T004522Z-65702d1bcf72
---

## Cost
input: 853994
output: 114924
cache_read: 20014847
cache_creation: 491677
cost_usd: 14.8908
dispatches: 19
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 853878, output: 61961, cache_read: 15145472, cache_creation: 0, cost_usd: 8.9238, dispatches: 11, cost_unmetered: 0
  claude: input: 116, output: 52963, cache_read: 4869375, cache_creation: 491677, cost_usd: 5.967, dispatches: 8, cost_unmetered: 0

## Time
state: measured
active_ms: 4490637
provider_active_ms: 3236140
no_provider_active_ms: 1254497

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
