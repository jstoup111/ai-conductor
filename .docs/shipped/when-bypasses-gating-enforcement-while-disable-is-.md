---
slug: when-bypasses-gating-enforcement-while-disable-is-
spec_hash: 3c79e241d854d26c57e9a6247987843fee193b8b4219678e1bc849d551b39b51
pr: https://github.com/jstoup111/ai-conductor/pull/2107
shipped: 2026-09-01
engine_version: 20260831T195224Z-deb31710fc27
---

## Cost
input: 1671420
output: 190177
cache_read: 32713597
cache_creation: 1251062
cost_usd: 34.5578
dispatches: 34
retries: 4
halts: 2
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1671088, output: 95561, cache_read: 21068544, cache_creation: 0, cost_usd: 13.8576, dispatches: 10, cost_unmetered: 0
  claude: input: 332, output: 94616, cache_read: 11645053, cache_creation: 1251062, cost_usd: 20.7002, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 5
infrastructure_failures: 0
rubrics:
  testQuality: failures: 7, judged: 11
skip_reasons:
