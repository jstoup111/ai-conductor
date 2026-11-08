---
slug: manual-test-failure-routed-to-a-child-that-can-t-h
spec_hash: b7cac449040237af9d72799af1209901c3b1f64596da029dca52799566661523
pr: https://github.com/jstoup111/ai-conductor/pull/3655
shipped: 2026-11-08
engine_version: 20261108T000318Z-7a2ff38b78c5
---

## Cost
input: 3489654
output: 315049
cache_read: 71048052
cache_creation: 1898913
cost_usd: 49.9625
dispatches: 64
retries: 6
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3489426, output: 211383, cache_read: 63734016, cache_creation: 0, cost_usd: 31.2341, dispatches: 41, cost_unmetered: 0
  claude: input: 228, output: 103666, cache_read: 7314036, cache_creation: 1898913, cost_usd: 18.7283, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 1, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
