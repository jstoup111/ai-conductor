---
slug: prd-audit-passes-on-a-partial-report-when-backgrou
spec_hash: a2a9d21827ce4922eac5872e211a0b5c852eea51e3d61f115e5ab55229f7217b
pr: https://github.com/jstoup111/ai-conductor/pull/1457
shipped: 2026-08-11
engine_version: 20260811T082815Z-f5de721eb47e
---

## Cost
input: 59893781
output: 308831
cache_read: 80130939
cache_creation: 613268
cost_usd: 21.1428
dispatches: 34
retries: 4
halts: 0
unmetered: count: 10, duration_ms: 0
cost_unmetered: count: 18
providers:
  codex: input: 59893151, output: 163527, cache_read: 57642496, cache_creation: 0, cost_usd: 0, dispatches: 22, cost_unmetered: 18
  claude: input: 630, output: 145304, cache_read: 22488443, cache_creation: 613268, cost_usd: 21.1428, dispatches: 10, cost_unmetered: 0

## Time
state: partial
