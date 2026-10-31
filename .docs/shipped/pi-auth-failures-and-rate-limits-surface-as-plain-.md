---
slug: pi-auth-failures-and-rate-limits-surface-as-plain-
spec_hash: caa6771a873f9f01f34fdd61adb0c11a69bff9a0f9d34face60778488128017b
pr: https://github.com/jstoup111/ai-conductor/pull/3532
shipped: 2026-10-31
engine_version: 20261031T092626Z-5ecd86e21e59
---

## Cost
input: 1359067
output: 815319
cache_read: 75258368
cache_creation: 2002143
cost_usd: 52.0059
dispatches: 78
retries: 3
halts: 0
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 5
providers:
  codex: input: 1358183, output: 82991, cache_read: 20172544, cache_creation: 0, cost_usd: 10.3215, dispatches: 18, cost_unmetered: 5
  claude: input: 884, output: 732328, cache_read: 55085824, cache_creation: 2002143, cost_usd: 41.6844, dispatches: 60, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 3
skipped: 3
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 2, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 3
skip_reasons:
  scope-empty: 3
