---
slug: config-validation-gaps-satisfiesversion-and-six-ot
spec_hash: 59e4e533a5ebf71e0a97888b75ab7860cf625e28270a13f3e569e38d863275ab
pr: https://github.com/jstoup111/ai-conductor/pull/2829
shipped: 2026-09-29
engine_version: 20260929T143128Z-78113f1e7e2f
---

## Cost
input: 2562573
output: 242251
cache_read: 38994233
cache_creation: 908158
cost_usd: 31.779
dispatches: 51
retries: 2
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2562305, output: 146802, cache_read: 32410112, cache_creation: 0, cost_usd: 18.7942, dispatches: 32, cost_unmetered: 0
  claude: input: 268, output: 95449, cache_read: 6584121, cache_creation: 908158, cost_usd: 12.9848, dispatches: 19, cost_unmetered: 0

## Time
state: measured
active_ms: 11904198
provider_active_ms: 7537451
no_provider_active_ms: 4366747

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
