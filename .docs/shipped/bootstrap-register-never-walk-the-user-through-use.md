---
slug: bootstrap-register-never-walk-the-user-through-use
spec_hash: eee871b982c47149da35d884ba7435f7daedd8fa596c827b7834bff26d14fd0f
pr: https://github.com/jstoup111/ai-conductor/pull/2575
shipped: 2026-09-19
engine_version: 20260919T112422Z-8d60f5660031
---

## Cost
input: 2836525
output: 691879
cache_read: 84938583
cache_creation: 3280506
cost_usd: 113.9088
dispatches: 57
retries: 4
halts: 8
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2835661, output: 269454, cache_read: 44022016, cache_creation: 0, cost_usd: 24.9614, dispatches: 32, cost_unmetered: 0
  claude: input: 864, output: 422425, cache_read: 40916567, cache_creation: 3280506, cost_usd: 88.9474, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 8
skip_reasons:
  disabled: 3
