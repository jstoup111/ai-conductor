---
slug: verify-resume-halt-clear-and-post-one-resolved-com
spec_hash: ca37c882ebec96653d4369a11b59e4f8b60cc7a5e54921fd269b732ac265fe02
pr: https://github.com/jstoup111/ai-conductor/pull/2887
shipped: 2026-10-01
engine_version: 20260930T225148Z-18b2a2a206ea
---

## Cost
input: 655228
output: 58582
cache_read: 13408901
cache_creation: 265801
cost_usd: 7.6409
dispatches: 18
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 655152, output: 44048, cache_read: 12252288, cache_creation: 0, cost_usd: 5.0692, dispatches: 9, cost_unmetered: 0
  claude: input: 76, output: 14534, cache_read: 1156613, cache_creation: 265801, cost_usd: 2.5717, dispatches: 9, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 1, judged: 2
skip_reasons:
