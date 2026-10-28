---
slug: pi-steps-never-receive-the-engine-built-system-pro
spec_hash: a63071b7f388f957eb288cff66c01bc880b3faf493dd2df7da6f6247994ec13b
pr: https://github.com/jstoup111/ai-conductor/pull/3441
shipped: 2026-10-26
engine_version: 20261026T015452Z-d74b2ab722ef
---

## Cost
input: 1730662
output: 159113
cache_read: 30622706
cache_creation: 748612
cost_usd: 23.0647
dispatches: 32
retries: 2
halts: 0
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1730552, output: 103349, cache_read: 28135680, cache_creation: 0, cost_usd: 15.4626, dispatches: 21, cost_unmetered: 0
  claude: input: 110, output: 55764, cache_read: 2487026, cache_creation: 748612, cost_usd: 7.602, dispatches: 11, cost_unmetered: 0

## Time
state: partial
active_ms: 23907699
reason: provider-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
  disabled: 3
