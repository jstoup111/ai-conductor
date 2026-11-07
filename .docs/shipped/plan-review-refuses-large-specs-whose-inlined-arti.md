---
slug: plan-review-refuses-large-specs-whose-inlined-arti
spec_hash: 7d92d01ad6b51eeae2175e0abfdb77abfd4942b39b630857d0f9028d5a7f4194
pr: https://github.com/jstoup111/ai-conductor/pull/3425
shipped: 2026-10-25
engine_version: 20261025T145310Z-618ae4fcadec
---

## Cost
input: 1260060
output: 112715
cache_read: 21070678
cache_creation: 328354
cost_usd: 13.3123
dispatches: 21
retries: 7
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1259996, output: 87190, cache_read: 19503104, cache_creation: 0, cost_usd: 9.8612, dispatches: 16, cost_unmetered: 0
  claude: input: 64, output: 25525, cache_read: 1567574, cache_creation: 328354, cost_usd: 3.4511, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: not reached
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 1, judged: 1
skip_reasons:
  disabled: 1
