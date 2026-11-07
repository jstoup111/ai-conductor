---
slug: otlp-header-credentials-can-only-come-from-an-envi
spec_hash: 24f2169e04325e0736b4312ac5b4e08941bceb0efbfa16081097f642eff0ab7a
pr: https://github.com/jstoup111/ai-conductor/pull/3531
shipped: 2026-10-29
engine_version: 20261029T135834Z-54bb2b838304
---

## Cost
input: 1849035
output: 176619
cache_read: 31574515
cache_creation: 675128
cost_usd: 19.9193
dispatches: 37
retries: 6
halts: 0
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 6
providers:
  codex: input: 1848915, output: 120437, cache_read: 28318848, cache_creation: 0, cost_usd: 12.7431, dispatches: 26, cost_unmetered: 6
  claude: input: 120, output: 56182, cache_read: 3255667, cache_creation: 675128, cost_usd: 7.1763, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  implementationQuality: failures: 1, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 1, judged: 3
skip_reasons:
