---
slug: preserve-project-owned-pr-body-sections-through-fi
spec_hash: 81433db82eaf0b5dbb468ad9474fae726849e8ad2cd4774e2308034e535e4c59
pr: https://github.com/jstoup111/ai-conductor/pull/2777
shipped: 2026-09-29
engine_version: 20260929T224340Z-3ed99833a1db
---

## Cost
input: 6589105
output: 844775
cache_read: 148874986
cache_creation: 3486220
cost_usd: 127.2348
dispatches: 105
retries: 12
halts: 11
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 6588245, output: 417723, cache_read: 118579072, cache_creation: 0, cost_usd: 63.7028, dispatches: 56, cost_unmetered: 0
  claude: input: 860, output: 427052, cache_read: 30295914, cache_creation: 3486220, cost_usd: 63.5319, dispatches: 49, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 10
  testQuality: failures: 0, judged: 10
skip_reasons:
