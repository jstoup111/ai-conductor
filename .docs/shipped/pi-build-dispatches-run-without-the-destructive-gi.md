---
slug: pi-build-dispatches-run-without-the-destructive-gi
spec_hash: 46be3e69a49f72d67e967b57e75a82c2024360304930175381e1f6f371af8cfb
pr: https://github.com/jstoup111/ai-conductor/pull/3081
shipped: 2026-10-10
engine_version: 20261010T011143Z-f79d1fd8d7cd
---

## Cost
input: 947379
output: 87816
cache_read: 18100158
cache_creation: 382541
cost_usd: 14.1968
dispatches: 24
retries: 1
halts: 1
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 947277, output: 54623, cache_read: 16129024, cache_creation: 0, cost_usd: 10.0779, dispatches: 14, cost_unmetered: 0
  claude: input: 102, output: 33193, cache_read: 1971134, cache_creation: 382541, cost_usd: 4.1188, dispatches: 10, cost_unmetered: 0

## Time
state: partial
active_ms: 7059454
reason: provider-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
