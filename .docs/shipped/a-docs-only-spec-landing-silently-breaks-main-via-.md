---
slug: a-docs-only-spec-landing-silently-breaks-main-via-
spec_hash: af3b7029356da8f717381ad3691125a3a5e8df76315e806727cadf4ad5f2a3fc
pr: https://github.com/jstoup111/ai-conductor/pull/3168
shipped: 2026-10-11
engine_version: 20261011T003623Z-5f233d35b433
---

## Cost
input: 399530
output: 35794
cache_read: 7968959
cache_creation: 167696
cost_usd: 5.6291
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 399496, output: 23590, cache_read: 7380224, cache_creation: 0, cost_usd: 3.9256, dispatches: 6, cost_unmetered: 0
  claude: input: 34, output: 12204, cache_read: 588735, cache_creation: 167696, cost_usd: 1.7035, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 1984739
provider_active_ms: 1073109
no_provider_active_ms: 911630

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
