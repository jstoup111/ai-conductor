---
slug: fail-closed-when-build-review-cannot-resolve-which
spec_hash: 64437706557b2ff6e1e5a4d39b708ac6a9636bd2ed41d4367f4cd5bb7e38a857
pr: https://github.com/jstoup111/ai-conductor/pull/2426
shipped: 2026-09-07
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 627081
output: 61224
cache_read: 11713865
cache_creation: 66487
cost_usd: 6.6996
dispatches: 13
retries: 2
halts: 0
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 627061, output: 48436, cache_read: 11176832, cache_creation: 0, cost_usd: 4.9012, dispatches: 7, cost_unmetered: 0
  claude: input: 20, output: 12788, cache_read: 537033, cache_creation: 66487, cost_usd: 1.7984, dispatches: 1, cost_unmetered: 0

## Time
state: measured
active_ms: 3490609
provider_active_ms: 2941769
no_provider_active_ms: 548840

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
