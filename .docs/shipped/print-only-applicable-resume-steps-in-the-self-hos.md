---
slug: print-only-applicable-resume-steps-in-the-self-hos
spec_hash: 2e45653886aa2f9e4b4c79b9a58261c1cdaaceab05a819dd16d89dbb67bf40ed
pr: https://github.com/jstoup111/ai-conductor/pull/2565
shipped: 2026-09-15
engine_version: 20260915T105227Z-df26a1d8ebd1
---

## Cost
input: 419926
output: 51006
cache_read: 6894960
cache_creation: 197090
cost_usd: 6.5249
dispatches: 9
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 419900, output: 40947, cache_read: 6263040, cache_creation: 0, cost_usd: 3.9864, dispatches: 6, cost_unmetered: 0
  claude: input: 26, output: 10059, cache_read: 631920, cache_creation: 197090, cost_usd: 2.5385, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
