---
slug: daemon-build-review-can-wedge-before-provider-laun
spec_hash: 3962da192a03144de2cfa78f91dad5cbd271f3fae5ea67f08535b56f55633766
pr: https://github.com/jstoup111/ai-conductor/pull/1231
shipped: 2026-08-02
engine_version: 20260802T091115Z-1551f80fb912
---

## Cost
input: 142933599
output: 369544
cache_read: 165664055
cache_creation: 782172
cost_usd: 26.6836
dispatches: 28
retries: 0
halts: 0
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 15
providers:
  codex: input: 142933307, output: 272392, cache_read: 139713536, cache_creation: 0, cost_usd: 0, dispatches: 15, cost_unmetered: 15
  claude: input: 292, output: 97152, cache_read: 25950519, cache_creation: 782172, cost_usd: 26.6836, dispatches: 11, cost_unmetered: 0

## Time
state: partial
