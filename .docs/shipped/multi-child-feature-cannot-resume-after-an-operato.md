---
slug: multi-child-feature-cannot-resume-after-an-operato
spec_hash: f10c5e69f2078b29ccf9053a86f6c20247117c205d8e3a65a39d4ca79d6f0143
pr: https://github.com/jstoup111/ai-conductor/pull/3411
shipped: 2026-10-25
engine_version: 20261025T104004Z-5288497d86bd
---

## Cost
input: 8033739
output: 840181
cache_read: 256641198
cache_creation: 4457767
cost_usd: 131.0404
dispatches: 88
retries: 16
halts: 3
unmetered: count: 10, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 8033417, output: 680407, cache_read: 221111040, cache_creation: 0, cost_usd: 85.0755, dispatches: 67, cost_unmetered: 0
  claude: input: 322, output: 159774, cache_read: 35530158, cache_creation: 4457767, cost_usd: 45.9649, dispatches: 21, cost_unmetered: 0

## Time
state: partial
active_ms: 63212945
reason: provider-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 5
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:
  disabled: 5
