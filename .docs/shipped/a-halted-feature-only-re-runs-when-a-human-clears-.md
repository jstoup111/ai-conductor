---
slug: a-halted-feature-only-re-runs-when-a-human-clears-
spec_hash: 756f5a90b8eba9377d2f840d376cd16c540a9d2197bc342bc955193a231baabc
pr: https://github.com/jstoup111/ai-conductor/pull/2206
shipped: 2026-09-09
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 8299754
output: 1425118
cache_read: 294673614
cache_creation: 6595866
cost_usd: 279.8972
dispatches: 130
retries: 21
halts: 14
unmetered: count: 25, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 8298082, output: 671998, cache_read: 196785920, cache_creation: 0, cost_usd: 84.2796, dispatches: 61, cost_unmetered: 0
  claude: input: 1672, output: 753120, cache_read: 97887694, cache_creation: 6595866, cost_usd: 195.6176, dispatches: 47, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 4, judged: 12
skip_reasons:
