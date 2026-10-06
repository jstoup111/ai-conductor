---
slug: engine-prompts-direct-daemon-sessions-to-ai-conduc
spec_hash: 339de4a50f4bda2fcde687278048524156fed6bb78b376a82aa3f3c5dec7f006
pr: https://github.com/jstoup111/ai-conductor/pull/2920
shipped: 2026-10-06
engine_version: 20261006T122043Z-5c4e39f1a089
---

## Cost
input: 9975543
output: 1023155
cache_read: 225153498
cache_creation: 4765821
cost_usd: 160.2485
dispatches: 139
retries: 12
halts: 23
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 9974427, output: 585602, cache_read: 177677952, cache_creation: 0, cost_usd: 92.0169, dispatches: 84, cost_unmetered: 0
  claude: input: 1116, output: 437553, cache_read: 47475546, cache_creation: 4765821, cost_usd: 68.2316, dispatches: 55, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 2
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 0, judged: 8
skip_reasons:
