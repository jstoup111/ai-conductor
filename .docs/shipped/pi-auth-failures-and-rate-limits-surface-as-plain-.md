---
slug: pi-auth-failures-and-rate-limits-surface-as-plain-
spec_hash: caa6771a873f9f01f34fdd61adb0c11a69bff9a0f9d34face60778488128017b
pr: https://github.com/jstoup111/ai-conductor/pull/3532
shipped: 2026-10-31
engine_version: 20261031T092626Z-5ecd86e21e59
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "No plan task covers these two unrelated test files. They de-flake pre-existing tests: one race and one probabilistic UUID match. Production behavior is unchanged and nothing is user-visible."
    accepted: false
    authority: engine
---

## Cost
input: 1342354
output: 815183
cache_read: 75223936
cache_creation: 2002143
cost_usd: 52.0059
dispatches: 77
retries: 3
halts: 0
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 4
providers:
  codex: input: 1341470, output: 82855, cache_read: 20138112, cache_creation: 0, cost_usd: 10.3215, dispatches: 17, cost_unmetered: 4
  claude: input: 884, output: 732328, cache_read: 55085824, cache_creation: 2002143, cost_usd: 41.6844, dispatches: 60, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4610826f-e0d9-41b1-b782-5c8618a2178b","lifecycle-step","finish"]

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
