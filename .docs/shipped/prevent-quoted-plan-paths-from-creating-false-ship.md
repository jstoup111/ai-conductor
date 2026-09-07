---
slug: prevent-quoted-plan-paths-from-creating-false-ship
spec_hash: 40bc7a50506bec95f1c5b6dd6e00972564133bb840bfa05e6ef36b1ee0f90747
pr: https://github.com/jstoup111/ai-conductor/pull/2362
shipped: 2026-09-07
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 1191314
output: 163602
cache_read: 34558188
cache_creation: 635284
cost_usd: 25.4496
dispatches: 26
retries: 1
halts: 2
unmetered: count: 9, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1191140, output: 95791, cache_read: 28105984, cache_creation: 0, cost_usd: 12.4653, dispatches: 10, cost_unmetered: 0
  claude: input: 174, output: 67811, cache_read: 6452204, cache_creation: 635284, cost_usd: 12.9843, dispatches: 7, cost_unmetered: 0

## Time
state: measured
active_ms: 8057298
provider_active_ms: 6450152
no_provider_active_ms: 1607146

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
