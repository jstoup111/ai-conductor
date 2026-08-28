---
slug: fix-otel-step-duration-histogram-bucket-saturation
spec_hash: 1ffe3f3fd79cd9d4207d2b9859960ed0c83dee2e5aa0ab6ffdca4528a3348ce3
pr: https://github.com/jstoup111/ai-conductor/pull/1985
shipped: 2026-08-28
engine_version: 20260828T002007Z-9437d2c3c3be
---

## Cost
input: 650298
output: 50918
cache_read: 9094800
cache_creation: 250839
cost_usd: 7.3506
dispatches: 13
retries: 0
halts: 1
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 650264, output: 39089, cache_read: 8232704, cache_creation: 0, cost_usd: 4.1153, dispatches: 6, cost_unmetered: 0
  claude: input: 34, output: 11829, cache_read: 862096, cache_creation: 250839, cost_usd: 3.2353, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 3355030
provider_active_ms: 2812549
no_provider_active_ms: 542481

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 2
skip_reasons:
