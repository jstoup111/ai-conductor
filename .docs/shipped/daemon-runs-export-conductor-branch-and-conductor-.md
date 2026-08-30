---
slug: daemon-runs-export-conductor-branch-and-conductor-
spec_hash: fee20cccb7c2b303bf0d38c3101ac4a235d91ec1c8a6c3657ba7b877367537aa
pr: https://github.com/jstoup111/ai-conductor/pull/2080
shipped: 2026-08-30
engine_version: 20260830T211057Z-8e7daae72ad7
---

## Cost
input: 1224482
output: 210765
cache_read: 33055482
cache_creation: 994780
cost_usd: 31.7183
dispatches: 32
retries: 2
halts: 2
unmetered: count: 10, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1224096, output: 79755, cache_read: 16178944, cache_creation: 0, cost_usd: 9.4541, dispatches: 12, cost_unmetered: 0
  claude: input: 386, output: 131010, cache_read: 16876538, cache_creation: 994780, cost_usd: 22.2642, dispatches: 10, cost_unmetered: 0

## Time
state: measured
active_ms: 5165524
provider_active_ms: 4636248
no_provider_active_ms: 529276

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 4
skip_reasons:
