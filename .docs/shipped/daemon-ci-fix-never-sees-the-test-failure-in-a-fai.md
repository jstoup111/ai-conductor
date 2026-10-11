---
slug: daemon-ci-fix-never-sees-the-test-failure-in-a-fai
spec_hash: edcfb37d0e3270daaddcb593176dc3df6fb9f02e91e814843e9fbce77c3da858
pr: https://github.com/jstoup111/ai-conductor/pull/3175
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 417293
output: 39854
cache_read: 6502707
cache_creation: 129420
cost_usd: 4.7923
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 417247, output: 27768, cache_read: 5777024, cache_creation: 0, cost_usd: 3.3699, dispatches: 6, cost_unmetered: 0
  claude: input: 46, output: 12086, cache_read: 725683, cache_creation: 129420, cost_usd: 1.4224, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 2029178
provider_active_ms: 996876
no_provider_active_ms: 1032302

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
