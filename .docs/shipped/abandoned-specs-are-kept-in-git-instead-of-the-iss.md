---
slug: abandoned-specs-are-kept-in-git-instead-of-the-iss
spec_hash: 234ca054bb9d66e31b46fb004f140e942e1ee82152a94d7bafb5c14a7045b43c
pr: https://github.com/jstoup111/ai-conductor/pull/1956
shipped: 2026-08-28
engine_version: 20260828T051725Z-80907eaa21b5
---

## Cost
input: 1547571
output: 239850
cache_read: 30760024
cache_creation: 496822
cost_usd: 25.9344
dispatches: 26
retries: 3
halts: 4
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1547261, output: 137907, cache_read: 21620480, cache_creation: 0, cost_usd: 13.8463, dispatches: 14, cost_unmetered: 0
  claude: input: 310, output: 101943, cache_read: 9139544, cache_creation: 496822, cost_usd: 12.0881, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
