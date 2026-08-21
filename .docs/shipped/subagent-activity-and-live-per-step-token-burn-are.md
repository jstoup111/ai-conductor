---
slug: subagent-activity-and-live-per-step-token-burn-are
spec_hash: 499a87928481d8ebfb5bc7eb16e00443374d99aa0052837ebccaf56ef0c86804
pr: https://github.com/jstoup111/ai-conductor/pull/1742
shipped: 2026-08-21
engine_version: 20260821T140854Z-49f61d6510da
---

## Cost
input: 5770394
output: 609532
cache_read: 126203200
cache_creation: 2690138
cost_usd: 56.4295
dispatches: 115
retries: 33
halts: 12
unmetered: count: 17, duration_ms: 0
cost_unmetered: count: 64
providers:
  codex: input: 5769530, output: 366668, cache_read: 80280320, cache_creation: 0, cost_usd: 0, dispatches: 64, cost_unmetered: 64
  claude: input: 864, output: 242864, cache_read: 45922880, cache_creation: 2690138, cost_usd: 56.4295, dispatches: 38, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:wiring_check

## Build Review
laps_to_pass: 12
skipped: 31
cache_hits: 72
infrastructure_failures: 7
rubrics:
  completeness: failures: 9, judged: 31
  rootCause: failures: 29, judged: 36
  scope: failures: 6, judged: 37
  tautology: failures: 6, judged: 6
skip_reasons:
  disabled: 31
