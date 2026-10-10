---
slug: build-origin-plan-gap-recovery-refuses-rewind-to-b
spec_hash: 6ed90927f7763c04dc013c3133ebfa6775300720418f7f960fc5d238d4755c44
pr: https://github.com/jstoup111/ai-conductor/pull/3120
shipped: 2026-10-10
engine_version: 20261010T180413Z-fbbc3bdb2533
---

## Cost
input: 385182
output: 36456
cache_read: 5226241
cache_creation: 100875
cost_usd: 4.3158
dispatches: 9
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 385130, output: 24117, cache_read: 4296320, cache_creation: 0, cost_usd: 3.0759, dispatches: 6, cost_unmetered: 0
  claude: input: 52, output: 12339, cache_read: 929921, cache_creation: 100875, cost_usd: 1.24, dispatches: 3, cost_unmetered: 0

## Time
state: measured
active_ms: 2593671
provider_active_ms: 1437005
no_provider_active_ms: 1156666

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
skip_reasons:
  test_quality_empty_scope: 1
