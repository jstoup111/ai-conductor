---
slug: 2026-07-27-codex-usage-metering-and-cost-attribution-906
spec_hash: 862824b5af80911c59c8110a76356662f58fe7d3e6210f5ee9abde2b68f800ee
pr: https://github.com/jstoup111/ai-conductor/pull/1090
shipped: 2026-07-28
engine_version: 20260728T022446Z-e0a2a7af222c
---

## Cost
input: 20839769
output: 116194
cache_read: 27302206
cache_creation: 281713
cost_usd: 10.3783
dispatches: 12
retries: 0
halts: 0
unmetered: count: 5, duration_ms: 0
providers:
  claude: input: 131, output: 65710, cache_read: 7012158, cache_creation: 281713, cost_usd: 10.3783, dispatches: 5
  codex: input: 20839638, output: 50484, cache_read: 20290048, cache_creation: 0, cost_usd: 0, dispatches: 4
