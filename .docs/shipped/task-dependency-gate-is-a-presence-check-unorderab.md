---
slug: task-dependency-gate-is-a-presence-check-unorderab
spec_hash: 79b34e42b7454f98dcd979909df117dd4f3156aec7450d6121326063a5ff43cb
pr: https://github.com/jstoup111/ai-conductor/pull/3616
shipped: 2026-11-07
engine_version: 20261107T171540Z-bd50b107eb9d
---

## Cost
input: 1330195
output: 95231
cache_read: 21157667
cache_creation: 372276
cost_usd: 14.1188
dispatches: 22
retries: 1
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1330143, output: 67886, cache_read: 19860352, cache_creation: 0, cost_usd: 10.334, dispatches: 17, cost_unmetered: 0
  claude: input: 52, output: 27345, cache_read: 1297315, cache_creation: 372276, cost_usd: 3.7848, dispatches: 5, cost_unmetered: 0

## Time
state: measured
active_ms: 21045650
provider_active_ms: 3824064
no_provider_active_ms: 17221586

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  implementationQuality: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
