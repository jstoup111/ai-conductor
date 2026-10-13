---
slug: skill-frontmatter-disagrees-with-the-engine-for-si
spec_hash: 5fba4f357632f67d2d0ae56db85341a8912ad285c40c63d06c9bb5901ec35778
pr: https://github.com/jstoup111/ai-conductor/pull/3217
shipped: 2026-10-13
engine_version: 20261013T130203Z-2b29223c4c95
---

## Cost
input: 408677
output: 39459
cache_read: 7055121
cache_creation: 165608
cost_usd: 5.3345
dispatches: 11
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 408615, output: 21143, cache_read: 5805952, cache_creation: 0, cost_usd: 3.3932, dispatches: 7, cost_unmetered: 0
  claude: input: 62, output: 18316, cache_read: 1249169, cache_creation: 165608, cost_usd: 1.9413, dispatches: 4, cost_unmetered: 0

## Time
state: measured
active_ms: 4320378
provider_active_ms: 2522274
no_provider_active_ms: 1798104

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 1
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
  disabled: 1
