---
slug: protected-artifact-halt-prints-no-recovery-command
spec_hash: 55a1ed64dbed0b45e1eabc073e7fe1282384e2692c40365a18b086e55c3e2fa5
pr: https://github.com/jstoup111/ai-conductor/pull/3372
shipped: 2026-10-23
engine_version: 20261023T034049Z-7407bc37137f
---

## Cost
input: 624654
output: 50007
cache_read: 11814555
cache_creation: 245343
cost_usd: 7.6977
dispatches: 11
retries: 1
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 624608, output: 36177, cache_read: 10878720, cache_creation: 0, cost_usd: 5.271, dispatches: 7, cost_unmetered: 0
  claude: input: 46, output: 13830, cache_read: 935835, cache_creation: 245343, cost_usd: 2.4267, dispatches: 4, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","5a72b2cf-3820-43d4-98fc-b517726a5d6a","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 1
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 1
  testQuality: failures: 0, judged: 1
skip_reasons:
  disabled: 1
