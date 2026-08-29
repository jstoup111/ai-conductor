---
slug: every-project-reports-the-same-otel-identity-so-me
spec_hash: 838b490894a46553da5ff794558d5220325cc49aa448693f77b87bee5437ef1d
pr: https://github.com/jstoup111/ai-conductor/pull/1971
shipped: 2026-08-29
engine_version: 20260829T034839Z-c08661797b2b
---

## Cost
input: 2742567
output: 409832
cache_read: 65982643
cache_creation: 2232124
cost_usd: 65.8461
dispatches: 66
retries: 0
halts: 8
unmetered: count: 22, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2741935, output: 205822, cache_read: 41872640, cache_creation: 0, cost_usd: 26.3664, dispatches: 21, cost_unmetered: 0
  claude: input: 632, output: 204010, cache_read: 24110003, cache_creation: 2232124, cost_usd: 39.4797, dispatches: 23, cost_unmetered: 0

## Time
state: measured
active_ms: 11923399
provider_active_ms: 8717232
no_provider_active_ms: 3206167

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 9
skip_reasons:
