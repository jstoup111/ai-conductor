---
slug: routed-remediation-skips-re-run-steps-on-stale-chi
spec_hash: 1212a7016b17277dcca16616195c9713eb442ae0b0e9dd38758d9e33da552bf7
pr: https://github.com/jstoup111/ai-conductor/pull/3543
shipped: 2026-10-30
engine_version: 20261030T100118Z-079e48ea5f1d
---

## Cost
input: 4173516
output: 360816
cache_read: 66782143
cache_creation: 1342388
cost_usd: 42.4058
dispatches: 81
retries: 16
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 12
providers:
  codex: input: 4173276, output: 250340, cache_read: 58381440, cache_creation: 0, cost_usd: 27.7761, dispatches: 55, cost_unmetered: 12
  claude: input: 240, output: 110476, cache_read: 8400703, cache_creation: 1342388, cost_usd: 14.6297, dispatches: 26, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 7
  implementationQuality: failures: 2, judged: 7
  security: failures: 0, judged: 7
  testQuality: failures: 1, judged: 7
skip_reasons:
